import { Request, Response } from "express";
import { db } from "../../models/connection";
import { shippingZones } from "../../models/schema";
import { eq, and, sql } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError, NotFound, BadRequest } from "../../Errors";
import { catchAsync } from "../../utils/catchAsync";
import * as turf from "@turf/turf";
import { v4 as uuidv4 } from "uuid";

// Helper: normalize and close coordinates ring
function normalizePolygonCoordinates(rawCoords: Array<{ lat: number; lng: number }>): Array<{ lat: number; lng: number }> {
    if (!rawCoords || rawCoords.length < 3) {
        throw new BadRequest("A zone must have at least 3 coordinates");
    }

    const first = rawCoords[0];
    const last = rawCoords[rawCoords.length - 1];
    const isClosed = Math.abs(first.lat - last.lat) < 0.000001 && Math.abs(first.lng - last.lng) < 0.000001;

    const ring = [...rawCoords];
    if (!isClosed) {
        ring.push({ ...first });
    }

    // Check validity using turf polygon: turf expects [lng, lat]
    try {
        const turfCoords = ring.map((pt) => [pt.lng, pt.lat]);
        const poly = turf.polygon([turfCoords]);
        const kinks = turf.kinks(poly);
        if (kinks.features.length > 0) {
            throw new BadRequest("Polygon has self-intersecting edges (kinks). Please provide a valid boundary.");
        }
    } catch (err: any) {
        if (err instanceof BadRequest) throw err;
        throw new BadRequest(`Invalid polygon structure: ${err.message}`);
    }

    return ring;
}

// =========================================================================
// 1. Create Zone
// =========================================================================
export const createZone = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const { name, nameAr, coordinates, coverageAreaRadiusKm, deliveryFee, minOrderAmount, status } = req.body;

    const normalizedCoordinates = normalizePolygonCoordinates(coordinates);

    const newId = uuidv4();
    await db.insert(shippingZones).values({
        id: newId,
        shippingCompanyId: companyId,
        name,
        nameAr,
        coordinates: normalizedCoordinates,
        coverageAreaRadiusKm: coverageAreaRadiusKm ? String(coverageAreaRadiusKm) : undefined,
        deliveryFee: deliveryFee ? String(deliveryFee) : "0.00",
        minOrderAmount: minOrderAmount ? String(minOrderAmount) : "0.00",
        status: status || "active",
    });

    return SuccessResponse(res, {
        message: "Shipping zone created successfully",
        data: {
            id: newId,
            shippingCompanyId: companyId,
            name,
            nameAr,
            coordinates: normalizedCoordinates,
            coverageAreaRadiusKm: coverageAreaRadiusKm ? String(coverageAreaRadiusKm) : undefined,
            deliveryFee: deliveryFee ? String(deliveryFee) : "0.00",
            minOrderAmount: minOrderAmount ? String(minOrderAmount) : "0.00",
            status: status || "active",
        }
    }, 201);
});

// =========================================================================
// 2. Get Zones
// =========================================================================
export const getZones = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const zones = await db
        .select()
        .from(shippingZones)
        .where(
            and(
                eq(shippingZones.shippingCompanyId, companyId),
                eq(shippingZones.status, "active")
            )
        );

    return SuccessResponse(res, {
        message: "Shipping zones retrieved successfully",
        data: zones,
    });
});

// =========================================================================
// 3. Get Zone By ID
// =========================================================================
export const getZoneById = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const [zone] = await db
        .select()
        .from(shippingZones)
        .where(
            and(
                eq(shippingZones.id, id),
                eq(shippingZones.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (!zone) {
        throw new NotFound("Shipping zone not found");
    }

    return SuccessResponse(res, {
        message: "Shipping zone retrieved successfully",
        data: zone,
    });
});

// =========================================================================
// 4. Update Zone
// =========================================================================
export const updateZone = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const [zone] = await db
        .select({ id: shippingZones.id })
        .from(shippingZones)
        .where(
            and(
                eq(shippingZones.id, id),
                eq(shippingZones.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (!zone) {
        throw new NotFound("Shipping zone not found");
    }

    const { name, nameAr, coordinates, coverageAreaRadiusKm, deliveryFee, minOrderAmount, status } = req.body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (nameAr !== undefined) updateData.nameAr = nameAr;
    if (coordinates !== undefined) {
        updateData.coordinates = normalizePolygonCoordinates(coordinates);
    }
    if (coverageAreaRadiusKm !== undefined) updateData.coverageAreaRadiusKm = String(coverageAreaRadiusKm);
    if (deliveryFee !== undefined) updateData.deliveryFee = String(deliveryFee);
    if (minOrderAmount !== undefined) updateData.minOrderAmount = String(minOrderAmount);
    if (status !== undefined) updateData.status = status;

    await db
        .update(shippingZones)
        .set(updateData)
        .where(eq(shippingZones.id, id));

    return SuccessResponse(res, {
        message: "Shipping zone updated successfully",
    });
});

// =========================================================================
// 5. Delete Zone (Soft Delete per Phase 4: status = 'inactive')
// =========================================================================
export const deleteZone = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const [zone] = await db
        .select({ id: shippingZones.id })
        .from(shippingZones)
        .where(
            and(
                eq(shippingZones.id, id),
                eq(shippingZones.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (!zone) {
        throw new NotFound("Shipping zone not found");
    }

    // Soft delete
    await db
        .update(shippingZones)
        .set({ status: "inactive" })
        .where(eq(shippingZones.id, id));

    return SuccessResponse(res, {
        message: "Shipping zone deactivated successfully",
    });
});
