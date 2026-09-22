"use strict";
// src/helpers/pricing.helper.ts
/**
 * Multi-Tier Channel Pricing Engine
 *
 * Pricing cascade (single override source):
 *   1. foodPricingOverrides / variantPricingOverrides (branch + module)
 *   2. override (branch, module = NULL)
 *   3. override (branch = NULL, module)
 *   4. food.price / variationOptions.additionalPrice
 *
 * branchMenuItems is inventory/availability only (status, stockType, stockQty).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateCalculatedPrice = exports.resolveBranchIdFromAddress = void 0;
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const geo_1 = require("../utils/geo");
const BadRequest_1 = require("../Errors/BadRequest");
const NotFound_1 = require("../Errors/NotFound");
const foodConditions_1 = require("./foodConditions");
const pricing_overrides_1 = require("./pricing.overrides");
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
 * from foodPricingOverrides / variantPricingOverrides + base prices.
 */
const calculateCalculatedPrice = async (foodId, variantOptionIds, branchId, serviceModule) => {
    const [foodRow, foodOverrides, branchMenuRow, variantOverrideRows, baseVariantRows] = await Promise.all([
        connection_1.db.select({ price: schema_1.food.price, status: schema_1.food.status, isOutOfStock: schema_1.food.isOutOfStock })
            .from(schema_1.food)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.id, foodId), foodConditions_1.activeFoodCondition))
            .limit(1),
        (0, pricing_overrides_1.fetchFoodOverrides)(connection_1.db, foodId, branchId, serviceModule),
        branchId
            ? connection_1.db.select({
                status: schema_1.branchMenuItems.status,
                stockType: schema_1.branchMenuItems.stockType,
                stockQty: schema_1.branchMenuItems.stockQty,
            })
                .from(schema_1.branchMenuItems)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branchMenuItems.foodId, foodId), (0, drizzle_orm_1.eq)(schema_1.branchMenuItems.branchId, branchId)))
                .limit(1)
            : Promise.resolve([]),
        (0, pricing_overrides_1.fetchVariantOverrides)(connection_1.db, variantOptionIds, branchId, serviceModule),
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
    const foodData = foodRow[0];
    if (!foodData) {
        throw new NotFound_1.NotFound(`Food item not found: ${foodId}`);
    }
    const winningFoodOverride = (0, pricing_overrides_1.pickBestOverride)(foodOverrides);
    let basePrice = winningFoodOverride
        ? (0, pricing_overrides_1.parsePrice)(winningFoodOverride.price)
        : (0, pricing_overrides_1.parsePrice)(foodData.price);
    let isFoodAvailable = foodData.status !== "inactive" && !foodData.isOutOfStock;
    if (branchMenuRow.length > 0) {
        const row = branchMenuRow[0];
        if (row.status === "inactive")
            isFoodAvailable = false;
        if (row.stockType === "limited" && (row.stockQty ?? 0) <= 0)
            isFoodAvailable = false;
    }
    const resolvedVariants = [];
    let totalVariantPrice = 0;
    const overridesByVariant = new Map();
    for (const row of variantOverrideRows) {
        const list = overridesByVariant.get(row.variantId) ?? [];
        list.push(row);
        overridesByVariant.set(row.variantId, list);
    }
    const baseVarMap = new Map(baseVariantRows.map((r) => [r.id, r]));
    for (const optionId of variantOptionIds) {
        const baseOption = baseVarMap.get(optionId);
        if (!baseOption) {
            resolvedVariants.push({ variantOptionId: optionId, price: 0, isAvailable: false });
            continue;
        }
        const winning = (0, pricing_overrides_1.pickBestOverride)(overridesByVariant.get(optionId) ?? []);
        const varPrice = winning ? (0, pricing_overrides_1.parsePrice)(winning.price) : (0, pricing_overrides_1.parsePrice)(baseOption.additionalPrice);
        const varAvailable = baseOption.status !== false;
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
