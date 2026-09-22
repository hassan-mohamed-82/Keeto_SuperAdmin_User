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
        // 2. التحقق من العناوين المرتبطة بطلبات سابقة (isRelatedToOrder)
        const orderConditions = [(0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), (0, drizzle_orm_1.isNotNull)(schema_1.orders.addressId)];
        if (restaurantId && restaurantId.trim() !== "") {
            orderConditions.push((0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId.trim()));
        }
        const orderAddressRows = await connection_1.db
            .select({ addressId: schema_1.orders.addressId })
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.and)(...orderConditions));
        const usedAddressIds = new Set(orderAddressRows.map((o) => o.addressId));
        // 3. جلب رقم callCenterPhone للمطعم إذا تم تمرير restaurantId
        let callcenterphone = null;
        if (restaurantId && restaurantId.trim() !== "") {
            const [rest] = await connection_1.db
                .select({ callcenterphone: schema_1.restaurants.callcenterphone })
                .from(schema_1.restaurants)
                .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId.trim()))
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
            return (0, response_1.SuccessResponse)(res, { data: formattedAddresses });
            // return SuccessResponse(res, { 
            //     data: {
            //         callcenterphone: null,
            //         addresses: formattedAddresses 
            //     }
            // });
        }
        // 4. جلب مناطق التوصيل والرسوم النشطة للمطعم المختار
        const restaurantFees = await connection_1.db
            .select({
            fee: schema_1.restaurantZoneDeliveryFees,
            zone: schema_1.zones,
        })
            .from(schema_1.restaurantZoneDeliveryFees)
            .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.zoneId, schema_1.zones.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.restaurantId, restaurantId.trim()), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.status, "active")));
        // 5. مطابقة إحداثيات كل عنوان ديناميكياً مع مناطق تغطية المطعم
        const formattedAddresses = userAddresses.map((addr) => {
            const addrLat = parseFloat(addr.lat || "");
            const addrLng = parseFloat(addr.lng || "");
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
        return (0, response_1.SuccessResponse)(res, {
            data: {
                callcenterphone,
                addresses: formattedAddresses
            }
        });
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
