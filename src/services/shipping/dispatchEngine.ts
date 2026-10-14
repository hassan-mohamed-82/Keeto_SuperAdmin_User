import { db } from "../../models/connection";
import {
    orders,
    restaurants,
    branches,
    restaurantSettings,
    shippingCompanies,
    shippingZones,
    deliveryMen,
    deliveryManShifts,
    deliveryManZones,
    dispatchAssignments,
    addresses,
} from "../../models/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import redisClient from "../../config/redis";
import * as turf from "@turf/turf";
import {
    notifyDeliveryMan,
    notifyShippingCompany,
    notifyRestaurant,
    notifyAdmins,
    notifyOrderTracking,
} from "../socket/socketService";
import { SOCKET_EVENTS } from "../socket/socketEvents";

export interface DispatchResult {
    success: boolean;
    orderId: string;
    shippingStatus: "assigned" | "manual_required";
    reason?: "no_company" | "company_inactive" | "out_of_zone" | "no_courier" | "max_attempts" | "no_coordinates";
    deliveryMan?: {
        id: string;
        name: string;
        phone: string;
        distanceKm: number;
    };
    message?: string;
}

// -------------------------------------------------------------
// Redis Key Patterns & Helpers
// -------------------------------------------------------------
export const REDIS_GEO_KEY = "couriers:geo";
export const REDIS_ALIVE_KEY_PREFIX = "courier:alive:";

export async function updateCourierRedisLocation(
    courierId: string,
    lat: number,
    lng: number
): Promise<void> {
    try {
        await redisClient.geoadd(REDIS_GEO_KEY, lng, lat, courierId);
        await redisClient.set(`${REDIS_ALIVE_KEY_PREFIX}${courierId}`, "1", "EX", 60);
    } catch (err) {
        console.error("Redis geoadd/alive error for courier:", courierId, err);
    }
}

export async function removeCourierFromRedis(courierId: string): Promise<void> {
    try {
        await redisClient.zrem(REDIS_GEO_KEY, courierId);
        await redisClient.del(`${REDIS_ALIVE_KEY_PREFIX}${courierId}`);
    } catch (err) {
        console.error("Redis zrem error for courier:", courierId, err);
    }
}

// Phase 6: Release courier on delivered / cancelled / manual unassign
export async function releaseCourierForOrder(orderId: string, courierId: string): Promise<void> {
    try {
        await db
            .update(deliveryMen)
            .set({
                activeOrdersCount: sql`GREATEST(0, ${deliveryMen.activeOrdersCount} - 1)`,
            })
            .where(eq(deliveryMen.id, courierId));
    } catch (err) {
        console.error("Error releasing courier orders count:", err);
    }
}

