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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.REDIS_ALIVE_KEY_PREFIX = exports.REDIS_GEO_KEY = void 0;
exports.updateCourierRedisLocation = updateCourierRedisLocation;
exports.removeCourierFromRedis = removeCourierFromRedis;
exports.releaseCourierForOrder = releaseCourierForOrder;
exports.assignCourierToOrder = assignCourierToOrder;
exports.dispatchOrder = dispatchOrder;
exports.rejectOrderByCourier = rejectOrderByCourier;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const redis_1 = __importDefault(require("../../config/redis"));
const turf = __importStar(require("@turf/turf"));
const socketService_1 = require("../socket/socketService");
const socketEvents_1 = require("../socket/socketEvents");
// -------------------------------------------------------------
// Redis Key Patterns & Helpers
// -------------------------------------------------------------
exports.REDIS_GEO_KEY = "couriers:geo";
exports.REDIS_ALIVE_KEY_PREFIX = "courier:alive:";
async function updateCourierRedisLocation(courierId, lat, lng) {
    try {
        await redis_1.default.geoadd(exports.REDIS_GEO_KEY, lng, lat, courierId);
        await redis_1.default.set(`${exports.REDIS_ALIVE_KEY_PREFIX}${courierId}`, "1", "EX", 60);
    }
    catch (err) {
        console.error("Redis geoadd/alive error for courier:", courierId, err);
    }
}
async function removeCourierFromRedis(courierId) {
    try {
        await redis_1.default.zrem(exports.REDIS_GEO_KEY, courierId);
        await redis_1.default.del(`${exports.REDIS_ALIVE_KEY_PREFIX}${courierId}`);
    }
    catch (err) {
        console.error("Redis zrem error for courier:", courierId, err);
    }
}
// Phase 6: Release courier on delivered / cancelled / manual unassign
async function releaseCourierForOrder(orderId, courierId) {
    try {
        await connection_1.db
            .update(schema_1.deliveryMen)
            .set({
            activeOrdersCount: (0, drizzle_orm_1.sql) `GREATEST(0, ${schema_1.deliveryMen.activeOrdersCount} - 1)`,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, courierId));
    }
    catch (err) {
        console.error("Error releasing courier orders count:", err);
    }
}
// Timezone-aware hour/minute formatter (D7)
function getLocalDayAndTime(timeZone = process.env.APP_TIMEZONE || "Africa/Cairo") {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        weekday: "short",
        hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const partMap = new Map(parts.map((p) => [p.type, p.value]));
    const hour = parseInt(partMap.get("hour") || "0", 10);
    const minute = parseInt(partMap.get("minute") || "0", 10);
    const second = parseInt(partMap.get("second") || "0", 10);
    const timeMinutes = hour * 60 + minute;
    const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
    const weekdayShort = partMap.get("weekday");
    const dayMap = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
    };
    const dayOfWeek = weekdayShort && dayMap[weekdayShort] !== undefined ? dayMap[weekdayShort] : now.getDay();
    return { dayOfWeek, timeStr, timeMinutes };
}
// D7: Check shift including overnight shifts (from > to)
function isTimeInShift(shiftFrom, shiftTo, currentMinutes) {
    const parseTime = (t) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + (m || 0);
    };
    const fromMin = parseTime(shiftFrom);
    const toMin = parseTime(shiftTo);
    if (fromMin <= toMin) {
        return currentMinutes >= fromMin && currentMinutes <= toMin;
    }
    // Overnight shift: e.g. 22:00 to 06:00
    return currentMinutes >= fromMin || currentMinutes <= toMin;
}
// -------------------------------------------------------------
// Shared Assign Function (Step 8 Atomic Assign)
// -------------------------------------------------------------
async function assignCourierToOrder(orderId, courierId, companyId, attemptNumber = 1) {
    return await connection_1.db.transaction(async (tx) => {
        // Fetch courier with row lock to check activeOrdersCount vs maxActiveOrders
        const [courier] = await tx
            .select()
            .from(schema_1.deliveryMen)
            .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, courierId))
            .limit(1);
        if (!courier || courier.isDeleted || !courier.isActive) {
            return { success: false };
        }
        const [company] = await tx
            .select({ maxActiveOrders: schema_1.shippingCompanies.maxActiveOrders })
            .from(schema_1.shippingCompanies)
            .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, companyId))
            .limit(1);
        const maxActive = company?.maxActiveOrders ?? 3;
        if (courier.activeOrdersCount >= maxActive) {
            return { success: false };
        }
        // Update order
        await tx
            .update(schema_1.orders)
            .set({
            shippingCompanyId: companyId,
            deliveryManId: courierId,
            shippingStatus: "assigned",
            shippingFailReason: null,
            dispatchAttempts: attemptNumber,
            shippingAssignedAt: new Date(),
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        // Increment activeOrdersCount atomically
        await tx
            .update(schema_1.deliveryMen)
            .set({
            activeOrdersCount: (0, drizzle_orm_1.sql) `${schema_1.deliveryMen.activeOrdersCount} + 1`,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, courierId));
        // Insert assignment audit log
        await tx.insert(schema_1.dispatchAssignments).values({
            orderId,
            shippingCompanyId: companyId,
            deliveryManId: courierId,
            attemptNumber,
            status: "active",
        });
        return { success: true, courier };
    });
}
/**
 * Main Auto-Dispatch Engine
 */
