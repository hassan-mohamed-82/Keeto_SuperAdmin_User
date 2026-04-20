"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrderDetails = exports.getOrderHistory = exports.getActiveOrders = exports.checkout = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const uuid_1 = require("uuid");
const schema_2 = require("../../models/schema");
const Errors_1 = require("../../Errors");
// ==========================================
// 1. إنشاء الطلب (Checkout)
// ==========================================
const checkout = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const { orderSource, paymentMethodId, orderType, idempotencyKey, userZoneId, branchId } = req.body;
    // 1. Idempotency Check
    if (idempotencyKey) {
        const [existing] = await connection_1.db.select().from(schema_1.orders).where((0, drizzle_orm_1.eq)(schema_1.orders.idempotencyKey, idempotencyKey)).limit(1);
        if (existing)
            return (0, response_1.SuccessResponse)(res, { message: "Order already processed", data: existing });
    }
    // 2. Get Cart Items
    const userCart = await connection_1.db.select().from(schema_1.cartItems).where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId));
    if (!userCart.length)
        throw new BadRequest_1.BadRequest("Your cart is empty");
    const restaurantId = userCart[0].restaurantId;
    // 3. Get Restaurant & Business Plan
    const [restaurant] = await connection_1.db.select().from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId)).limit(1);
    if (!restaurant)
        throw new BadRequest_1.BadRequest("Restaurant not found");
    const [plan] = await connection_1.db.select().from(schema_1.restaurantBusinessPlans).where((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, restaurantId)).limit(1);
    if (orderSource === "food_aggregator" && (!plan || !plan.commissionRate)) {
        throw new BadRequest_1.BadRequest("Order failed. This restaurant has no active business plan.");
    }
    // جلب نوع وسيلة الدفع 
    const [paymentMethod] = await connection_1.db.select().from(schema_1.paymentMethods).where((0, drizzle_orm_1.eq)(schema_1.paymentMethods.id, paymentMethodId)).limit(1);
    if (!paymentMethod)
        throw new BadRequest_1.BadRequest("Invalid payment method");
    // 4. Calculate Subtotal from Cart Snapshots
    let subtotal = 0;
    const itemsToInsert = [];
    for (const item of userCart) {
        const basePrice = parseFloat(item.unitPrice || "0");
        let varPrice = 0;
        const vars = typeof item.variations === 'string' ? JSON.parse(item.variations) : item.variations;
        if (Array.isArray(vars)) {
            varPrice = vars.reduce((sum, v) => sum + parseFloat(v.additionalPrice || "0"), 0);
        }
        const itemTotal = (basePrice + varPrice) * item.quantity;
        subtotal += itemTotal;
        itemsToInsert.push({
            id: (0, uuid_1.v4)(),
            foodId: item.foodId,
            quantity: item.quantity,
            basePrice: basePrice.toString(),
            variationsPrice: varPrice.toString(),
            totalPrice: itemTotal.toString()
        });
    }
    const serviceFee = plan ? parseFloat(plan.serviceFee || "0") : 0;
    let appCommission = orderSource === "food_aggregator" ? subtotal * (parseFloat(plan?.commissionRate || "0") / 100) : 0;
    // 5. Smart Delivery Logic
    let deliveryFee = 0;
    if (orderType === "delivery") {
        if (!userZoneId)
            throw new BadRequest_1.BadRequest("Delivery zone is required");
        const [selfFee] = await connection_1.db.select().from(schema_1.restaurantZoneDeliveryFees)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.zoneId, userZoneId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.status, "active"))).limit(1);
        if (!selfFee)
            throw new BadRequest_1.BadRequest("Restaurant does not deliver to your zone directly");
        deliveryFee = parseFloat(selfFee.deliveryFee || "0");
    }
    const totalAmount = subtotal + deliveryFee + serviceFee;
    const orderId = (0, uuid_1.v4)();
    const orderNumber = `ORD-${Date.now()}`;
    // 6. Get Customer Info (شيلنا الـ walletBalance من هنا لأنها بقت في جدول لوحدها)
    const [userInfo] = await connection_1.db.select({ id: schema_1.users.id, name: schema_1.users.name, phone: schema_1.users.phone, email: schema_1.users.email })
        .from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, userId)).limit(1);
    // ==========================================
    // 🛡️ 7. فحص محفظة العميل (من جدول userWallets)
    // ==========================================
    let userWallet = null;
    if (paymentMethod.type === "wallet") {
        const walletResult = await connection_1.db.select().from(schema_2.userWallets).where((0, drizzle_orm_1.eq)(schema_2.userWallets.userId, userId)).limit(1);
        userWallet = walletResult[0];
        const currentBalance = parseFloat(userWallet?.balance || "0");
        if (!userWallet || currentBalance < totalAmount) {
            throw new BadRequest_1.BadRequest("Insufficient wallet balance");
        }
    }
    // 8. Execute Order (Transaction)
    await connection_1.db.transaction(async (tx) => {
        // ==========================================
        // 🛡️ أ. خصم المحفظة وتسجيل الحركة (لو الدفع محفظة)
        // ==========================================
        if (paymentMethod.type === "wallet" && userWallet) {
            const balanceBefore = parseFloat(userWallet.balance);
            const newBalance = balanceBefore - totalAmount;
            // 1. تحديث رصيد المحفظة
            await tx.update(schema_2.userWallets)
                .set({ balance: newBalance.toString() })
                .where((0, drizzle_orm_1.eq)(schema_2.userWallets.userId, userId));
            // 2. تسجيل حركة الخصم في دفتر الأستاذ (Ledger)
            await tx.insert(schema_2.userWalletTransactions).values({
                id: (0, uuid_1.v4)(),
                userId,
                paymentMethodId,
                type: "debit", // خصم
                transactionType: "order_payment", // دفع أوردر
                amount: totalAmount.toString(),
                balanceBefore: balanceBefore.toString(),
                reference: orderNumber,
                status: "approved"
            });
        }
        // ب. تسجيل بيانات الأوردر نفسه
        await tx.insert(schema_1.orders).values({
            id: orderId,
            orderNumber,
            idempotencyKey,
            userId,
            restaurantId,
            branchId,
            orderSource,
            paymentMethodId,
            orderType: orderType || "delivery",
            subtotal: subtotal.toString(),
            deliveryFee: deliveryFee.toString(),
            serviceFee: serviceFee.toString(),
            appCommission: appCommission.toString(),
            totalAmount: totalAmount.toString(),
            status: "pending"
        });
        // ج. تفريغ الكارت وتسجيل الأصناف
        await tx.insert(schema_1.orderItems).values(itemsToInsert.map(i => ({ ...i, orderId })));
        await tx.delete(schema_1.cartItems).where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId));
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Order created successfully",
        data: {
            orderDetails: { orderId, orderNumber, subtotal, deliveryFee, serviceFee, totalAmount },
            customerDetails: userInfo
        }
    });
};
exports.checkout = checkout;
// ==========================================
// 2. جلب الطلبات النشطة (الحالية)
// ==========================================
const getActiveOrders = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const activeOrders = await connection_1.db
        .select({
        orderId: schema_1.orders.id,
        orderNumber: schema_1.orders.orderNumber,
        restaurantName: schema_1.restaurants.name,
        restaurantImage: schema_1.restaurants.logo,
        totalAmount: schema_1.orders.totalAmount,
        status: schema_1.orders.status,
        createdAt: schema_1.orders.createdAt,
        itemsCount: (0, drizzle_orm_1.sql) `(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${schema_1.orders.id})`
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), 
    // 🔥 تجلب فقط الطلبات التي لم تنتهِ بعد
    (0, drizzle_orm_1.inArray)(schema_1.orders.status, ["pending", "accepted", "preparing", "out_for_delivery"])))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.orders.createdAt));
    return (0, response_1.SuccessResponse)(res, { data: activeOrders });
};
exports.getActiveOrders = getActiveOrders;
// ==========================================
// 3. جلب سجل الطلبات (History) - المكتملة والملغية
// ==========================================
const getOrderHistory = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const historyOrders = await connection_1.db
        .select({
        orderId: schema_1.orders.id,
        orderNumber: schema_1.orders.orderNumber,
        restaurantName: schema_1.restaurants.name,
        restaurantImage: schema_1.restaurants.logo,
        totalAmount: schema_1.orders.totalAmount,
        status: schema_1.orders.status, // سيكون إما delivered أو cancelled
        createdAt: schema_1.orders.createdAt,
        itemsCount: (0, drizzle_orm_1.sql) `(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${schema_1.orders.id})`
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), 
    // 🔥 تجلب فقط الطلبات التي انتهت (وصلت أو أُلغيت/رُفضت)
    (0, drizzle_orm_1.inArray)(schema_1.orders.status, ["delivered", "cancelled"])))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.orders.createdAt));
    return (0, response_1.SuccessResponse)(res, { data: historyOrders });
};
exports.getOrderHistory = getOrderHistory;
// ==========================================
// 4. تفاصيل الطلب (Order Details)
// ==========================================
const getOrderDetails = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const { orderId } = req.params;
    const orderInfo = await connection_1.db
        .select({
        orderId: schema_1.orders.id,
        orderNumber: schema_1.orders.orderNumber,
        status: schema_1.orders.status,
        createdAt: schema_1.orders.createdAt,
        paymentMethod: schema_1.orders.paymentMethodId,
        orderType: schema_1.orders.orderType,
        subtotal: schema_1.orders.subtotal,
        deliveryFee: schema_1.orders.deliveryFee,
        serviceFee: schema_1.orders.serviceFee,
        totalAmount: schema_1.orders.totalAmount,
        restaurantName: schema_1.restaurants.name,
        restaurantImage: schema_1.restaurants.logo
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId))
        .limit(1);
    if (!orderInfo.length) {
        throw new NotFound_1.NotFound("Order not found");
    }
    const items = await connection_1.db
        .select({
        foodId: schema_1.orderItems.foodId,
        foodName: schema_1.food.name,
        quantity: schema_1.orderItems.quantity,
        basePrice: schema_1.orderItems.basePrice,
        variationsPrice: schema_1.orderItems.variationsPrice,
        totalPrice: schema_1.orderItems.totalPrice
    })
        .from(schema_1.orderItems)
        .leftJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.orderItems.foodId, schema_1.food.id))
        .where((0, drizzle_orm_1.eq)(schema_1.orderItems.orderId, orderId));
    return (0, response_1.SuccessResponse)(res, {
        data: {
            ...orderInfo[0],
            items
        }
    });
};
exports.getOrderDetails = getOrderDetails;
