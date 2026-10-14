import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    deliveryMen,
    shippingCompanies,
    restaurants,
    branches,
    deliveryManZones,
    deliveryManShifts,
    shippingZones,
    restaurantSettings,
} from "../../models/schema";
import { eq, and, sql, inArray, isNull } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound, UnauthorizedError, ConflictError } from "../../Errors";
import bcrypt from "bcrypt";
import { notifyShippingCompany } from "../../services/socket/socketService";
import { removeCourierFromRedis } from "../../services/shipping/dispatchEngine";
import { catchAsync } from "../../utils/catchAsync";

// =========================================================================
// 0. عرض المناديب الأحرار المتاحين للربط بشركة الشحن (Available Free Couriers)
// =========================================================================
export const getAvailableCouriers = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    // Must be NOT linked to any shipping company, NOT linked to any restaurant, active, and not deleted
    const availableCouriers = await db
        .select({
            id: deliveryMen.id,
            name: deliveryMen.name,
            phone: deliveryMen.phone,
            email: deliveryMen.email,
            image: deliveryMen.image,
            createdAt: deliveryMen.createdAt,
        })
        .from(deliveryMen)
        .where(
            and(
                isNull(deliveryMen.shippingCompanyId),
                isNull(deliveryMen.restaurantId),
                eq(deliveryMen.isActive, true),
                eq(deliveryMen.isDeleted, false)
            )
        );

    return SuccessResponse(res, {
        message: "Available couriers retrieved successfully",
        data: availableCouriers,
    });
});

// =========================================================================
// 1. إنشاء مندوب توصيل جديد تابع لشركة الشحن (Create Outsource Delivery Man)
// =========================================================================
export const createDeliveryMan = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;

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
        allZones = true,
        zoneIds,
        restaurantId,
        branchId,
    } = req.body;

    // فحص رقم الهاتف
    const [existing] = await db
        .select({ id: deliveryMen.id })
        .from(deliveryMen)
        .where(eq(deliveryMen.phone, phone))
        .limit(1);

    if (existing) {
        throw new BadRequest("Phone number is already registered for another delivery man");
    }

    let hashedPassword: string | undefined;
    if (password) {
        hashedPassword = await bcrypt.hash(password, 10);
    }

    let createdId = "";

    await db.transaction(async (tx) => {
        // Always deliveryType = 'outsource' per D4
        const [insertResult] = await tx.insert(deliveryMen).values({
            shippingCompanyId: companyId,
            restaurantId: restaurantId || null,
            branchId: branchId || null,
            name,
            phone,
            email,
            password: hashedPassword,
            image,
            deliveryType: "outsource",
            allZones: Boolean(allZones),
            shiftStatus: "inactive",
            isOnline: false,
            isAvailable: true,
            isActive: true,
        });

        const [created] = await tx
            .select({ id: deliveryMen.id })
            .from(deliveryMen)
            .where(eq(deliveryMen.phone, phone))
            .limit(1);

        createdId = created.id;

        // If not allZones, attach specific zones
        if (!allZones && Array.isArray(zoneIds) && zoneIds.length > 0) {
            for (const zId of zoneIds) {
                await tx.insert(deliveryManZones).values({
                    deliveryManId: createdId,
                    zoneId: zId,
                });
            }
        }
    });

    const [newDeliveryMan] = await db
        .select()
        .from(deliveryMen)
        .where(eq(deliveryMen.id, createdId))
        .limit(1);

    const { password: _, ...dmData } = newDeliveryMan;

    return SuccessResponse(res, {
        message: "Delivery man created and assigned to shipping company successfully",
        data: dmData,
    }, 201);
});

