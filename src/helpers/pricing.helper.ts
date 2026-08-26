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

import { db } from "../models/connection";
import {
    addresses,
    branches,
    food,
    variationOptions,
    restaurantZoneDeliveryFees,
    zones,
} from "../models/schema";
import {
    branchMenuItems,
    productChannelPricing,
    variantChannelPricing,
    branchVariantPricing,
} from "../models/schema/admin/channelPricing";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { isLocationInZone } from "../utils/geo";
import { BadRequest } from "../Errors/BadRequest";
import { NotFound } from "../Errors/NotFound";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type ServiceModule = "takeaway" | "dine_in" | "delivery";

export type VariantPriceResult = {
    variantOptionId: string;
    price: number;
    isAvailable: boolean;
};

export type CalculatedPriceResult = {
    /** Resolved base price after cascade */
    basePrice: number;
    /** false if any pricing tier marks the food as inactive/OOS */
    isAvailable: boolean;
    /** Per-variant resolution results */
    variants: VariantPriceResult[];
    /** basePrice + sum of variant prices */
    totalUnitPrice: number;
};

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
export const resolveBranchIdFromAddress = async (
    addressId: string,
    restaurantId: string
): Promise<string> => {
    // 1. Fetch the address lat/lng
    const [address] = await db
        .select({ lat: addresses.lat, lng: addresses.lng, zoneId: addresses.zoneId })
        .from(addresses)
        .where(eq(addresses.id, addressId))
        .limit(1);

    if (!address) {
        throw new NotFound("Delivery address not found.");
    }

    const lat = parseFloat(address.lat || "0");
    const lng = parseFloat(address.lng || "0");

    if (!lat || !lng) {
        throw new BadRequest(
            "Delivery address requires valid latitude and longitude coordinates."
        );
    }

    // 2. Fetch all active delivery zones for this restaurant (with zone geometry)
    const restaurantFees = await db
        .select({
            id: restaurantZoneDeliveryFees.id,
            zoneId: restaurantZoneDeliveryFees.zoneId,
            branchId: restaurantZoneDeliveryFees.branchId,
            deliveryFee: restaurantZoneDeliveryFees.deliveryFee,
            coverageType: restaurantZoneDeliveryFees.coverageType,
            customCoordinates: restaurantZoneDeliveryFees.customCoordinates,
            customRadiusKm: restaurantZoneDeliveryFees.customRadiusKm,
            defaultCoordinates: zones.coordinates,
            defaultRadiusKm: zones.coverageAreaRadiusKm,
        })
        .from(restaurantZoneDeliveryFees)
        .leftJoin(zones, eq(restaurantZoneDeliveryFees.zoneId, zones.id))
        .where(
            and(
                eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
                eq(restaurantZoneDeliveryFees.status, "active")
            )
        );

    // 3. Find the best-matching zone (highest delivery fee that covers the address)
    let matchedFee: (typeof restaurantFees)[number] | null = null;
    let maxDeliveryFee = -1;

    for (const fee of restaurantFees) {
        if (isLocationInZone(lat, lng, fee.zoneId, fee)) {
            const currentFee = parseFloat((fee as any).deliveryFee || "0");
            if (matchedFee === null || currentFee > maxDeliveryFee) {
                maxDeliveryFee = currentFee;
                matchedFee = fee;
            }
        }
    }

    if (!matchedFee) {
        throw new BadRequest(
            "Delivery is not available for your selected address. Please choose a different address or contact support."
        );
    }

    // 4a. Fee has a dedicated branch → use it
    if (matchedFee.branchId) {
        return matchedFee.branchId;
    }

    // 4b. No dedicated branch → find an active branch in that zone
    if (matchedFee.zoneId) {
        const [branch] = await db
            .select({ id: branches.id })
            .from(branches)
            .where(
                and(
                    eq(branches.restaurantId, restaurantId),
                    eq(branches.zoneId, matchedFee.zoneId),
                    eq(branches.status, "active")
                )
            )
            .limit(1);

        if (branch) return branch.id;
    }

    throw new NotFound(
        "No active branch found serving your delivery zone. Please try again later."
    );
};

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
export const calculateCalculatedPrice = async (
    foodId: string,
    variantOptionIds: string[],
    branchId: string,
    serviceModule: ServiceModule
): Promise<CalculatedPriceResult> => {
    // ─── Parallel batch fetch ───────────────────────────────────────────
    const [
        foodRow,
        // Food channel pricing — branch-specific
        channelBranchRows,
        // Food channel pricing — global (branchId IS NULL)
        channelGlobalRows,
        // Branch menu item override
        branchMenuRow,
        // Variant channel pricing — branch-specific (all selected variants)
        variantChannelBranchRows,
        // Variant channel pricing — global (all selected variants)
        variantChannelGlobalRows,
        // Branch variant pricing overrides
        branchVariantRows,
        // Base variant option prices
        baseVariantRows,
    ] = await Promise.all([
        // Food base
        db.select({ price: food.price, status: food.status, isOutOfStock: food.isOutOfStock })
            .from(food)
            .where(eq(food.id, foodId))
            .limit(1),

        // A. productChannelPricing — branch-specific
        db.select({ price: productChannelPricing.price, status: productChannelPricing.status })
            .from(productChannelPricing)
            .where(
                and(
                    eq(productChannelPricing.foodId, foodId),
                    eq(productChannelPricing.branchId, branchId),
                    eq(productChannelPricing.serviceModule, serviceModule)
                )
            )
            .limit(1),

        // B. productChannelPricing — global channel default
        db.select({ price: productChannelPricing.price, status: productChannelPricing.status })
            .from(productChannelPricing)
            .where(
                and(
                    eq(productChannelPricing.foodId, foodId),
                    eq(productChannelPricing.serviceModule, serviceModule),
                    isNull(productChannelPricing.branchId)
                )
            )
            .limit(1),

        // C. branchMenuItems — branch override
        db.select({
                price: branchMenuItems.price,
                status: branchMenuItems.status,
                stockType: branchMenuItems.stockType,
                stockQty: branchMenuItems.stockQty,
            })
            .from(branchMenuItems)
            .where(
                and(
                    eq(branchMenuItems.foodId, foodId),
                    eq(branchMenuItems.branchId, branchId)
                )
            )
            .limit(1),

        // Variant queries — only run if there are variants selected
        variantOptionIds.length > 0
            ? db.select({
                    variantId: variantChannelPricing.variantId,
                    price: variantChannelPricing.price,
                    status: variantChannelPricing.status,
                })
                .from(variantChannelPricing)
                .where(
                    and(
                        inArray(variantChannelPricing.variantId, variantOptionIds),
                        eq(variantChannelPricing.branchId, branchId),
                        eq(variantChannelPricing.serviceModule, serviceModule)
                    )
                )
            : Promise.resolve([]),

        variantOptionIds.length > 0
            ? db.select({
                    variantId: variantChannelPricing.variantId,
                    price: variantChannelPricing.price,
                    status: variantChannelPricing.status,
                })
                .from(variantChannelPricing)
                .where(
                    and(
                        inArray(variantChannelPricing.variantId, variantOptionIds),
                        eq(variantChannelPricing.serviceModule, serviceModule),
                        isNull(variantChannelPricing.branchId)
                    )
                )
            : Promise.resolve([]),

        variantOptionIds.length > 0
            ? db.select({
                    variantId: branchVariantPricing.variantId,
                    price: branchVariantPricing.price,
                    status: branchVariantPricing.status,
                })
                .from(branchVariantPricing)
                .where(
                    and(
                        inArray(branchVariantPricing.variantId, variantOptionIds),
                        eq(branchVariantPricing.branchId, branchId)
                    )
                )
            : Promise.resolve([]),

        variantOptionIds.length > 0
            ? db.select({
                    id: variationOptions.id,
                    additionalPrice: variationOptions.additionalPrice,
                    status: variationOptions.status,
                })
                .from(variationOptions)
                .where(inArray(variationOptions.id, variantOptionIds))
            : Promise.resolve([]),
    ]);

    // ─── Resolve food base price ────────────────────────────────────────
    const foodData = foodRow[0];
    if (!foodData) {
        throw new NotFound(`Food item not found: ${foodId}`);
    }

    let basePrice = parseFloat(foodData.price as string || "0");
    let isFoodAvailable = foodData.status !== "inactive" && !foodData.isOutOfStock;

    // A. Branch-specific channel pricing (highest priority)
    if (channelBranchRows.length > 0) {
        const row = channelBranchRows[0];
        basePrice = parseFloat(row.price as string || "0");
        if (row.status === "inactive") isFoodAvailable = false;
    }
    // B. Global channel pricing (second priority)
    else if (channelGlobalRows.length > 0) {
        const row = channelGlobalRows[0];
        basePrice = parseFloat(row.price as string || "0");
        if (row.status === "inactive") isFoodAvailable = false;
    }
    // C. Branch menu item override (third priority)
    else if (branchMenuRow.length > 0) {
        const row = branchMenuRow[0];
        if (row.price !== null && row.price !== undefined) {
            basePrice = parseFloat(row.price as string || "0");
        }
        if (row.status === "inactive") isFoodAvailable = false;
        if (row.stockType === "limited" && (row.stockQty ?? 0) <= 0) isFoodAvailable = false;
    }
    // D. food.price — already set as basePrice above

    // ─── Resolve variant prices ─────────────────────────────────────────
    const resolvedVariants: VariantPriceResult[] = [];
    let totalVariantPrice = 0;

    // Build lookup maps for O(1) access
    const vcBranchMap = new Map(variantChannelBranchRows.map(r => [r.variantId, r]));
    const vcGlobalMap = new Map(variantChannelGlobalRows.map(r => [r.variantId, r]));
    const bvMap = new Map(branchVariantRows.map(r => [r.variantId, r]));
    const baseVarMap = new Map(baseVariantRows.map(r => [r.id, r]));

    for (const optionId of variantOptionIds) {
        const baseOption = baseVarMap.get(optionId);
        let varPrice = parseFloat((baseOption?.additionalPrice as string) || "0");
        let varAvailable = baseOption ? baseOption.status !== false : true;

        // A. Variant channel — branch-specific
        const vcBranch = vcBranchMap.get(optionId);
        if (vcBranch) {
            varPrice = parseFloat(vcBranch.price as string || "0");
            if (vcBranch.status === "inactive") varAvailable = false;
        }
        // B. Variant channel — global
        else if (vcGlobalMap.get(optionId)) {
            const vcGlobal = vcGlobalMap.get(optionId)!;
            varPrice = parseFloat(vcGlobal.price as string || "0");
            if (vcGlobal.status === "inactive") varAvailable = false;
        }
        // C. Branch variant pricing
        else if (bvMap.get(optionId)) {
            const bv = bvMap.get(optionId)!;
            varPrice = parseFloat(bv.price as string || "0");
            if (bv.status === "inactive") varAvailable = false;
        }
        // D. Base variant price — already set above

        totalVariantPrice += varPrice;
        resolvedVariants.push({
            variantOptionId: optionId,
            price: varPrice,
            isAvailable: varAvailable,
        });
    }

    const hasUnavailableVariant = resolvedVariants.some(v => !v.isAvailable);

    return {
        basePrice,
        isAvailable: isFoodAvailable && !hasUnavailableVariant,
        variants: resolvedVariants,
        totalUnitPrice: basePrice + totalVariantPrice,
    };
};
