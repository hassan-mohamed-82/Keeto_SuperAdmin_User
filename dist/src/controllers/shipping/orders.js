"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectOrderCourierEndpoint = exports.markOrderDelivered = exports.markOrderPickedUp = exports.autoAssignOrder = exports.manualAssignDeliveryMan = exports.getOrderDetails = exports.getOrders = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const dispatchEngine_1 = require("../../services/shipping/dispatchEngine");
const socketService_1 = require("../../services/socket/socketService");
const socketEvents_1 = require("../../services/socket/socketEvents");
const catchAsync_1 = require("../../utils/catchAsync");
const restaurantWalletService_1 = require("../../services/restaurantWalletService");
// =========================================================================
// 1. عرض طلبات شركة الشحن (Get Orders Filtered by orders.shippingCompanyId)
// =========================================================================
exports.getOrders = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const { restaurantId, branchId, status, shippingStatus, deliveryManId, page = "1", limit = "20", fromDate, toDate, } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const offset = (pageNum - 1) * limitNum;
    // Direct filter on orders.shippingCompanyId (Phase 8 requirement)
    const conditions = [
        (0, drizzle_orm_1.eq)(schema_1.orders.shippingCompanyId, companyId),
    ];
    if (restaurantId && typeof restaurantId === "string") {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId));
    }
    if (branchId && typeof branchId === "string") {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.branchId, branchId));
    }
    if (status && typeof status === "string") {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.status, status));
    }
    if (shippingStatus && typeof shippingStatus === "string") {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.shippingStatus, shippingStatus));
    }
    if (deliveryManId && typeof deliveryManId === "string") {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.deliveryManId, deliveryManId));
    }
    if (fromDate && typeof fromDate === "string") {
        conditions.push((0, drizzle_orm_1.sql) `${schema_1.orders.createdAt} >= ${fromDate}`);
    }
    if (toDate && typeof toDate === "string") {
        conditions.push((0, drizzle_orm_1.sql) `${schema_1.orders.createdAt} <= ${toDate}`);
    }
    const whereClause = (0, drizzle_orm_1.and)(...conditions);
    const orderList = await connection_1.db
        .select({
        id: schema_1.orders.id,
        orderNumber: schema_1.orders.orderNumber,
        restaurantId: schema_1.orders.restaurantId,
        restaurantName: schema_1.restaurants.name,
        restaurantLogo: schema_1.restaurants.logo,
        branchId: schema_1.orders.branchId,
        branchName: schema_1.branches.name,
        branchAddress: schema_1.branches.address,
        orderType: schema_1.orders.orderType,
        status: schema_1.orders.status,
        shippingStatus: schema_1.orders.shippingStatus,
        shippingFailReason: schema_1.orders.shippingFailReason,
        dispatchAttempts: schema_1.orders.dispatchAttempts,
        totalAmount: schema_1.orders.totalAmount,
        deliveryFee: schema_1.orders.deliveryFee,
        shippingAddress: schema_1.orders.shippingAddress,
        deliveryManId: schema_1.orders.deliveryManId,
        deliveryManName: schema_1.deliveryMen.name,
        deliveryManPhone: schema_1.deliveryMen.phone,
        shippingAssignedAt: schema_1.orders.shippingAssignedAt,
        pickedUpAt: schema_1.orders.pickedUpAt,
        deliveredAt: schema_1.orders.deliveredAt,
        createdAt: schema_1.orders.createdAt,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.branches, (0, drizzle_orm_1.eq)(schema_1.orders.branchId, schema_1.branches.id))
        .leftJoin(schema_1.deliveryMen, (0, drizzle_orm_1.eq)(schema_1.orders.deliveryManId, schema_1.deliveryMen.id))
        .where(whereClause)
        .orderBy((0, drizzle_orm_1.desc)(schema_1.orders.createdAt))
        .limit(limitNum)
        .offset(offset);
    const [totalResult] = await connection_1.db
        .select({ count: (0, drizzle_orm_1.sql) `count(*)` })
        .from(schema_1.orders)
        .where(whereClause);
    return (0, response_1.SuccessResponse)(res, {
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
exports.getOrderDetails = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const orderData = await connection_1.db
        .select({
        order: schema_1.orders,
        restaurant: schema_1.restaurants,
        branch: schema_1.branches,
        deliveryMan: schema_1.deliveryMen,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.branches, (0, drizzle_orm_1.eq)(schema_1.orders.branchId, schema_1.branches.id))
        .leftJoin(schema_1.deliveryMen, (0, drizzle_orm_1.eq)(schema_1.orders.deliveryManId, schema_1.deliveryMen.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, id), (0, drizzle_orm_1.eq)(schema_1.orders.shippingCompanyId, companyId)))
        .limit(1);
    if (orderData.length === 0) {
        throw new Errors_1.NotFound("Order not found or does not belong to your shipping company");
    }
    const { order, restaurant, branch, deliveryMan } = orderData[0];
    const items = await connection_1.db
        .select({
        id: schema_1.orderItems.id,
        foodId: schema_1.orderItems.foodId,
        foodName: schema_1.food.name,
        foodNameAr: schema_1.food.nameAr,
        quantity: schema_1.orderItems.quantity,
        basePrice: schema_1.orderItems.basePrice,
        totalPrice: schema_1.orderItems.totalPrice,
        variations: schema_1.orderItems.variations,
        addons: schema_1.orderItems.addons,
        note: schema_1.orderItems.note,
    })
        .from(schema_1.orderItems)
        .leftJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.orderItems.foodId, schema_1.food.id))
        .where((0, drizzle_orm_1.eq)(schema_1.orderItems.orderId, id));
    return (0, response_1.SuccessResponse)(res, {
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
exports.manualAssignDeliveryMan = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params; // orderId
    const { deliveryManId } = req.body;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const [order] = await connection_1.db
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, id), (0, drizzle_orm_1.eq)(schema_1.orders.shippingCompanyId, companyId)))
        .limit(1);
    if (!order) {
        throw new Errors_1.NotFound("Order not found or does not belong to your shipping company");
    }
    // Assign atomically via shared assign engine
    const assignRes = await (0, dispatchEngine_1.assignCourierToOrder)(id, deliveryManId, companyId, (order.dispatchAttempts || 0) + 1);
    if (!assignRes.success) {
        throw new Errors_1.BadRequest("Courier is not available or has reached max active orders");
    }
    const dm = assignRes.courier;
    (0, socketService_1.notifyDeliveryMan)(deliveryManId, socketEvents_1.SOCKET_EVENTS.COURIER_ASSIGNED, {
        orderId: id,
        orderNumber: order.orderNumber,
        assignedBy: "shipping_company_manual",
    });
    (0, socketService_1.notifyOrderTracking)(id, socketEvents_1.SOCKET_EVENTS.ORDER_COURIER_ASSIGNED, {
        deliveryManId: dm.id,
        deliveryManName: dm.name,
        deliveryManPhone: dm.phone,
    });
    return (0, response_1.SuccessResponse)(res, {
        message: `Order assigned to delivery man ${dm.name} successfully`,
    });
});
// =========================================================================
// 4. إعادة التوزيع التلقائي (Re-Dispatch by Company Dispatcher)
// =========================================================================
exports.autoAssignOrder = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params; // orderId
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const [order] = await connection_1.db
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, id), (0, drizzle_orm_1.eq)(schema_1.orders.shippingCompanyId, companyId)))
        .limit(1);
    if (!order) {
        throw new Errors_1.NotFound("Order not found or does not belong to your company");
    }
    const result = await (0, dispatchEngine_1.dispatchOrder)(id);
    return (0, response_1.SuccessResponse)(res, {
        message: result.message || "Dispatch run completed",
        data: result,
    });
});
// =========================================================================
// 5. Courier Endpoint: Picked Up (POST /api/delivery/orders/:id/picked-up)
// =========================================================================
exports.markOrderPickedUp = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const courierId = req.user?.deliveryManId || req.user?.id;
    const { id } = req.params;
    if (!courierId) {
        throw new Errors_1.UnauthorizedError("Unauthorized courier");
    }
    const [order] = await connection_1.db
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, id), (0, drizzle_orm_1.eq)(schema_1.orders.deliveryManId, courierId)))
        .limit(1);
    if (!order) {
        throw new Errors_1.NotFound("Order not found or not assigned to you");
    }
    if (order.shippingStatus !== "assigned") {
        throw new Errors_1.BadRequest(`Cannot mark picked up from shipping status "${order.shippingStatus}"`);
    }
    const now = new Date();
    await connection_1.db
        .update(schema_1.orders)
        .set({
        shippingStatus: "picked_up",
        pickedUpAt: now,
        status: "out_for_delivery",
        updatedAt: now,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, id));
    if (order.shippingCompanyId) {
        (0, socketService_1.notifyShippingCompany)(order.shippingCompanyId, socketEvents_1.SOCKET_EVENTS.ORDER_STATUS_CHANGED, {
            orderId: id,
            shippingStatus: "picked_up",
            updatedAt: now,
        });
    }
    (0, socketService_1.notifyOrderTracking)(id, socketEvents_1.SOCKET_EVENTS.ORDER_PICKED_UP, {
        orderId: id,
        courierId,
        pickedUpAt: now,
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Order marked as picked up successfully",
    });
});
// =========================================================================
// 6. Courier Endpoint: Delivered (POST /api/delivery/orders/:id/delivered)
// =========================================================================
exports.markOrderDelivered = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const courierId = req.user?.deliveryManId || req.user?.id;
    const { id } = req.params;
    if (!courierId) {
        throw new Errors_1.UnauthorizedError("Unauthorized courier");
    }
    const [order] = await connection_1.db
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, id), (0, drizzle_orm_1.eq)(schema_1.orders.deliveryManId, courierId)))
        .limit(1);
    if (!order) {
        throw new Errors_1.NotFound("Order not found or not assigned to you");
    }
    if (order.shippingStatus !== "picked_up" && order.shippingStatus !== "assigned") {
        throw new Errors_1.BadRequest(`Cannot mark delivered from shipping status "${order.shippingStatus}"`);
    }
    const now = new Date();
    await connection_1.db.transaction(async (tx) => {
        // 1. Update order status and timestamp
        await tx
            .update(schema_1.orders)
            .set({
            shippingStatus: "delivered",
            status: "delivered",
            deliveredAt: now,
            updatedAt: now,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, id));
        // 2. Decrement courier activeOrdersCount
        await tx
            .update(schema_1.deliveryMen)
            .set({
            activeOrdersCount: (0, drizzle_orm_1.sql) `GREATEST(0, ${schema_1.deliveryMen.activeOrdersCount} - 1)`,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, courierId));
        // 3. Mark assignment completed
        await tx
            .update(schema_1.dispatchAssignments)
            .set({
            status: "completed",
            respondedAt: now,
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.dispatchAssignments.orderId, id), (0, drizzle_orm_1.eq)(schema_1.dispatchAssignments.deliveryManId, courierId), (0, drizzle_orm_1.eq)(schema_1.dispatchAssignments.status, "active")));
        // 4. Settle restaurant earnings via shared service
        await (0, restaurantWalletService_1.settleDeliveredOrder)(id, tx);
    });
    if (order.shippingCompanyId) {
        (0, socketService_1.notifyShippingCompany)(order.shippingCompanyId, socketEvents_1.SOCKET_EVENTS.ORDER_STATUS_CHANGED, {
            orderId: id,
            shippingStatus: "delivered",
            updatedAt: now,
        });
    }
    (0, socketService_1.notifyOrderTracking)(id, socketEvents_1.SOCKET_EVENTS.ORDER_DELIVERED, {
        orderId: id,
        courierId,
        deliveredAt: now,
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Order marked as delivered successfully",
    });
});
// =========================================================================
// 7. Courier Endpoint: Reject Order (POST /api/delivery/orders/:id/reject)
// =========================================================================
exports.rejectOrderCourierEndpoint = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const courierId = req.user?.deliveryManId || req.user?.id;
    const { id } = req.params;
    const { reason } = req.body;
    if (!courierId) {
        throw new Errors_1.UnauthorizedError("Unauthorized courier");
    }
    if (!reason || reason.trim() === "") {
        throw new Errors_1.BadRequest("Reject reason is mandatory");
    }
    const result = await (0, dispatchEngine_1.rejectOrderByCourier)(id, courierId, reason);
    return (0, response_1.SuccessResponse)(res, {
        message: "Order rejected and re-dispatch initiated",
        data: result,
    });
});
