import { Request, Response } from "express";
import { db } from "../../models/connection";
import { shippingCompanyZones } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError, NotFound } from "../../Errors";

export async function createZone(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const { name, nameAr, coordinates, coverageAreaRadiusKm, deliveryFee, minOrderAmount, status } = req.body;

    const [insertResult] = await db.insert(shippingCompanyZones).values({
        shippingCompanyId: companyId,
        name,
        nameAr,
        coordinates,
        coverageAreaRadiusKm: coverageAreaRadiusKm ? String(coverageAreaRadiusKm) : undefined,
        deliveryFee: deliveryFee ? String(deliveryFee) : "0.00",
        minOrderAmount: minOrderAmount ? String(minOrderAmount) : "0.00",
        status: status || "active",
    });

    const newZone = await db
        .select()
        .from(shippingCompanyZones)
        .where(
            and(
                eq(shippingCompanyZones.shippingCompanyId, companyId),
                eq(shippingCompanyZones.name, name)
            )
        )
        .orderBy(shippingCompanyZones.createdAt)
        .limit(1);

    return SuccessResponse(res, {
        message: "Shipping zone created successfully",
        data: newZone[0],
    }, 201);
}

export async function getZones(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const zones = await db
        .select()
        .from(shippingCompanyZones)
        .where(eq(shippingCompanyZones.shippingCompanyId, companyId));

    return SuccessResponse(res, {
        message: "Shipping zones retrieved successfully",
        data: zones,
    });
}

export async function getZoneById(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const zone = await db
        .select()
        .from(shippingCompanyZones)
        .where(
            and(
                eq(shippingCompanyZones.id, id),
                eq(shippingCompanyZones.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (zone.length === 0) {
        throw new NotFound("Shipping zone not found");
    }

    return SuccessResponse(res, {
        message: "Shipping zone retrieved successfully",
        data: zone[0],
    });
}

export async function updateZone(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const zone = await db
        .select({ id: shippingCompanyZones.id })
        .from(shippingCompanyZones)
        .where(
            and(
                eq(shippingCompanyZones.id, id),
                eq(shippingCompanyZones.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (zone.length === 0) {
        throw new NotFound("Shipping zone not found");
    }

    const { name, nameAr, coordinates, coverageAreaRadiusKm, deliveryFee, minOrderAmount, status } = req.body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (nameAr !== undefined) updateData.nameAr = nameAr;
    if (coordinates !== undefined) updateData.coordinates = coordinates;
    if (coverageAreaRadiusKm !== undefined) updateData.coverageAreaRadiusKm = String(coverageAreaRadiusKm);
    if (deliveryFee !== undefined) updateData.deliveryFee = String(deliveryFee);
    if (minOrderAmount !== undefined) updateData.minOrderAmount = String(minOrderAmount);
    if (status !== undefined) updateData.status = status;

    await db
        .update(shippingCompanyZones)
        .set(updateData)
        .where(eq(shippingCompanyZones.id, id));

    return SuccessResponse(res, {
        message: "Shipping zone updated successfully",
    });
}

export async function deleteZone(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const zone = await db
        .select({ id: shippingCompanyZones.id })
        .from(shippingCompanyZones)
        .where(
            and(
                eq(shippingCompanyZones.id, id),
                eq(shippingCompanyZones.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (zone.length === 0) {
        throw new NotFound("Shipping zone not found");
    }

    await db.delete(shippingCompanyZones).where(eq(shippingCompanyZones.id, id));

    return SuccessResponse(res, {
        message: "Shipping zone deleted successfully",
    });
}
