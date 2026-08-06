import { Request, Response } from "express";
import { db } from "../../models/connection";
import { users, addresses, zones, cities, restaurantZoneDeliveryFees } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound, UnauthorizedError } from "../../Errors";
import { v4 as uuidv4 } from "uuid";

export const getUserAddresses = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;

    const userAddresses = await db.select().from(addresses).where(eq(addresses.userId, userId));

    return SuccessResponse(res, { data: userAddresses });
};

export const addUserAddress = async (req: Request, res: Response) => {
    try {
        if (!req.user) throw new UnauthorizedError("Unauthenticated");
        const userId = req.user.id;
        const { lat, lng, type, title, street, number, floor, zoneId, landmark  } = req.body;

        const newAddress = await db.insert(addresses).values({
            id: uuidv4(),
            userId,
            type,
            lat,
            lng,
            title,
            street,
            number,
            zoneId,
            floor,
            landmark: landmark || null,
        });

        return SuccessResponse(res, { message: "Address added successfully", data: newAddress });
    } catch (error) {
        // السطر ده هيفضح المشكلة الحقيقية في التيرمينال
        console.error("🔥 MYSQL ERROR DETAILS:", error);
        throw error;
    }
};

export const deleteUserAddress = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { addressId } = req.params;

    const existingAddress = await db.select().from(addresses).where(eq(addresses.id, addressId)).limit(1);
    if (!existingAddress[0]) {
        throw new NotFound("Address not found");
    }

    await db.delete(addresses).where(eq(addresses.id, addressId));

    return SuccessResponse(res, { message: "Address deleted successfully" });
};

export const updateUserAddress = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { addressId } = req.params;
    const { lat, lng, type, title, street, number, floor, zoneId, landmark } = req.body;

    const existingAddress = await db.select().from(addresses).where(eq(addresses.id, addressId)).limit(1);
    if (!existingAddress[0]) {
        throw new NotFound("Address not found");
    }

    await db
        .update(addresses)
        .set({ lat, lng, type, title, street, number, floor, zoneId, landmark: landmark ?? null })
        .where(eq(addresses.id, addressId));

    return SuccessResponse(res, { message: "Address updated successfully" });
};

export const getZones = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    // 1. نجيب الداتا من الـ Database مع الـ Joins
    const zoneData = await db
        .select({
            zone: zones,
            city: cities,
            deliveryFee: restaurantZoneDeliveryFees
        })
        .from(zones)
        .leftJoin(cities, eq(zones.cityId, cities.id))
        .leftJoin(restaurantZoneDeliveryFees, eq(zones.id, restaurantZoneDeliveryFees.zoneId));

    // 2. ننظم الداتا عشان نمنع التكرار ونحط رسوم التوصيل في مصفوفة (Array)
    const zonesMap = new Map();

    zoneData.forEach((item) => {
        const zoneId = item.zone.id;

        // لو الـ Zone مش موجودة في الماب، نضيفها
        if (!zonesMap.has(zoneId)) {
            zonesMap.set(zoneId, {
                ...item.zone,
                city: item.city,
                deliveryFees: [] // مصفوفة فاضية هنحط فيها الرسوم
            });
        }

        // لو في رسوم توصيل مربوطة بالـ Zone دي، نضيفها للمصفوفة
        if (item.deliveryFee) {
            zonesMap.get(zoneId).deliveryFees.push(item.deliveryFee);
        }
    });

    // 3. نحول الماب لمصفوفة عادية عشان نرجعها في الـ Response
    const formattedZones = Array.from(zonesMap.values());

    return SuccessResponse(res, { data: formattedZones });
};