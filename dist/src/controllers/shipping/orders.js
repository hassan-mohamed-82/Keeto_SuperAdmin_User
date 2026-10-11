"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrders = getOrders;
exports.getOrderDetails = getOrderDetails;
exports.manualAssignDeliveryMan = manualAssignDeliveryMan;
exports.autoAssignOrder = autoAssignOrder;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const dispatchService_1 = require("../../services/shipping/dispatchService");
const socketService_1 = require("../../services/socket/socketService");
// =========================================================================
// 1. عرض طلبات المطاعم التابعة لشركة الشحن (Get Shipping Company Orders)
// =========================================================================
async function getOrders(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const { restaurantId, branchId, status, deliveryManId, page = "1", limit = "20", fromDate, toDate, } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const offset = (pageNum - 1) * limitNum;
    // جلب المطاعم المسندة لهذه الشركة أولاً
    const assignedRestaurants = await connection_1.db
        .select({ restaurantId: schema_1.shippingCompanyRestaurants.restaurantId })
        .from(schema_1.shippingCompanyRestaurants)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.status, "active")));
    const restaurantIds = assignedRestaurants.map((r) => r.restaurantId);
    if (restaurantIds.length === 0) {
        return (0, response_1.SuccessResponse)(res, {
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
        (0, drizzle_orm_1.inArray)(schema_1.orders.restaurantId, restaurantIds),
    ];
    if (restaurantId && typeof restaurantId === "string") {
        if (!restaurantIds.includes(restaurantId)) {
            throw new Errors_1.UnauthorizedError("Restaurant not assigned to this shipping company");
        }
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId));
    }
    if (branchId && typeof branchId === "string") {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.branchId, branchId));
    }
    if (status && typeof status === "string") {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.status, status));
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
        totalAmount: schema_1.orders.totalAmount,
        deliveryFee: schema_1.orders.deliveryFee,
        shippingAddress: schema_1.orders.shippingAddress,
        deliveryManId: schema_1.orders.deliveryManId,
        deliveryManName: schema_1.deliveryMen.name,
        deliveryManPhone: schema_1.deliveryMen.phone,
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
}
// =========================================================================
// 2. تفاصيل أوردر محدد (Get Order Details)
// =========================================================================
async function getOrderDetails(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
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
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, id))
        .limit(1);
    if (orderData.length === 0) {
        throw new Errors_1.NotFound("Order not found");
    }
    const { order, restaurant, branch, deliveryMan } = orderData[0];
    // التأكد من أن المطعم مسند لشركة الشحن
    const isAssigned = await connection_1.db
        .select({ id: schema_1.shippingCompanyRestaurants.id })
        .from(schema_1.shippingCompanyRestaurants)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.restaurantId, order.restaurantId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.status, "active")))
        .limit(1);
    if (isAssigned.length === 0) {
        throw new Errors_1.UnauthorizedError("You are not authorized to view orders for this restaurant");
    }
    // جلب أصناف الأوردر
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
}
// =========================================================================
// 3. إسناد مندوب توصيل يدوي للأوردر (Manual Assign Delivery Man)
// =========================================================================
async function manualAssignDeliveryMan(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params; // orderId
    const { deliveryManId } = req.body;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const orderData = await connection_1.db
        .select({
        id: schema_1.orders.id,
        orderNumber: schema_1.orders.orderNumber,
        restaurantId: schema_1.orders.restaurantId,
    })
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, id))
        .limit(1);
    if (orderData.length === 0) {
        throw new Errors_1.NotFound("Order not found");
    }
    // التحقق من صلاحية شركة الشحن على هذا المطعم
    const isAssigned = await connection_1.db
        .select({ id: schema_1.shippingCompanyRestaurants.id })
        .from(schema_1.shippingCompanyRestaurants)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.restaurantId, orderData[0].restaurantId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.status, "active")))
        .limit(1);
    if (isAssigned.length === 0) {
        throw new Errors_1.UnauthorizedError("You are not authorized to assign delivery man for this order");
    }
    // التحقق من المندوب
    const dm = await connection_1.db
        .select()
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, deliveryManId), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isActive, true), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false)))
        .limit(1);
    if (dm.length === 0) {
        throw new Errors_1.BadRequest("Delivery man is not assigned to your company or is inactive");
    }
    await connection_1.db
        .update(schema_1.orders)
        .set({
        deliveryManId,
        shippingCompanyId: companyId,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, id));
    // إرسال تنبيه للمندوب والمتابعة
    (0, socketService_1.notifyDeliveryMan)(deliveryManId, "order:assigned", {
        orderId: id,
        orderNumber: orderData[0].orderNumber,
        assignedBy: "shipping_company",
    });
    (0, socketService_1.notifyOrderTracking)(id, "order:delivery_assigned", {
        deliveryManId: dm[0].id,
        deliveryManName: dm[0].name,
        deliveryManPhone: dm[0].phone,
    });
    return (0, response_1.SuccessResponse)(res, {
        message: `Order assigned to delivery man ${dm[0].name} successfully`,
    });
}
// =========================================================================
// 4. الإسناد التلقائي لأقرب مندوب حسب الموقع الجغرافي للفرع (Auto-Assign to Closest Delivery Man)
// =========================================================================
async function autoAssignOrder(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params; // orderId
    const { maxRadiusKm } = req.body;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const result = await (0, dispatchService_1.autoAssignOrderToClosestDeliveryMan)(id, {
        maxRadiusKm,
        shippingCompanyId: companyId,
    });
    if (!result.assigned) {
        throw new Errors_1.BadRequest(result.reason || "Could not auto-assign delivery man");
    }
    return (0, response_1.SuccessResponse)(res, {
        message: `Order successfully auto-assigned to closest delivery man: ${result.deliveryMan?.name}`,
        data: result,
    });
}
