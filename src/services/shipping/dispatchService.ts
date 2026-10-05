import { db } from "../../models/connection";
import { orders, deliveryMen, branches, restaurants, shippingCompanyRestaurants, shippingCompanies } from "../../models/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import * as turf from "@turf/turf";
import { notifyDeliveryMan, notifyShippingCompany, notifyOrderTracking } from "../socket/socketService";
import { BadRequest, NotFound } from "../../Errors";

export interface AutoAssignResult {
    assigned: boolean;
    orderId: string;
    deliveryMan?: {
        id: string;
        name: string;
        phone: string;
        distanceKm: number;
    };
    reason?: string;
}

/**
 * دالة البحث عن أقرب مندوب توصيل لفرع المطعم وإسناد الطلب له تلقائياً
 */
export async function autoAssignOrderToClosestDeliveryMan(
    orderId: string,
    options?: { maxRadiusKm?: number; shippingCompanyId?: string }
): Promise<AutoAssignResult> {
    // 1. جلب بيانات الأوردر والفرع
    const orderData = await db
        .select({
            order: orders,
            branch: branches,
            restaurant: restaurants,
        })
        .from(orders)
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .where(eq(orders.id, orderId))
        .limit(1);

    if (orderData.length === 0) {
        throw new NotFound("Order not found");
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
        throw new BadRequest("Branch/Restaurant does not have valid GPS coordinates (lat, lng)");
    }

    // 2. معرفة شركة الشحن التابعة لهذا المطعم
    let targetCompanyId = options?.shippingCompanyId || order.shippingCompanyId;

    if (!targetCompanyId) {
        const assignedCompany = await db
            .select({ shippingCompanyId: shippingCompanyRestaurants.shippingCompanyId })
            .from(shippingCompanyRestaurants)
            .where(
                and(
                    eq(shippingCompanyRestaurants.restaurantId, order.restaurantId),
                    eq(shippingCompanyRestaurants.status, "active")
                )
            )
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
    const eligibleDeliveryMen = await db
        .select()
        .from(deliveryMen)
        .where(
            and(
                eq(deliveryMen.shippingCompanyId, targetCompanyId),
                eq(deliveryMen.isActive, true),
                eq(deliveryMen.isDeleted, false),
                eq(deliveryMen.shiftStatus, "active"),
                eq(deliveryMen.isAvailable, true),
                isNotNull(deliveryMen.currentLat),
                isNotNull(deliveryMen.currentLng)
            )
        );

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
            const dmLat = parseFloat(dm.currentLat!);
            const dmLng = parseFloat(dm.currentLng!);

            if (isNaN(dmLat) || isNaN(dmLng)) return null;

            const dmPoint = turf.point([dmLng, dmLat]);
            const distanceKm = turf.distance(branchPoint, dmPoint, { units: "kilometers" });

            return {
                deliveryMan: dm,
                distanceKm: parseFloat(distanceKm.toFixed(2)),
            };
        })
        .filter((item): item is { deliveryMan: typeof eligibleDeliveryMen[0]; distanceKm: number } => {
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
    await db
        .update(orders)
        .set({
            deliveryManId: closest.deliveryMan.id,
            shippingCompanyId: targetCompanyId,
        })
        .where(eq(orders.id, orderId));

    await db
        .update(deliveryMen)
        .set({
            isAvailable: false,
        })
        .where(eq(deliveryMen.id, closest.deliveryMan.id));

    // 7. إرسال تنبيهات لحظية عبر الـ WebSocket
    notifyDeliveryMan(closest.deliveryMan.id, "order:assigned", {
        orderId,
        orderNumber: order.orderNumber,
        restaurantName: restaurant?.name,
        branchName: branch?.name,
        distanceKm: closest.distanceKm,
    });

    notifyShippingCompany(targetCompanyId, "order:auto_assigned", {
        orderId,
        orderNumber: order.orderNumber,
        deliveryManId: closest.deliveryMan.id,
        deliveryManName: closest.deliveryMan.name,
        distanceKm: closest.distanceKm,
    });

    notifyOrderTracking(orderId, "order:delivery_assigned", {
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
