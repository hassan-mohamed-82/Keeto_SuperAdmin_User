import { db } from "../../models/connection";
import {
    orders,
    restaurants,
    restaurantSettings,
    branches,
    shippingCompanies,
    shippingCompanyRestaurants,
    shippingZones,
    deliveryMen,
    deliveryManShifts,
    deliveryManZones,
    dispatchAssignments,
    users,
} from "../../models/schema";
import { eq, and, sql, inArray, isNotNull } from "drizzle-orm";
import * as turf from "@turf/turf";
import redisClient from "../../config/redis";
import {
    notifyDeliveryMan,
    notifyShippingCompany,
    notifyOrderTracking,
} from "../socket/socketService";

export interface DispatchResult {
    success: boolean;
    orderId: string;
    shippingStatus: "assigned" | "manual_required";
    reason?: "no_company" | "company_inactive" | "out_of_zone" | "no_courier" | "max_attempts";
    deliveryMan?: {
        id: string;
        name: string;
        phone: string;
        distanceKm: number;
    };
    message: string;
}

/**
 * 1. Redis Courier Location Tracking Helpers
 */
export async function updateCourierRedisLocation(
    courierId: string,
    lat: number,
    lng: number,
    companyId?: string
) {
    try {
        // A) حفظ الموقع الجغرافي في Redis GEO
        await redisClient.geoadd("couriers:geo", lng, lat, courierId);

        // B) مفتاح Alive بـ TTL 60 ثانية للتأكد من اتصال المندوب وحداثة موقعه
        await redisClient.set(`courier:alive:${courierId}`, "1", "EX", 60);

        if (companyId) {
            await redisClient.set(`courier:company:${courierId}`, companyId, "EX", 300);
        }
    } catch (err: any) {
        console.warn("⚠️ Redis GEO update warning:", err.message);
    }
}

export async function removeCourierFromRedis(courierId: string) {
    try {
        await redisClient.zrem("couriers:geo", courierId);
        await redisClient.del(`courier:alive:${courierId}`);
    } catch (err: any) {
        console.warn("⚠️ Redis remove warning:", err.message);
    }
}

/**
 * 2. المحرك الرئيسي لتوزيع الطلبات (dispatchOrder)
 */
