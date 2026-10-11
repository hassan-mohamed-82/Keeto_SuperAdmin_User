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
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoAssignOrderToClosestDeliveryMan = autoAssignOrderToClosestDeliveryMan;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const turf = __importStar(require("@turf/turf"));
const socketService_1 = require("../socket/socketService");
const Errors_1 = require("../../Errors");
/**
 * دالة البحث عن أقرب مندوب توصيل لفرع المطعم وإسناد الطلب له تلقائياً
 */
async function autoAssignOrderToClosestDeliveryMan(orderId, options) {
    // 1. جلب بيانات الأوردر والفرع
    const orderData = await connection_1.db
        .select({
        order: schema_1.orders,
        branch: schema_1.branches,
        restaurant: schema_1.restaurants,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.branches, (0, drizzle_orm_1.eq)(schema_1.orders.branchId, schema_1.branches.id))
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId))
        .limit(1);
    if (orderData.length === 0) {
        throw new Errors_1.NotFound("Order not found");
    }
    const { order, branch, restaurant } = orderData[0];
    // تحديد إحداثيات الفرع (من جدول الفروع أو من لقطة الفرع في الأوردر)
    let branchLat = branch?.lat ? parseFloat(branch.lat) : NaN;
    let branchLng = branch?.lng ? parseFloat(branch.lng) : NaN;
    if (isNaN(branchLat) || isNaN(branchLng)) {
        if (restaurant?.lat && restaurant?.lng) {
            branchLat = parseFloat(restaurant.lat);
            branchLng = parseFloat(restaurant.lng);
        }
    }
    if (isNaN(branchLat) || isNaN(branchLng)) {
        throw new Errors_1.BadRequest("Branch/Restaurant does not have valid GPS coordinates (lat, lng)");
    }
    // 2. معرفة شركة الشحن التابعة لهذا المطعم
    let targetCompanyId = options?.shippingCompanyId || order.shippingCompanyId;
    if (!targetCompanyId) {
        const assignedCompany = await connection_1.db
            .select({ shippingCompanyId: schema_1.shippingCompanyRestaurants.shippingCompanyId })
            .from(schema_1.shippingCompanyRestaurants)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.restaurantId, order.restaurantId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.status, "active")))
            .limit(1);
        if (assignedCompany.length > 0) {
            targetCompanyId = assignedCompany[0].shippingCompanyId;
        }
    }
    if (!targetCompanyId) {
        return {
            assigned: false,
            orderId,
            reason: "Restaurant is not assigned to any active shipping company",
        };
    }
    // 3. جلب جميع المناديب المتاحين التابعين لشركة الشحن والشفت الخاص بهم نشط ولديهم إحداثيات
    const eligibleDeliveryMen = await connection_1.db
        .select()
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, targetCompanyId), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isActive, true), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.shiftStatus, "active"), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isAvailable, true), (0, drizzle_orm_1.isNotNull)(schema_1.deliveryMen.currentLat), (0, drizzle_orm_1.isNotNull)(schema_1.deliveryMen.currentLng)));
    if (eligibleDeliveryMen.length === 0) {
        return {
            assigned: false,
            orderId,
            reason: "No active delivery men on shift with valid GPS coordinates available right now",
        };
    }
    // 4. حساب المسافة بين كل مندوب وفرع المطعم باستخدام Turf.js
    const branchPoint = turf.point([branchLng, branchLat]);
    const maxRadius = options?.maxRadiusKm || 50; // الحد الأقصى لنطاق البحث الافتراضي بالكيلومتر
    const candidates = eligibleDeliveryMen
        .map((dm) => {
        const dmLat = parseFloat(dm.currentLat);
        const dmLng = parseFloat(dm.currentLng);
        if (isNaN(dmLat) || isNaN(dmLng))
            return null;
        const dmPoint = turf.point([dmLng, dmLat]);
        const distanceKm = turf.distance(branchPoint, dmPoint, { units: "kilometers" });
        return {
            deliveryMan: dm,
            distanceKm: parseFloat(distanceKm.toFixed(2)),
        };
    })
        .filter((item) => {
        return item !== null && item.distanceKm <= maxRadius;
    });
    if (candidates.length === 0) {
        return {
            assigned: false,
            orderId,
            reason: `No active delivery men found within ${maxRadius}km radius of the restaurant branch`,
        };
    }
    // 5. اختيار أقرب مندوب (أقل مسافة)
    candidates.sort((a, b) => a.distanceKm - b.distanceKm);
    const closest = candidates[0];
    // 6. تعيين المندوب للأوردر وتحديث حالته
    await connection_1.db
        .update(schema_1.orders)
        .set({
        deliveryManId: closest.deliveryMan.id,
        shippingCompanyId: targetCompanyId,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
    await connection_1.db
        .update(schema_1.deliveryMen)
        .set({
        isAvailable: false,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, closest.deliveryMan.id));
    // 7. إرسال تنبيهات لحظية عبر الـ WebSocket
    (0, socketService_1.notifyDeliveryMan)(closest.deliveryMan.id, "order:assigned", {
        orderId,
        orderNumber: order.orderNumber,
        restaurantName: restaurant?.name,
        branchName: branch?.name,
        distanceKm: closest.distanceKm,
    });
    (0, socketService_1.notifyShippingCompany)(targetCompanyId, "order:auto_assigned", {
        orderId,
        orderNumber: order.orderNumber,
        deliveryManId: closest.deliveryMan.id,
        deliveryManName: closest.deliveryMan.name,
        distanceKm: closest.distanceKm,
    });
    (0, socketService_1.notifyOrderTracking)(orderId, "order:delivery_assigned", {
        deliveryManId: closest.deliveryMan.id,
        deliveryManName: closest.deliveryMan.name,
        deliveryManPhone: closest.deliveryMan.phone,
    });
    return {
        assigned: true,
        orderId,
        deliveryMan: {
            id: closest.deliveryMan.id,
            name: closest.deliveryMan.name,
            phone: closest.deliveryMan.phone,
            distanceKm: closest.distanceKm,
        },
    };
}