// =========================================================================
// 2. إسناد مندوب توصيل حالي لشركة الشحن (Assign Existing FREE Delivery Man)
// =========================================================================
export const assignExistingDeliveryMan = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const { deliveryManId, deliveryType = "outsource", allZones = true, zoneIds } = req.body;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const [dm] = await db
        .select()
        .from(deliveryMen)
        .where(eq(deliveryMen.id, deliveryManId))
        .limit(1);

    if (!dm) {
        throw new NotFound("Delivery man not found");
    }

    // Security check: Must be active and not deleted
    if (dm.isDeleted || !dm.isActive) {
        throw new BadRequest("Cannot assign an inactive or deleted courier");
    }

    // Security check: Cannot take a restaurant-owned courier
    if (dm.restaurantId) {
        throw new BadRequest("Cannot assign a delivery man who is assigned to a restaurant");
    }

    // Security check: Cannot take a courier assigned to another company
    if (dm.shippingCompanyId && dm.shippingCompanyId !== companyId) {
        throw new BadRequest("Courier is already assigned to another shipping company");
    }

    await db.transaction(async (tx) => {
        await tx
            .update(deliveryMen)
            .set({
                shippingCompanyId: companyId,
                deliveryType: "outsource",
                allZones: Boolean(allZones),
            })
            .where(eq(deliveryMen.id, deliveryManId));

        if (!allZones && Array.isArray(zoneIds) && zoneIds.length > 0) {
            await tx
                .delete(deliveryManZones)
                .where(eq(deliveryManZones.deliveryManId, deliveryManId));

            for (const zId of zoneIds) {
                await tx.insert(deliveryManZones).values({
                    deliveryManId,
                    zoneId: zId,
                });
            }
        }
    });

    return SuccessResponse(res, {
        message: `Delivery man ${dm.name} has been assigned to shipping company successfully`,
    });
});

// =========================================================================
// 3. عرض قائمة مناديب التوصيل التابعين لشركة الشحن (Get Delivery Men)
// =========================================================================
export const getDeliveryMen = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
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
            allZones: deliveryMen.allZones,
            activeOrdersCount: deliveryMen.activeOrdersCount,
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
});

// =========================================================================
// 4. تفاصيل مندوب توصيل محدد
// =========================================================================
export const getDeliveryManById = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const [dm] = await db
        .select()
        .from(deliveryMen)
        .where(
            and(
                eq(deliveryMen.id, id),
                eq(deliveryMen.shippingCompanyId, companyId),
                eq(deliveryMen.isDeleted, false)
            )
        )
        .limit(1);

    if (!dm) {
        throw new NotFound("Delivery man not found or not assigned to this company");
    }

    // Zones
    const zones = await db
        .select({
            id: shippingZones.id,
            name: shippingZones.name,
            nameAr: shippingZones.nameAr,
        })
        .from(deliveryManZones)
        .innerJoin(shippingZones, eq(deliveryManZones.zoneId, shippingZones.id))
        .where(eq(deliveryManZones.deliveryManId, id));

    // Shifts
    const shifts = await db
        .select({
            id: deliveryManShifts.id,
            restaurantId: deliveryManShifts.restaurantId,
            restaurantName: restaurants.name,
            dayOfWeek: deliveryManShifts.dayOfWeek,
            from: deliveryManShifts.from,
            to: deliveryManShifts.to,
            status: deliveryManShifts.status,
        })
        .from(deliveryManShifts)
        .innerJoin(restaurants, eq(deliveryManShifts.restaurantId, restaurants.id))
        .where(eq(deliveryManShifts.deliveryManId, id));

    const { password: _, ...dmData } = dm;

    return SuccessResponse(res, {
        message: "Delivery man details retrieved successfully",
        data: {
            ...dmData,
            zones,
            shifts,
        },
    });
});

