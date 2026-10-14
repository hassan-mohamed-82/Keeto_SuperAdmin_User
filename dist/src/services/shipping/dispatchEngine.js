"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function () { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function (o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function (o) {
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
exports.updateCourierRedisLocation = updateCourierRedisLocation;
exports.removeCourierFromRedis = removeCourierFromRedis;
exports.dispatchOrder = dispatchOrder;
exports.rejectOrderByCourier = rejectOrderByCourier;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const turf = __importStar(require("@turf/turf"));
const redis_1 = __importDefault(require("../../config/redis"));
const socketService_1 = require("../socket/socketService");
/**
 * 1. Redis Courier Location Tracking Helpers
 */
async function updateCourierRedisLocation(courierId, lat, lng, companyId) {
    try {
        // A) حفظ الموقع الجغرافي في Redis GEO
        await redis_1.default.geoadd("couriers:geo", lng, lat, courierId);
        // B) مفتاح Alive بـ TTL 60 ثانية للتأكد من اتصال المندوب وحداثة موقعه
        await redis_1.default.set(`courier:alive:${courierId}`, "1", "EX", 60);
        if (companyId) {
            await redis_1.default.set(`courier:company:${courierId}`, companyId, "EX", 300);
        }
    }
    catch (err) {
        console.warn("⚠️ Redis GEO update warning:", err.message);
    }
}
async function removeCourierFromRedis(courierId) {
    try {
        await redis_1.default.zrem("couriers:geo", courierId);
        await redis_1.default.del(`courier:alive:${courierId}`);
    }
    catch (err) {
        console.warn("⚠️ Redis remove warning:", err.message);
    }
}
/**
 * 2. المحرك الرئيسي لتوزيع الطلبات (dispatchOrder)
 */