async function dispatchOrder(orderId) {
    // Acquire Redis mutex lock per order to prevent concurrent dispatches
    const lockKey = `lock:dispatch:${orderId}`;
    let lockAcquired = false;
    try {
        const lockRes = await redis_1.default.set(lockKey, "1", "EX", 15, "NX");
        lockAcquired = lockRes === "OK";
    }
    catch {
        // Continue if Redis fails
    }
    if (!lockAcquired) {
        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            message: "Dispatch already running for this order",
        };
    }
    try {
        return await executeDispatch(orderId);
    }
    finally {
        try {
            await redis_1.default.del(lockKey);
        }
        catch {
            // Ignore unlock errors
        }
    }
}
async function executeDispatch(orderId) {
    // -------------------------------------------------------------
    // Fetch order, restaurant, branch, and settings
    // -------------------------------------------------------------
    const [orderData] = await connection_1.db
        .select({
        order: schema_1.orders,
        restaurant: schema_1.restaurants,
        branch: schema_1.branches,
        settings: schema_1.restaurantSettings,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.branches, (0, drizzle_orm_1.eq)(schema_1.orders.branchId, schema_1.branches.id))
        .leftJoin(schema_1.restaurantSettings, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurantSettings.restaurantId))
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId))
        .limit(1);
    if (!orderData) {
        throw new Error(`Order #${orderId} not found`);
    }
    const { order, restaurant, branch, settings } = orderData;
    // -------------------------------------------------------------
    // Step 1: Restaurant linked to a company? (D3: restaurantSettings.shippingCompanyId only)
    // -------------------------------------------------------------
    const companyId = settings?.shippingCompanyId || order.shippingCompanyId;
    if (!companyId) {
        await connection_1.db
            .update(schema_1.orders)
            .set({
            shippingStatus: "manual_required",
            shippingFailReason: "no_company",
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        (0, socketService_1.notifyRestaurant)(order.restaurantId, socketEvents_1.SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "no_company",
            message: "No shipping company is linked to restaurant",
        });
        (0, socketService_1.notifyAdmins)(socketEvents_1.SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "no_company",
        });
        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "no_company",
            message: "Restaurant is not linked to any shipping company",
        };
    }
    // -------------------------------------------------------------
    // Step 2: Company active?
    // -------------------------------------------------------------
    const [company] = await connection_1.db
        .select()
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, companyId))
        .limit(1);
    if (!company || company.status !== "active") {
        await connection_1.db
            .update(schema_1.orders)
            .set({
            shippingCompanyId: companyId,
            shippingStatus: "manual_required",
            shippingFailReason: "company_inactive",
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        (0, socketService_1.notifyShippingCompany)(companyId, socketEvents_1.SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "company_inactive",
        });
        (0, socketService_1.notifyAdmins)(socketEvents_1.SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "company_inactive",
        });
        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "company_inactive",
            message: "Shipping company is inactive or not found",
        };
    }
    // -------------------------------------------------------------
    // Step 3: Customer point inside a company zone?
    // -------------------------------------------------------------
    const shippingAddress = order.shippingAddress;
    let customerLat = shippingAddress?.lat ? parseFloat(shippingAddress.lat) : NaN;
    let customerLng = shippingAddress?.lng ? parseFloat(shippingAddress.lng) : NaN;
    if (isNaN(customerLat) || isNaN(customerLng)) {
        if (order.addressId) {
            const [addr] = await connection_1.db
                .select({ lat: schema_1.addresses.lat, lng: schema_1.addresses.lng })
                .from(schema_1.addresses)
                .where((0, drizzle_orm_1.eq)(schema_1.addresses.id, order.addressId))
                .limit(1);
            if (addr?.lat && addr?.lng) {
                customerLat = parseFloat(addr.lat);
                customerLng = parseFloat(addr.lng);
            }
        }
    }
    if (isNaN(customerLat) || isNaN(customerLng)) {
        await connection_1.db
            .update(schema_1.orders)
            .set({
            shippingCompanyId: companyId,
            shippingStatus: "manual_required",
            shippingFailReason: "no_coordinates",
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        (0, socketService_1.notifyShippingCompany)(companyId, socketEvents_1.SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "no_coordinates",
            message: "Customer delivery coordinates are missing",
        });
        (0, socketService_1.notifyRestaurant)(order.restaurantId, socketEvents_1.SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "no_coordinates",
        });
        (0, socketService_1.notifyAdmins)(socketEvents_1.SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "no_coordinates",
        });
        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "no_coordinates",
            message: "Customer delivery coordinates are missing or invalid",
        };
    }
    const companyZones = await connection_1.db
        .select()
        .from(schema_1.shippingZones)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingZones.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.shippingZones.status, "active")));
    const customerPoint = turf.point([customerLng, customerLat]);
    let matchedZoneId = null;
    for (const zone of companyZones) {
        const coords = zone.coordinates;
        if (!coords || coords.length < 3)
            continue;
        try {
            const polygonCoords = coords.map((c) => [c.lng, c.lat]);
            const first = polygonCoords[0];
            const last = polygonCoords[polygonCoords.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
                polygonCoords.push(first);
            }
            const poly = turf.polygon([polygonCoords]);
            if (turf.booleanPointInPolygon(customerPoint, poly)) {
                matchedZoneId = zone.id;
                break;
            }
        }
        catch {
            // Ignore malformed polygon
        }
    }
    if (!matchedZoneId) {
        await connection_1.db
            .update(schema_1.orders)
            .set({
            shippingCompanyId: companyId,
            shippingStatus: "manual_required",
            shippingFailReason: "out_of_zone",
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        (0, socketService_1.notifyShippingCompany)(companyId, socketEvents_1.SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "out_of_zone",
            message: "Customer location is outside all company zones",
        });
        (0, socketService_1.notifyRestaurant)(order.restaurantId, socketEvents_1.SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "out_of_zone",
        });
        (0, socketService_1.notifyAdmins)(socketEvents_1.SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "out_of_zone",
        });
        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "out_of_zone",
            message: "Customer address does not fall inside any active company zone",
        };
    }
    // -------------------------------------------------------------
    // Step 4: Attempts < maxAttempts?
    // -------------------------------------------------------------
    const maxAttempts = company.maxAttempts ?? 3;
    const currentAttempts = order.dispatchAttempts || 0;
    if (currentAttempts >= maxAttempts) {
        await connection_1.db
            .update(schema_1.orders)
            .set({
            shippingCompanyId: companyId,
            shippingStatus: "manual_required",
            shippingFailReason: "max_attempts",
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        (0, socketService_1.notifyShippingCompany)(companyId, socketEvents_1.SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "max_attempts",
            message: `Reached maximum dispatch attempts (${maxAttempts})`,
        });
        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "max_attempts",
            message: `Order reached max dispatch attempts limit of ${maxAttempts}`,
        };
    }
    // -------------------------------------------------------------
    // Step 5: Redis GEOSEARCH couriers within maxSearchRadius of BRANCH
    // -------------------------------------------------------------
    const branchLat = branch?.lat ? parseFloat(branch.lat) : NaN;
    const branchLng = branch?.lng ? parseFloat(branch.lng) : NaN;
    if (isNaN(branchLat) || isNaN(branchLng)) {
        await connection_1.db
            .update(schema_1.orders)
            .set({
            shippingCompanyId: companyId,
            shippingStatus: "manual_required",
            shippingFailReason: "no_coordinates",
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "no_coordinates",
            message: "Restaurant branch coordinates are missing or invalid",
        };
    }
    const maxRadiusKm = parseFloat(String(company.maxSearchRadius ?? 10));
    const nearbyCourierIdsWithDist = new Map();
    try {
        const rawResults = (await redis_1.default.geosearch(exports.REDIS_GEO_KEY, "FROMLONLAT", branchLng, branchLat, "BYRADIUS", maxRadiusKm, "km", "WITHDIST", "ASC"));
        if (Array.isArray(rawResults)) {
            for (const item of rawResults) {
                if (Array.isArray(item) && item.length >= 2) {
                    const cId = item[0];
                    const dist = parseFloat(item[1]);
                    if (!isNaN(dist)) {
                        nearbyCourierIdsWithDist.set(cId, dist);
                    }
                }
            }
        }
    }
    catch (err) {
        console.warn("Redis GEOSEARCH failed, falling back to MySQL coordinates:", err);
    }
    // -------------------------------------------------------------
    // Step 6: Filter couriers (MySQL)
    // -------------------------------------------------------------
    // Couriers who previously rejected this order
    const previousRejections = await connection_1.db
        .select({ deliveryManId: schema_1.dispatchAssignments.deliveryManId })
        .from(schema_1.dispatchAssignments)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.dispatchAssignments.orderId, orderId), (0, drizzle_orm_1.eq)(schema_1.dispatchAssignments.status, "rejected")));
    const rejectedCourierIds = new Set(previousRejections.map((r) => r.deliveryManId));
    // Couriers of this company with activeOrdersCount < maxActiveOrders
    const couriers = await connection_1.db
        .select()
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isActive, true), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isOnline, true), (0, drizzle_orm_1.sql) `${schema_1.deliveryMen.activeOrdersCount} < ${company.maxActiveOrders}`));
    if (couriers.length === 0) {
        await connection_1.db
            .update(schema_1.orders)
            .set({
            shippingCompanyId: companyId,
            shippingStatus: "manual_required",
            shippingFailReason: "no_courier",
            dispatchAttempts: currentAttempts + 1,
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        (0, socketService_1.notifyShippingCompany)(companyId, socketEvents_1.SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "no_courier",
            message: "No online couriers found for shipping company",
        });
        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "no_courier",
            message: "No available online couriers found",
        };
    }
    // Batch query zones and shifts to prevent N+1 queries (Phase 6 requirement)
    const courierIds = couriers.map((c) => c.id);
    const [allCourierZones, allCourierShifts] = await Promise.all([
        connection_1.db
            .select({
            deliveryManId: schema_1.deliveryManZones.deliveryManId,
            zoneId: schema_1.deliveryManZones.zoneId,
        })
            .from(schema_1.deliveryManZones)
            .where((0, drizzle_orm_1.inArray)(schema_1.deliveryManZones.deliveryManId, courierIds)),
        connection_1.db
            .select()
            .from(schema_1.deliveryManShifts)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.deliveryManShifts.deliveryManId, courierIds), (0, drizzle_orm_1.eq)(schema_1.deliveryManShifts.status, "active"))),
    ]);
    const courierZonesMap = new Map();
    for (const z of allCourierZones) {
        if (!courierZonesMap.has(z.deliveryManId)) {
            courierZonesMap.set(z.deliveryManId, new Set());
        }
        courierZonesMap.get(z.deliveryManId).add(z.zoneId);
    }
    const courierShiftsMap = new Map();
    for (const s of allCourierShifts) {
        if (!courierShiftsMap.has(s.deliveryManId)) {
            courierShiftsMap.set(s.deliveryManId, []);
        }
        courierShiftsMap.get(s.deliveryManId).push(s);
    }
    const { dayOfWeek, timeMinutes } = getLocalDayAndTime();
    const branchPoint = turf.point([branchLng, branchLat]);
    const eligibleCouriers = [];
    for (const c of couriers) {
        // Did not reject this order
        if (rejectedCourierIds.has(c.id)) {
            continue;
        }
        // Alive key check (must have fresh heartbeat in Redis)
        try {
            const isAlive = await redis_1.default.get(`${exports.REDIS_ALIVE_KEY_PREFIX}${c.id}`);
            if (!isAlive) {
                // Couriers without an alive key are stale / disconnected
                continue;
            }
        }
        catch {
            // Redis error fallback: continue
        }
        // Zone check: allZones === true OR has zone in delivery_man_zones (D5)
        if (!c.allZones) {
            const zonesSet = courierZonesMap.get(c.id);
            if (!zonesSet || !zonesSet.has(matchedZoneId)) {
                continue;
            }
        }
        // deliveryType check: outsource OR (restaurant for this restaurant AND inside shift window)
        if (c.deliveryType === "restaurant") {
            const shifts = courierShiftsMap.get(c.id) || [];
            const activeShift = shifts.find((s) => s.restaurantId === order.restaurantId &&
                s.dayOfWeek === dayOfWeek &&
                isTimeInShift(s.from, s.to, timeMinutes));
            if (!activeShift) {
                continue;
            }
        }
        // Distance calculation
        let distanceKm = nearbyCourierIdsWithDist.get(c.id);
        if (distanceKm === undefined && c.currentLat && c.currentLng) {
            const cLat = parseFloat(c.currentLat);
            const cLng = parseFloat(c.currentLng);
            if (!isNaN(cLat) && !isNaN(cLng)) {
                distanceKm = turf.distance(branchPoint, turf.point([cLng, cLat]), {
                    units: "kilometers",
                });
            }
        }
        if (distanceKm !== undefined && distanceKm <= maxRadiusKm) {
            eligibleCouriers.push({
                courier: c,
                distanceKm: parseFloat(distanceKm.toFixed(2)),
            });
        }
    }
    if (eligibleCouriers.length === 0) {
        await connection_1.db
            .update(schema_1.orders)
            .set({
            shippingCompanyId: companyId,
            shippingStatus: "manual_required",
            shippingFailReason: "no_courier",
            dispatchAttempts: currentAttempts + 1,
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        (0, socketService_1.notifyShippingCompany)(companyId, socketEvents_1.SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "no_courier",
            message: "No available couriers match shift/zone/distance criteria",
        });
        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "no_courier",
            message: "No available courier matches criteria nearby",
        };
    }
    // -------------------------------------------------------------
    // Step 7: Sort order per Decision D1
    // D1: distanceKm ASC, tie-break activeOrdersCount ASC (closest first!)
    // -------------------------------------------------------------
    eligibleCouriers.sort((a, b) => {
        if (a.distanceKm !== b.distanceKm) {
            return a.distanceKm - b.distanceKm;
        }
        return a.courier.activeOrdersCount - b.courier.activeOrdersCount;
    });
    // -------------------------------------------------------------
    // Step 8: Atomic Assignment (try candidates in sorted order)
    // -------------------------------------------------------------
    const newAttemptNumber = currentAttempts + 1;
    let assignedCourier = null;
    let assignedDistance = 0;
    for (const candidate of eligibleCouriers) {
        const assignRes = await assignCourierToOrder(orderId, candidate.courier.id, companyId, newAttemptNumber);
        if (assignRes.success) {
            assignedCourier = assignRes.courier;
            assignedDistance = candidate.distanceKm;
            break;
        }
    }
    if (!assignedCourier) {
        await connection_1.db
            .update(schema_1.orders)
            .set({
            shippingCompanyId: companyId,
            shippingStatus: "manual_required",
            shippingFailReason: "no_courier",
            dispatchAttempts: newAttemptNumber,
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        (0, socketService_1.notifyShippingCompany)(companyId, socketEvents_1.SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "no_courier",
        });
        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "no_courier",
            message: "All couriers became busy during atomic assignment",
        };
    }
    // -------------------------------------------------------------
    // Send Real-time Socket.IO Notifications
    // -------------------------------------------------------------
    (0, socketService_1.notifyDeliveryMan)(assignedCourier.id, socketEvents_1.SOCKET_EVENTS.COURIER_ASSIGNED, {
        orderId,
        orderNumber: order.orderNumber,
        restaurantName: restaurant?.name,
        branchName: branch?.name,
        branchAddress: branch?.address,
        distanceKm: assignedDistance,
    });
    (0, socketService_1.notifyShippingCompany)(companyId, socketEvents_1.SOCKET_EVENTS.ORDER_ASSIGNED, {
        orderId,
        orderNumber: order.orderNumber,
        deliveryManId: assignedCourier.id,
        deliveryManName: assignedCourier.name,
        distanceKm: assignedDistance,
    });
    (0, socketService_1.notifyOrderTracking)(orderId, socketEvents_1.SOCKET_EVENTS.ORDER_COURIER_ASSIGNED, {
        deliveryManId: assignedCourier.id,
        deliveryManName: assignedCourier.name,
        deliveryManPhone: assignedCourier.phone,
    });
    return {
        success: true,
        orderId,
        shippingStatus: "assigned",
        deliveryMan: {
            id: assignedCourier.id,
            name: assignedCourier.name,
            phone: assignedCourier.phone,
            distanceKm: assignedDistance,
        },
        message: `Order successfully assigned to courier ${assignedCourier.name}`,
    };
}
/**
 * Courier Reject with mandatory reason and re-dispatch
 */