// =========================================================================
// 5. تعديل بيانات المندوب (Update Delivery Man)
// =========================================================================
export const updateDeliveryMan = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const [dm] = await db
        .select({ id: deliveryMen.id })
        .from(deliveryMen)
        .where(
            and(
                eq(deliveryMen.id, id),
                eq(deliveryMen.shippingCompanyId, companyId),
                eq(deliveryMen.isDeleted, false)
            )
        )
        .limit(1);

    if (!dm) {
        throw new NotFound("Delivery man not found or does not belong to your company");
    }

    const {
        name,
        phone,
        email,
        password,
        image,
        deliveryType,
        allZones,
        shiftStatus,
        isActive,
        branchId,
        restaurantId,
    } = req.body;

    // Validate restaurant belongs to this company if specified
    if (restaurantId) {
        const [rest] = await db
            .select({ id: restaurantSettings.id })
            .from(restaurantSettings)
            .where(
                and(
                    eq(restaurantSettings.restaurantId, restaurantId),
                    eq(restaurantSettings.shippingCompanyId, companyId)
                )
            )
            .limit(1);

        if (!rest) {
            throw new BadRequest("Specified restaurant does not belong to your shipping company");
        }

        if (branchId) {
            const [br] = await db
                .select({ id: branches.id })
                .from(branches)
                .where(
                    and(
                        eq(branches.id, branchId),
                        eq(branches.restaurantId, restaurantId)
                    )
                )
                .limit(1);

            if (!br) {
                throw new BadRequest("Specified branch does not belong to the selected restaurant");
            }
        }
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (image !== undefined) updateData.image = image;
    if (deliveryType !== undefined) updateData.deliveryType = deliveryType;
    if (allZones !== undefined) updateData.allZones = allZones;
    if (shiftStatus !== undefined) updateData.shiftStatus = shiftStatus;
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
});

// =========================================================================
// 6. Zones Management: GET /:id/zones and PUT /:id/zones (Phase 5)
// =========================================================================
export const getCourierZones = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const [dm] = await db
        .select({ id: deliveryMen.id, allZones: deliveryMen.allZones })
        .from(deliveryMen)
        .where(
            and(
                eq(deliveryMen.id, id),
                eq(deliveryMen.shippingCompanyId, companyId),
                eq(deliveryMen.isDeleted, false)
            )
        )
        .limit(1);

    if (!dm) {
        throw new NotFound("Courier not found or does not belong to your company");
    }

    const zones = await db
        .select({
            id: shippingZones.id,
            name: shippingZones.name,
            nameAr: shippingZones.nameAr,
            status: shippingZones.status,
        })
        .from(deliveryManZones)
        .innerJoin(shippingZones, eq(deliveryManZones.zoneId, shippingZones.id))
        .where(eq(deliveryManZones.deliveryManId, id));

    return SuccessResponse(res, {
        message: "Courier zones retrieved successfully",
        data: {
            allZones: dm.allZones,
            zones,
        },
    });
});

export const updateCourierZones = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;
    const { allZones = false, zoneIds = [] } = req.body;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const [dm] = await db
        .select({ id: deliveryMen.id })
        .from(deliveryMen)
        .where(
            and(
                eq(deliveryMen.id, id),
                eq(deliveryMen.shippingCompanyId, companyId),
                eq(deliveryMen.isDeleted, false)
            )
        )
        .limit(1);

    if (!dm) {
        throw new NotFound("Courier not found or does not belong to your company");
    }

    // Verify all zoneIds belong to this shipping company
    if (zoneIds.length > 0) {
        const companyZones = await db
            .select({ id: shippingZones.id })
            .from(shippingZones)
            .where(
                and(
                    eq(shippingZones.shippingCompanyId, companyId),
                    inArray(shippingZones.id, zoneIds)
                )
            );

        if (companyZones.length !== zoneIds.length) {
            throw new BadRequest("One or more zone IDs do not belong to this company");
        }
    }

    await db.transaction(async (tx) => {
        await tx
            .update(deliveryMen)
            .set({ allZones: Boolean(allZones) })
            .where(eq(deliveryMen.id, id));

        await tx
            .delete(deliveryManZones)
            .where(eq(deliveryManZones.deliveryManId, id));

        if (!allZones && zoneIds.length > 0) {
            for (const zId of zoneIds) {
                await tx.insert(deliveryManZones).values({
                    deliveryManId: id,
                    zoneId: zId,
                });
            }
        }
    });

    return SuccessResponse(res, {
        message: "Courier zones updated successfully",
    });
});