async function dispatchOrder(orderId) {
    // -------------------------------------------------------------
    // جلب بيانات الأوردر والفرع والمطعم وإعدادات الشحن
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
    // الخطوة 1: فحص هل المطعم مرتبط بشركة شحن؟ (restaurantSettings.shippingCompanyId أو shippingCompanyRestaurants)
    // -------------------------------------------------------------
    let companyId = settings?.shippingCompanyId || order.shippingCompanyId;
    if (!companyId) {
        const assigned = await connection_1.db
            .select({ shippingCompanyId: schema_1.shippingCompanyRestaurants.shippingCompanyId })
            .from(schema_1.shippingCompanyRestaurants)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.restaurantId, order.restaurantId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.status, "active")))
            .limit(1);
        if (assigned.length > 0) {
            companyId = assigned[0].shippingCompanyId;
            // مزامنة إعدادات المطعم تلقائياً
            await connection_1.db
                .update(schema_1.restaurantSettings)
                .set({ shippingCompanyId: companyId })
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, order.restaurantId));
        }
    }
    if (!companyId) {
        await connection_1.db
            .update(schema_1.orders)
            .set({
                shippingStatus: "manual_required",
                shippingFailReason: "no_company",
                updatedAt: new Date(),
            })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        (0, socketService_1.notifyShippingCompany)("superadmin", "order:manual_required", {
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
        (0, socketService_1.notifyShippingCompany)(companyId, "order:manual_required", {
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
    const shippingAddress = order.shippingAddress;
    let customerLat = shippingAddress?.lat ? parseFloat(shippingAddress.lat) : NaN;
    let customerLng = shippingAddress?.lng ? parseFloat(shippingAddress.lng) : NaN;
    if (isNaN(customerLat) || isNaN(customerLng)) {
        // Fallback: جلب إحداثيات العنوان من جدول addresses إن كان addressId موجود
        if (order.addressId) {
            const [addr] = await connection_1.db
                .select({ lat: (0, drizzle_orm_1.sql)`lat`, lng: (0, drizzle_orm_1.sql)`lng` })
                .from((0, drizzle_orm_1.sql)`addresses`)
                .where((0, drizzle_orm_1.eq)((0, drizzle_orm_1.sql)`id`, order.addressId))
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
                shippingFailReason: "out_of_zone",
                updatedAt: new Date(),
            })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        return {
            success: false,
            orderId,
            shippingStatus: "manual_required",
            reason: "out_of_zone",
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
        if (zone.coordinates && Array.isArray(zone.coordinates) && zone.coordinates.length >= 3) {
            try {
                // تحويل النقاط إلى مضلع مغلق لـ Turf
                const ring = zone.coordinates.map((c) => [c.lng, c.lat]);
                if (ring[0][0] !== ring[ring.length - 1][0] ||
                    ring[0][1] !== ring[ring.length - 1][1]) {
                    ring.push(ring[0]); // إغلاق المضلع
                }
                const poly = turf.polygon([ring]);
                if (turf.booleanPointInPolygon(customerPoint, poly)) {
                    matchedZoneId = zone.id;
                    break;
                }
            }
            catch (err) {
                // تجاوز الخطأ في صياغة البوليجون
            }
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
        (0, socketService_1.notifyShippingCompany)(companyId, "order:manual_required", {
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
        await connection_1.db
            .update(schema_1.orders)
            .set({
                shippingCompanyId: companyId,
                shippingStatus: "manual_required",
                shippingFailReason: "max_attempts",
                updatedAt: new Date(),
            })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        (0, socketService_1.notifyShippingCompany)(companyId, "order:manual_required", {
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
    const maxRadiusKm = parseFloat(company.maxSearchRadius) || 10;
    let nearbyCourierIdsWithDist = new Map();
    // محاولة استخدام Redis GEOSEARCH
    try {
        const redisResults = await redis_1.default.call("GEOSEARCH", "couriers:geo", "FROMLONLAT", branchLng, branchLat, "BYRADIUS", maxRadiusKm, "KM", "ASC", "WITHDIST");
        if (Array.isArray(redisResults)) {
            for (const item of redisResults) {
                if (Array.isArray(item)) {
                    const courierId = String(item[0]);
                    const distKm = parseFloat(item[1]);
                    nearbyCourierIdsWithDist.set(courierId, distKm);
                }
            }
        }
    }
    catch (err) {
        console.warn("⚠️ Redis GEOSEARCH fallback to MySQL/Turf:", err.message);
    }
    // -------------------------------------------------------------
    // الخطوة 6: فلترة المناديب المؤهلين (MySQL Filtering)
    // -------------------------------------------------------------
    // جلب المناديب الذين رفضوا هذا الطلب مسبقاً لاستثنائهم
    const previousRejections = await connection_1.db
        .select({ deliveryManId: schema_1.dispatchAssignments.deliveryManId })
        .from(schema_1.dispatchAssignments)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.dispatchAssignments.orderId, orderId), (0, drizzle_orm_1.eq)(schema_1.dispatchAssignments.status, "rejected")));
    const rejectedCourierIds = new Set(previousRejections.map((r) => r.deliveryManId));
    // جلب جميع مناديب الشركة النشطين
    const couriers = await connection_1.db
        .select()
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isActive, true), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isOnline, true), (0, drizzle_orm_1.sql)`${schema_1.deliveryMen.activeOrdersCount} < ${company.maxActiveOrders}`));
    const now = new Date();
    const currentDayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday ...
    const currentTimeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00`;
    // فحص شفتات ومناطق المناديب
    const eligibleCouriers = [];
    const branchPoint = turf.point([branchLng, branchLat]);
    for (const c of couriers) {
        // استبعاد من رفض الأوردر مسبقاً
        if (rejectedCourierIds.has(c.id)) {
            continue;
        }
        // فحص مفتاح Redis Alive (إن أمكن)
        try {
            const isAlive = await redis_1.default.get(`courier:alive:${c.id}`);
            if (isAlive === null && nearbyCourierIdsWithDist.size > 0 && !c.currentLat) {
                continue; // منقطع الاتصال
            }
        }
        catch {
            // تخطي في حال تعطل Redis
        }
        // فحص هل المندوب مسند للـ Zone الخاصة بالعنوان
        const courierZones = await connection_1.db
            .select({ zoneId: schema_1.deliveryManZones.zoneId })
            .from(schema_1.deliveryManZones)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryManZones.deliveryManId, c.id), (0, drizzle_orm_1.eq)(schema_1.deliveryManZones.zoneId, matchedZoneId)))
            .limit(1);
        if (courierZones.length === 0) {
            // لو لم يتم تحديد مناطق خاصة للمندوب -> هل يعمل في كل المناطق؟
            // شرط المستخدم: "zones اللي بيشتغل فيها"
            const anyCourierZones = await connection_1.db
                .select({ id: schema_1.deliveryManZones.id })
                .from(schema_1.deliveryManZones)
                .where((0, drizzle_orm_1.eq)(schema_1.deliveryManZones.deliveryManId, c.id))
                .limit(1);
            // لو عنده مناطق محددة ولكنه ليس في منطقة الأوردر -> يتم استبعاده
            if (anyCourierZones.length > 0) {
                continue;
            }
        }
        // فحص deliveryType
        if (c.deliveryType === "restaurant") {
            // يجب أن يكون خادماً لنفس المطعم وضمن وقت الشيفت الحالي
            const validShift = await connection_1.db
                .select()
                .from(schema_1.deliveryManShifts)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryManShifts.deliveryManId, c.id), (0, drizzle_orm_1.eq)(schema_1.deliveryManShifts.restaurantId, order.restaurantId), (0, drizzle_orm_1.eq)(schema_1.deliveryManShifts.dayOfWeek, currentDayOfWeek), (0, drizzle_orm_1.eq)(schema_1.deliveryManShifts.status, "active"), (0, drizzle_orm_1.sql)`${schema_1.deliveryManShifts.from} <= ${currentTimeStr}`, (0, drizzle_orm_1.sql)`${schema_1.deliveryManShifts.to} >= ${currentTimeStr}`))
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
        (0, socketService_1.notifyShippingCompany)(companyId, "order:manual_required", {
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
    await connection_1.db.transaction(async (tx) => {
        // تحديث الطلب
        await tx
            .update(schema_1.orders)
            .set({
                shippingCompanyId: companyId,
                deliveryManId: chosen.courier.id,
                shippingStatus: "assigned",
                shippingFailReason: null,
                dispatchAttempts: newAttemptNumber,
                updatedAt: new Date(),
            })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        // زيادة عداد الأوردرات النشطة للمندوب
        await tx
            .update(schema_1.deliveryMen)
            .set({
                activeOrdersCount: (0, drizzle_orm_1.sql)`${schema_1.deliveryMen.activeOrdersCount} + 1`,
            })
            .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, chosen.courier.id));
        // تسجيل في سجل الـ assignments / offers
        await tx.insert(schema_1.dispatchAssignments).values({
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
    (0, socketService_1.notifyDeliveryMan)(chosen.courier.id, "order:assigned", {
        orderId,
        orderNumber: order.orderNumber,
        restaurantName: restaurant?.name,
        branchName: branch?.name,
        branchAddress: branch?.address,
        distanceKm: chosen.distanceKm,
    });
    (0, socketService_1.notifyShippingCompany)(companyId, "order:assigned", {
        orderId,
        orderNumber: order.orderNumber,
        deliveryManId: chosen.courier.id,
        deliveryManName: chosen.courier.name,
        distanceKm: chosen.distanceKm,
    });
    (0, socketService_1.notifyOrderTracking)(orderId, "order:courier_assigned", {
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
async function rejectOrderByCourier(orderId, courierId, rejectReason) {
    if (!rejectReason || rejectReason.trim() === "") {
        throw new Error("Reject reason is mandatory");
    }
    // التحقق من تعيين الطلب لهذا المندوب
    const [order] = await connection_1.db
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId), (0, drizzle_orm_1.eq)(schema_1.orders.deliveryManId, courierId)))
        .limit(1);
    if (!order) {
        throw new Error("Order not found or not currently assigned to this courier");
    }
    // 1. تحديث سجل الـ assignment إلى rejected مع تسجيل السبب
    await connection_1.db
        .update(schema_1.dispatchAssignments)
        .set({
            status: "rejected",
            rejectReason: rejectReason.trim(),
            respondedAt: new Date(),
        })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.dispatchAssignments.orderId, orderId), (0, drizzle_orm_1.eq)(schema_1.dispatchAssignments.deliveryManId, courierId), (0, drizzle_orm_1.eq)(schema_1.dispatchAssignments.status, "active")));
    // 2. إنقاص عداد الأوردرات النشطة للمندوب
    await connection_1.db
        .update(schema_1.deliveryMen)
        .set({
            activeOrdersCount: (0, drizzle_orm_1.sql)`GREATEST(0, ${schema_1.deliveryMen.activeOrdersCount} - 1)`,
        })
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, courierId));
    // 3. تصفير مندوب الأوردر مؤقتاً تمهيداً للإسناد التالي
    await connection_1.db
        .update(schema_1.orders)
        .set({
            deliveryManId: null,
            shippingStatus: "pending_dispatch",
        })
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
    // 4. استدعاء خوارزمية التوزيع مجدداً للمندوب التالي
    return await dispatchOrder(orderId);
}
