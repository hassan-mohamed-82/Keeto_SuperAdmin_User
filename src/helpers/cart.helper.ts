// src/helpers/cart.helper.ts
import { db } from "../models/connection";
import { addresses, branches, restaurantZoneDeliveryFees, zones } from "../models/schema";
import { eq, and } from "drizzle-orm";
import { isLocationInZone } from "../utils/geo";
import { BadRequest } from "../Errors/BadRequest";
import { type BranchInfo, getUnavailableBranchesForFoods } from "./food.helper";

/**
 * Resolves the target branchId for a given restaurant + address/branchId input.
 *
 * ─ If branchId is provided directly → return it as-is.
 * ─ If addressId is provided → fetch the address lat/lng, then check the
 *   restaurant's own delivery zones (restaurant_zone_delivery_fees) using
 *   isLocationInZone (polygon/radius geo check) to find which zone covers
 *   the address.
 *   • Returns the branchId on that fee record directly (if set), OR
 *   • Falls back to finding an active branch for the restaurant in that zone.
 *
 * WHY: The old resolveBranchId used the generic zones table via address.zoneId.
 * That is WRONG because zones are shared across restaurants — a zone may exist
 * in the system but a specific restaurant may NOT deliver to it.
 * restaurant_zone_delivery_fees is the source of truth for each restaurant's
 * actual delivery coverage.
 */
export const resolveBranchIdForCart = async (
    branchId?: string,
    addressId?: string,
    restaurantId?: string
): Promise<string | null> => {
    // 1. Direct branchId — nothing to resolve
    if (branchId) return branchId;

    // 2. No address either — cannot resolve
    if (!addressId) return null;

    // 3. Fetch the address (lat, lng, fallback zoneId)
    const [address] = await db
        .select({ lat: addresses.lat, lng: addresses.lng, zoneId: addresses.zoneId })
        .from(addresses)
        .where(eq(addresses.id, addressId))
        .limit(1);

    if (!address) return null;

    const lat = parseFloat(address.lat || "0");
    const lng = parseFloat(address.lng || "0");

    // 4. Precise geo check using restaurant-specific delivery zones
    if (lat && lng && restaurantId) {
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

        // Find the restaurant delivery zone with the highest delivery fee whose polygon/radius covers the address
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

        if (matchedFee) {
            // 4a. Fee has a dedicated branch → use it directly
            if (matchedFee.branchId) return matchedFee.branchId;

            // 4b. No branch on fee → find an active branch for the restaurant in that zone
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
        }

        // Address is outside this restaurant's delivery coverage
        return null;
    }

    // 5. Fallback: address has no coordinates → use stored zoneId (legacy behaviour)
    if (address.zoneId) {
        const conditions: ReturnType<typeof eq>[] = [eq(branches.zoneId, address.zoneId)];
        if (restaurantId) conditions.push(eq(branches.restaurantId, restaurantId));

        const [branch] = await db
            .select({ id: branches.id })
            .from(branches)
            .where(and(...conditions))
            .limit(1);

        if (branch) return branch.id;
    }

    return null;
};

/**
 * Validates whether a single food item is available at the branch
 * that the restaurant delivers to for the given address.
 *
 * Throws a BadRequest if the food is marked unavailable at that branch.
 * Silently returns if no branch can be resolved (delivery zone not found).
 */
export const validateFoodAvailabilityForCart = async (
    foodId: string,
    branchId?: string,
    addressId?: string,
    restaurantId?: string
): Promise<void> => {
    const targetBranchId = await resolveBranchIdForCart(branchId, addressId, restaurantId);

    if (!targetBranchId) return;

    const unavailableMap = await getUnavailableBranchesForFoods([foodId]);
    const unavailableBranches = unavailableMap.get(foodId) || [];

    const isUnavailable = unavailableBranches.some((b: BranchInfo) => b.id === targetBranchId);

    if (isUnavailable) {
        if (branchId) {
            throw new BadRequest("This item is currently unavailable in the selected branch.");
        }
        if (addressId) {
            throw new BadRequest("This item is currently unavailable for delivery to your selected address.");
        }
        throw new BadRequest("This item is currently unavailable at your location.");
    }
};

// Re-export for convenience
export type { BranchInfo };