// Timezone-aware hour/minute formatter (D7)
function getLocalDayAndTime(timeZone: string = process.env.APP_TIMEZONE || "Africa/Cairo") {
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
    const dayMap: Record<string, number> = {
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
function isTimeInShift(shiftFrom: string, shiftTo: string, currentMinutes: number): boolean {
    const parseTime = (t: string) => {
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
export async function assignCourierToOrder(
    orderId: string,
    courierId: string,
    companyId: string,
    attemptNumber: number = 1
): Promise<{ success: boolean; courier?: any }> {
    return await db.transaction(async (tx) => {
        // Fetch courier with row lock to check activeOrdersCount vs maxActiveOrders
        const [courier] = await tx
            .select()
            .from(deliveryMen)
            .where(eq(deliveryMen.id, courierId))
            .limit(1);

        if (!courier || courier.isDeleted || !courier.isActive) {
            return { success: false };
        }

        const [company] = await tx
            .select({ maxActiveOrders: shippingCompanies.maxActiveOrders })
            .from(shippingCompanies)
            .where(eq(shippingCompanies.id, companyId))
            .limit(1);

        const maxActive = company?.maxActiveOrders ?? 3;
        if (courier.activeOrdersCount >= maxActive) {
            return { success: false };
        }

        // Update order
        await tx
            .update(orders)
            .set({
                shippingCompanyId: companyId,
                deliveryManId: courierId,
                shippingStatus: "assigned",
                shippingFailReason: null,
                dispatchAttempts: attemptNumber,
                shippingAssignedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

        // Increment activeOrdersCount atomically
        await tx
            .update(deliveryMen)
            .set({
                activeOrdersCount: sql`${deliveryMen.activeOrdersCount} + 1`,
            })
            .where(eq(deliveryMen.id, courierId));

        // Insert assignment audit log
        await tx.insert(dispatchAssignments).values({
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
export async function dispatchOrder(orderId: string): Promise<DispatchResult> {
    // Acquire Redis mutex lock per order to prevent concurrent dispatches
    const lockKey = `lock:dispatch:${orderId}`;
    let lockAcquired = false;

    try {
        const lockRes = await redisClient.set(lockKey, "1", "EX", 15, "NX");
        lockAcquired = lockRes === "OK";
    } catch {
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
    } finally {
        try {
            await redisClient.del(lockKey);
        } catch {
            // Ignore unlock errors
        }
    }
}

async function executeDispatch(orderId: string): Promise<DispatchResult> {
    // -------------------------------------------------------------
    // Fetch order, restaurant, branch, and settings
    // -------------------------------------------------------------
    const [orderData] = await db
        .select({
            order: orders,
            restaurant: restaurants,
            branch: branches,
            settings: restaurantSettings,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(restaurantSettings, eq(orders.restaurantId, restaurantSettings.restaurantId))
        .where(eq(orders.id, orderId))
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
        await db
            .update(orders)
            .set({
                shippingStatus: "manual_required",
                shippingFailReason: "no_company",
                updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

        notifyRestaurant(order.restaurantId, SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "no_company",
            message: "No shipping company is linked to restaurant",
        });

        notifyAdmins(SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
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
    const [company] = await db
        .select()
        .from(shippingCompanies)
        .where(eq(shippingCompanies.id, companyId))
        .limit(1);

    if (!company || company.status !== "active") {
        await db
            .update(orders)
            .set({
                shippingCompanyId: companyId,
                shippingStatus: "manual_required",
                shippingFailReason: "company_inactive",
                updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

        notifyShippingCompany(companyId, SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "company_inactive",
        });

        notifyAdmins(SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
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
    const shippingAddress = order.shippingAddress as any;
    let customerLat = shippingAddress?.lat ? parseFloat(shippingAddress.lat) : NaN;
    let customerLng = shippingAddress?.lng ? parseFloat(shippingAddress.lng) : NaN;

    if (isNaN(customerLat) || isNaN(customerLng)) {
        if (order.addressId) {
            const [addr] = await db
                .select({ lat: addresses.lat, lng: addresses.lng })
                .from(addresses)
                .where(eq(addresses.id, order.addressId))
                .limit(1);

            if (addr?.lat && addr?.lng) {
                customerLat = parseFloat(addr.lat);
                customerLng = parseFloat(addr.lng);
            }
        }
    }

    if (isNaN(customerLat) || isNaN(customerLng)) {
        await db
            .update(orders)
            .set({
                shippingCompanyId: companyId,
                shippingStatus: "manual_required",
                shippingFailReason: "no_coordinates",
                updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

        notifyShippingCompany(companyId, SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "no_coordinates",
            message: "Customer delivery coordinates are missing",
        });

        notifyRestaurant(order.restaurantId, SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "no_coordinates",
        });

        notifyAdmins(SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
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

    const companyZones = await db
        .select()
        .from(shippingZones)
        .where(
            and(
                eq(shippingZones.shippingCompanyId, companyId),
                eq(shippingZones.status, "active")
            )
        );

    const customerPoint = turf.point([customerLng, customerLat]);
    let matchedZoneId: string | null = null;

    for (const zone of companyZones) {
        const coords = zone.coordinates as Array<{ lat: number; lng: number }> | null;
        if (!coords || coords.length < 3) continue;

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
        } catch {
            // Ignore malformed polygon
        }
    }

    if (!matchedZoneId) {
        await db
            .update(orders)
            .set({
                shippingCompanyId: companyId,
                shippingStatus: "manual_required",
                shippingFailReason: "out_of_zone",
                updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

        notifyShippingCompany(companyId, SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "out_of_zone",
            message: "Customer location is outside all company zones",
        });

        notifyRestaurant(order.restaurantId, SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
            orderId,
            orderNumber: order.orderNumber,
            reason: "out_of_zone",
        });

        notifyAdmins(SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
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
        await db
            .update(orders)
            .set({
                shippingCompanyId: companyId,
                shippingStatus: "manual_required",
                shippingFailReason: "max_attempts",
                updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

        notifyShippingCompany(companyId, SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
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
        await db
            .update(orders)
            .set({
                shippingCompanyId: companyId,
                shippingStatus: "manual_required",
                shippingFailReason: "no_coordinates",
                updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "no_coordinates",
            message: "Restaurant branch coordinates are missing or invalid",
        };
    }

    const maxRadiusKm = parseFloat(String(company.maxSearchRadius ?? 10));
    const nearbyCourierIdsWithDist = new Map<string, number>();

    try {
        const rawResults = (await (redisClient as any).geosearch(
            REDIS_GEO_KEY,
            "FROMLONLAT",
            branchLng,
            branchLat,
            "BYRADIUS",
            maxRadiusKm,
            "km",
            "WITHDIST",
            "ASC"
        )) as Array<[string, string]>;

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
    } catch (err) {
        console.warn("Redis GEOSEARCH failed, falling back to MySQL coordinates:", err);
    }

    // -------------------------------------------------------------
    // Step 6: Filter couriers (MySQL)
    // -------------------------------------------------------------
    // Couriers who previously rejected this order
    const previousRejections = await db
        .select({ deliveryManId: dispatchAssignments.deliveryManId })
        .from(dispatchAssignments)
        .where(
            and(
                eq(dispatchAssignments.orderId, orderId),
                eq(dispatchAssignments.status, "rejected")
            )
        );
    const rejectedCourierIds = new Set(previousRejections.map((r) => r.deliveryManId));

    // Couriers of this company with activeOrdersCount < maxActiveOrders
    const couriers = await db
        .select()
        .from(deliveryMen)
        .where(
            and(
                eq(deliveryMen.shippingCompanyId, companyId),
                eq(deliveryMen.isActive, true),
                eq(deliveryMen.isDeleted, false),
                eq(deliveryMen.isOnline, true),
                sql`${deliveryMen.activeOrdersCount} < ${company.maxActiveOrders}`
            )
        );

    if (couriers.length === 0) {
        await db
            .update(orders)
            .set({
                shippingCompanyId: companyId,
                shippingStatus: "manual_required",
                shippingFailReason: "no_courier",
                dispatchAttempts: currentAttempts + 1,
                updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

        notifyShippingCompany(companyId, SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
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
        db
            .select({
                deliveryManId: deliveryManZones.deliveryManId,
                zoneId: deliveryManZones.zoneId,
            })
            .from(deliveryManZones)
            .where(inArray(deliveryManZones.deliveryManId, courierIds)),
        db
            .select()
            .from(deliveryManShifts)
            .where(
                and(
                    inArray(deliveryManShifts.deliveryManId, courierIds),
                    eq(deliveryManShifts.status, "active")
                )
            ),
    ]);

    const courierZonesMap = new Map<string, Set<string>>();
    for (const z of allCourierZones) {
        if (!courierZonesMap.has(z.deliveryManId)) {
            courierZonesMap.set(z.deliveryManId, new Set());
        }
        courierZonesMap.get(z.deliveryManId)!.add(z.zoneId);
    }

    const courierShiftsMap = new Map<string, typeof allCourierShifts>();
    for (const s of allCourierShifts) {
        if (!courierShiftsMap.has(s.deliveryManId)) {
            courierShiftsMap.set(s.deliveryManId, []);
        }
        courierShiftsMap.get(s.deliveryManId)!.push(s);
    }

    const { dayOfWeek, timeMinutes } = getLocalDayAndTime();
    const branchPoint = turf.point([branchLng, branchLat]);
    const eligibleCouriers: Array<{
        courier: typeof couriers[0];
        distanceKm: number;
    }> = [];

    for (const c of couriers) {
        // Did not reject this order
        if (rejectedCourierIds.has(c.id)) {
            continue;
        }

        // Alive key check (must have fresh heartbeat in Redis)
        try {
            const isAlive = await redisClient.get(`${REDIS_ALIVE_KEY_PREFIX}${c.id}`);
            if (!isAlive) {
                // Couriers without an alive key are stale / disconnected
                continue;
            }
        } catch {
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
            const activeShift = shifts.find(
                (s) =>
                    s.restaurantId === order.restaurantId &&
                    s.dayOfWeek === dayOfWeek &&
                    isTimeInShift(s.from, s.to, timeMinutes)
            );

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
        await db
            .update(orders)
            .set({
                shippingCompanyId: companyId,
                shippingStatus: "manual_required",
                shippingFailReason: "no_courier",
                dispatchAttempts: currentAttempts + 1,
                updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

        notifyShippingCompany(companyId, SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
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
    let assignedCourier: any = null;
    let assignedDistance = 0;

    for (const candidate of eligibleCouriers) {
        const assignRes = await assignCourierToOrder(
            orderId,
            candidate.courier.id,
            companyId,
            newAttemptNumber
        );

        if (assignRes.success) {
            assignedCourier = assignRes.courier;
            assignedDistance = candidate.distanceKm;
            break;
        }
    }

    if (!assignedCourier) {
        await db
            .update(orders)
            .set({
                shippingCompanyId: companyId,
                shippingStatus: "manual_required",
                shippingFailReason: "no_courier",
                dispatchAttempts: newAttemptNumber,
                updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

        notifyShippingCompany(companyId, SOCKET_EVENTS.ORDER_MANUAL_REQUIRED, {
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
    notifyDeliveryMan(assignedCourier.id, SOCKET_EVENTS.COURIER_ASSIGNED, {
        orderId,
        orderNumber: order.orderNumber,
        restaurantName: restaurant?.name,
        branchName: branch?.name,
        branchAddress: branch?.address,
        distanceKm: assignedDistance,
    });

    notifyShippingCompany(companyId, SOCKET_EVENTS.ORDER_ASSIGNED, {
        orderId,
        orderNumber: order.orderNumber,
        deliveryManId: assignedCourier.id,
        deliveryManName: assignedCourier.name,
        distanceKm: assignedDistance,
    });

    notifyOrderTracking(orderId, SOCKET_EVENTS.ORDER_COURIER_ASSIGNED, {
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
export async function rejectOrderByCourier(
    orderId: string,
    courierId: string,
    rejectReason: string
): Promise<DispatchResult> {
    if (!rejectReason || rejectReason.trim() === "") {
        throw new Error("Reject reason is mandatory");
    }

    // Must be transactional and only valid if shippingStatus is assigned
    await db.transaction(async (tx) => {
        const [order] = await tx
            .select()
            .from(orders)
            .where(
                and(
                    eq(orders.id, orderId),
                    eq(orders.deliveryManId, courierId)
                )
            )
            .limit(1);

        if (!order) {
            throw new Error("Order not found or not currently assigned to this courier");
        }

        if (order.shippingStatus !== "assigned") {
            throw new Error(`Cannot reject order in shippingStatus "${order.shippingStatus}"`);
        }

        // 1. Update assignment to rejected
        await tx
            .update(dispatchAssignments)
            .set({
                status: "rejected",
                rejectReason: rejectReason.trim(),
                respondedAt: new Date(),
            })
            .where(
                and(
                    eq(dispatchAssignments.orderId, orderId),
                    eq(dispatchAssignments.deliveryManId, courierId),
                    eq(dispatchAssignments.status, "active")
                )
            );

        // 2. Decrement active orders count
        await tx
            .update(deliveryMen)
            .set({
                activeOrdersCount: sql`GREATEST(0, ${deliveryMen.activeOrdersCount} - 1)`,
            })
            .where(eq(deliveryMen.id, courierId));

        // 3. Reset order deliveryManId
        await tx
            .update(orders)
            .set({
                deliveryManId: null,
                shippingStatus: "pending_dispatch",
            })
            .where(eq(orders.id, orderId));
    });

    // Re-dispatch excluding this courier
    return await dispatchOrder(orderId);
}