async function rejectOrderByCourier(orderId, courierId, rejectReason) {
    if (!rejectReason || rejectReason.trim() === "") {
        throw new Error("Reject reason is mandatory");
    }
    // Must be transactional and only valid if shippingStatus is assigned
    await connection_1.db.transaction(async (tx) => {
        const [order] = await tx
            .select()
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId), (0, drizzle_orm_1.eq)(schema_1.orders.deliveryManId, courierId)))
            .limit(1);
        if (!order) {
            throw new Error("Order not found or not currently assigned to this courier");
        }
        if (order.shippingStatus !== "assigned") {
            throw new Error(`Cannot reject order in shippingStatus "${order.shippingStatus}"`);
        }
        // 1. Update assignment to rejected
        await tx
            .update(schema_1.dispatchAssignments)
            .set({
            status: "rejected",
            rejectReason: rejectReason.trim(),
            respondedAt: new Date(),
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.dispatchAssignments.orderId, orderId), (0, drizzle_orm_1.eq)(schema_1.dispatchAssignments.deliveryManId, courierId), (0, drizzle_orm_1.eq)(schema_1.dispatchAssignments.status, "active")));
        // 2. Decrement active orders count
        await tx
            .update(schema_1.deliveryMen)
            .set({
            activeOrdersCount: (0, drizzle_orm_1.sql) `GREATEST(0, ${schema_1.deliveryMen.activeOrdersCount} - 1)`,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, courierId));
        // 3. Reset order deliveryManId
        await tx
            .update(schema_1.orders)
            .set({
            deliveryManId: null,
            shippingStatus: "pending_dispatch",
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
    });
    // Re-dispatch excluding this courier
    return await dispatchOrder(orderId);
}
