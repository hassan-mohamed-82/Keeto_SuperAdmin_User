"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteUserAddress = exports.getUserAddresses = exports.updateUserAddress = exports.addUserAddress = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
const connection_1 = require("../../models/connection");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const schema_1 = require("../../models/schema");
const geo_1 = require("../../utils/geo");
/**
 * 1. ADD ADDRESS (إضافة عنوان جديد بدون ربطه بشرط زون معينة)
 */
const addUserAddress = async (req, res) => {
    try {
        if (!req.user)
            throw new Errors_1.UnauthorizedError("Unauthenticated");
        const userId = req.user.id;
        const { type, title, lat, lng, street, number, floor, apartment, landmark, location, fulladdress } = req.body;
        if (!lat || !lng || !street || !number || !title) {
            throw new Errors_1.BadRequest("Missing required address fields");
        }
        const parsedLat = parseFloat(lat);
        const parsedLng = parseFloat(lng);
        if (isNaN(parsedLat) || isNaN(parsedLng)) {
            throw new Errors_1.BadRequest("Invalid latitude or longitude format");
        }
        const addressId = (0, uuid_1.v4)();
        const newAddress = {
            id: addressId,
            userId,
            type: type || "home",
            title,
            lat: String(parsedLat),
            lng: String(parsedLng),
            street,
            number: String(number),
            floor: floor ? String(floor) : null,
            apartment: apartment ? String(apartment) : null,
            landmark: landmark || null,
            location: location || null,
            fulladdress: fulladdress || null,
            zoneId: null, // حفظ العنوان بالإحداثيات فقط دون تقييده بزون ثابتة
        };
        await connection_1.db.insert(schema_1.addresses).values(newAddress);
        return (0, response_1.SuccessResponse)(res, {
            message: "Address added successfully",
            data: newAddress,
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
        const { type, title, lat, lng, street, number, floor, apartment, landmark, location, fulladdress } = req.body;
        const [existingAddress] = await connection_1.db
            .select()
            .from(schema_1.addresses)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId), (0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId)));
        if (!existingAddress) {
            throw new Errors_1.NotFound("Address not found");
        }
        const updateData = {};
        if (type !== undefined)
            updateData.type = type;
        if (title !== undefined)
            updateData.title = title;
        if (lat !== undefined) {
            const parsedLat = parseFloat(lat);
            if (isNaN(parsedLat))
                throw new Errors_1.BadRequest("Invalid latitude format");
            updateData.lat = String(parsedLat);
        }
        if (lng !== undefined) {
            const parsedLng = parseFloat(lng);
            if (isNaN(parsedLng))
                throw new Errors_1.BadRequest("Invalid longitude format");
            updateData.lng = String(parsedLng);
        }
        if (street !== undefined)
            updateData.street = street;
        if (number !== undefined)
            updateData.number = String(number);
        if (floor !== undefined)
            updateData.floor = floor ? String(floor) : null;
        if (apartment !== undefined)
            updateData.apartment = apartment ? String(apartment) : null;
        if (landmark !== undefined)
            updateData.landmark = landmark;
        if (location !== undefined)
            updateData.location = location;
        if (fulladdress !== undefined)
            updateData.fulladdress = fulladdress;
        await connection_1.db
            .update(schema_1.addresses)
            .set(updateData)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId), (0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId)));
        return (0, response_1.SuccessResponse)(res, {
            message: "Address updated successfully",
            data: { id: addressId, ...updateData },
        });
    }
    catch (error) {
        console.error("🔥 UPDATE ADDRESS ERROR:", error);
        throw error;
    }
};
exports.updateUserAddress = updateUserAddress;
/**
 * 3. GET USER ADDRESSES (جلب عناوين العميل وفحص إمكانية التوصيل ديناميكياً)
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
        // إذا لم يحدد المطعم، نرجع العناوين فقط
        if (!restaurantId) {
            return (0, response_1.SuccessResponse)(res, { data: userAddresses });
        }
        // 2. جلب جميع مناطق التوصيل والرسوم النشطة للمطعم المختار
        const restaurantFees = await connection_1.db
            .select({
            fee: schema_1.restaurantZoneDeliveryFees,
            zone: schema_1.zones,
        })
            .from(schema_1.restaurantZoneDeliveryFees)
            .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.zoneId, schema_1.zones.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.status, "active")));
        // 3. مطابقة إحداثيات كل عنوان ديناميكياً مع مناطق تغطية المطعم
        const formattedAddresses = userAddresses.map((addr) => {
            const addrLat = parseFloat(addr.lat);
            const addrLng = parseFloat(addr.lng);
            let matchingFee = null;
            let maxDeliveryFee = -1;
            if (!isNaN(addrLat) && !isNaN(addrLng)) {
                for (const item of restaurantFees) {
                    const feeData = {
                        coverageType: item.fee.coverageType,
                        customCoordinates: item.fee.customCoordinates,
                        customRadiusKm: item.fee.customRadiusKm,
                        defaultCoordinates: item.zone?.coordinates,
                        defaultRadiusKm: item.zone?.coverageAreaRadiusKm,
                    };
                    if ((0, geo_1.isLocationInZone)(addrLat, addrLng, item.fee.zoneId, feeData)) {
                        const currentFee = parseFloat(item.fee.deliveryFee || "0");
                        // 🚀 اختيار النطاق ذو أعلى سعر توصيل والـ zoneId المقترن به في حالة التقاطع
                        if (matchingFee === null || currentFee > maxDeliveryFee) {
                            maxDeliveryFee = currentFee;
                            matchingFee = item.fee;
                        }
                    }
                }
            }
            return {
                ...addr,
                isDeliverable: !!matchingFee,
                deliveryFee: matchingFee ? matchingFee.deliveryFee : null,
                minOrderAmount: matchingFee ? matchingFee.minOrderAmount : null,
                restaurantDeliveryZoneId: matchingFee ? matchingFee.id : null,
                zoneId: matchingFee ? matchingFee.zoneId : null,
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
//------
// import { Request, Response } from "express";
// import { eq, and, inArray } from "drizzle-orm";
// import { v4 as uuidv4 } from "uuid";
// import * as turf from "@turf/turf";
// import { db } from "../../models/connection";
// import { SuccessResponse } from "../../utils/response";
// import { NotFound, UnauthorizedError, BadRequest } from "../../Errors";
// import { addresses, restaurantZoneDeliveryFees, zones, cities } from "../../models/schema";
// import { isLocationInZone } from "../../utils/geo";
// /**
//  * دالة مساعدة لتحديد الـ Zone تلقائياً بناءً على إحداثيات العميل
//  */
// // async function detectZoneFromCoordinates(lat: number, lng: number): Promise<string | null> {
// //     const allZones = await db.select().from(zones);
// //     const userPoint = turf.point([lng, lat]); // Turf يستخدم [lng, lat]
// //     for (const zone of allZones) {
// //         if (!zone.coordinates) continue;
// //         try {
// //             const parsedCoords = typeof zone.coordinates === "string"
// //                 ? JSON.parse(zone.coordinates)
// //                 : zone.coordinates;
// //             const polyCoords = parsedCoords.coordinates ? parsedCoords.coordinates : parsedCoords;
// //             const polygon = turf.polygon(polyCoords);
// //             if (turf.booleanPointInPolygon(userPoint, polygon)) {
// //                 return zone.id; // النقطة تقع داخل مضلع المنطقة
// //             }
// //         } catch (err) {
// //             console.error(`Error parsing coordinates for zone ${zone.id}:`, err);
// //         }
// //     }
// //     return null; // خارج نطاق التغطية للمناطق المسجلة
// // }
// /**
//  * دالة تحديد الـ Zone بعد إصلاح وتنسيق البيانات
//  */
// async function detectZoneFromCoordinates(lat: number, lng: number): Promise<string | null> {
//     const allZones = await db.select().from(zones).where(eq(zones.status, "active"));
//     for (const zone of allZones) {
//         // فحص وجود إحداثيات (سواء custom أو default أو coordinates)
//         const zoneCoords = (zone as any).customCoordinates || (zone as any).defaultCoordinates || zone.coordinates;
//         if (!zoneCoords) continue;
//         // جلب نصف القطر مع دعم الـ Fallback
//         const radiusVal = (zone as any).customRadiusKm || (zone as any).defaultRadiusKm || (zone as any).coverageAreaRadiusKm;
//         const radiusKm = parseFloat(radiusVal || "0");
//         // تحديد نوع التغطية
//         const coverageType = (zone as any).coverageType || (radiusKm > 0 ? "RADIUS" : "POLYGON");
//         const dummyFee = {
//             coverageType,
//             defaultCoordinates: zoneCoords,
//             defaultRadiusKm: radiusKm,
//             zoneId: zone.id
//         };
//         if (isLocationInZone(lat, lng, zone.id, dummyFee)) {
//             return zone.id;
//         }
//     }
//     return null;
// }
// /**
//  * 1. ADD ADDRESS (إضافة عنوان جديد)
//  */
// export const addUserAddress = async (req: Request, res: Response) => {
//     try {
//         if (!req.user) throw new UnauthorizedError("Unauthenticated");
//         const userId = req.user.id;
//         const { type, title, lat, lng, street, number, floor, apartment, landmark, location, fulladdress } = req.body;
//         if (!lat || !lng || !street || !number || !title) {
//             throw new BadRequest("Missing required address fields");
//         }
//         const parsedLat = parseFloat(lat);
//         const parsedLng = parseFloat(lng);
//         if (isNaN(parsedLat) || isNaN(parsedLng)) {
//             throw new BadRequest("Invalid latitude or longitude format");
//         }
//         // حساب الـ Zone تلقائياً من الإحداثيات
//         const detectedZoneId = await detectZoneFromCoordinates(parsedLat, parsedLng);
//         const addressId = uuidv4();
//         const newAddress = {
//             id: addressId,
//             userId,
//             type: type || "home",
//             title,
//             lat: String(parsedLat),
//             lng: String(parsedLng),
//             street,
//             number: String(number),
//             floor: floor ? String(floor) : null,
//             apartment: apartment ? String(apartment) : null,
//             landmark: landmark || null,
//             location: location || null,
//             fulladdress: fulladdress || null,
//             zoneId: detectedZoneId,
//         };
//         await db.insert(addresses).values(newAddress);
//         return SuccessResponse(res, {
//             message: "Address added successfully",
//             data: {
//                 ...newAddress,
//                 isCovered: !!detectedZoneId,
//             },
//         });
//     } catch (error) {
//         console.error("🔥 ADD ADDRESS ERROR:", error);
//         throw error;
//     }
// };
// /**
//  * 2. UPDATE ADDRESS (تعديل عنوان)
//  */
// export const updateUserAddress = async (req: Request, res: Response) => {
//     try {
//         if (!req.user) throw new UnauthorizedError("Unauthenticated");
//         const userId = req.user.id;
//         const { addressId } = req.params;
//         const { type, title, lat, lng, street, number, floor, apartment, landmark, location, fulladdress } = req.body;
//         const [existingAddress] = await db
//             .select()
//             .from(addresses)
//             .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)));
//         if (!existingAddress) {
//             throw new NotFound("Address not found");
//         }
//         const targetLat = lat !== undefined ? parseFloat(lat) : parseFloat(existingAddress.lat);
//         const targetLng = lng !== undefined ? parseFloat(lng) : parseFloat(existingAddress.lng);
//         let updatedZoneId = existingAddress.zoneId;
//         // إعادة الحساب إذا تغيرت الإحداثيات
//         if (targetLat !== parseFloat(existingAddress.lat) || targetLng !== parseFloat(existingAddress.lng)) {
//             if (isNaN(targetLat) || isNaN(targetLng)) {
//                 throw new BadRequest("Invalid coordinates provided");
//             }
//             updatedZoneId = await detectZoneFromCoordinates(targetLat, targetLng);
//         }
//         await db
//             .update(addresses)
//             .set({
//                 ...(type && { type }),
//                 ...(title && { title }),
//                 ...(lat !== undefined && { lat: String(lat) }),
//                 ...(lng !== undefined && { lng: String(lng) }),
//                 ...(street && { street }),
//                 ...(number !== undefined && { number: String(number) }),
//                 ...(floor !== undefined && { floor: floor ? String(floor) : null }),
//                 ...(apartment !== undefined && { apartment: apartment ? String(apartment) : null }),
//                 ...(landmark !== undefined && { landmark }),
//                 ...(location !== undefined && { location }),
//                 ...(fulladdress !== undefined && { fulladdress }),
//                 zoneId: updatedZoneId,
//             })
//             .where(eq(addresses.id, addressId));
//         return SuccessResponse(res, {
//             message: "Address updated successfully",
//             data: { id: addressId, zoneId: updatedZoneId, isCovered: !!updatedZoneId },
//         });
//     } catch (error) {
//         console.error("🔥 UPDATE ADDRESS ERROR:", error);
//         throw error;
//     }
// };
// /**
//  * 3. GET USER ADDRESSES (جلب عناوين العميل وفحص إمكانية التوصيل للمطعم)
//  */
// export const getUserAddresses = async (req: Request, res: Response) => {
//     try {
//         if (!req.user) throw new UnauthorizedError("Unauthenticated");
//         const userId = req.user.id;
//         const restaurantId = req.query.restaurantId as string | undefined;
//         // 1. جلب كافة عناوين العميل
//         const userAddresses = await db
//             .select({
//                 id: addresses.id,
//                 userId: addresses.userId,
//                 zoneId: addresses.zoneId,
//                 type: addresses.type,
//                 title: addresses.title,
//                 lat: addresses.lat,
//                 lng: addresses.lng,
//                 street: addresses.street,
//                 number: addresses.number,
//                 floor: addresses.floor,
//                 apartment: addresses.apartment,
//                 landmark: addresses.landmark,
//                 location: addresses.location,
//                 fulladdress: addresses.fulladdress,
//                 createdAt: addresses.createdAt,
//                 updatedAt: addresses.updatedAt,
//                 zone: {
//                     id: zones.id,
//                     name: zones.name,
//                     nameAr: zones.nameAr,
//                     nameFr: zones.nameFr,
//                     displayName: zones.displayName,
//                     displayNameAr: zones.displayNameAr,
//                     displayNameFr: zones.displayNameFr,
//                 },
//                 city: {
//                     id: cities.id,
//                     name: cities.name,
//                     nameAr: cities.nameAr,
//                     nameFr: cities.nameFr,
//                 }
//             })
//             .from(addresses)
//             .leftJoin(zones, eq(addresses.zoneId, zones.id))
//             .leftJoin(cities, eq(zones.cityId, cities.id))
//             .where(eq(addresses.userId, userId));
//         // إذا لم يحدد المطعم، نرجع العناوين كما هي
//         if (!restaurantId) {
//             return SuccessResponse(res, { data: userAddresses });
//         }
//         // 2. تجميع الـ zoneIds الخاصة بعناوين المستخدم
//         const userZoneIds = userAddresses.map((a) => a.zoneId).filter(Boolean) as string[];
//         // 3. الاستعلام عن رسوم ومناطق التوصيل النشطة للمطعم المختار
//         const activeDeliveryFees = userZoneIds.length > 0
//             ? await db
//                 .select()
//                 .from(restaurantZoneDeliveryFees)
//                 .where(
//                     and(
//                         eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
//                         eq(restaurantZoneDeliveryFees.status, "active"),
//                         inArray(restaurantZoneDeliveryFees.zoneId, userZoneIds)
//                     )
//                 )
//             : [];
//         // خريطة سريعة للبحث: zoneId -> deliveryFee
//         const feeMap = new Map<string, string>();
//         activeDeliveryFees.forEach((item) => feeMap.set(item.zoneId, item.deliveryFee as string));
//         // 4. مطابقة كل عنوان لمعرفة هل المطعم يغطيه أم لا
//         const formattedAddresses = userAddresses.map((address) => {
//             const isDeliverable = address.zoneId ? feeMap.has(address.zoneId) : false;
//             const deliveryFee = address.zoneId ? (feeMap.get(address.zoneId) ?? null) : null;
//             return {
//                 ...address,
//                 isDeliverable, // true إذا كان المطعم يوصل لزون هذا العنوان، false إذا كان Out of zone
//                 deliveryFee,
//             };
//         });
//         return SuccessResponse(res, { data: formattedAddresses });
//     } catch (error) {
//         console.error("🔥 GET USER ADDRESSES ERROR:", error);
//         throw error;
//     }
// };
// /**
//  * 4. DELETE ADDRESS (حذف عنوان)
//  */
// export const deleteUserAddress = async (req: Request, res: Response) => {
//     try {
//         if (!req.user) throw new UnauthorizedError("Unauthenticated");
//         const userId = req.user.id;
//         const { addressId } = req.params;
//         await db
//             .delete(addresses)
//             .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)));
//         return SuccessResponse(res, { message: "Address deleted successfully" });
//     } catch (error) {
//         console.error("🔥 DELETE ADDRESS ERROR:", error);
//         throw error;
//     }
// };
