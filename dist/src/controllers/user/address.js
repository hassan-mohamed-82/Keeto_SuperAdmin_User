"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteUserAddress = exports.getUserAddresses = exports.updateUserAddress = exports.addUserAddress = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
const turf = __importStar(require("@turf/turf"));
const connection_1 = require("../../models/connection");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const schema_1 = require("../../models/schema");
/**
 * دالة مساعدة لتحديد الـ Zone تلقائياً بناءً على إحداثيات العميل
 */
async function detectZoneFromCoordinates(lat, lng) {
    const allZones = await connection_1.db.select().from(schema_1.zones);
    const userPoint = turf.point([lng, lat]); // Turf يستخدم [lng, lat]
    for (const zone of allZones) {
        if (!zone.coordinates)
            continue;
        try {
            const parsedCoords = typeof zone.coordinates === "string"
                ? JSON.parse(zone.coordinates)
                : zone.coordinates;
            const polyCoords = parsedCoords.coordinates ? parsedCoords.coordinates : parsedCoords;
            const polygon = turf.polygon(polyCoords);
            if (turf.booleanPointInPolygon(userPoint, polygon)) {
                return zone.id; // النقطة تقع داخل مضلع المنطقة
            }
        }
        catch (err) {
            console.error(`Error parsing coordinates for zone ${zone.id}:`, err);
        }
    }
    return null; // خارج نطاق التغطية للمناطق المسجلة
}
/**
 * 1. ADD ADDRESS (إضافة عنوان جديد)
 */
const addUserAddress = async (req, res) => {
    try {
        if (!req.user)
            throw new Errors_1.UnauthorizedError("Unauthenticated");
        const userId = req.user.id;
        const { type, title, lat, lng, street, number, floor, landmark, location } = req.body;
        if (!lat || !lng || !street || !number || !title) {
            throw new Errors_1.BadRequest("Missing required address fields");
        }
        // حساب الـ Zone تلقائياً من الإحداثيات
        const detectedZoneId = await detectZoneFromCoordinates(parseFloat(lat), parseFloat(lng));
        const addressId = (0, uuid_1.v4)();
        await connection_1.db.insert(schema_1.addresses).values({
            id: addressId,
            userId,
            type: type || "home",
            title,
            lat: String(lat),
            lng: String(lng),
            street,
            number: String(number),
            floor: floor ? String(floor) : null,
            landmark: landmark || null,
            location: location || null,
            zoneId: detectedZoneId, // يحفظ الـ ID أو null لو خارج التغطية
        });
        return (0, response_1.SuccessResponse)(res, {
            message: "Address added successfully",
            data: {
                id: addressId,
                zoneId: detectedZoneId,
                isCovered: !!detectedZoneId,
            },
        });
    }
    catch (error) {
        console.error("🔥 ADD ADDRESS ERROR:", error);
        throw error;
    }
};
exports.addUserAddress = addUserAddress;
/**
 * 2. UPDATE ADDRESS (تعديل عنوان)
 */
const updateUserAddress = async (req, res) => {
    try {
        if (!req.user)
            throw new Errors_1.UnauthorizedError("Unauthenticated");
        const userId = req.user.id;
        const { addressId } = req.params;
        const { type, title, lat, lng, street, number, floor, landmark, location } = req.body;
        const [existingAddress] = await connection_1.db
            .select()
            .from(schema_1.addresses)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId), (0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId)));
        if (!existingAddress) {
            throw new Errors_1.NotFound("Address not found");
        }
        let updatedZoneId = existingAddress.zoneId;
        // إذا تغيرت الإحداثيات، نعيد اكتشاف الـ Zone
        if (lat && lng && (lat !== existingAddress.lat || lng !== existingAddress.lng)) {
            updatedZoneId = await detectZoneFromCoordinates(parseFloat(lat), parseFloat(lng));
        }
        await connection_1.db
            .update(schema_1.addresses)
            .set({
            ...(type && { type }),
            ...(title && { title }),
            ...(lat && { lat: String(lat) }),
            ...(lng && { lng: String(lng) }),
            ...(street && { street }),
            ...(number && { number: String(number) }),
            ...(floor !== undefined && { floor: floor ? String(floor) : null }),
            ...(landmark !== undefined && { landmark }),
            ...(location !== undefined && { location }),
            zoneId: updatedZoneId,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId));
        return (0, response_1.SuccessResponse)(res, {
            message: "Address updated successfully",
            data: { id: addressId, zoneId: updatedZoneId },
        });
    }
    catch (error) {
        console.error("🔥 UPDATE ADDRESS ERROR:", error);
        throw error;
    }
};
exports.updateUserAddress = updateUserAddress;
/**
 * 3. GET USER ADDRESSES (جلب عناوين العميل وفحص إمكانية التوصيل للمطعم)
 */
const getUserAddresses = async (req, res) => {
    try {
        if (!req.user)
            throw new Errors_1.UnauthorizedError("Unauthenticated");
        const userId = req.user.id;
        const restaurantId = req.query.restaurantId;
        // 1. جلب كافة عناوين العميل
        const userAddresses = await connection_1.db
            .select()
            .from(schema_1.addresses)
            .where((0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId));
        // إذا لم يحدد المطعم، نرجع العناوين كما هي
        if (!restaurantId) {
            return (0, response_1.SuccessResponse)(res, { data: userAddresses });
        }
        // 2. تجميع الـ zoneIds الخاصة بعناوين المستخدم
        const userZoneIds = userAddresses.map((a) => a.zoneId).filter(Boolean);
        // 3. الاستعلام عن رسوم ومناطق التوصيل النشطة للمطعم المختار
        const activeDeliveryFees = userZoneIds.length > 0
            ? await connection_1.db
                .select()
                .from(schema_1.restaurantZoneDeliveryFees)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.status, "active"), (0, drizzle_orm_1.inArray)(schema_1.restaurantZoneDeliveryFees.zoneId, userZoneIds)))
            : [];
        // خريطة سريعة للبحث: zoneId -> deliveryFee
        const feeMap = new Map();
        activeDeliveryFees.forEach((item) => feeMap.set(item.zoneId, item.deliveryFee));
        // 4. مطابقة كل عنوان لمعرفة هل المطعم يغطيه أم لا
        const formattedAddresses = userAddresses.map((address) => {
            const isDeliverable = address.zoneId ? feeMap.has(address.zoneId) : false;
            const deliveryFee = address.zoneId ? (feeMap.get(address.zoneId) ?? null) : null;
            return {
                ...address,
                isDeliverable, // true إذا كان المطعم يوصل لزون هذا العنوان، false إذا كان Out of zone
                deliveryFee,
            };
        });
        return (0, response_1.SuccessResponse)(res, { data: formattedAddresses });
    }
    catch (error) {
        console.error("🔥 GET USER ADDRESSES ERROR:", error);
        throw error;
    }
};
exports.getUserAddresses = getUserAddresses;
/**
 * 4. DELETE ADDRESS (حذف عنوان)
 */
const deleteUserAddress = async (req, res) => {
    try {
        if (!req.user)
            throw new Errors_1.UnauthorizedError("Unauthenticated");
        const userId = req.user.id;
        const { addressId } = req.params;
        await connection_1.db
            .delete(schema_1.addresses)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId), (0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId)));
        return (0, response_1.SuccessResponse)(res, { message: "Address deleted successfully" });
    }
    catch (error) {
        console.error("🔥 DELETE ADDRESS ERROR:", error);
        throw error;
    }
};
exports.deleteUserAddress = deleteUserAddress;
