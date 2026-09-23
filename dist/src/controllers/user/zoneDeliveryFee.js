"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getZoneAndDeliveryFee = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const geo_1 = require("../../utils/geo");
// ============================================================
// GET Zone & Delivery Fee
// POST /api/v1/user/zone-delivery-fee
//
// Public endpoint — accepts { restaurantId, lat, lng, branchId? }
// Returns the matched zone + delivery fee from restaurant_zone_delivery_fees.
// Uses the same isLocationInZone engine as checkout, ensuring fee shown
// to the user ALWAYS matches fee charged at order time.
// ============================================================
const getZoneAndDeliveryFee = async (req, res) => {
    const { restaurantId, lat, lng, branchId } = req.body;
    // ── 1. Validate restaurant exists ──────────────────────────────
    const [restaurant] = await connection_1.db
        .select({ id: schema_1.restaurants.id, name: schema_1.restaurants.name })
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId))
        .limit(1);
    if (!restaurant) {
        throw new BadRequest_1.BadRequest("Restaurant not found.");
    }
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    if (isNaN(userLat) || isNaN(userLng)) {
        throw new BadRequest_1.BadRequest("Invalid coordinates provided.");
    }
    // ── 2. Fetch all active restaurant zone delivery fees ──────────
    // Sourced from restaurant_zone_delivery_fees (admin-configured per restaurant)
    // joined with global zones table for zone name/nameAr
    const restaurantFees = await connection_1.db
        .select({
        id: schema_1.restaurantZoneDeliveryFees.id,
        zoneId: schema_1.restaurantZoneDeliveryFees.zoneId,
        branchId: schema_1.restaurantZoneDeliveryFees.branchId,
        deliveryFee: schema_1.restaurantZoneDeliveryFees.deliveryFee,
        minOrderAmount: schema_1.restaurantZoneDeliveryFees.minOrderAmount,
        coverageType: schema_1.restaurantZoneDeliveryFees.coverageType,
        customCoordinates: schema_1.restaurantZoneDeliveryFees.customCoordinates,
        customRadiusKm: schema_1.restaurantZoneDeliveryFees.customRadiusKm,
        // Zone defaults from the global zone record
        defaultCoordinates: schema_1.zones.coordinates,
        defaultRadiusKm: schema_1.zones.coverageAreaRadiusKm,
        zoneName: schema_1.zones.name,
        zoneNameAr: schema_1.zones.nameAr,
    })
        .from(schema_1.restaurantZoneDeliveryFees)
        .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.zoneId, schema_1.zones.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.status, "active"), 
    // Filter by branchId if provided
    branchId ? (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.branchId, branchId) : undefined));
    // ── 3. Find the applicable zone (highest fee — same as checkout) ─
    let applicableFee = null;
    let maxDeliveryFee = -1;
    for (const fee of restaurantFees) {
        if ((0, geo_1.isLocationInZone)(userLat, userLng, fee.zoneId, fee)) {
            const currentFee = parseFloat(fee.deliveryFee || "0");
            if (currentFee > maxDeliveryFee) {
                maxDeliveryFee = currentFee;
                applicableFee = fee;
            }
        }
    }
    // ── 4. Return result ────────────────────────────────────────────
    if (!applicableFee) {
        return (0, response_1.SuccessResponse)(res, {
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
    let resolvedBranchId = applicableFee.branchId || branchId || null;
    if (!resolvedBranchId) {
        // Try to find an active branch in this zone
        const [matchedBranch] = await connection_1.db
            .select({ id: schema_1.branches.id })
            .from(schema_1.branches)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.branches.zoneId, applicableFee.zoneId), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")))
            .limit(1);
        resolvedBranchId = matchedBranch?.id || null;
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Delivery zone found.",
        data: {
            isDeliverable: true,
            deliveryFee: parseFloat(applicableFee.deliveryFee || "0"),
            minOrderAmount: applicableFee.minOrderAmount
                ? parseFloat(applicableFee.minOrderAmount)
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
exports.getZoneAndDeliveryFee = getZoneAndDeliveryFee;
