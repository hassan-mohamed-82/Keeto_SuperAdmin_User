"use strict";
// src/helpers/pricing.helper.ts
/**
 * Multi-Tier Channel Pricing Engine
 *
 * Provides two core primitives:
 *  1. resolveBranchIdFromAddress — geo-based branch resolver for delivery orders
 *  2. calculateCalculatedPrice   — 4-tier price cascade per food + variants
 *
 * Pricing priority (highest → lowest):
 *  Food Base Price:
 *    A. productChannelPricing (foodId + branchId + serviceModule)
 *    B. productChannelPricing (foodId + serviceModule, branchId IS NULL)  — global channel default
 *    C. branchMenuItems       (foodId + branchId)
 *    D. food.price            — raw base price
 *
 *  Variant Option Price:
 *    A. variantChannelPricing (variantId + branchId + serviceModule)
 *    B. variantChannelPricing (variantId + serviceModule, branchId IS NULL) — global channel default
 *    C. branchVariantPricing  (variantId + branchId)
 *    D. variationOptions.additionalPrice — base variant price
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateCalculatedPrice = exports.resolveBranchIdFromAddress = void 0;
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const channelPricing_1 = require("../models/schema/admin/channelPricing");
const drizzle_orm_1 = require("drizzle-orm");
const geo_1 = require("../utils/geo");
const BadRequest_1 = require("../Errors/BadRequest");
const NotFound_1 = require("../Errors/NotFound");
// ─────────────────────────────────────────────
// 1. resolveBranchIdFromAddress
// ─────────────────────────────────────────────
/**
 * Resolves the active branchId for a delivery order by geo-matching the
 * customer's address against the restaurant's `restaurant_zone_delivery_fees`.
 *
 * Priority:
 *  1. Fee record has an explicit branchId → use it directly.
 *  2. No explicit branchId → find an active branch in the same zone.
 *
 * Throws:
 *  - BadRequest  — address coordinates missing or outside delivery coverage.
 *  - NotFound    — no active branch found for the matched zone.
 */
const resolveBranchIdFromAddress = async (addressId, restaurantId) => {
    // 1. Fetch the address lat/lng
    const [address] = await connection_1.db
        .select({ lat: schema_1.addresses.lat, lng: schema_1.addresses.lng, zoneId: schema_1.addresses.zoneId })
        .from(schema_1.addresses)
        .where((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId))
        .limit(1);
    if (!address) {
        throw new NotFound_1.NotFound("Delivery address not found.");
    }
    const lat = parseFloat(address.lat || "0");
    const lng = parseFloat(address.lng || "0");
    if (!lat || !lng) {
        throw new BadRequest_1.BadRequest("Delivery address requires valid latitude and longitude coordinates.");
    }
    // 2. Fetch all active delivery zones for this restaurant (with zone geometry)
    const restaurantFees = await connection_1.db
        .select({
        id: schema_1.restaurantZoneDeliveryFees.id,
        zoneId: schema_1.restaurantZoneDeliveryFees.zoneId,
        branchId: schema_1.restaurantZoneDeliveryFees.branchId,
        deliveryFee: schema_1.restaurantZoneDeliveryFees.deliveryFee,
        coverageType: schema_1.restaurantZoneDeliveryFees.coverageType,
        customCoordinates: schema_1.restaurantZoneDeliveryFees.customCoordinates,
        customRadiusKm: schema_1.restaurantZoneDeliveryFees.customRadiusKm,
        defaultCoordinates: schema_1.zones.coordinates,
        defaultRadiusKm: schema_1.zones.coverageAreaRadiusKm,
    })
        .from(schema_1.restaurantZoneDeliveryFees)
        .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.zoneId, schema_1.zones.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.status, "active")));
    // 3. Find the best-matching zone (highest delivery fee that covers the address)
    let matchedFee = null;
    let maxDeliveryFee = -1;
    for (const fee of restaurantFees) {
        if ((0, geo_1.isLocationInZone)(lat, lng, fee.zoneId, fee)) {
            const currentFee = parseFloat(fee.deliveryFee || "0");
            if (matchedFee === null || currentFee > maxDeliveryFee) {
                maxDeliveryFee = currentFee;
                matchedFee = fee;
            }
        }
    }
    if (!matchedFee) {
        throw new BadRequest_1.BadRequest("Delivery is not available for your selected address. Please choose a different address or contact support.");
    }
    // 4a. Fee has a dedicated branch → use it
    if (matchedFee.branchId) {
        return matchedFee.branchId;
    }
    // 4b. No dedicated branch → find an active branch in that zone
    if (matchedFee.zoneId) {
        const [branch] = await connection_1.db
            .select({ id: schema_1.branches.id })
            .from(schema_1.branches)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.branches.zoneId, matchedFee.zoneId), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")))
            .limit(1);
        if (branch)
            return branch.id;
    }
    throw new NotFound_1.NotFound("No active branch found serving your delivery zone. Please try again later.");
};
exports.resolveBranchIdFromAddress = resolveBranchIdFromAddress;
// ─────────────────────────────────────────────
// 2. calculateCalculatedPrice
// ─────────────────────────────────────────────
/**
 * Resolves the effective price for a food item + its selected variant options
 * using the 4-tier pricing cascade.
 *
 * All DB queries are executed in parallel via Promise.all for performance.
 * Availability collapses to false if ANY tier marks the item as inactive.
 */
