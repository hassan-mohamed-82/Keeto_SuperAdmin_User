import { Request, Response } from "express";
import { eq, and, isNotNull } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../models/connection";
import { SuccessResponse } from "../../utils/response";
import { NotFound, UnauthorizedError, BadRequest } from "../../Errors";
import { addresses, orders, restaurants, restaurantZoneDeliveryFees, zones } from "../../models/schema";
import { isLocationInZone } from "../../utils/geo";

/**
 * 1. ADD ADDRESS (إضافة عنوان جديد بدون ربطه بشرط زون معينة)
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
            zoneId: null, // حفظ العنوان بالإحداثيات فقط دون تقييده بزون ثابتة
        };

        await db.insert(addresses).values(newAddress);

        return SuccessResponse(res, {
            message: "Address added successfully",
            data: newAddress,
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

        const updateData: Record<string, any> = {};

        if (type !== undefined) updateData.type = type;
        if (title !== undefined) updateData.title = title;
        if (lat !== undefined) {
            const parsedLat = parseFloat(lat);
            if (isNaN(parsedLat)) throw new BadRequest("Invalid latitude format");
            updateData.lat = String(parsedLat);
        }
        if (lng !== undefined) {
            const parsedLng = parseFloat(lng);
            if (isNaN(parsedLng)) throw new BadRequest("Invalid longitude format");
            updateData.lng = String(parsedLng);
        }
        if (street !== undefined) updateData.street = street;
        if (number !== undefined) updateData.number = String(number);
        if (floor !== undefined) updateData.floor = floor ? String(floor) : null;
        if (apartment !== undefined) updateData.apartment = apartment ? String(apartment) : null;
        if (landmark !== undefined) updateData.landmark = landmark;
        if (location !== undefined) updateData.location = location;
        if (fulladdress !== undefined) updateData.fulladdress = fulladdress;

        await db
            .update(addresses)
            .set(updateData)
            .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)));

        return SuccessResponse(res, {
            message: "Address updated successfully",
            data: { id: addressId, ...updateData },
        });
    } catch (error) {
        console.error("🔥 UPDATE ADDRESS ERROR:", error);
        throw error;
    }
};

/**
 * 3. GET USER ADDRESSES (جلب عناوين العميل وفحص إمكانية التوصيل ديناميكياً)
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

        // 2. التحقق من العناوين المرتبطة بطلبات سابقة (isRelatedToOrder)
        const orderConditions = [eq(orders.userId, userId), isNotNull(orders.addressId)];
        if (restaurantId && restaurantId.trim() !== "") {
            orderConditions.push(eq(orders.restaurantId, restaurantId.trim()));
        }

        const orderAddressRows = await db
            .select({ addressId: orders.addressId })
            .from(orders)
            .where(and(...orderConditions));

        const usedAddressIds = new Set(orderAddressRows.map((o) => o.addressId));

        // 3. جلب رقم callCenterPhone للمطعم إذا تم تمرير restaurantId
        let callcenterphone: string | null = null;
        if (restaurantId && restaurantId.trim() !== "") {
            const [rest] = await db
                .select({ callcenterphone: restaurants.callcenterphone })
                .from(restaurants)
                .where(eq(restaurants.id, restaurantId.trim()))
                .limit(1);
            if (rest) {
                callcenterphone = rest.callcenterphone || null;
            }
        }

        // إذا لم يحدد المطعم، نرجع العناوين المنسقة فقط مع callcenterphone كـ null
        if (!restaurantId || restaurantId.trim() === "") {
            const formattedAddresses = userAddresses.map((addr) => ({
                ...addr,
                isRelatedToOrder: usedAddressIds.has(addr.id),
            }));

            return SuccessResponse(res, { 
                data: {
                    callcenterphone: null,
                    addresses: formattedAddresses 
                }
            });
        }

        // 4. جلب مناطق التوصيل والرسوم النشطة للمطعم المختار
        const restaurantFees = await db
            .select({
                fee: restaurantZoneDeliveryFees,
                zone: zones,
            })
            .from(restaurantZoneDeliveryFees)
            .leftJoin(zones, eq(restaurantZoneDeliveryFees.zoneId, zones.id))
            .where(
                and(
                    eq(restaurantZoneDeliveryFees.restaurantId, restaurantId.trim()),
                    eq(restaurantZoneDeliveryFees.status, "active")
                )
            );

        // 5. مطابقة إحداثيات كل عنوان ديناميكياً مع مناطق تغطية المطعم
        const formattedAddresses = userAddresses.map((addr) => {
            const addrLat = parseFloat(addr.lat || "");
            const addrLng = parseFloat(addr.lng || "");

            let matchingFee: typeof restaurantZoneDeliveryFees.$inferSelect | null = null;
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

                    if (isLocationInZone(addrLat, addrLng, item.fee.zoneId, feeData)) {
                        const currentFee = parseFloat(item.fee.deliveryFee || "0");
                        if (matchingFee === null || currentFee > maxDeliveryFee) {
                            maxDeliveryFee = currentFee;
                            matchingFee = item.fee;
                        }
                    }
                }
            }

            return {
                ...addr,
                isRelatedToOrder: usedAddressIds.has(addr.id),
                isDeliverable: !!matchingFee,
                deliveryFee: matchingFee ? matchingFee.deliveryFee : null,
                minOrderAmount: matchingFee ? matchingFee.minOrderAmount : null,
                restaurantDeliveryZoneId: matchingFee ? matchingFee.id : null,
                zoneId: matchingFee ? matchingFee.zoneId : addr.zoneId,
            };
        });

        return SuccessResponse(res, { 
            data: {
                callcenterphone,
                addresses: formattedAddresses
            }
        });
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
