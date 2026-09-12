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

import { db } from "../models/connection";
import {
    addresses,
    branches,
    food,
    variationOptions,
    restaurantZoneDeliveryFees,
    zones,
    branchMenuItems,
} from "../models/schema";
import { eq, and, inArray } from "drizzle-orm";
import { isLocationInZone } from "../utils/geo";
import { BadRequest } from "../Errors/BadRequest";
import { NotFound } from "../Errors/NotFound";
import { activeFoodCondition } from "./foodConditions";
import {
    fetchFoodOverrides,
    fetchVariantOverrides,
    parsePrice,
    pickBestOverride,
} from "./pricing.overrides";

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
 * from foodPricingOverrides / variantPricingOverrides + base prices.
 */
export const calculateCalculatedPrice = async (
    foodId: string,
    variantOptionIds: string[],
    branchId: string,
    serviceModule?: ServiceModule
): Promise<CalculatedPriceResult> => {
    const [foodRow, foodOverrides, branchMenuRow, variantOverrideRows, baseVariantRows] = await Promise.all([
        db.select({ price: food.price, status: food.status, isOutOfStock: food.isOutOfStock })
            .from(food)
            .where(and(eq(food.id, foodId), activeFoodCondition))
            .limit(1),
        fetchFoodOverrides(db, foodId, branchId, serviceModule),
        db.select({
            status: branchMenuItems.status,
            stockType: branchMenuItems.stockType,
            stockQty: branchMenuItems.stockQty,
        })
            .from(branchMenuItems)
            .where(and(eq(branchMenuItems.foodId, foodId), eq(branchMenuItems.branchId, branchId)))
            .limit(1),
        fetchVariantOverrides(db, variantOptionIds, branchId, serviceModule),
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

    const foodData = foodRow[0];
    if (!foodData) {
        throw new NotFound(`Food item not found: ${foodId}`);
    }

    const winningFoodOverride = pickBestOverride(foodOverrides);
    let basePrice = winningFoodOverride
        ? parsePrice(winningFoodOverride.price)
        : parsePrice(foodData.price as string);

    let isFoodAvailable = foodData.status !== "inactive" && !foodData.isOutOfStock;
    if (branchMenuRow.length > 0) {
        const row = branchMenuRow[0];
        if (row.status === "inactive") isFoodAvailable = false;
        if (row.stockType === "limited" && (row.stockQty ?? 0) <= 0) isFoodAvailable = false;
    }

    const resolvedVariants: VariantPriceResult[] = [];
    let totalVariantPrice = 0;
    const overridesByVariant = new Map<string, typeof variantOverrideRows>();
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

        const winning = pickBestOverride(overridesByVariant.get(optionId) ?? []);
        const varPrice = winning ? parsePrice(winning.price) : parsePrice(baseOption.additionalPrice as string);
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