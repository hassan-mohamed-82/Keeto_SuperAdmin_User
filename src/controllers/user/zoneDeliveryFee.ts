import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    restaurantZoneDeliveryFees,
    restaurants,
    zones,
    branches,
} from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { isLocationInZone } from "../../utils/geo";

// ============================================================
// GET Zone & Delivery Fee
// POST /api/v1/user/zone-delivery-fee
//
// Public endpoint — accepts { restaurantId, lat, lng, branchId? }
// Returns the matched zone + delivery fee from restaurant_zone_delivery_fees.
// Uses the same isLocationInZone engine as checkout, ensuring fee shown
// to the user ALWAYS matches fee charged at order time.
// ============================================================
export const getZoneAndDeliveryFee = async (req: Request, res: Response) => {
    const { restaurantId, lat, lng, branchId } = req.body;

    // ── 1. Validate restaurant exists ──────────────────────────────
    const [restaurant] = await db
        .select({ id: restaurants.id, name: restaurants.name })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

    if (!restaurant) {
        throw new BadRequest("Restaurant not found.");
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    if (isNaN(userLat) || isNaN(userLng)) {
        throw new BadRequest("Invalid coordinates provided.");
    }

    // ── 2. Fetch all active restaurant zone delivery fees ──────────
    // Sourced from restaurant_zone_delivery_fees (admin-configured per restaurant)
    // joined with global zones table for zone name/nameAr
    const restaurantFees = await db
        .select({
            id: restaurantZoneDeliveryFees.id,
            zoneId: restaurantZoneDeliveryFees.zoneId,
            branchId: restaurantZoneDeliveryFees.branchId,
            deliveryFee: restaurantZoneDeliveryFees.deliveryFee,
            minOrderAmount: restaurantZoneDeliveryFees.minOrderAmount,
            coverageType: restaurantZoneDeliveryFees.coverageType,
            customCoordinates: restaurantZoneDeliveryFees.customCoordinates,
            customRadiusKm: restaurantZoneDeliveryFees.customRadiusKm,
            // Zone defaults from the global zone record
            defaultCoordinates: zones.coordinates,
            defaultRadiusKm: zones.coverageAreaRadiusKm,
            zoneName: zones.name,
            zoneNameAr: zones.nameAr,
        })
        .from(restaurantZoneDeliveryFees)
        .leftJoin(zones, eq(restaurantZoneDeliveryFees.zoneId, zones.id))
        .where(
            and(
                eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
                eq(restaurantZoneDeliveryFees.status, "active"),
                // Filter by branchId if provided
                branchId ? eq(restaurantZoneDeliveryFees.branchId, branchId) : undefined
            )
        );

    // ── 3. Find the applicable zone (highest fee — same as checkout) ─
    let applicableFee: (typeof restaurantFees)[0] | null = null;
    let maxDeliveryFee = -1;

    for (const fee of restaurantFees) {
        if (isLocationInZone(userLat, userLng, fee.zoneId, fee)) {
            const currentFee = parseFloat((fee.deliveryFee as string) || "0");
            if (currentFee > maxDeliveryFee) {
                maxDeliveryFee = currentFee;
                applicableFee = fee;
            }
        }
    }

    // ── 4. Return result ────────────────────────────────────────────
    if (!applicableFee) {
        return SuccessResponse(res, {
            message: "Location is outside our delivery zones.",
            data: {
                isDeliverable: false,
                deliveryFee: null,
                minOrderAmount: null,
                zone: null,
                branchId: null,
            },
        });
    }

    // Resolve the serving branch if not already known
    let resolvedBranchId: string | null = applicableFee.branchId || branchId || null;

    if (!resolvedBranchId) {
        // Try to find an active branch in this zone
        const [matchedBranch] = await db
            .select({ id: branches.id })
            .from(branches)
            .where(
                and(
                    eq(branches.restaurantId, restaurantId),
                    eq(branches.zoneId, applicableFee.zoneId),
                    eq(branches.status, "active")
                )
            )
            .limit(1);

        resolvedBranchId = matchedBranch?.id || null;
    }

    return SuccessResponse(res, {
        message: "Delivery zone found.",
        data: {
            isDeliverable: true,
            deliveryFee: parseFloat((applicableFee.deliveryFee as string) || "0"),
            minOrderAmount: applicableFee.minOrderAmount
                ? parseFloat(applicableFee.minOrderAmount as string)
                : null,
            zone: {
                id: applicableFee.id,
                zoneId: applicableFee.zoneId,
                name: applicableFee.zoneName || null,
                nameAr: applicableFee.zoneNameAr || null,
            },
            branchId: resolvedBranchId,
        },
    });
};
