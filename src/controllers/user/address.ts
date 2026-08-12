import { Request, Response } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import * as turf from "@turf/turf";
import { db } from "../../models/connection";
import { SuccessResponse } from "../../utils/response";
import { NotFound, UnauthorizedError, BadRequest } from "../../Errors";
import { addresses, restaurantZoneDeliveryFees, zones } from "../../models/schema";

/**
 * دالة مساعدة لتحديد الـ Zone تلقائياً بناءً على إحداثيات العميل
 */
async function detectZoneFromCoordinates(lat: number, lng: number): Promise<string | null> {
    const allZones = await db.select().from(zones);
    const userPoint = turf.point([lng, lat]); // Turf يستخدم [lng, lat]

    for (const zone of allZones) {
        if (!zone.coordinates) continue;

        try {
            const parsedCoords = typeof zone.coordinates === "string"
                ? JSON.parse(zone.coordinates)
                : zone.coordinates;

            const polyCoords = parsedCoords.coordinates ? parsedCoords.coordinates : parsedCoords;
            const polygon = turf.polygon(polyCoords);

            if (turf.booleanPointInPolygon(userPoint, polygon)) {
                return zone.id; // النقطة تقع داخل مضلع المنطقة
            }
        } catch (err) {
            console.error(`Error parsing coordinates for zone ${zone.id}:`, err);
        }
    }

    return null; // خارج نطاق التغطية للمناطق المسجلة
}

/**
 * 1. ADD ADDRESS (إضافة عنوان جديد)
 */
export const addUserAddress = async (req: Request, res: Response) => {
    try {
        if (!req.user) throw new UnauthorizedError("Unauthenticated");
        const userId = req.user.id;

        const { type, title, lat, lng, street, number, floor, apartment, landmark, location } = req.body;

        if (!lat || !lng || !street || !number || !title) {
            throw new BadRequest("Missing required address fields");
        }

        // حساب الـ Zone تلقائياً من الإحداثيات
        const detectedZoneId = await detectZoneFromCoordinates(parseFloat(lat), parseFloat(lng));

        const addressId = uuidv4();
        await db.insert(addresses).values({
            id: addressId,
            userId,
            type: type || "home",
            title,
            lat: String(lat),
            lng: String(lng),
            street,
            number: String(number),
            floor: floor ? String(floor) : null,
            apartment: apartment ? String(apartment) : null,
            landmark: landmark || null,
            location: location || null,
            zoneId: detectedZoneId, // يحفظ الـ ID أو null لو خارج التغطية
        });

        return SuccessResponse(res, {
            message: "Address added successfully",
            data: {
                id: addressId,
                zoneId: detectedZoneId,
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
        const { type, title, lat, lng, street, number, floor, apartment, landmark, location } = req.body;

        const [existingAddress] = await db
            .select()
            .from(addresses)
            .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)));

        if (!existingAddress) {
            throw new NotFound("Address not found");
        }

        let updatedZoneId = existingAddress.zoneId;

        // إذا تغيرت الإحداثيات، نعيد اكتشاف الـ Zone
        if (lat && lng && (lat !== existingAddress.lat || lng !== existingAddress.lng)) {
            updatedZoneId = await detectZoneFromCoordinates(parseFloat(lat), parseFloat(lng));
        }

        await db
            .update(addresses)
            .set({
                ...(type && { type }),
                ...(title && { title }),
                ...(lat && { lat: String(lat) }),
                ...(lng && { lng: String(lng) }),
                ...(street && { street }),
                ...(number && { number: String(number) }),
                ...(floor !== undefined && { floor: floor ? String(floor) : null }),
                ...(apartment !== undefined && { apartment: apartment ? String(apartment) : null }),
                ...(landmark !== undefined && { landmark }),
                ...(location !== undefined && { location }),
                zoneId: updatedZoneId,
            })
            .where(eq(addresses.id, addressId));

        return SuccessResponse(res, {
            message: "Address updated successfully",
            data: { id: addressId, zoneId: updatedZoneId },
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
            .select()
            .from(addresses)
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