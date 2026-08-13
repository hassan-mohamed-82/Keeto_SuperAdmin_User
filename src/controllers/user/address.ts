import { Request, Response } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import * as turf from "@turf/turf";
import { db } from "../../models/connection";
import { SuccessResponse } from "../../utils/response";
import { NotFound, UnauthorizedError, BadRequest } from "../../Errors";
import { addresses, restaurantZoneDeliveryFees, zones, cities } from "../../models/schema";
import { isLocationInZone } from "../../utils/geo";

/**
 * دالة مساعدة لتحديد الـ Zone تلقائياً بناءً على إحداثيات العميل
 */
// async function detectZoneFromCoordinates(lat: number, lng: number): Promise<string | null> {
//     const allZones = await db.select().from(zones);
//     const userPoint = turf.point([lng, lat]); // Turf يستخدم [lng, lat]

//     for (const zone of allZones) {
//         if (!zone.coordinates) continue;

//         try {
//             const parsedCoords = typeof zone.coordinates === "string"
//                 ? JSON.parse(zone.coordinates)
//                 : zone.coordinates;

//             const polyCoords = parsedCoords.coordinates ? parsedCoords.coordinates : parsedCoords;
//             const polygon = turf.polygon(polyCoords);

//             if (turf.booleanPointInPolygon(userPoint, polygon)) {
//                 return zone.id; // النقطة تقع داخل مضلع المنطقة
//             }
//         } catch (err) {
//             console.error(`Error parsing coordinates for zone ${zone.id}:`, err);
//         }
//     }

//     return null; // خارج نطاق التغطية للمناطق المسجلة
// }

/**
 * دالة تحديد الـ Zone بعد إصلاح وتنسيق البيانات
 */
async function detectZoneFromCoordinates(lat: number, lng: number): Promise<string | null> {
    const allZones = await db.select().from(zones).where(eq(zones.status, "active"));

    for (const zone of allZones) {
        if (!zone.coordinates) continue;

        const radiusKm = parseFloat((zone.coverageAreaRadiusKm as string) || "0");
        const isRadius = radiusKm > 0;

        const dummyFee = {
            coverageType: isRadius ? "RADIUS" : "POLYGON",
            defaultCoordinates: zone.coordinates,
            defaultRadiusKm: radiusKm,
            zoneId: zone.id
        };

        if (isLocationInZone(lat, lng, null, dummyFee)) {
            return zone.id;
        }
    }

    return null;
}

/**
 * 1. ADD ADDRESS (إضافة عنوان جديد)
 */
export const addUserAddress = async (req: Request, res: Response) => {
    try {
        if (!req.user) throw new UnauthorizedError("Unauthenticated");
        const userId = req.user.id;

        const { type, title, lat, lng, street, number, floor, apartment, landmark, location, fulladdress } = req.body;

        if (!lat || !lng || !street || !number || !title) {
            throw new BadRequest("Missing required address fields");
        }

        const parsedLat = parseFloat(lat);
        const parsedLng = parseFloat(lng);

        if (isNaN(parsedLat) || isNaN(parsedLng)) {
            throw new BadRequest("Invalid latitude or longitude format");
        }

        // حساب الـ Zone تلقائياً من الإحداثيات
        const detectedZoneId = await detectZoneFromCoordinates(parsedLat, parsedLng);

        const addressId = uuidv4();
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
            zoneId: detectedZoneId,
        };

        await db.insert(addresses).values(newAddress);

        return SuccessResponse(res, {
            message: "Address added successfully",
            data: {
                ...newAddress,
                isCovered: !!detectedZoneId,
            },
        });
    } catch (error) {
        console.error("🔥 ADD ADDRESS ERROR:", error);
        throw error;
    }
};

/**
 * 2. UPDATE ADDRESS (تعديل عنوان)
 */
