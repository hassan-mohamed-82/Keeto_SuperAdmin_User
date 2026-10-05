import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    orders,
    orderItems,
    restaurants,
    branches,
    deliveryMen,
    shippingCompanyRestaurants,
    food,
} from "../../models/schema";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound, UnauthorizedError } from "../../Errors";
import { autoAssignOrderToClosestDeliveryMan } from "../../services/shipping/dispatchService";
import { notifyDeliveryMan, notifyShippingCompany, notifyOrderTracking } from "../../services/socket/socketService";

// =========================================================================
// 1. عرض طلبات المطاعم التابعة لشركة الشحن (Get Shipping Company Orders)
// =========================================================================
export async function getOrders(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const {
        restaurantId,
        branchId,
        status,
        deliveryManId,
        page = "1",
        limit = "20",
        fromDate,
        toDate,
    } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 20;
    const offset = (pageNum - 1) * limitNum;

    // جلب المطاعم المسندة لهذه الشركة أولاً
    const assignedRestaurants = await db
        .select({ restaurantId: shippingCompanyRestaurants.restaurantId })
        .from(shippingCompanyRestaurants)
        .where(
            and(
                eq(shippingCompanyRestaurants.shippingCompanyId, companyId),
                eq(shippingCompanyRestaurants.status, "active")
            )
        );

    const restaurantIds = assignedRestaurants.map((r) => r.restaurantId);

    if (restaurantIds.length === 0) {
        return SuccessResponse(res, {
            message: "No restaurants assigned to this shipping company",
            data: [],
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: 0,
                totalPages: 0,
            },
        });
    }

    const conditions = [
        inArray(orders.restaurantId, restaurantIds),
    ];

    if (restaurantId && typeof restaurantId === "string") {
        if (!restaurantIds.includes(restaurantId)) {
            throw new UnauthorizedError("Restaurant not assigned to this shipping company");
        }
        conditions.push(eq(orders.restaurantId, restaurantId));
    }

    if (branchId && typeof branchId === "string") {
        conditions.push(eq(orders.branchId, branchId));
    }

    if (status && typeof status === "string") {
        conditions.push(eq(orders.status, status as any));
    }

    if (deliveryManId && typeof deliveryManId === "string") {
        conditions.push(eq(orders.deliveryManId, deliveryManId));
    }

    if (fromDate && typeof fromDate === "string") {
        conditions.push(sql`${orders.createdAt} >= ${fromDate}`);
    }

    if (toDate && typeof toDate === "string") {
        conditions.push(sql`${orders.createdAt} <= ${toDate}`);
    }

    const whereClause = and(...conditions);

    const orderList = await db
        .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            restaurantId: orders.restaurantId,
            restaurantName: restaurants.name,
            restaurantLogo: restaurants.logo,
            branchId: orders.branchId,
            branchName: branches.name,
            branchAddress: branches.address,
            orderType: orders.orderType,
            status: orders.status,
            totalAmount: orders.totalAmount,
            deliveryFee: orders.deliveryFee,
            shippingAddress: orders.shippingAddress,
            deliveryManId: orders.deliveryManId,
            deliveryManName: deliveryMen.name,
            deliveryManPhone: deliveryMen.phone,
            createdAt: orders.createdAt,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(deliveryMen, eq(orders.deliveryManId, deliveryMen.id))
        .where(whereClause)
        .orderBy(desc(orders.createdAt))
        .limit(limitNum)
        .offset(offset);

    const [totalResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(orders)
        .where(whereClause);

    return SuccessResponse(res, {
        message: "Orders retrieved successfully",
        data: orderList,
        pagination: {
            page: pageNum,
            limit: limitNum,
            total: Number(totalResult?.count || 0),
            totalPages: Math.ceil(Number(totalResult?.count || 0) / limitNum),
        },
    });
}

