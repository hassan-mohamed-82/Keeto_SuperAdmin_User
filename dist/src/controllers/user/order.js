"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrderPrerequisites = exports.getOrderDetails = exports.getOrderHistory = exports.getActiveOrders = exports.checkout = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const uuid_1 = require("uuid");
const Errors_1 = require("../../Errors");
const notifications_1 = require("../../utils/notifications");
const geo_1 = require("../../utils/geo");
// 👇 1. دالة تظبيط الوقت لتوقيت مصر عشان نص الإشعار
const formatToEgyptTime = (date) => {
    return new Intl.DateTimeFormat("ar-EG", {
        timeZone: "Africa/Cairo",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    }).format(date);
};
// ==========================================
// 1. إنشاء الطلب (Checkout)
// ==========================================
const checkout = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderSource, paymentMethod, orderType, idempotencyKey, userZoneId, branchId, addressId, note } = req.body;
    // ==========================================
    // 🛡️ 1. Validation (التحقق من المدخلات)
    // ==========================================
    const validOrderSources = ["online_order", "food_aggregator", "mykeeto"];
    if (!validOrderSources.includes(orderSource)) {
        throw new BadRequest_1.BadRequest("Invalid order source");
    }
    const [selectedPayment] = await connection_1.db.select().from(schema_1.paymentMethods).where((0, drizzle_orm_1.eq)(schema_1.paymentMethods.id, paymentMethod)).limit(1);
    if (!selectedPayment || !selectedPayment.isActive) {
        throw new BadRequest_1.BadRequest("Invalid or inactive payment method");
    }
    const paymentMethodName = selectedPayment.name;
    const paymentMethodNameAr = selectedPayment.nameAr;
    const isWalletPayment = paymentMethodName === "wallet" || paymentMethodNameAr === "محفظتى";
    const isCashPayment = paymentMethodName === "cash_on_delivery" || paymentMethodNameAr === "الدفع عند الاستلام" || paymentMethodName === "cash";
    // ==========================================
    // 2. Idempotency Check
    // ==========================================
    if (idempotencyKey) {
        const [existing] = await connection_1.db.select().from(schema_1.orders).where((0, drizzle_orm_1.eq)(schema_1.orders.idempotencyKey, idempotencyKey)).limit(1);
        if (existing)
            return (0, response_1.SuccessResponse)(res, { message: "Order already processed", data: existing });
    }
    // ==========================================
    // 3. Get Cart Items
    // ==========================================
    const userCart = await connection_1.db.select().from(schema_1.cartItems).where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId));
    if (!userCart.length)
        throw new BadRequest_1.BadRequest("Your cart is empty");
    const restaurantId = userCart[0].restaurantId;
    // ==========================================
    // 4. Get Restaurant & Business Plan
    // ==========================================
    const [restaurant] = await connection_1.db.select().from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId)).limit(1);
    if (!restaurant)
        throw new BadRequest_1.BadRequest("Restaurant not found");
    const [plan] = await connection_1.db.select().from(schema_1.restaurantBusinessPlans).where((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, restaurantId)).limit(1);
    if (orderSource === "food_aggregator" && (!plan || !plan.commissionRate)) {
        throw new BadRequest_1.BadRequest("Order failed. This restaurant has no active business plan.");
    }
    // ==========================================
    // 4.1 Validate Restaurant Settings & Schedules
    // ==========================================
    const [settings] = await connection_1.db.select().from(schema_1.restaurantSettings).where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId)).limit(1);
    if (settings) {
        if (orderType === "takeaway" && !settings.takeaway) {
            throw new BadRequest_1.BadRequest("This restaurant does not accept takeaway orders");
        }
        if (orderType === "dine_in" && !settings.dineIn) {
            throw new BadRequest_1.BadRequest("This restaurant does not accept dine-in orders");
        }
        if (orderType === "delivery" && !settings.homeDelivery) {
            throw new BadRequest_1.BadRequest("This restaurant does not accept delivery orders");
        }
        if (!settings.isAlwaysOpen) {
            const egyptDate = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
            const dayOfWeek = egyptDate.getDay();
            const currentHour = egyptDate.getHours().toString().padStart(2, '0');
            const currentMinute = egyptDate.getMinutes().toString().padStart(2, '0');
            const currentTimeStr = `${currentHour}:${currentMinute}`;
            const todaySchedules = await connection_1.db.select().from(schema_1.restaurantSchedules)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantSchedules.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantSchedules.dayOfWeek, dayOfWeek)));
            if (todaySchedules.length === 0 || todaySchedules.every(s => s.isOffDay)) {
                throw new BadRequest_1.BadRequest("The restaurant is closed today");
            }
            let isOpenNow = false;
            for (const schedule of todaySchedules) {
                if (schedule.isOffDay)
                    continue;
                if (!schedule.openingTime || !schedule.closingTime) {
                    isOpenNow = true;
                    break;
                }
                if (schedule.closingTime < schedule.openingTime) {
                    if (currentTimeStr >= schedule.openingTime || currentTimeStr <= schedule.closingTime) {
                        isOpenNow = true;
                        break;
                    }
                }
                else {
                    if (currentTimeStr >= schedule.openingTime && currentTimeStr <= schedule.closingTime) {
                        isOpenNow = true;
                        break;
                    }
                }
            }
            if (!isOpenNow) {
                throw new BadRequest_1.BadRequest("The restaurant is currently closed");
            }
        }
    }
    // ==========================================
    // 5. Calculate Subtotal from Cart Snapshots
    // ==========================================
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
            totalPrice: itemTotal.toString(),
            note: item.note || null
        });
    }
    const serviceFee = plan ? parseFloat(plan.serviceFee || "0") : 0;
    let appCommission = orderSource === "food_aggregator" ? subtotal * (parseFloat(plan?.commissionRate || "0") / 100) : 0;
    // ==========================================
    // 6. Smart Delivery Logic (Zone + Radius Hybrid)
    // ==========================================
    let deliveryFee = 0;
    if (orderType === "delivery") {
        if (!addressId)
            throw new BadRequest_1.BadRequest("Delivery address is required");
        if (!branchId)
            throw new BadRequest_1.BadRequest("Branch is required for delivery orders");
        // أ. جلب بيانات العنوان والتحقق منه
        const [userAddress] = await connection_1.db.select().from(schema_1.addresses)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId), (0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId))).limit(1);
        if (!userAddress)
            throw new BadRequest_1.BadRequest("Invalid delivery address");
        // ب. جلب بيانات الفرع المختار للتأكد من موقعه الجغرافي ونصف القطر
        const [branch] = await connection_1.db.select().from(schema_1.branches)
            .where((0, drizzle_orm_1.eq)(schema_1.branches.id, branchId)).limit(1);
        if (!branch)
            throw new BadRequest_1.BadRequest("Invalid branch selected");
        // ج. الفحص الأول: التأكد من تسعير المنطقة (Zone Validation)
        const resolvedZoneId = userZoneId || userAddress.zoneId;
        const [selfFee] = await connection_1.db.select().from(schema_1.restaurantZoneDeliveryFees)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.zoneId, resolvedZoneId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.status, "active"))).limit(1);
        if (!selfFee)
            throw new BadRequest_1.BadRequest("Restaurant does not deliver to your zone directly");
        deliveryFee = parseFloat(selfFee.deliveryFee || "0");
        // د. الفحص الثاني: التأكد من النطاق الجغرافي بالمتر/الكيلومتر (Radius Validation)
        if (branch.lat && branch.lng && branch.deliveryRadiusKm) {
            const distance = (0, geo_1.calculateDistance)(Number(branch.lat), Number(branch.lng), Number(userAddress.lat), Number(userAddress.lng));
            if (distance > Number(branch.deliveryRadiusKm)) {
                throw new BadRequest_1.BadRequest("عذراً، عنوانك خارج نطاق التوصيل الجغرافي المسموح به لهذا الفرع");
            }
        }
        else {
            throw new BadRequest_1.BadRequest("إعدادات التوصيل الجغرافية لهذا الفرع غير مكتملة");
        }
    }
    const totalAmount = subtotal + deliveryFee + serviceFee;
    const orderId = (0, uuid_1.v4)();
    const orderNumber = `ORD-${Date.now()}`;
    // ==========================================
    // 7. Get Customer Info
    // ==========================================
    const [userInfo] = await connection_1.db.select({ id: schema_1.users.id, name: schema_1.users.name, phone: schema_1.users.phone, email: schema_1.users.email })
        .from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, userId)).limit(1);
    // ==========================================
    // 🛡️ 8. فحص محفظة العميل
    // ==========================================
    let userWallet = null;
    if (isWalletPayment) {
        const walletResult = await connection_1.db.select().from(schema_1.userWallets).where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId)).limit(1);
        userWallet = walletResult[0];
        const currentBalance = parseFloat(userWallet?.balance || "0");
        if (!userWallet || currentBalance < totalAmount) {
            throw new BadRequest_1.BadRequest("Insufficient wallet balance");
        }
    }
    // ==========================================
    // 🛡️ 9. جلب محفظة المطعم 
    // ==========================================
    let [restaurantWallet] = await connection_1.db.select().from(schema_1.restaurantWallets).where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId)).limit(1);
    // ==========================================
    // 10. Execute Order (Transaction)
    // ==========================================
    const now = new Date();
    await connection_1.db.transaction(async (tx) => {
        // أ. خصم محفظة العميل
        if (isWalletPayment && userWallet) {
            const balanceBefore = parseFloat(userWallet.balance);
            const newBalance = balanceBefore - totalAmount;
            await tx.update(schema_1.userWallets)
                .set({ balance: newBalance.toString() })
                .where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId));
            await tx.insert(schema_1.userWalletTransactions).values({
                id: (0, uuid_1.v4)(),
                userId,
                type: "debit",
                transactionType: "order_payment",
                amount: totalAmount.toString(),
                balanceBefore: balanceBefore.toString(),
                reference: orderNumber,
                status: "approved",
                createdAt: now
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
            addressId: addressId || null,
            orderSource,
            paymentMethod,
            orderType: orderType || "delivery",
            subtotal: subtotal.toString(),
            deliveryFee: deliveryFee.toString(),
            serviceFee: serviceFee.toString(),
            appCommission: appCommission.toString(),
            totalAmount: totalAmount.toString(),
            note: note || null,
            status: "pending",
            createdAt: now
        });
        // ج. تفريغ الكارت وتسجيل الأصناف
        await tx.insert(schema_1.orderItems).values(itemsToInsert.map(i => ({ ...i, orderId })));
        await tx.delete(schema_1.cartItems).where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId));
        // د. تسويات محفظة المطعم
        if (!restaurantWallet) {
            await tx.insert(schema_1.restaurantWallets).values({
                id: (0, uuid_1.v4)(),
                restaurantId: restaurantId,
                balance: "0.00",
                collectedCash: "0.00",
                totalEarning: "0.00"
            });
            restaurantWallet = { balance: "0.00", collectedCash: "0.00", totalEarning: "0.00" };
        }
        const currentRestBalance = parseFloat(restaurantWallet.balance);
        const currentCollectedCash = parseFloat(restaurantWallet.collectedCash);
        const currentTotalEarning = parseFloat(restaurantWallet.totalEarning);
        const restaurantEarning = subtotal + deliveryFee - appCommission;
        const appDues = appCommission + serviceFee;
        let newRestBalance = currentRestBalance;
        let newCollectedCash = currentCollectedCash;
        if (isCashPayment) {
            newRestBalance -= appDues;
            newCollectedCash += totalAmount;
        }
        else {
            newRestBalance += restaurantEarning;
        }
        await tx.update(schema_1.restaurantWallets)
            .set({
            balance: newRestBalance.toString(),
            collectedCash: newCollectedCash.toString(),
            totalEarning: (currentTotalEarning + restaurantEarning).toString()
        })
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId));
        const isCash = isCashPayment;
        await tx.insert(schema_1.restaurantWalletTransactions).values({
            id: (0, uuid_1.v4)(),
            restaurantId,
            type: "order_payment",
            amount: isCash ? `-${appDues}` : `${restaurantEarning}`,
            balanceBefore: currentRestBalance.toString(),
            balanceAfter: newRestBalance.toString(),
            method: paymentMethodName,
            reference: orderNumber,
            note: isCash ? "Commission deducted from cash order" : "Earnings added from digital payment",
            createdAt: now
        });
    });
    // ==========================================
    // 11. Send Notification to Restaurant
    // ==========================================
    // ملاحظة: تأكد من بقاء دالة formatToEgyptTime أو استبدالها بما يماثلها لديك لقراءة النص بالإشعار
    const cairoTimeFormatted = new Date(now).toLocaleTimeString("en-US", { timeZone: "Africa/Cairo" });
    await (0, notifications_1.sendPushNotification)({
        recipientType: "restaurant",
        recipientId: restaurantId,
        title: "طلب جديد! 🛒",
        body: `تم استلام طلب جديد #${orderNumber} بقيمة ${totalAmount} ج.م الساعة ${cairoTimeFormatted}.`,
        data: {
            orderId,
            orderNumber,
            type: "new_order",
            createdAt: now.toISOString()
        }
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Order created successfully",
        order_level: {
            orderDetails: {
                orderId,
                orderNumber,
                subtotal,
                deliveryFee,
                serviceFee,
                totalAmount,
                createdAt: now.toISOString()
            },
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
    const userId = req.user.id;
    const { restaurantId } = req.query;
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
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), restaurantId ? (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, String(restaurantId)) : undefined, 
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
    const userId = req.user.id;
    const { restaurantId } = req.query;
    const historyOrders = await connection_1.db
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
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), restaurantId ? (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, String(restaurantId)) : undefined, 
    // 🔥 تجلب فقط الطلبات التي انتهت (تم إضافة المرفوض والمسترجع)
    (0, drizzle_orm_1.inArray)(schema_1.orders.status, ["delivered", "cancelled", "rejected", "refund"])))
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
    const userId = req.user.id;
    const { orderId } = req.params;
    const orderInfo = await connection_1.db
        .select({
        orderId: schema_1.orders.id,
        orderNumber: schema_1.orders.orderNumber,
        status: schema_1.orders.status,
        createdAt: schema_1.orders.createdAt,
        paymentMethod: schema_1.orders.paymentMethod, // 👈 تم التعديل هنا (كانت orderItems بالخطأ)
        orderType: schema_1.orders.orderType,
        subtotal: schema_1.orders.subtotal,
        deliveryFee: schema_1.orders.deliveryFee,
        serviceFee: schema_1.orders.serviceFee,
        totalAmount: schema_1.orders.totalAmount,
        note: schema_1.orders.note,
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
        totalPrice: schema_1.orderItems.totalPrice,
        note: schema_1.orderItems.note
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
// ==========================================
// 5. متطلبات الطلب المسبقة (Order Prerequisites)
// ==========================================
const getOrderPrerequisites = async (req, res) => {
    if (!req.user) {
        throw new Errors_1.UnauthorizedError("Unauthenticated: Token is missing or invalid");
    }
    const userId = req.user.id;
    const restaurantId = req.query.restaurantId;
    if (!restaurantId) {
        throw new BadRequest_1.BadRequest("restaurantId is required");
    }
    // جلب البيانات المطلوبة من الداتا بيز
    const [userAddresses, restaurantBranches] = await Promise.all([
        // أ) عناوين اليوزر 
        connection_1.db.select().from(schema_1.addresses).where((0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId)),
        // ب) فروع المطعم
        connection_1.db.select().from(schema_1.branches).where((0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId)),
    ]);
    // ج) طرق الدفع 
    const activePaymentMethods = await connection_1.db.select({
        id: schema_1.paymentMethods.id,
        name: schema_1.paymentMethods.name,
        nameAr: schema_1.paymentMethods.nameAr
    }).from(schema_1.paymentMethods).where((0, drizzle_orm_1.eq)(schema_1.paymentMethods.isActive, true));
    // تجميع الداتا وإرسالها
    return (0, response_1.SuccessResponse)(res, {
        data: {
            addresses: userAddresses,
            branches: restaurantBranches,
            paymentMethods: activePaymentMethods
        }
    });
};
exports.getOrderPrerequisites = getOrderPrerequisites;
