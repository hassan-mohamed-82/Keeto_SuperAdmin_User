import { Request, Response } from "express";
import { db } from "../../models/connection";
import { deliveryMen, shippingCompanies } from "../../models/schema";
import { eq, and, sql } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound, UnauthorizedError } from "../../Errors";
import bcrypt from "bcrypt";
import { notifyShippingCompany } from "../../services/socket/socketService";

// =========================================================================
// 1. إنشاء مندوب توصيل جديد تابع لشركة الشحن (Create Outsource Delivery Man)
// =========================================================================
export async function createDeliveryMan(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const {
        name,
        phone,
        email,
        password,
        image,
        deliveryType = "outsource",
        shiftStatus = "inactive",
        branchId,
        restaurantId,
    } = req.body;

    // فحص رقم الهاتف أو البريد
    const existing = await db
        .select({ id: deliveryMen.id })
        .from(deliveryMen)
        .where(eq(deliveryMen.phone, phone))
        .limit(1);

    if (existing.length > 0) {
        throw new BadRequest("Phone number is already registered for another delivery man");
    }

    let hashedPassword: string | undefined;
    if (password) {
        hashedPassword = await bcrypt.hash(password, 10);
    }

    const [insertResult] = await db.insert(deliveryMen).values({
        shippingCompanyId: companyId,
        restaurantId: restaurantId || null,
        branchId: branchId || null,
        name,
        phone,
        email,
        password: hashedPassword,
        image,
        deliveryType,
        shiftStatus,
        isOnline: false,
        isAvailable: true,
        isActive: true,
    });

    const newDeliveryMan = await db
        .select({
            id: deliveryMen.id,
            name: deliveryMen.name,
            phone: deliveryMen.phone,
            email: deliveryMen.email,
            image: deliveryMen.image,
            deliveryType: deliveryMen.deliveryType,
            shiftStatus: deliveryMen.shiftStatus,
            isOnline: deliveryMen.isOnline,
            isAvailable: deliveryMen.isAvailable,
            isActive: deliveryMen.isActive,
            shippingCompanyId: deliveryMen.shippingCompanyId,
            createdAt: deliveryMen.createdAt,
        })
        .from(deliveryMen)
        .where(eq(deliveryMen.phone, phone))
        .limit(1);

    return SuccessResponse(res, {
        message: "Delivery man created and assigned to shipping company successfully",
        data: newDeliveryMan[0],
    }, 201);
}

// =========================================================================
// 2. إسناد مندوب توصيل حالي لشركة الشحن (Assign Existing Delivery Man)
// =========================================================================
export async function assignExistingDeliveryMan(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { deliveryManId, deliveryType = "outsource" } = req.body;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const dm = await db
        .select({ id: deliveryMen.id, name: deliveryMen.name })
        .from(deliveryMen)
        .where(eq(deliveryMen.id, deliveryManId))
        .limit(1);

    if (dm.length === 0) {
        throw new NotFound("Delivery man not found");
    }

    await db
        .update(deliveryMen)
        .set({
            shippingCompanyId: companyId,
            deliveryType,
        })
        .where(eq(deliveryMen.id, deliveryManId));

    return SuccessResponse(res, {
        message: `Delivery man ${dm[0].name} has been assigned to shipping company successfully`,
    });
}

// =========================================================================
// 3. عرض قائمة مناديب التوصيل التابعين لشركة الشحن (Get Delivery Men)
// =========================================================================
export async function getDeliveryMen(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { shiftStatus, isOnline, isAvailable, search, deliveryType } = req.query;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const conditions = [
        eq(deliveryMen.shippingCompanyId, companyId),
        eq(deliveryMen.isDeleted, false),
    ];

    if (shiftStatus) {
        conditions.push(eq(deliveryMen.shiftStatus, shiftStatus as "active" | "inactive"));
    }

    if (deliveryType) {
        conditions.push(eq(deliveryMen.deliveryType, deliveryType as "restaurant" | "outsource"));
    }

    if (isOnline !== undefined) {
        conditions.push(eq(deliveryMen.isOnline, isOnline === "true"));
    }

    if (isAvailable !== undefined) {
        conditions.push(eq(deliveryMen.isAvailable, isAvailable === "true"));
    }

    if (search) {
        conditions.push(
            sql`(${deliveryMen.name} LIKE ${`%${search}%`} OR ${deliveryMen.phone} LIKE ${`%${search}%`})`
        );
    }

    const list = await db
        .select({
            id: deliveryMen.id,
            name: deliveryMen.name,
            phone: deliveryMen.phone,
            email: deliveryMen.email,
            image: deliveryMen.image,
            deliveryType: deliveryMen.deliveryType,
            shiftStatus: deliveryMen.shiftStatus,
            isOnline: deliveryMen.isOnline,
            isAvailable: deliveryMen.isAvailable,
            isActive: deliveryMen.isActive,
            currentLat: deliveryMen.currentLat,
            currentLng: deliveryMen.currentLng,
            lastLocationUpdate: deliveryMen.lastLocationUpdate,
            createdAt: deliveryMen.createdAt,
        })
        .from(deliveryMen)
        .where(and(...conditions));

    return SuccessResponse(res, {
        message: "Delivery men retrieved successfully",
        data: list,
    });
}

