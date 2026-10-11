"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDeliveryMan = createDeliveryMan;
exports.assignExistingDeliveryMan = assignExistingDeliveryMan;
exports.getDeliveryMen = getDeliveryMen;
exports.getDeliveryManById = getDeliveryManById;
exports.updateDeliveryMan = updateDeliveryMan;
exports.toggleShift = toggleShift;
exports.updateLocation = updateLocation;
exports.unassignOrDeleteDeliveryMan = unassignOrDeleteDeliveryMan;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const bcrypt_1 = __importDefault(require("bcrypt"));
const socketService_1 = require("../../services/socket/socketService");
// =========================================================================
// 1. إنشاء مندوب توصيل جديد تابع لشركة الشحن (Create Outsource Delivery Man)
// =========================================================================
async function createDeliveryMan(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const { name, phone, email, password, image, deliveryType = "outsource", shiftStatus = "inactive", branchId, restaurantId, } = req.body;
    // فحص رقم الهاتف أو البريد
    const existing = await connection_1.db
        .select({ id: schema_1.deliveryMen.id })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.phone, phone))
        .limit(1);
    if (existing.length > 0) {
        throw new Errors_1.BadRequest("Phone number is already registered for another delivery man");
    }
    let hashedPassword;
    if (password) {
        hashedPassword = await bcrypt_1.default.hash(password, 10);
    }
    const [insertResult] = await connection_1.db.insert(schema_1.deliveryMen).values({
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
    const newDeliveryMan = await connection_1.db
        .select({
        id: schema_1.deliveryMen.id,
        name: schema_1.deliveryMen.name,
        phone: schema_1.deliveryMen.phone,
        email: schema_1.deliveryMen.email,
        image: schema_1.deliveryMen.image,
        deliveryType: schema_1.deliveryMen.deliveryType,
        shiftStatus: schema_1.deliveryMen.shiftStatus,
        isOnline: schema_1.deliveryMen.isOnline,
        isAvailable: schema_1.deliveryMen.isAvailable,
        isActive: schema_1.deliveryMen.isActive,
        shippingCompanyId: schema_1.deliveryMen.shippingCompanyId,
        createdAt: schema_1.deliveryMen.createdAt,
    })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.phone, phone))
        .limit(1);
    return (0, response_1.SuccessResponse)(res, {
        message: "Delivery man created and assigned to shipping company successfully",
        data: newDeliveryMan[0],
    }, 201);
}
// =========================================================================
// 2. إسناد مندوب توصيل حالي لشركة الشحن (Assign Existing Delivery Man)
// =========================================================================
async function assignExistingDeliveryMan(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { deliveryManId, deliveryType = "outsource" } = req.body;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const dm = await connection_1.db
        .select({ id: schema_1.deliveryMen.id, name: schema_1.deliveryMen.name })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId))
        .limit(1);
    if (dm.length === 0) {
        throw new Errors_1.NotFound("Delivery man not found");
    }
    await connection_1.db
        .update(schema_1.deliveryMen)
        .set({
        shippingCompanyId: companyId,
        deliveryType,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId));
    return (0, response_1.SuccessResponse)(res, {
        message: `Delivery man ${dm[0].name} has been assigned to shipping company successfully`,
    });
}
// =========================================================================
// 3. عرض قائمة مناديب التوصيل التابعين لشركة الشحن (Get Delivery Men)
// =========================================================================
async function getDeliveryMen(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
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
}
// =========================================================================
// 4. تفاصيل مندوب توصيل محدد
// =========================================================================
async function getDeliveryManById(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const dm = await connection_1.db
        .select({
        id: schema_1.deliveryMen.id,
        name: schema_1.deliveryMen.name,
        phone: schema_1.deliveryMen.phone,
        email: schema_1.deliveryMen.email,
        image: schema_1.deliveryMen.image,
        deliveryType: schema_1.deliveryMen.deliveryType,
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
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, companyId)))
        .limit(1);
    if (dm.length === 0) {
        throw new Errors_1.NotFound("Delivery man not found or not assigned to this company");
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Delivery man details retrieved successfully",
        data: dm[0],
    });
}
// =========================================================================
// 5. تعديل بيانات المندوب (Update Delivery Man)
// =========================================================================
async function updateDeliveryMan(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const dm = await connection_1.db
        .select({ id: schema_1.deliveryMen.id })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, companyId)))
        .limit(1);
    if (dm.length === 0) {
        throw new Errors_1.NotFound("Delivery man not found");
    }
    const { name, phone, email, password, image, deliveryType, shiftStatus, isOnline, isAvailable, isActive, branchId, restaurantId, } = req.body;
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
    if (shiftStatus !== undefined)
        updateData.shiftStatus = shiftStatus;
    if (isOnline !== undefined)
        updateData.isOnline = isOnline;
    if (isAvailable !== undefined)
        updateData.isAvailable = isAvailable;
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
}
// =========================================================================
// 6. تبديل شفت المندوب (Toggle Shift Status - active / inactive)
// =========================================================================
async function toggleShift(req, res) {
    const { id } = req.params;
    const { shiftStatus } = req.body;
    const dm = await connection_1.db
        .select({ id: schema_1.deliveryMen.id, shippingCompanyId: schema_1.deliveryMen.shippingCompanyId })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id))
        .limit(1);
    if (dm.length === 0) {
        throw new Errors_1.NotFound("Delivery man not found");
    }
    await connection_1.db
        .update(schema_1.deliveryMen)
        .set({ shiftStatus })
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id));
    if (dm[0].shippingCompanyId) {
        (0, socketService_1.notifyShippingCompany)(dm[0].shippingCompanyId, "delivery:shift_changed", {
            deliveryManId: id,
            shiftStatus,
        });
    }
    return (0, response_1.SuccessResponse)(res, {
        message: `Shift status updated to ${shiftStatus}`,
    });
}
// =========================================================================
// 7. تحديث إحداثيات موقع المندوب عبر الـ HTTP (كبديل إضافي بجانب WebSocket)
// =========================================================================
async function updateLocation(req, res) {
    const { id } = req.params;
    const { lat, lng } = req.body;
    const dm = await connection_1.db
        .select({ id: schema_1.deliveryMen.id, shippingCompanyId: schema_1.deliveryMen.shippingCompanyId })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id))
        .limit(1);
    if (dm.length === 0) {
        throw new Errors_1.NotFound("Delivery man not found");
    }
    const now = new Date();
    await connection_1.db
        .update(schema_1.deliveryMen)
        .set({
        currentLat: String(lat),
        currentLng: String(lng),
        lastLocationUpdate: now,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id));
    if (dm[0].shippingCompanyId) {
        (0, socketService_1.notifyShippingCompany)(dm[0].shippingCompanyId, "delivery:location_changed", {
            deliveryManId: id,
            lat: String(lat),
            lng: String(lng),
            updatedAt: now,
        });
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Delivery man location updated successfully",
    });
}
// =========================================================================
// 8. فك ربط أو حذف مندوب التوصيل
// =========================================================================
async function unassignOrDeleteDeliveryMan(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const dm = await connection_1.db
        .select({ id: schema_1.deliveryMen.id })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, companyId)))
        .limit(1);
    if (dm.length === 0) {
        throw new Errors_1.NotFound("Delivery man not found or not assigned to this company");
    }
    // فك الربط بشركة الشحن
    await connection_1.db
        .update(schema_1.deliveryMen)
        .set({
        shippingCompanyId: null,
        shiftStatus: "inactive",
        isOnline: false,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Delivery man unassigned from shipping company successfully",
    });
}
