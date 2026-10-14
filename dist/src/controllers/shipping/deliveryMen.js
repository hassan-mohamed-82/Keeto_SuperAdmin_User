"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.unassignOrDeleteDeliveryMan = exports.updateCourierShifts = exports.getCourierShifts = exports.updateCourierZones = exports.getCourierZones = exports.updateDeliveryMan = exports.getDeliveryManById = exports.getDeliveryMen = exports.assignExistingDeliveryMan = exports.createDeliveryMan = exports.getAvailableCouriers = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const bcrypt_1 = __importDefault(require("bcrypt"));
const dispatchEngine_1 = require("../../services/shipping/dispatchEngine");
const catchAsync_1 = require("../../utils/catchAsync");
// =========================================================================
// 0. عرض المناديب الأحرار المتاحين للربط بشركة الشحن (Available Free Couriers)
// =========================================================================
exports.getAvailableCouriers = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    // Must be NOT linked to any shipping company, NOT linked to any restaurant, active, and not deleted
    const availableCouriers = await connection_1.db
        .select({
        id: schema_1.deliveryMen.id,
        name: schema_1.deliveryMen.name,
        phone: schema_1.deliveryMen.phone,
        email: schema_1.deliveryMen.email,
        image: schema_1.deliveryMen.image,
        createdAt: schema_1.deliveryMen.createdAt,
    })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.isNull)(schema_1.deliveryMen.shippingCompanyId), (0, drizzle_orm_1.isNull)(schema_1.deliveryMen.restaurantId), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isActive, true), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false)));
    return (0, response_1.SuccessResponse)(res, {
        message: "Available couriers retrieved successfully",
        data: availableCouriers,
    });
});
// =========================================================================
// 1. إنشاء مندوب توصيل جديد تابع لشركة الشحن (Create Outsource Delivery Man)
// =========================================================================
exports.createDeliveryMan = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const { name, phone, email, password, image, deliveryType = "outsource", allZones = true, zoneIds, restaurantId, branchId, } = req.body;
    // فحص رقم الهاتف
    const [existing] = await connection_1.db
        .select({ id: schema_1.deliveryMen.id })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.phone, phone))
        .limit(1);
    if (existing) {
        throw new Errors_1.BadRequest("Phone number is already registered for another delivery man");
    }
    let hashedPassword;
    if (password) {
        hashedPassword = await bcrypt_1.default.hash(password, 10);
    }
    let createdId = "";
    await connection_1.db.transaction(async (tx) => {
        // Always deliveryType = 'outsource' per D4
        const [insertResult] = await tx.insert(schema_1.deliveryMen).values({
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
            .select({ id: schema_1.deliveryMen.id })
            .from(schema_1.deliveryMen)
            .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.phone, phone))
            .limit(1);
        createdId = created.id;
        // If not allZones, attach specific zones
        if (!allZones && Array.isArray(zoneIds) && zoneIds.length > 0) {
            for (const zId of zoneIds) {
                await tx.insert(schema_1.deliveryManZones).values({
                    deliveryManId: createdId,
                    zoneId: zId,
                });
            }
        }
    });
    const [newDeliveryMan] = await connection_1.db
        .select()
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, createdId))
        .limit(1);
    const { password: _, ...dmData } = newDeliveryMan;
    return (0, response_1.SuccessResponse)(res, {
        message: "Delivery man created and assigned to shipping company successfully",
        data: dmData,
    }, 201);
});
// =========================================================================
// 2. إسناد مندوب توصيل حالي لشركة الشحن (Assign Existing FREE Delivery Man)
// =========================================================================
exports.assignExistingDeliveryMan = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { deliveryManId, deliveryType = "outsource", allZones = true, zoneIds } = req.body;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const [dm] = await connection_1.db
        .select()
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId))
        .limit(1);
    if (!dm) {
        throw new Errors_1.NotFound("Delivery man not found");
    }
    // Security check: Must be active and not deleted
    if (dm.isDeleted || !dm.isActive) {
        throw new Errors_1.BadRequest("Cannot assign an inactive or deleted courier");
    }
    // Security check: Cannot take a restaurant-owned courier
    if (dm.restaurantId) {
        throw new Errors_1.BadRequest("Cannot assign a delivery man who is assigned to a restaurant");
    }
    // Security check: Cannot take a courier assigned to another company
    if (dm.shippingCompanyId && dm.shippingCompanyId !== companyId) {
        throw new Errors_1.BadRequest("Courier is already assigned to another shipping company");
    }
    await connection_1.db.transaction(async (tx) => {
        await tx
            .update(schema_1.deliveryMen)
            .set({
            shippingCompanyId: companyId,
            deliveryType: "outsource",
            allZones: Boolean(allZones),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId));
        if (!allZones && Array.isArray(zoneIds) && zoneIds.length > 0) {
            await tx
                .delete(schema_1.deliveryManZones)
                .where((0, drizzle_orm_1.eq)(schema_1.deliveryManZones.deliveryManId, deliveryManId));
            for (const zId of zoneIds) {
                await tx.insert(schema_1.deliveryManZones).values({
                    deliveryManId,
                    zoneId: zId,
                });
            }
        }
    });
    return (0, response_1.SuccessResponse)(res, {
        message: `Delivery man ${dm.name} has been assigned to shipping company successfully`,
    });
});
// =========================================================================
// 3. عرض قائمة مناديب التوصيل التابعين لشركة الشحن (Get Delivery Men)
// =========================================================================
exports.getDeliveryMen = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { shiftStatus, isOnline, isAvailable, search, deliveryType } = req.query;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const conditions = [
        (0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, companyId),
        (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false),
    ];
    if (shiftStatus) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.deliveryMen.shiftStatus, shiftStatus));
    }
    if (deliveryType) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.deliveryMen.deliveryType, deliveryType));
    }
    if (isOnline !== undefined) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.deliveryMen.isOnline, isOnline === "true"));
    }
    if (isAvailable !== undefined) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.deliveryMen.isAvailable, isAvailable === "true"));
    }
    if (search) {
        conditions.push((0, drizzle_orm_1.sql) `(${schema_1.deliveryMen.name} LIKE ${`%${search}%`} OR ${schema_1.deliveryMen.phone} LIKE ${`%${search}%`})`);
    }
    const list = await connection_1.db
        .select({
        id: schema_1.deliveryMen.id,
        name: schema_1.deliveryMen.name,
        phone: schema_1.deliveryMen.phone,
        email: schema_1.deliveryMen.email,
        image: schema_1.deliveryMen.image,
        deliveryType: schema_1.deliveryMen.deliveryType,
        allZones: schema_1.deliveryMen.allZones,
        activeOrdersCount: schema_1.deliveryMen.activeOrdersCount,
        shiftStatus: schema_1.deliveryMen.shiftStatus,
        isOnline: schema_1.deliveryMen.isOnline,
        isAvailable: schema_1.deliveryMen.isAvailable,
        isActive: schema_1.deliveryMen.isActive,
        currentLat: schema_1.deliveryMen.currentLat,
        currentLng: schema_1.deliveryMen.currentLng,
        lastLocationUpdate: schema_1.deliveryMen.lastLocationUpdate,
        createdAt: schema_1.deliveryMen.createdAt,
    })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)(...conditions));
    return (0, response_1.SuccessResponse)(res, {
        message: "Delivery men retrieved successfully",
        data: list,
    });
});
// =========================================================================
// 4. تفاصيل مندوب توصيل محدد
// =========================================================================
exports.getDeliveryManById = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const [dm] = await connection_1.db
        .select()
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false)))
        .limit(1);
    if (!dm) {
        throw new Errors_1.NotFound("Delivery man not found or not assigned to this company");
    }
    // Zones
    const zones = await connection_1.db
        .select({
        id: schema_1.shippingZones.id,
        name: schema_1.shippingZones.name,
        nameAr: schema_1.shippingZones.nameAr,
    })
        .from(schema_1.deliveryManZones)
        .innerJoin(schema_1.shippingZones, (0, drizzle_orm_1.eq)(schema_1.deliveryManZones.zoneId, schema_1.shippingZones.id))
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryManZones.deliveryManId, id));
    // Shifts
    const shifts = await connection_1.db
        .select({
        id: schema_1.deliveryManShifts.id,
        restaurantId: schema_1.deliveryManShifts.restaurantId,
        restaurantName: schema_1.restaurants.name,
        dayOfWeek: schema_1.deliveryManShifts.dayOfWeek,
        from: schema_1.deliveryManShifts.from,
        to: schema_1.deliveryManShifts.to,
        status: schema_1.deliveryManShifts.status,
    })
        .from(schema_1.deliveryManShifts)
        .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.deliveryManShifts.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryManShifts.deliveryManId, id));
    const { password: _, ...dmData } = dm;
    return (0, response_1.SuccessResponse)(res, {
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
exports.updateDeliveryMan = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const [dm] = await connection_1.db
        .select({ id: schema_1.deliveryMen.id })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false)))
        .limit(1);
    if (!dm) {
        throw new Errors_1.NotFound("Delivery man not found or does not belong to your company");
    }
    const { name, phone, email, password, image, deliveryType, allZones, shiftStatus, isActive, branchId, restaurantId, } = req.body;
    // Validate restaurant belongs to this company if specified
    if (restaurantId) {
        const [rest] = await connection_1.db
            .select({ id: schema_1.restaurantSettings.id })
            .from(schema_1.restaurantSettings)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantSettings.shippingCompanyId, companyId)))
            .limit(1);
        if (!rest) {
            throw new Errors_1.BadRequest("Specified restaurant does not belong to your shipping company");
        }
        if (branchId) {
            const [br] = await connection_1.db
                .select({ id: schema_1.branches.id })
                .from(schema_1.branches)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.id, branchId), (0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId)))
                .limit(1);
            if (!br) {
                throw new Errors_1.BadRequest("Specified branch does not belong to the selected restaurant");
            }
        }
    }
    const updateData = {};
    if (name !== undefined)
        updateData.name = name;
    if (phone !== undefined)
        updateData.phone = phone;
    if (email !== undefined)
        updateData.email = email;
    if (image !== undefined)
        updateData.image = image;
    if (deliveryType !== undefined)
        updateData.deliveryType = deliveryType;
    if (allZones !== undefined)
        updateData.allZones = allZones;
    if (shiftStatus !== undefined)
        updateData.shiftStatus = shiftStatus;
    if (isActive !== undefined)
        updateData.isActive = isActive;
    if (branchId !== undefined)
        updateData.branchId = branchId;
    if (restaurantId !== undefined)
        updateData.restaurantId = restaurantId;
    if (password) {
        updateData.password = await bcrypt_1.default.hash(password, 10);
    }
    await connection_1.db
        .update(schema_1.deliveryMen)
        .set(updateData)
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Delivery man updated successfully",
    });
});
// =========================================================================
// 6. Zones Management: GET /:id/zones and PUT /:id/zones (Phase 5)
// =========================================================================
exports.getCourierZones = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const [dm] = await connection_1.db
        .select({ id: schema_1.deliveryMen.id, allZones: schema_1.deliveryMen.allZones })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false)))
        .limit(1);
    if (!dm) {
        throw new Errors_1.NotFound("Courier not found or does not belong to your company");
    }
    const zones = await connection_1.db
        .select({
        id: schema_1.shippingZones.id,
        name: schema_1.shippingZones.name,
        nameAr: schema_1.shippingZones.nameAr,
        status: schema_1.shippingZones.status,
    })
        .from(schema_1.deliveryManZones)
        .innerJoin(schema_1.shippingZones, (0, drizzle_orm_1.eq)(schema_1.deliveryManZones.zoneId, schema_1.shippingZones.id))
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryManZones.deliveryManId, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Courier zones retrieved successfully",
        data: {
            allZones: dm.allZones,
            zones,
        },
    });
});
exports.updateCourierZones = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;
    const { allZones = false, zoneIds = [] } = req.body;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const [dm] = await connection_1.db
        .select({ id: schema_1.deliveryMen.id })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false)))
        .limit(1);
    if (!dm) {
        throw new Errors_1.NotFound("Courier not found or does not belong to your company");
    }
    // Verify all zoneIds belong to this shipping company
    if (zoneIds.length > 0) {
        const companyZones = await connection_1.db
            .select({ id: schema_1.shippingZones.id })
            .from(schema_1.shippingZones)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingZones.shippingCompanyId, companyId), (0, drizzle_orm_1.inArray)(schema_1.shippingZones.id, zoneIds)));
        if (companyZones.length !== zoneIds.length) {
            throw new Errors_1.BadRequest("One or more zone IDs do not belong to this company");
        }
    }
    await connection_1.db.transaction(async (tx) => {
        await tx
            .update(schema_1.deliveryMen)
            .set({ allZones: Boolean(allZones) })
            .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id));
        await tx
            .delete(schema_1.deliveryManZones)
            .where((0, drizzle_orm_1.eq)(schema_1.deliveryManZones.deliveryManId, id));
        if (!allZones && zoneIds.length > 0) {
            for (const zId of zoneIds) {
                await tx.insert(schema_1.deliveryManZones).values({
                    deliveryManId: id,
                    zoneId: zId,
                });
            }
        }
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Courier zones updated successfully",
    });
});
// =========================================================================
// 7. Shifts Management: GET /:id/shifts and PUT /:id/shifts (Phase 5)
// =========================================================================
exports.getCourierShifts = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const [dm] = await connection_1.db
        .select({ id: schema_1.deliveryMen.id, deliveryType: schema_1.deliveryMen.deliveryType })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false)))
        .limit(1);
    if (!dm) {
        throw new Errors_1.NotFound("Courier not found or does not belong to your company");
    }
    const shifts = await connection_1.db
        .select({
        id: schema_1.deliveryManShifts.id,
        restaurantId: schema_1.deliveryManShifts.restaurantId,
        restaurantName: schema_1.restaurants.name,
        dayOfWeek: schema_1.deliveryManShifts.dayOfWeek,
        from: schema_1.deliveryManShifts.from,
        to: schema_1.deliveryManShifts.to,
        status: schema_1.deliveryManShifts.status,
    })
        .from(schema_1.deliveryManShifts)
        .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.deliveryManShifts.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryManShifts.deliveryManId, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Courier shifts retrieved successfully",
        data: shifts,
    });
});
exports.updateCourierShifts = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;
    const { shifts = [] } = req.body;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const [dm] = await connection_1.db
        .select({ id: schema_1.deliveryMen.id, deliveryType: schema_1.deliveryMen.deliveryType })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false)))
        .limit(1);
    if (!dm) {
        throw new Errors_1.NotFound("Courier not found or does not belong to your company");
    }
    // Verify all restaurants are linked to this shipping company
    const restaurantIds = [...new Set(shifts.map((s) => s.restaurantId))];
    if (restaurantIds.length > 0) {
        const linked = await connection_1.db
            .select({ restaurantId: schema_1.restaurantSettings.restaurantId })
            .from(schema_1.restaurantSettings)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.shippingCompanyId, companyId), (0, drizzle_orm_1.inArray)(schema_1.restaurantSettings.restaurantId, restaurantIds)));
        if (linked.length !== restaurantIds.length) {
            throw new Errors_1.BadRequest("One or more restaurants are not assigned to your shipping company");
        }
    }
    await connection_1.db.transaction(async (tx) => {
        // Replace shifts
        await tx
            .delete(schema_1.deliveryManShifts)
            .where((0, drizzle_orm_1.eq)(schema_1.deliveryManShifts.deliveryManId, id));
        for (const s of shifts) {
            await tx.insert(schema_1.deliveryManShifts).values({
                deliveryManId: id,
                restaurantId: s.restaurantId,
                dayOfWeek: s.dayOfWeek,
                from: s.from,
                to: s.to,
                status: s.status || "active",
            });
        }
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Courier shifts updated successfully",
    });
});
// =========================================================================
// 8. فك ربط مندوب التوصيل من شركة الشحن (Unassign Delivery Man)
// =========================================================================
exports.unassignOrDeleteDeliveryMan = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const [dm] = await connection_1.db
        .select({
        id: schema_1.deliveryMen.id,
        activeOrdersCount: schema_1.deliveryMen.activeOrdersCount,
    })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, companyId)))
        .limit(1);
    if (!dm) {
        throw new Errors_1.NotFound("Delivery man not found or not assigned to this company");
    }
    // Security check: cannot unassign a courier with active orders!
    if (dm.activeOrdersCount > 0) {
        throw new Errors_1.BadRequest(`Cannot unassign courier while they have ${dm.activeOrdersCount} active orders. Complete or reassign them first.`);
    }
    // Remove from Redis GEO & alive key
    await (0, dispatchEngine_1.removeCourierFromRedis)(id);
    // Clean up shifts, zones, and unlink
    await connection_1.db.transaction(async (tx) => {
        await tx
            .delete(schema_1.deliveryManZones)
            .where((0, drizzle_orm_1.eq)(schema_1.deliveryManZones.deliveryManId, id));
        await tx
            .delete(schema_1.deliveryManShifts)
            .where((0, drizzle_orm_1.eq)(schema_1.deliveryManShifts.deliveryManId, id));
        await tx
            .update(schema_1.deliveryMen)
            .set({
            shippingCompanyId: null,
            shiftStatus: "inactive",
            isOnline: false,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id));
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Delivery man unassigned from shipping company successfully",
    });
});