// =========================================================================
// 2. تفاصيل أوردر محدد (Get Order Details)
// =========================================================================
export async function getOrderDetails(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const orderData = await db
        .select({
            order: orders,
            restaurant: restaurants,
            branch: branches,
            deliveryMan: deliveryMen,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(deliveryMen, eq(orders.deliveryManId, deliveryMen.id))
        .where(eq(orders.id, id))
        .limit(1);

    if (orderData.length === 0) {
        throw new NotFound("Order not found");
    }

    const { order, restaurant, branch, deliveryMan } = orderData[0];

    // التأكد من أن المطعم مسند لشركة الشحن
    const isAssigned = await db
        .select({ id: shippingCompanyRestaurants.id })
        .from(shippingCompanyRestaurants)
        .where(
            and(
                eq(shippingCompanyRestaurants.shippingCompanyId, companyId),
                eq(shippingCompanyRestaurants.restaurantId, order.restaurantId),
                eq(shippingCompanyRestaurants.status, "active")
            )
        )
        .limit(1);

    if (isAssigned.length === 0) {
        throw new UnauthorizedError("You are not authorized to view orders for this restaurant");
    }

    // جلب أصناف الأوردر
    const items = await db
        .select({
            id: orderItems.id,
            foodId: orderItems.foodId,
            foodName: food.name,
            foodNameAr: food.nameAr,
            quantity: orderItems.quantity,
            basePrice: orderItems.basePrice,
            totalPrice: orderItems.totalPrice,
            variations: orderItems.variations,
            addons: orderItems.addons,
            note: orderItems.note,
        })
        .from(orderItems)
        .leftJoin(food, eq(orderItems.foodId, food.id))
        .where(eq(orderItems.orderId, id));

    return SuccessResponse(res, {
        message: "Order details retrieved successfully",
        data: {
            ...order,
            restaurant: restaurant ? { id: restaurant.id, name: restaurant.name, phone: restaurant.ownerPhone } : null,
            branch: branch ? { id: branch.id, name: branch.name, address: branch.address, lat: branch.lat, lng: branch.lng } : null,
            deliveryMan: deliveryMan
                ? {
                      id: deliveryMan.id,
                      name: deliveryMan.name,
                      phone: deliveryMan.phone,
                      currentLat: deliveryMan.currentLat,
                      currentLng: deliveryMan.currentLng,
                      shiftStatus: deliveryMan.shiftStatus,
                      isOnline: deliveryMan.isOnline,
                  }
                : null,
            items,
        },
    });
}

// =========================================================================
// 3. إسناد مندوب توصيل يدوي للأوردر (Manual Assign Delivery Man)
// =========================================================================
export async function manualAssignDeliveryMan(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params; // orderId
    const { deliveryManId } = req.body;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const orderData = await db
        .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            restaurantId: orders.restaurantId,
        })
        .from(orders)
        .where(eq(orders.id, id))
        .limit(1);

    if (orderData.length === 0) {
        throw new NotFound("Order not found");
    }

    // التحقق من صلاحية شركة الشحن على هذا المطعم
    const isAssigned = await db
        .select({ id: shippingCompanyRestaurants.id })
        .from(shippingCompanyRestaurants)
        .where(
            and(
                eq(shippingCompanyRestaurants.shippingCompanyId, companyId),
                eq(shippingCompanyRestaurants.restaurantId, orderData[0].restaurantId),
                eq(shippingCompanyRestaurants.status, "active")
            )
        )
        .limit(1);

    if (isAssigned.length === 0) {
        throw new UnauthorizedError("You are not authorized to assign delivery man for this order");
    }

    // التحقق من المندوب
    const dm = await db
        .select()
        .from(deliveryMen)
        .where(
            and(
                eq(deliveryMen.id, deliveryManId),
                eq(deliveryMen.shippingCompanyId, companyId),
                eq(deliveryMen.isActive, true),
                eq(deliveryMen.isDeleted, false)
            )
        )
        .limit(1);

    if (dm.length === 0) {
        throw new BadRequest("Delivery man is not assigned to your company or is inactive");
    }

    await db
        .update(orders)
        .set({
            deliveryManId,
            shippingCompanyId: companyId,
        })
        .where(eq(orders.id, id));

    // إرسال تنبيه للمندوب والمتابعة
    notifyDeliveryMan(deliveryManId, "order:assigned", {
        orderId: id,
        orderNumber: orderData[0].orderNumber,
        assignedBy: "shipping_company",
    });

    notifyOrderTracking(id, "order:delivery_assigned", {
        deliveryManId: dm[0].id,
        deliveryManName: dm[0].name,
        deliveryManPhone: dm[0].phone,
    });

    return SuccessResponse(res, {
        message: `Order assigned to delivery man ${dm[0].name} successfully`,
    });
}

// =========================================================================
// 4. الإسناد التلقائي لأقرب مندوب حسب الموقع الجغرافي للفرع (Auto-Assign to Closest Delivery Man)
// =========================================================================
export async function autoAssignOrder(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params; // orderId
    const { maxRadiusKm } = req.body;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const result = await autoAssignOrderToClosestDeliveryMan(id, {
        maxRadiusKm,
        shippingCompanyId: companyId,
    });

    if (!result.assigned) {
        throw new BadRequest(result.reason || "Could not auto-assign delivery man");
    }

    return SuccessResponse(res, {
        message: `Order successfully auto-assigned to closest delivery man: ${result.deliveryMan?.name}`,
        data: result,
    });
}
