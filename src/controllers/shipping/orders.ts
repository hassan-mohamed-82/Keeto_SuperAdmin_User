import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    orders,
    orderItems,
    restaurants,
    branches,
    deliveryMen,
    dispatchAssignments,
    food,
} from "../../models/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound, UnauthorizedError, ForbiddenError } from "../../Errors";
import { dispatchOrder, assignCourierToOrder, rejectOrderByCourier, releaseCourierForOrder } from "../../services/shipping/dispatchEngine";
import { notifyDeliveryMan, notifyShippingCompany, notifyOrderTracking } from "../../services/socket/socketService";
import { SOCKET_EVENTS } from "../../services/socket/socketEvents";
import { catchAsync } from "../../utils/catchAsync";
import { settleDeliveredOrder } from "../../services/restaurantWalletService";

// =========================================================================
// 1. عرض طلبات شركة الشحن (Get Orders Filtered by orders.shippingCompanyId)
// =========================================================================
export const getOrders = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const {
        restaurantId,
        branchId,
        status,
        shippingStatus,
        deliveryManId,
        page = "1",
        limit = "20",
        fromDate,
        toDate,
    } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 20;
    const offset = (pageNum - 1) * limitNum;

    // Direct filter on orders.shippingCompanyId (Phase 8 requirement)
    const conditions = [
        eq(orders.shippingCompanyId, companyId),
    ];

    if (restaurantId && typeof restaurantId === "string") {
        conditions.push(eq(orders.restaurantId, restaurantId));
    }

    if (branchId && typeof branchId === "string") {
        conditions.push(eq(orders.branchId, branchId));
    }

    if (status && typeof status === "string") {
        conditions.push(eq(orders.status, status as any));
    }

    if (shippingStatus && typeof shippingStatus === "string") {
        conditions.push(eq(orders.shippingStatus, shippingStatus as any));
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
            shippingStatus: orders.shippingStatus,
            shippingFailReason: orders.shippingFailReason,
            dispatchAttempts: orders.dispatchAttempts,
            totalAmount: orders.totalAmount,
            deliveryFee: orders.deliveryFee,
            shippingAddress: orders.shippingAddress,
            deliveryManId: orders.deliveryManId,
            deliveryManName: deliveryMen.name,
            deliveryManPhone: deliveryMen.phone,
            shippingAssignedAt: orders.shippingAssignedAt,
            pickedUpAt: orders.pickedUpAt,
            deliveredAt: orders.deliveredAt,
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
});