export const updateUserAddress = async (req: Request, res: Response) => {
    try {
        if (!req.user) throw new UnauthorizedError("Unauthenticated");
        const userId = req.user.id;
        const { addressId } = req.params;
        const { type, title, lat, lng, street, number, floor, apartment, landmark, location, fulladdress } = req.body;

        const [existingAddress] = await db
            .select()
            .from(addresses)
            .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)));

        if (!existingAddress) {
            throw new NotFound("Address not found");
        }

        const targetLat = lat !== undefined ? parseFloat(lat) : parseFloat(existingAddress.lat);
        const targetLng = lng !== undefined ? parseFloat(lng) : parseFloat(existingAddress.lng);

        let updatedZoneId = existingAddress.zoneId;

        // إعادة الحساب إذا تغيرت الإحداثيات
        if (targetLat !== parseFloat(existingAddress.lat) || targetLng !== parseFloat(existingAddress.lng)) {
            if (isNaN(targetLat) || isNaN(targetLng)) {
                throw new BadRequest("Invalid coordinates provided");
            }
            updatedZoneId = await detectZoneFromCoordinates(targetLat, targetLng);
        }

        await db
            .update(addresses)
            .set({
                ...(type && { type }),
                ...(title && { title }),
                ...(lat !== undefined && { lat: String(lat) }),
                ...(lng !== undefined && { lng: String(lng) }),
                ...(street && { street }),
                ...(number !== undefined && { number: String(number) }),
                ...(floor !== undefined && { floor: floor ? String(floor) : null }),
                ...(apartment !== undefined && { apartment: apartment ? String(apartment) : null }),
                ...(landmark !== undefined && { landmark }),
                ...(location !== undefined && { location }),
                ...(fulladdress !== undefined && { fulladdress }),
                zoneId: updatedZoneId,
            })
            .where(eq(addresses.id, addressId));

        return SuccessResponse(res, {
            message: "Address updated successfully",
            data: { id: addressId, zoneId: updatedZoneId, isCovered: !!updatedZoneId },
        });
    } catch (error) {
        console.error("🔥 UPDATE ADDRESS ERROR:", error);
        throw error;
    }
};

/**
 * 3. GET USER ADDRESSES (جلب عناوين العميل وفحص إمكانية التوصيل للمطعم)
 */
export const getUserAddresses = async (req: Request, res: Response) => {
    try {
        if (!req.user) throw new UnauthorizedError("Unauthenticated");
        const userId = req.user.id;
        const restaurantId = req.query.restaurantId as string | undefined;

        // 1. جلب كافة عناوين العميل
        const userAddresses = await db
            .select({
                id: addresses.id,
                userId: addresses.userId,
                zoneId: addresses.zoneId,
                type: addresses.type,
                title: addresses.title,
                lat: addresses.lat,
                lng: addresses.lng,
                street: addresses.street,
                number: addresses.number,
                floor: addresses.floor,
                apartment: addresses.apartment,
                landmark: addresses.landmark,
                location: addresses.location,
                fulladdress: addresses.fulladdress,
                createdAt: addresses.createdAt,
                updatedAt: addresses.updatedAt,
                zone: {
                    id: zones.id,
                    name: zones.name,
                    nameAr: zones.nameAr,
                    nameFr: zones.nameFr,
                    displayName: zones.displayName,
                    displayNameAr: zones.displayNameAr,
                    displayNameFr: zones.displayNameFr,
                },
                city: {
                    id: cities.id,
                    name: cities.name,
                    nameAr: cities.nameAr,
                    nameFr: cities.nameFr,
                }
            })
            .from(addresses)
            .leftJoin(zones, eq(addresses.zoneId, zones.id))
            .leftJoin(cities, eq(zones.cityId, cities.id))
            .where(eq(addresses.userId, userId));

        // إذا لم يحدد المطعم، نرجع العناوين كما هي
        if (!restaurantId) {
            return SuccessResponse(res, { data: userAddresses });
        }

        // 2. تجميع الـ zoneIds الخاصة بعناوين المستخدم
        const userZoneIds = userAddresses.map((a) => a.zoneId).filter(Boolean) as string[];

        // 3. الاستعلام عن رسوم ومناطق التوصيل النشطة للمطعم المختار
        const activeDeliveryFees = userZoneIds.length > 0
            ? await db
                .select()
                .from(restaurantZoneDeliveryFees)
                .where(
                    and(
                        eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
                        eq(restaurantZoneDeliveryFees.status, "active"),
                        inArray(restaurantZoneDeliveryFees.zoneId, userZoneIds)
                    )
                )
            : [];

        // خريطة سريعة للبحث: zoneId -> deliveryFee
        const feeMap = new Map<string, string>();
        activeDeliveryFees.forEach((item) => feeMap.set(item.zoneId, item.deliveryFee as string));

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

        return SuccessResponse(res, { data: formattedAddresses });
    } catch (error) {
        console.error("🔥 GET USER ADDRESSES ERROR:", error);
        throw error;
    }
};

/**
 * 4. DELETE ADDRESS (حذف عنوان)
 */
export const deleteUserAddress = async (req: Request, res: Response) => {
    try {
        if (!req.user) throw new UnauthorizedError("Unauthenticated");
        const userId = req.user.id;
        const { addressId } = req.params;

        await db
            .delete(addresses)
            .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)));

        return SuccessResponse(res, { message: "Address deleted successfully" });
    } catch (error) {
        console.error("🔥 DELETE ADDRESS ERROR:", error);
        throw error;
    }
};