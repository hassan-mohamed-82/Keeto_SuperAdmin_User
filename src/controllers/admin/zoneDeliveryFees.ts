import { Request, Response } from "express";
import { db } from "../../models/connection";
import { zoneDeliveryFees, zones } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

// ==========================================
// 1. إنشاء تسعيرة شحن بين منطقتين
// ==========================================
export const createZoneDeliveryFee = async (req: Request, res: Response) => {
    const { fromZoneId, toZoneId, fee } = req.body;

    if (!fromZoneId || !toZoneId || !fee) {
        throw new BadRequest("Missing required fields: fromZoneId, toZoneId, fee");
    }

    // التأكد من وجود المناطق
    const fromZone = await db.select().from(zones).where(eq(zones.id, fromZoneId)).limit(1);
    if (!fromZone[0]) throw new BadRequest("fromZoneId not found");

    const toZone = await db.select().from(zones).where(eq(zones.id, toZoneId)).limit(1);
    if (!toZone[0]) throw new BadRequest("toZoneId not found");

    // التأكد من عدم وجود تسعيرة مسبقة لنفس المنطقتين
    const existingFee = await db.select().from(zoneDeliveryFees)
        .where(and(eq(zoneDeliveryFees.fromZoneId, fromZoneId), eq(zoneDeliveryFees.toZoneId, toZoneId)))
        .limit(1);

    if (existingFee[0]) {
        throw new BadRequest("Delivery fee between these zones already exists");
    }

    const id = uuidv4();

    await db.insert(zoneDeliveryFees).values({
        id,
        fromZoneId,
        toZoneId,
        fee: fee.toString()
    });

    return SuccessResponse(res, { message: "Zone delivery fee created successfully", data: { id } }, 201);
};

// ==========================================
// 2. جلب جميع التسعيرات مع تفاصيل المناطق
// ==========================================
export const getAllZoneDeliveryFees = async (req: Request, res: Response) => {
    const fromZ = alias(zones, "fromZone");
    const toZ = alias(zones, "toZone");

    const allFees = await db
        .select({
            id: zoneDeliveryFees.id,
            fromZoneId: zoneDeliveryFees.fromZoneId,
            toZoneId: zoneDeliveryFees.toZoneId,
            fee: zoneDeliveryFees.fee,
            createdAt: zoneDeliveryFees.createdAt,
            updatedAt: zoneDeliveryFees.updatedAt,
            fromZoneName: fromZ.name,
            toZoneName: toZ.name
        })
        .from(zoneDeliveryFees)
        .leftJoin(fromZ, eq(zoneDeliveryFees.fromZoneId, fromZ.id))
        .leftJoin(toZ, eq(zoneDeliveryFees.toZoneId, toZ.id));

    return SuccessResponse(res, { message: "Fetch all zone delivery fees success", data: allFees });
};

// ==========================================
// 3. جلب تسعيرة برقم الـ ID
// ==========================================
export const getZoneDeliveryFeeById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const fromZ = alias(zones, "fromZone");
    const toZ = alias(zones, "toZone");

    const feeRecord = await db
        .select({
            id: zoneDeliveryFees.id,
            fromZoneId: zoneDeliveryFees.fromZoneId,
            toZoneId: zoneDeliveryFees.toZoneId,
            fee: zoneDeliveryFees.fee,
            createdAt: zoneDeliveryFees.createdAt,
            updatedAt: zoneDeliveryFees.updatedAt,
            fromZoneName: fromZ.name,
            toZoneName: toZ.name
        })
        .from(zoneDeliveryFees)
        .leftJoin(fromZ, eq(zoneDeliveryFees.fromZoneId, fromZ.id))
        .leftJoin(toZ, eq(zoneDeliveryFees.toZoneId, toZ.id))
        .where(eq(zoneDeliveryFees.id, id))
        .limit(1);

    if (!feeRecord[0]) {
        throw new NotFound("Zone delivery fee not found");
    }

    return SuccessResponse(res, { message: "Fetch zone delivery fee success", data: feeRecord[0] });
};

// ==========================================
// 4. تحديث التسعيرة
// ==========================================
export const updateZoneDeliveryFee = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { fromZoneId, toZoneId, fee } = req.body;

    const existingFee = await db.select().from(zoneDeliveryFees).where(eq(zoneDeliveryFees.id, id)).limit(1);
    if (!existingFee[0]) {
        throw new NotFound("Zone delivery fee not found");
    }

    const updateData: any = { updatedAt: new Date() };

    if (fromZoneId) {
        const fromZone = await db.select().from(zones).where(eq(zones.id, fromZoneId)).limit(1);
        if (!fromZone[0]) throw new BadRequest("fromZoneId not found");
        updateData.fromZoneId = fromZoneId;
    }
    
    if (toZoneId) {
        const toZone = await db.select().from(zones).where(eq(zones.id, toZoneId)).limit(1);
        if (!toZone[0]) throw new BadRequest("toZoneId not found");
        updateData.toZoneId = toZoneId;
    }

    if (fee) updateData.fee = fee.toString();

    // التأكد من عدم تكرار التسعيرة بعد التعديل
    if (updateData.fromZoneId || updateData.toZoneId) {
        const checkFrom = updateData.fromZoneId || existingFee[0].fromZoneId;
        const checkTo = updateData.toZoneId || existingFee[0].toZoneId;

        const duplicateCheck = await db.select().from(zoneDeliveryFees)
            .where(and(
                eq(zoneDeliveryFees.fromZoneId, checkFrom), 
                eq(zoneDeliveryFees.toZoneId, checkTo)
            ))
            .limit(1);

        if (duplicateCheck[0] && duplicateCheck[0].id !== id) {
            throw new BadRequest("Delivery fee between these zones already exists");
        }
    }

    await db.update(zoneDeliveryFees).set(updateData).where(eq(zoneDeliveryFees.id, id));

    return SuccessResponse(res, { message: "Zone delivery fee updated successfully" });
};

// ==========================================
// 5. مسح التسعيرة
// ==========================================
export const deleteZoneDeliveryFee = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingFee = await db.select().from(zoneDeliveryFees).where(eq(zoneDeliveryFees.id, id)).limit(1);
    if (!existingFee[0]) {
        throw new NotFound("Zone delivery fee not found");
    }

    await db.delete(zoneDeliveryFees).where(eq(zoneDeliveryFees.id, id));

    return SuccessResponse(res, { message: "Zone delivery fee deleted successfully" });
};


export const getallzone=async (req: Request, res: Response) => {
    const allZones = await db.select().from(zones);
    return SuccessResponse(res, { message: "All zones fetched successfully", data: allZones });
}