// =========================================================================
// 2. تفاصيل أوردر محدد (Get Order Details)
// =========================================================================
export const getOrderDetails = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
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
        .where(
            and(
                eq(orders.id, id),
                eq(orders.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (orderData.length === 0) {
        throw new NotFound("Order not found or does not belong to your shipping company");
    }

    const { order, restaurant, branch, deliveryMan } = orderData[0];

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
});

// =========================================================================
// 3. إسناد مندوب توصيل يدوي للأوردر (Manual Assign by Company Dispatcher)
// =========================================================================
export const manualAssignDeliveryMan = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params; // orderId
    const { deliveryManId } = req.body;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const [order] = await db
        .select()
        .from(orders)
        .where(
            and(
                eq(orders.id, id),
                eq(orders.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (!order) {
        throw new NotFound("Order not found or does not belong to your shipping company");
    }

    // Assign atomically via shared assign engine
    const assignRes = await assignCourierToOrder(id, deliveryManId, companyId, (order.dispatchAttempts || 0) + 1);

    if (!assignRes.success) {
        throw new BadRequest("Courier is not available or has reached max active orders");
    }

    const dm = assignRes.courier;

    notifyDeliveryMan(deliveryManId, SOCKET_EVENTS.COURIER_ASSIGNED, {
        orderId: id,
        orderNumber: order.orderNumber,
        assignedBy: "shipping_company_manual",
    });

    notifyOrderTracking(id, SOCKET_EVENTS.ORDER_COURIER_ASSIGNED, {
        deliveryManId: dm.id,
        deliveryManName: dm.name,
        deliveryManPhone: dm.phone,
    });

    return SuccessResponse(res, {
        message: `Order assigned to delivery man ${dm.name} successfully`,
    });
});

// =========================================================================
// 4. إعادة التوزيع التلقائي (Re-Dispatch by Company Dispatcher)
// =========================================================================
export const autoAssignOrder = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params; // orderId

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const [order] = await db
        .select()
        .from(orders)
        .where(
            and(
                eq(orders.id, id),
                eq(orders.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (!order) {
        throw new NotFound("Order not found or does not belong to your company");
    }

    const result = await dispatchOrder(id);

    return SuccessResponse(res, {
        message: result.message || "Dispatch run completed",
        data: result,
    });
});

// =========================================================================
// 5. Courier Endpoint: Picked Up (POST /api/delivery/orders/:id/picked-up)
// =========================================================================
export const markOrderPickedUp = catchAsync(async (req: Request, res: Response) => {
    const courierId = req.user?.deliveryManId || req.user?.id;
    const { id } = req.params;

    if (!courierId) {
        throw new UnauthorizedError("Unauthorized courier");
    }

    const [order] = await db
        .select()
        .from(orders)
        .where(
            and(
                eq(orders.id, id),
                eq(orders.deliveryManId, courierId)
            )
        )
        .limit(1);

    if (!order) {
        throw new NotFound("Order not found or not assigned to you");
    }

    if (order.shippingStatus !== "assigned") {
        throw new BadRequest(`Cannot mark picked up from shipping status "${order.shippingStatus}"`);
    }

    const now = new Date();

    await db
        .update(orders)
        .set({
            shippingStatus: "picked_up",
            pickedUpAt: now,
            status: "out_for_delivery",
            updatedAt: now,
        })
        .where(eq(orders.id, id));

    if (order.shippingCompanyId) {
        notifyShippingCompany(order.shippingCompanyId, SOCKET_EVENTS.ORDER_STATUS_CHANGED, {
            orderId: id,
            shippingStatus: "picked_up",
            updatedAt: now,
        });
    }

    notifyOrderTracking(id, SOCKET_EVENTS.ORDER_PICKED_UP, {
        orderId: id,
        courierId,
        pickedUpAt: now,
    });

    return SuccessResponse(res, {
        message: "Order marked as picked up successfully",
    });
});

// =========================================================================
// 6. Courier Endpoint: Delivered (POST /api/delivery/orders/:id/delivered)
// =========================================================================
export const markOrderDelivered = catchAsync(async (req: Request, res: Response) => {
    const courierId = req.user?.deliveryManId || req.user?.id;
    const { id } = req.params;

    if (!courierId) {
        throw new UnauthorizedError("Unauthorized courier");
    }

    const [order] = await db
        .select()
        .from(orders)
        .where(
            and(
                eq(orders.id, id),
                eq(orders.deliveryManId, courierId)
            )
        )
        .limit(1);

    if (!order) {
        throw new NotFound("Order not found or not assigned to you");
    }

    if (order.shippingStatus !== "picked_up" && order.shippingStatus !== "assigned") {
        throw new BadRequest(`Cannot mark delivered from shipping status "${order.shippingStatus}"`);
    }

    const now = new Date();

    await db.transaction(async (tx) => {
        // 1. Update order status and timestamp
        await tx
            .update(orders)
            .set({
                shippingStatus: "delivered",
                status: "delivered",
                deliveredAt: now,
                updatedAt: now,
            })
            .where(eq(orders.id, id));

        // 2. Decrement courier activeOrdersCount
        await tx
            .update(deliveryMen)
            .set({
                activeOrdersCount: sql`GREATEST(0, ${deliveryMen.activeOrdersCount} - 1)`,
            })
            .where(eq(deliveryMen.id, courierId));

        // 3. Mark assignment completed
        await tx
            .update(dispatchAssignments)
            .set({
                status: "completed",
                respondedAt: now,
            })
            .where(
                and(
                    eq(dispatchAssignments.orderId, id),
                    eq(dispatchAssignments.deliveryManId, courierId),
                    eq(dispatchAssignments.status, "active")
                )
            );

        // 4. Settle restaurant earnings via shared service
        await settleDeliveredOrder(id, tx);
    });

    if (order.shippingCompanyId) {
        notifyShippingCompany(order.shippingCompanyId, SOCKET_EVENTS.ORDER_STATUS_CHANGED, {
            orderId: id,
            shippingStatus: "delivered",
            updatedAt: now,
        });
    }

    notifyOrderTracking(id, SOCKET_EVENTS.ORDER_DELIVERED, {
        orderId: id,
        courierId,
        deliveredAt: now,
    });

    return SuccessResponse(res, {
        message: "Order marked as delivered successfully",
    });
});

// =========================================================================
// 7. Courier Endpoint: Reject Order (POST /api/delivery/orders/:id/reject)
// =========================================================================
export const rejectOrderCourierEndpoint = catchAsync(async (req: Request, res: Response) => {
    const courierId = req.user?.deliveryManId || req.user?.id;
    const { id } = req.params;
    const { reason } = req.body;

    if (!courierId) {
        throw new UnauthorizedError("Unauthorized courier");
    }

    if (!reason || reason.trim() === "") {
        throw new BadRequest("Reject reason is mandatory");
    }

    const result = await rejectOrderByCourier(id, courierId, reason);

    return SuccessResponse(res, {
        message: "Order rejected and re-dispatch initiated",
        data: result,
    });
});