// =========================================================================
// 7. Shifts Management: GET /:id/shifts and PUT /:id/shifts (Phase 5)
// =========================================================================
export const getCourierShifts = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const [dm] = await db
        .select({ id: deliveryMen.id, deliveryType: deliveryMen.deliveryType })
        .from(deliveryMen)
        .where(
            and(
                eq(deliveryMen.id, id),
                eq(deliveryMen.shippingCompanyId, companyId),
                eq(deliveryMen.isDeleted, false)
            )
        )
        .limit(1);

    if (!dm) {
        throw new NotFound("Courier not found or does not belong to your company");
    }

    const shifts = await db
        .select({
            id: deliveryManShifts.id,
            restaurantId: deliveryManShifts.restaurantId,
            restaurantName: restaurants.name,
            dayOfWeek: deliveryManShifts.dayOfWeek,
            from: deliveryManShifts.from,
            to: deliveryManShifts.to,
            status: deliveryManShifts.status,
        })
        .from(deliveryManShifts)
        .innerJoin(restaurants, eq(deliveryManShifts.restaurantId, restaurants.id))
        .where(eq(deliveryManShifts.deliveryManId, id));

    return SuccessResponse(res, {
        message: "Courier shifts retrieved successfully",
        data: shifts,
    });
});

export const updateCourierShifts = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;
    const { shifts = [] } = req.body;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const [dm] = await db
        .select({ id: deliveryMen.id, deliveryType: deliveryMen.deliveryType })
        .from(deliveryMen)
        .where(
            and(
                eq(deliveryMen.id, id),
                eq(deliveryMen.shippingCompanyId, companyId),
                eq(deliveryMen.isDeleted, false)
            )
        )
        .limit(1);

    if (!dm) {
        throw new NotFound("Courier not found or does not belong to your company");
    }

    // Verify all restaurants are linked to this shipping company
    const restaurantIds = [...new Set(shifts.map((s: any) => s.restaurantId))] as string[];
    if (restaurantIds.length > 0) {
        const linked = await db
            .select({ restaurantId: restaurantSettings.restaurantId })
            .from(restaurantSettings)
            .where(
                and(
                    eq(restaurantSettings.shippingCompanyId, companyId),
                    inArray(restaurantSettings.restaurantId, restaurantIds)
                )
            );

        if (linked.length !== restaurantIds.length) {
            throw new BadRequest("One or more restaurants are not assigned to your shipping company");
        }
    }

    await db.transaction(async (tx) => {
        // Replace shifts
        await tx
            .delete(deliveryManShifts)
            .where(eq(deliveryManShifts.deliveryManId, id));

        for (const s of shifts) {
            await tx.insert(deliveryManShifts).values({
                deliveryManId: id,
                restaurantId: s.restaurantId,
                dayOfWeek: s.dayOfWeek,
                from: s.from,
                to: s.to,
                status: s.status || "active",
            });
        }
    });

    return SuccessResponse(res, {
        message: "Courier shifts updated successfully",
    });
});

// =========================================================================
// 8. فك ربط مندوب التوصيل من شركة الشحن (Unassign Delivery Man)
// =========================================================================
export const unassignOrDeleteDeliveryMan = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const [dm] = await db
        .select({
            id: deliveryMen.id,
            activeOrdersCount: deliveryMen.activeOrdersCount,
        })
        .from(deliveryMen)
        .where(
            and(
                eq(deliveryMen.id, id),
                eq(deliveryMen.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (!dm) {
        throw new NotFound("Delivery man not found or not assigned to this company");
    }

    // Security check: cannot unassign a courier with active orders!
    if (dm.activeOrdersCount > 0) {
        throw new BadRequest(`Cannot unassign courier while they have ${dm.activeOrdersCount} active orders. Complete or reassign them first.`);
    }

    // Remove from Redis GEO & alive key
    await removeCourierFromRedis(id);

    // Clean up shifts, zones, and unlink
    await db.transaction(async (tx) => {
        await tx
            .delete(deliveryManZones)
            .where(eq(deliveryManZones.deliveryManId, id));

        await tx
            .delete(deliveryManShifts)
            .where(eq(deliveryManShifts.deliveryManId, id));

        await tx
            .update(deliveryMen)
            .set({
                shippingCompanyId: null,
                shiftStatus: "inactive",
                isOnline: false,
            })
            .where(eq(deliveryMen.id, id));
    });

    return SuccessResponse(res, {
        message: "Delivery man unassigned from shipping company successfully",
    });
});