const calculateCalculatedPrice = async (foodId, variantOptionIds, branchId, serviceModule) => {
    // ─── Parallel batch fetch ───────────────────────────────────────────
    const [foodRow, 
    // Food channel pricing — branch-specific
    channelBranchRows, 
    // Food channel pricing — global
    channelGlobalRows, 
    // Branch menu item override
    branchMenuRow, 
    // Variant channel pricing — branch-specific
    variantChannelBranchRows, 
    // Variant channel pricing — global
    variantChannelGlobalRows, 
    // Branch variant pricing overrides
    branchVariantRows, 
    // Base variant option prices
    baseVariantRows,] = await Promise.all([
        // Food base
        connection_1.db.select({ price: schema_1.food.price, status: schema_1.food.status, isOutOfStock: schema_1.food.isOutOfStock })
            .from(schema_1.food)
            .where((0, drizzle_orm_1.eq)(schema_1.food.id, foodId))
            .limit(1),
        // A. productChannelPricing — branch-specific
        connection_1.db.select({ price: channelPricing_1.productChannelPricing.price, status: channelPricing_1.productChannelPricing.status })
            .from(channelPricing_1.productChannelPricing)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(channelPricing_1.productChannelPricing.foodId, foodId), (0, drizzle_orm_1.eq)(channelPricing_1.productChannelPricing.branchId, branchId), serviceModule ? (0, drizzle_orm_1.eq)(channelPricing_1.productChannelPricing.serviceModule, serviceModule) : undefined))
            .limit(1),
        // B. productChannelPricing — global channel default
        connection_1.db.select({ price: channelPricing_1.productChannelPricing.price, status: channelPricing_1.productChannelPricing.status })
            .from(channelPricing_1.productChannelPricing)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(channelPricing_1.productChannelPricing.foodId, foodId), (0, drizzle_orm_1.isNull)(channelPricing_1.productChannelPricing.branchId), serviceModule ? (0, drizzle_orm_1.eq)(channelPricing_1.productChannelPricing.serviceModule, serviceModule) : undefined))
            .limit(1),
        // C. branchMenuItems — branch override
        connection_1.db.select({
            price: channelPricing_1.branchMenuItems.price,
            status: channelPricing_1.branchMenuItems.status,
            stockType: channelPricing_1.branchMenuItems.stockType,
            stockQty: channelPricing_1.branchMenuItems.stockQty,
        })
            .from(channelPricing_1.branchMenuItems)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(channelPricing_1.branchMenuItems.foodId, foodId), (0, drizzle_orm_1.eq)(channelPricing_1.branchMenuItems.branchId, branchId)))
            .limit(1),
        // Variant channel pricing — branch-specific
        variantOptionIds.length > 0
            ? connection_1.db.select({
                variantId: channelPricing_1.variantChannelPricing.variantId,
                price: channelPricing_1.variantChannelPricing.price,
                status: channelPricing_1.variantChannelPricing.status,
            })
                .from(channelPricing_1.variantChannelPricing)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(channelPricing_1.variantChannelPricing.variantId, variantOptionIds), (0, drizzle_orm_1.eq)(channelPricing_1.variantChannelPricing.branchId, branchId), serviceModule ? (0, drizzle_orm_1.eq)(channelPricing_1.variantChannelPricing.serviceModule, serviceModule) : undefined))
            : Promise.resolve([]),
        // Variant channel pricing — global
        variantOptionIds.length > 0
            ? connection_1.db.select({
                variantId: channelPricing_1.variantChannelPricing.variantId,
                price: channelPricing_1.variantChannelPricing.price,
                status: channelPricing_1.variantChannelPricing.status,
            })
                .from(channelPricing_1.variantChannelPricing)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(channelPricing_1.variantChannelPricing.variantId, variantOptionIds), (0, drizzle_orm_1.isNull)(channelPricing_1.variantChannelPricing.branchId), serviceModule ? (0, drizzle_orm_1.eq)(channelPricing_1.variantChannelPricing.serviceModule, serviceModule) : undefined))
            : Promise.resolve([]),
        // Branch variant pricing overrides
        variantOptionIds.length > 0
            ? connection_1.db.select({
                variantId: channelPricing_1.branchVariantPricing.variantId,
                price: channelPricing_1.branchVariantPricing.price,
                status: channelPricing_1.branchVariantPricing.status,
            })
                .from(channelPricing_1.branchVariantPricing)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(channelPricing_1.branchVariantPricing.variantId, variantOptionIds), (0, drizzle_orm_1.eq)(channelPricing_1.branchVariantPricing.branchId, branchId)))
            : Promise.resolve([]),
        // Base variant option prices
        variantOptionIds.length > 0
            ? connection_1.db.select({
                id: schema_1.variationOptions.id,
                additionalPrice: schema_1.variationOptions.additionalPrice,
                status: schema_1.variationOptions.status,
            })
                .from(schema_1.variationOptions)
                .where((0, drizzle_orm_1.inArray)(schema_1.variationOptions.id, variantOptionIds))
            : Promise.resolve([]),
    ]);
    // ─── Resolve food base price ────────────────────────────────────────
    const foodData = foodRow[0];
    if (!foodData) {
        throw new NotFound_1.NotFound(`Food item not found: ${foodId}`);
    }
    let basePrice = parseFloat(foodData.price || "0");
    let isFoodAvailable = foodData.status !== "inactive" && !foodData.isOutOfStock;
    // 1. تسعير القناة الخاص بالفرع
    if (channelBranchRows.length > 0) {
        const row = channelBranchRows[0];
        basePrice = parseFloat(row.price || "0");
        if (row.status === "inactive")
            isFoodAvailable = false;
    }
    // 2. تسعير القناة العام
    else if (channelGlobalRows.length > 0) {
        const row = channelGlobalRows[0];
        basePrice = parseFloat(row.price || "0");
        if (row.status === "inactive")
            isFoodAvailable = false;
    }
    // 3. تسعير الفرع المباشر (Fallback)
    else if (branchMenuRow.length > 0) {
        const row = branchMenuRow[0];
        if (row.price !== null && row.price !== undefined) {
            basePrice = parseFloat(row.price || "0");
        }
        if (row.status === "inactive")
            isFoodAvailable = false;
        if (row.stockType === "limited" && (row.stockQty ?? 0) <= 0)
            isFoodAvailable = false;
    }
    // 4. food.price العام
    // ─── Resolve variant prices ─────────────────────────────────────────
    const resolvedVariants = [];
    let totalVariantPrice = 0;
    const vcBranchMap = new Map(variantChannelBranchRows.map((r) => [r.variantId, r]));
    const vcGlobalMap = new Map(variantChannelGlobalRows.map((r) => [r.variantId, r]));
    const bvMap = new Map(branchVariantRows.map((r) => [r.variantId, r]));
    const baseVarMap = new Map(baseVariantRows.map((r) => [r.id, r]));
    for (const optionId of variantOptionIds) {
        const baseOption = baseVarMap.get(optionId);
        let varPrice = parseFloat(baseOption?.additionalPrice || "0");
        let varAvailable = baseOption ? baseOption.status !== false : true;
        if (vcBranchMap.get(optionId)) {
            const vcBranch = vcBranchMap.get(optionId);
            varPrice = parseFloat(vcBranch.price || "0");
            if (vcBranch.status === "inactive")
                varAvailable = false;
        }
        // Variant channel pricing — global
        else if (vcGlobalMap.get(optionId)) {
            const vcGlobal = vcGlobalMap.get(optionId);
            varPrice = parseFloat(vcGlobal.price || "0");
            if (vcGlobal.status === "inactive")
                varAvailable = false;
        }
        // Branch variant pricing
        else if (bvMap.get(optionId)) {
            const bv = bvMap.get(optionId);
            varPrice = parseFloat(bv.price || "0");
            if (bv.status === "inactive")
                varAvailable = false;
        }
        // Base variant price — already set above
        totalVariantPrice += varPrice;
        resolvedVariants.push({
            variantOptionId: optionId,
            price: varPrice,
            isAvailable: varAvailable,
        });
    }
    const hasUnavailableVariant = resolvedVariants.some((v) => !v.isAvailable);
    return {
        basePrice,
        isAvailable: isFoodAvailable && !hasUnavailableVariant,
        variants: resolvedVariants,
        totalUnitPrice: basePrice + totalVariantPrice,
    };
};
exports.calculateCalculatedPrice = calculateCalculatedPrice;