// =========================================================================
// 4. تفاصيل مندوب توصيل محدد
// =========================================================================
export async function getDeliveryManById(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const dm = await db
        .select({
            id: deliveryMen.id,
            name: deliveryMen.name,
            phone: deliveryMen.phone,
            email: deliveryMen.email,
            image: deliveryMen.image,
            deliveryType: deliveryMen.deliveryType,
            shiftStatus: deliveryMen.shiftStatus,
            isOnline: deliveryMen.isOnline,
            isAvailable: deliveryMen.isAvailable,
            isActive: deliveryMen.isActive,
            currentLat: deliveryMen.currentLat,
            currentLng: deliveryMen.currentLng,
            lastLocationUpdate: deliveryMen.lastLocationUpdate,
            createdAt: deliveryMen.createdAt,
        })
        .from(deliveryMen)
        .where(
            and(
                eq(deliveryMen.id, id),
                eq(deliveryMen.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (dm.length === 0) {
        throw new NotFound("Delivery man not found or not assigned to this company");
    }

    return SuccessResponse(res, {
        message: "Delivery man details retrieved successfully",
        data: dm[0],
    });
}

// =========================================================================
// 5. تعديل بيانات المندوب (Update Delivery Man)
// =========================================================================
export async function updateDeliveryMan(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const dm = await db
        .select({ id: deliveryMen.id })
        .from(deliveryMen)
        .where(
            and(
                eq(deliveryMen.id, id),
                eq(deliveryMen.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (dm.length === 0) {
        throw new NotFound("Delivery man not found");
    }

    const {
        name,
        phone,
        email,
        password,
        image,
        deliveryType,
        shiftStatus,
        isOnline,
        isAvailable,
        isActive,
        branchId,
        restaurantId,
    } = req.body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (image !== undefined) updateData.image = image;
    if (deliveryType !== undefined) updateData.deliveryType = deliveryType;
    if (shiftStatus !== undefined) updateData.shiftStatus = shiftStatus;
    if (isOnline !== undefined) updateData.isOnline = isOnline;
    if (isAvailable !== undefined) updateData.isAvailable = isAvailable;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (branchId !== undefined) updateData.branchId = branchId;
    if (restaurantId !== undefined) updateData.restaurantId = restaurantId;

    if (password) {
        updateData.password = await bcrypt.hash(password, 10);
    }

    await db
        .update(deliveryMen)
        .set(updateData)
        .where(eq(deliveryMen.id, id));

    return SuccessResponse(res, {
        message: "Delivery man updated successfully",
    });
}

// =========================================================================
// 6. تبديل شفت المندوب (Toggle Shift Status - active / inactive)
// =========================================================================
export async function toggleShift(req: Request, res: Response) {
    const { id } = req.params;
    const { shiftStatus } = req.body;

    const dm = await db
        .select({ id: deliveryMen.id, shippingCompanyId: deliveryMen.shippingCompanyId })
        .from(deliveryMen)
        .where(eq(deliveryMen.id, id))
        .limit(1);

    if (dm.length === 0) {
        throw new NotFound("Delivery man not found");
    }

    await db
        .update(deliveryMen)
        .set({ shiftStatus })
        .where(eq(deliveryMen.id, id));

    if (dm[0].shippingCompanyId) {
        notifyShippingCompany(dm[0].shippingCompanyId, "delivery:shift_changed", {
            deliveryManId: id,
            shiftStatus,
        });
    }

    return SuccessResponse(res, {
        message: `Shift status updated to ${shiftStatus}`,
    });
}

// =========================================================================
// 7. تحديث إحداثيات موقع المندوب عبر الـ HTTP (كبديل إضافي بجانب WebSocket)
// =========================================================================
export async function updateLocation(req: Request, res: Response) {
    const { id } = req.params;
    const { lat, lng } = req.body;

    const dm = await db
        .select({ id: deliveryMen.id, shippingCompanyId: deliveryMen.shippingCompanyId })
        .from(deliveryMen)
        .where(eq(deliveryMen.id, id))
        .limit(1);

    if (dm.length === 0) {
        throw new NotFound("Delivery man not found");
    }

    const now = new Date();

    await db
        .update(deliveryMen)
        .set({
            currentLat: String(lat),
            currentLng: String(lng),
            lastLocationUpdate: now,
        })
        .where(eq(deliveryMen.id, id));

    if (dm[0].shippingCompanyId) {
        notifyShippingCompany(dm[0].shippingCompanyId, "delivery:location_changed", {
            deliveryManId: id,
            lat: String(lat),
            lng: String(lng),
            updatedAt: now,
        });
    }

    return SuccessResponse(res, {
        message: "Delivery man location updated successfully",
    });
}

// =========================================================================
// 8. فك ربط أو حذف مندوب التوصيل
// =========================================================================
export async function unassignOrDeleteDeliveryMan(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const dm = await db
        .select({ id: deliveryMen.id })
        .from(deliveryMen)
        .where(
            and(
                eq(deliveryMen.id, id),
                eq(deliveryMen.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (dm.length === 0) {
        throw new NotFound("Delivery man not found or not assigned to this company");
    }

    // فك الربط بشركة الشحن
    await db
        .update(deliveryMen)
        .set({
            shippingCompanyId: null,
            shiftStatus: "inactive",
            isOnline: false,
        })
        .where(eq(deliveryMen.id, id));

    return SuccessResponse(res, {
        message: "Delivery man unassigned from shipping company successfully",
    });
}