export async function dispatchOrder(orderId: string): Promise<DispatchResult> {
    // -------------------------------------------------------------
    // جلب بيانات الأوردر والفرع والمطعم وإعدادات الشحن
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
    // الخطوة 1: فحص هل المطعم مرتبط بشركة شحن؟ (restaurantSettings.shippingCompanyId أو shippingCompanyRestaurants)
    // -------------------------------------------------------------
    let companyId = settings?.shippingCompanyId || order.shippingCompanyId;

    if (!companyId) {
        const assigned = await db
            .select({ shippingCompanyId: shippingCompanyRestaurants.shippingCompanyId })
            .from(shippingCompanyRestaurants)
            .where(
                and(
                    eq(shippingCompanyRestaurants.restaurantId, order.restaurantId),
                    eq(shippingCompanyRestaurants.status, "active")
                )
            )
            .limit(1);

        if (assigned.length > 0) {
            companyId = assigned[0].shippingCompanyId;

            // مزامنة إعدادات المطعم تلقائياً
            await db
                .update(restaurantSettings)
                .set({ shippingCompanyId: companyId })
                .where(eq(restaurantSettings.restaurantId, order.restaurantId));
        }
    }

    if (!companyId) {
        await db
            .update(orders)
            .set({
                shippingStatus: "manual_required",
                shippingFailReason: "no_company",
                updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

        notifyShippingCompany("superadmin", "order:manual_required", {
            orderId,
            orderNumber: order.orderNumber,
            reason: "no_company",
            restaurantId: order.restaurantId,
        });

        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "no_company",
            message: "Restaurant has no shipping company assigned",
        };
    }

    // -------------------------------------------------------------
    // الخطوة 2: فحص هل شركة الشحن نشطة؟ (company.status === 'active')
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

        notifyShippingCompany(companyId, "order:manual_required", {
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
    // الخطوة 3: التحقق من عنوان العميل ومناطق الشركة (Point-in-Polygon)
    // -------------------------------------------------------------
    const shippingAddress = order.shippingAddress as any;
    let customerLat = shippingAddress?.lat ? parseFloat(shippingAddress.lat) : NaN;
    let customerLng = shippingAddress?.lng ? parseFloat(shippingAddress.lng) : NaN;

    if (isNaN(customerLat) || isNaN(customerLng)) {
        // Fallback: جلب إحداثيات العنوان من جدول addresses إن كان addressId موجود
        if (order.addressId) {
            const [addr] = await db
                .select({ lat: sql`lat`, lng: sql`lng` })
                .from(sql`addresses`)
                .where(eq(sql`id`, order.addressId))
                .limit(1) as any;
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
                shippingFailReason: "out_of_zone",
                updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "out_of_zone",
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
        if (zone.coordinates && Array.isArray(zone.coordinates) && zone.coordinates.length >= 3) {
            try {
                // تحويل النقاط إلى مضلع مغلق لـ Turf
                const ring = zone.coordinates.map((c: any) => [c.lng, c.lat]);
                if (
                    ring[0][0] !== ring[ring.length - 1][0] ||
                    ring[0][1] !== ring[ring.length - 1][1]
                ) {
                    ring.push(ring[0]); // إغلاق المضلع
                }
                const poly = turf.polygon([ring]);
                if (turf.booleanPointInPolygon(customerPoint, poly)) {
                    matchedZoneId = zone.id;
                    break;
                }
            } catch (err) {
                // تجاوز الخطأ في صياغة البوليجون
            }
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

        notifyShippingCompany(companyId, "order:manual_required", {
            orderId,
            orderNumber: order.orderNumber,
            reason: "out_of_zone",
            message: "Customer address is out of company delivery zones",
        });

        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "out_of_zone",
            message: "Customer delivery address is outside all shipping company zones",
        };
    }

    // -------------------------------------------------------------
    // الخطوة 4: فحص عدد محاولات التوزيع السابقة < maxAttempts
    // -------------------------------------------------------------
    const currentAttempts = order.dispatchAttempts || 0;
    if (currentAttempts >= company.maxAttempts) {
        await db
            .update(orders)
            .set({
                shippingCompanyId: companyId,
                shippingStatus: "manual_required",
                shippingFailReason: "max_attempts",
                updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

        notifyShippingCompany(companyId, "order:manual_required", {
            orderId,
            orderNumber: order.orderNumber,
            reason: "max_attempts",
            attempts: currentAttempts,
        });

        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "max_attempts",
            message: `Order reached max dispatch attempts (${company.maxAttempts})`,
        };
    }

    // -------------------------------------------------------------
    // الخطوة 5: إحداثيات الفرع والبحث الجغرافي (Redis GEOSEARCH)
    // -------------------------------------------------------------
    let branchLat = branch?.lat ? parseFloat(branch.lat) : NaN;
    let branchLng = branch?.lng ? parseFloat(branch.lng) : NaN;
    if (isNaN(branchLat) || isNaN(branchLng)) {
        if (restaurant?.lat && restaurant?.lng) {
            branchLat = parseFloat(restaurant.lat);
            branchLng = parseFloat(restaurant.lng);
        }
    }

    if (isNaN(branchLat) || isNaN(branchLng)) {
        throw new Error("Restaurant / Branch GPS coordinates are missing");
    }

    const maxRadiusKm = parseFloat(company.maxSearchRadius as string) || 10;
    let nearbyCourierIdsWithDist: Map<string, number> = new Map();

    // محاولة استخدام Redis GEOSEARCH
    try {
        const redisResults: any = await redisClient.call(
            "GEOSEARCH",
            "couriers:geo",
            "FROMLONLAT",
            branchLng,
            branchLat,
            "BYRADIUS",
            maxRadiusKm,
            "KM",
            "ASC",
            "WITHDIST"
        );

        if (Array.isArray(redisResults)) {
            for (const item of redisResults) {
                if (Array.isArray(item)) {
                    const courierId = String(item[0]);
                    const distKm = parseFloat(item[1]);
                    nearbyCourierIdsWithDist.set(courierId, distKm);
                }
            }
        }
    } catch (err: any) {
        console.warn("⚠️ Redis GEOSEARCH fallback to MySQL/Turf:", err.message);
    }

    // -------------------------------------------------------------
    // الخطوة 6: فلترة المناديب المؤهلين (MySQL Filtering)
    // -------------------------------------------------------------
    // جلب المناديب الذين رفضوا هذا الطلب مسبقاً لاستثنائهم
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

    // جلب جميع مناديب الشركة النشطين
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

    const now = new Date();
    const currentDayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday ...
    const currentTimeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00`;

    // فحص شفتات ومناطق المناديب
    const eligibleCouriers: Array<{
        courier: typeof couriers[0];
        distanceKm: number;
    }> = [];

    const branchPoint = turf.point([branchLng, branchLat]);

    for (const c of couriers) {
        // استبعاد من رفض الأوردر مسبقاً
        if (rejectedCourierIds.has(c.id)) {
            continue;
        }

        // فحص مفتاح Redis Alive (إن أمكن)
        try {
            const isAlive = await redisClient.get(`courier:alive:${c.id}`);
            if (isAlive === null && nearbyCourierIdsWithDist.size > 0 && !c.currentLat) {
                continue; // منقطع الاتصال
            }
        } catch {
            // تخطي في حال تعطل Redis
        }

        // فحص هل المندوب مسند للـ Zone الخاصة بالعنوان
        const courierZones = await db
            .select({ zoneId: deliveryManZones.zoneId })
            .from(deliveryManZones)
            .where(
                and(
                    eq(deliveryManZones.deliveryManId, c.id),
                    eq(deliveryManZones.zoneId, matchedZoneId)
                )
            )
            .limit(1);

        if (courierZones.length === 0) {
            // لو لم يتم تحديد مناطق خاصة للمندوب -> هل يعمل في كل المناطق؟
            // شرط المستخدم: "zones اللي بيشتغل فيها"
            const anyCourierZones = await db
                .select({ id: deliveryManZones.id })
                .from(deliveryManZones)
                .where(eq(deliveryManZones.deliveryManId, c.id))
                .limit(1);

            // لو عنده مناطق محددة ولكنه ليس في منطقة الأوردر -> يتم استبعاده
            if (anyCourierZones.length > 0) {
                continue;
            }
        }

        // فحص workType
        if (c.workType === "restaurant_shift") {
            // يجب أن يكون خادماً لنفس المطعم وضمن وقت الشيفت الحالي
            const validShift = await db
                .select()
                .from(deliveryManShifts)
                .where(
                    and(
                        eq(deliveryManShifts.deliveryManId, c.id),
                        eq(deliveryManShifts.restaurantId, order.restaurantId),
                        eq(deliveryManShifts.dayOfWeek, currentDayOfWeek),
                        eq(deliveryManShifts.status, "active"),
                        sql`${deliveryManShifts.from} <= ${currentTimeStr}`,
                        sql`${deliveryManShifts.to} >= ${currentTimeStr}`
                    )
                )
                .limit(1);

            if (validShift.length === 0) {
                continue; // ليس في وقت شيفت هذا المطعم
            }
        }

        // حساب المسافة
        let distanceKm = nearbyCourierIdsWithDist.get(c.id);
        if (distanceKm === undefined) {
            if (c.currentLat && c.currentLng) {
                const cLat = parseFloat(c.currentLat);
                const cLng = parseFloat(c.currentLng);
                if (!isNaN(cLat) && !isNaN(cLng)) {
                    distanceKm = turf.distance(branchPoint, turf.point([cLng, cLat]), {
                        units: "kilometers",
                    });
                }
            }
        }

        if (distanceKm !== undefined && distanceKm <= maxRadiusKm) {
            eligibleCouriers.push({
                courier: c,
                distanceKm: parseFloat(distanceKm.toFixed(2)),
            });
        }
    }

    // -------------------------------------------------------------
    // الخطوة 7: الترتيب (الأقل أوردرات نشطة أولاً، ثم الأقرب مسافة)
    // -------------------------------------------------------------
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

        notifyShippingCompany(companyId, "order:manual_required", {
            orderId,
            orderNumber: order.orderNumber,
            reason: "no_courier",
            message: "No available couriers in shift/zone right now",
        });

        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "no_courier",
            message: "No available courier matches criteria nearby",
        };
    }

    eligibleCouriers.sort((a, b) => {
        // 1. الأقل أوردرات نشطة
        if (a.courier.activeOrdersCount !== b.courier.activeOrdersCount) {
            return a.courier.activeOrdersCount - b.courier.activeOrdersCount;
        }
        // 2. الأقرب لموقع الفرع
        return a.distanceKm - b.distanceKm;
    });

    const chosen = eligibleCouriers[0];
    const newAttemptNumber = currentAttempts + 1;

    // -------------------------------------------------------------
    // الخطوة 8: إسناد الطلب وتسجيل العملية وتحديث العدادات
    // -------------------------------------------------------------
    await db.transaction(async (tx) => {
        // تحديث الطلب
        await tx
            .update(orders)
            .set({
                shippingCompanyId: companyId,
                deliveryManId: chosen.courier.id,
                shippingStatus: "assigned",
                shippingFailReason: null,
                dispatchAttempts: newAttemptNumber,
                updatedAt: new Date(),
            })
            .where(eq(orders.id, orderId));

        // زيادة عداد الأوردرات النشطة للمندوب
        await tx
            .update(deliveryMen)
            .set({
                activeOrdersCount: sql`${deliveryMen.activeOrdersCount} + 1`,
            })
            .where(eq(deliveryMen.id, chosen.courier.id));

        // تسجيل في سجل الـ assignments / offers
        await tx.insert(dispatchAssignments).values({
            orderId,
            shippingCompanyId: companyId,
            deliveryManId: chosen.courier.id,
            attemptNumber: newAttemptNumber,
            status: "active",
        });
    });

    // -------------------------------------------------------------
    // إرسال تنبيهات لحظية عبر Socket.IO
    // -------------------------------------------------------------
    notifyDeliveryMan(chosen.courier.id, "order:assigned", {
        orderId,
        orderNumber: order.orderNumber,
        restaurantName: restaurant?.name,
        branchName: branch?.name,
        branchAddress: branch?.address,
        distanceKm: chosen.distanceKm,
    });

    notifyShippingCompany(companyId, "order:assigned", {
        orderId,
        orderNumber: order.orderNumber,
        deliveryManId: chosen.courier.id,
        deliveryManName: chosen.courier.name,
        distanceKm: chosen.distanceKm,
    });

    notifyOrderTracking(orderId, "order:courier_assigned", {
        deliveryManId: chosen.courier.id,
        deliveryManName: chosen.courier.name,
        deliveryManPhone: chosen.courier.phone,
    });

    return {
        success: true,
        orderId,
        shippingStatus: "assigned",
        deliveryMan: {
            id: chosen.courier.id,
            name: chosen.courier.name,
            phone: chosen.courier.phone,
            distanceKm: chosen.distanceKm,
        },
        message: `Order successfully assigned to courier ${chosen.courier.name}`,
    };
}

/**
 * 3. دالة رفض المندوب للطلب مع السبب الإجباري وإعادة التوزيع التلقائي
 */
export async function rejectOrderByCourier(
    orderId: string,
    courierId: string,
    rejectReason: string
) {
    if (!rejectReason || rejectReason.trim() === "") {
        throw new Error("Reject reason is mandatory");
    }

    // التحقق من تعيين الطلب لهذا المندوب
    const [order] = await db
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

    // 1. تحديث سجل الـ assignment إلى rejected مع تسجيل السبب
    await db
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

    // 2. إنقاص عداد الأوردرات النشطة للمندوب
    await db
        .update(deliveryMen)
        .set({
            activeOrdersCount: sql`GREATEST(0, ${deliveryMen.activeOrdersCount} - 1)`,
        })
        .where(eq(deliveryMen.id, courierId));

    // 3. تصفير مندوب الأوردر مؤقتاً تمهيداً للإسناد التالي
    await db
        .update(orders)
        .set({
            deliveryManId: null,
            shippingStatus: "pending_dispatch",
        })
        .where(eq(orders.id, orderId));

    // 4. استدعاء خوارزمية التوزيع مجدداً للمندوب التالي
    return await dispatchOrder(orderId);
}
