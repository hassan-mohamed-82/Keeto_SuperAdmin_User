"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReasons = exports.updateOrderStatus = exports.getAllOrders = exports.getOrderDetails = exports.getOrdersByRestaurant = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../models/schema");
const response_1 = require("../../utils/response");
const connection_1 = require("../../models/connection");
const Errors_1 = require("../../Errors");
const notifications_1 = require("../../utils/notifications");
const uuid_1 = require("uuid");
const getOrdersByRestaurant = async (req, res) => {
    const { restaurantId } = req.params; // الأيدي بتاع المطعم اللي باعتينه في اللينك
    const { status } = req.query; // لو عايز تفلتر بـ Pending أو Delivered مثلاً
    // بناء الكويري بشكل ديناميكي
    const baseQuery = connection_1.db
        .select({
        orderId: schema_1.orders.orderNumber, // الرقم العشوائي (ORD-123)
        internalId: schema_1.orders.id,
        orderDate: schema_1.orders.createdAt,
        totalAmount: schema_1.orders.totalAmount,
        orderStatus: schema_1.orders.status,
        customerName: schema_1.users.name, // اسم العميل من جدول اليوزرز
        customerPhone: schema_1.users.phone
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.orders.userId, schema_1.users.id)); // ربطنا الأوردر باليوزر
    // لو الأدمن داس على تابة معينة (مثلاً Pending فقط)
    let condition = (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId);
    if (status) {
        condition = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.orders.status, status));
    }
    const result = await baseQuery.where(condition).orderBy((0, drizzle_orm_1.desc)(schema_1.orders.createdAt));
    return (0, response_1.SuccessResponse)(res, {
        message: "Fetched restaurant orders successfully",
        data: result
    });
};
exports.getOrdersByRestaurant = getOrdersByRestaurant;
const getOrderDetails = async (req, res) => {
    // 👈 هنجيب الـ orderId والـ restaurantId من الـ params
    const { orderId, restaurantId } = req.params;
    const result = await connection_1.db
        .select({
        orderNumber: schema_1.orders.orderNumber,
        internalId: schema_1.orders.id,
        restaurantId: schema_1.orders.restaurantId, // 👈 ضفنا الـ restaurantId في النتيجة برضه لو محتاجه
        orderDate: schema_1.orders.createdAt,
        totalAmount: schema_1.orders.totalAmount,
        orderStatus: schema_1.orders.status,
        subtotal: schema_1.orders.subtotal,
        deliveryFee: schema_1.orders.deliveryFee,
        serviceFee: schema_1.orders.serviceFee,
        paymentMethod: schema_1.orders.paymentMethod,
        customerName: schema_1.users.name,
        customerPhone: schema_1.users.phone,
        addressTitle: schema_1.addresses.title,
        street: schema_1.addresses.street,
        buildingNumber: schema_1.addresses.number,
        floor: schema_1.addresses.floor,
        lat: schema_1.addresses.lat,
        lng: schema_1.addresses.lng,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.orders.userId, schema_1.users.id))
        .leftJoin(schema_1.addresses, (0, drizzle_orm_1.eq)(schema_1.orders.addressId, schema_1.addresses.id))
        .where(
    // 👈 شرط الأمان: لازم الـ id بتاع الأوردر يطابق، وكمان يكون تبع المطعم ده
    (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId), (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId)))
        .limit(1);
    if (!result || result.length === 0) {
        // رسالة الخطأ دلوقتي بتغطي الحالتين (مش موجود أصلاً، أو موجود بس بتاع مطعم تاني)
        throw new Errors_1.NotFound("Order not found");
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Order details fetched successfully",
        data: result[0]
    });
};
exports.getOrderDetails = getOrderDetails;
const getAllOrders = async (req, res) => {
    const result = await connection_1.db.select({
        orderId: schema_1.orders.orderNumber,
        internalId: schema_1.orders.id,
        orderDate: schema_1.orders.createdAt,
        totalAmount: schema_1.orders.totalAmount,
        orderStatus: schema_1.orders.status,
        customerName: schema_1.users.name,
        customerPhone: schema_1.users.phone,
        restaurantName: schema_1.restaurants.name,
        restaurantId: schema_1.restaurants.id,
        paymentMethod: schema_1.orders.paymentMethod,
        orderType: schema_1.orders.orderType,
        deliveryFee: schema_1.orders.deliveryFee,
        serviceFee: schema_1.orders.serviceFee,
        appCommission: schema_1.orders.appCommission,
        discountAmount: schema_1.orders.discountAmount,
        rating: schema_1.orders.rating,
        ratingComment: schema_1.orders.ratingComment,
        cancelReason: schema_1.orders.cancelReason,
        cancelReasonId: schema_1.orders.cancelReasonId,
        note: schema_1.orders.note,
        dailyOrderNumber: schema_1.orders.dailyOrderNumber,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.orders.userId, schema_1.users.id))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.orders.createdAt));
    return (0, response_1.SuccessResponse)(res, {
        message: "All orders fetched successfully",
        data: result
    });
};
exports.getAllOrders = getAllOrders;
// ==========================================
// 3. تحديث حالة الأوردر (مع إرجاع الفلوس والعمولة لو المطعم كنسل)
// تحديث حالة الأوردر (إرجاع المحفظة + التسوية + إضافة النقاط عند delivered)
// ==========================================
const updateOrderStatus = async (req, res) => {
    const { orderId } = req.params;
    const { status, cancelReasonId } = req.body;
    const adminRestaurantId = req.user?.restaurantId || req.user?.id;
    const adminBranchId = req.user?.branchId;
    if (!status)
        throw new Errors_1.BadRequest("Status is required");
    if (status === "cancelled" && !cancelReasonId) {
        throw new Errors_1.BadRequest("Cancel reason ID is required when cancelling an order");
    }
    const [existingOrder] = await connection_1.db.select().from(schema_1.orders).where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId)).limit(1);
    if (!existingOrder)
        throw new Errors_1.NotFound("Order not found");
    // Only restaurant admins are restricted to their own restaurant/branch.
    // SuperAdmins (type === "super_admin") can update any order.
    const isSuperAdmin = req.user?.type === "super_admin";
    if (!isSuperAdmin) {
        if (existingOrder.restaurantId !== adminRestaurantId)
            throw new Errors_1.BadRequest("Unauthorized");
        if (adminBranchId && existingOrder.branchId !== adminBranchId)
            throw new Errors_1.BadRequest("Unauthorized");
    }
    const currentStatus = existingOrder.status;
    const finalStatuses = ["delivered", "cancelled", "refund"];
    if (finalStatuses.includes(currentStatus)) {
        throw new Errors_1.BadRequest(`Order is already ${currentStatus} and cannot be changed`);
    }
    const statusFlowOrder = {
        "pending": 1,
        "accepted": 2,
        "preparing": 3,
        "out_for_delivery": 4,
        "delivered": 5,
    };
    if (statusFlowOrder[currentStatus] && statusFlowOrder[status]) {
        if (statusFlowOrder[status] === statusFlowOrder[currentStatus]) {
            throw new Errors_1.BadRequest(`Order is already ${currentStatus}`);
        }
        if (statusFlowOrder[status] < statusFlowOrder[currentStatus]) {
            throw new Errors_1.BadRequest(`Cannot revert status from ${currentStatus} to ${status}`);
        }
    }
    else if (currentStatus === status) {
        throw new Errors_1.BadRequest(`Order is already ${currentStatus}`);
    }
    let reason = null;
    if (status === "cancelled") {
        const [found] = await connection_1.db.select().from(schema_1.selectReasons)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.selectReasons.id, cancelReasonId), (0, drizzle_orm_1.eq)(schema_1.selectReasons.type, "restaurant")))
            .limit(1);
        if (!found)
            throw new Errors_1.BadRequest("Invalid cancel reason for restaurant");
        reason = found;
    }
    await connection_1.db.transaction(async (tx) => {
        // 1. تحديث حالة الطلب
        await tx.update(schema_1.orders)
            .set({
            status: status,
            cancelReasonId: status === "cancelled" ? reason.id : null,
            cancelReason: status === "cancelled" ? reason.name : null,
            updatedAt: new Date()
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        // ==========================================
        // 💰 2. الـ Refund لمحفظة العميل (User Wallet) عند الإلغاء
        // ==========================================
        if (status === "cancelled" || status === "rejected") {
            // البحث هل تم الدفع سابقاً بواسطة المحفظة
            const [walletTx] = await tx.select().from(schema_1.userWalletTransactions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.reference, existingOrder.orderNumber), (0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.transactionType, "order_payment"))).limit(1);
            if (walletTx) {
                const [userWallet] = await tx.select().from(schema_1.userWallets)
                    .where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, existingOrder.userId)).limit(1);
                if (userWallet) {
                    const balanceBefore = parseFloat(userWallet.balance ?? "0.00");
                    const amountToRefund = parseFloat(existingOrder.totalAmount || "0.00");
                    const newBalance = balanceBefore + amountToRefund;
                    // تحديث رصيد محفظة العميل
                    await tx.update(schema_1.userWallets)
                        .set({
                        balance: newBalance.toFixed(2),
                        updatedAt: new Date()
                    })
                        .where((0, drizzle_orm_1.eq)(schema_1.userWallets.id, userWallet.id));
                    // إضافة حركة إرجاع الرصيد (Refund Transaction)
                    await tx.insert(schema_1.userWalletTransactions).values({
                        id: (0, uuid_1.v4)(),
                        userId: existingOrder.userId,
                        paymentMethodId: existingOrder.paymentMethod ?? null,
                        type: "credit",
                        transactionType: "refund",
                        amount: amountToRefund.toFixed(2),
                        balanceBefore: balanceBefore.toFixed(2),
                        reference: existingOrder.orderNumber,
                        status: "approved",
                        createdAt: new Date()
                    });
                }
            }
            // ==========================================
            // 💰 3. التسوية العكسية لمحفظة المطعم (Restaurant Wallet Reversal)
            // ==========================================
            let payment = null;
            if (existingOrder.paymentMethod) {
                [payment] = await tx
                    .select()
                    .from(schema_1.paymentMethods)
                    .where((0, drizzle_orm_1.eq)(schema_1.paymentMethods.id, existingOrder.paymentMethod))
                    .limit(1);
            }
            const pmName = (payment?.name || "").toLowerCase();
            const isCashPayment = pmName.includes("cash") || pmName.includes("استلام");
            const appCommission = parseFloat(existingOrder.appCommission || "0");
            const serviceFee = parseFloat(existingOrder.serviceFee || "0");
            const totalAmount = parseFloat(existingOrder.totalAmount || "0");
            const subtotal = parseFloat(existingOrder.subtotal || "0");
            const deliveryFee = parseFloat(existingOrder.deliveryFee || "0");
            const appDues = appCommission + serviceFee;
            const restaurantEarning = subtotal + deliveryFee - appCommission;
            let [restWallet] = await tx.select().from(schema_1.restaurantWallets)
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, existingOrder.restaurantId)).limit(1);
            if (!restWallet) {
                await tx.insert(schema_1.restaurantWallets).values({ id: (0, uuid_1.v4)(), restaurantId: existingOrder.restaurantId });
                [restWallet] = await tx.select().from(schema_1.restaurantWallets)
                    .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, existingOrder.restaurantId)).limit(1);
            }
            let currentBalance = parseFloat(restWallet.balance || "0");
            let currentCollectedCash = parseFloat(restWallet.collectedCash || "0");
            let currentTotalEarning = parseFloat(restWallet.totalEarning || "0");
            if (isCashPayment) {
                currentBalance += appDues;
                currentCollectedCash -= totalAmount;
            }
            else {
                currentBalance -= restaurantEarning;
            }
            currentTotalEarning -= restaurantEarning;
            const balanceAfterPenalty = currentBalance - appDues;
            await tx.update(schema_1.restaurantWallets)
                .set({
                balance: balanceAfterPenalty.toFixed(2),
                collectedCash: currentCollectedCash.toFixed(2),
                totalEarning: currentTotalEarning.toFixed(2),
                updatedAt: new Date()
            })
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, existingOrder.restaurantId));
            await tx.insert(schema_1.restaurantWalletTransactions).values({
                id: (0, uuid_1.v4)(),
                restaurantId: existingOrder.restaurantId,
                type: "order_payment",
                amount: `-${appDues.toFixed(2)}`,
                balanceBefore: currentBalance.toFixed(2),
                balanceAfter: balanceAfterPenalty.toFixed(2),
                method: existingOrder.paymentMethod,
                reference: existingOrder.orderNumber,
                note: `Order Reversal & Penalty: Cancelled by restaurant. Commission deducted: ${appDues}`,
                createdAt: new Date()
            });
        }
        // ==========================================
        // ⭐ LOYALTY POINTS: إضافة نقاط المطعم عند التوصيل (DELIVERED)
        // ==========================================
        if (status === "delivered") {
            const items = await tx
                .select({ foodId: schema_1.orderItems.foodId, quantity: schema_1.orderItems.quantity })
                .from(schema_1.orderItems)
                .where((0, drizzle_orm_1.eq)(schema_1.orderItems.orderId, orderId));
            if (items.length > 0) {
                const foodIds = items.map(i => i.foodId);
                const enrolledRows = await tx
                    .select({ foodId: schema_1.pointsProducts.foodId, isActive: schema_1.pointsProducts.isActive })
                    .from(schema_1.pointsProducts)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.pointsProducts.restaurantId, existingOrder.restaurantId), (0, drizzle_orm_1.inArray)(schema_1.pointsProducts.foodId, foodIds)));
                const enrolledMap = new Map(enrolledRows.filter(r => r.isActive).map(r => [r.foodId, true]));
                if (enrolledMap.size > 0) {
                    const enrolledFoodIds = foodIds.filter(id => enrolledMap.has(id));
                    const foodPoints = await tx
                        .select({ id: schema_1.food.id, points: schema_1.food.points })
                        .from(schema_1.food)
                        .where((0, drizzle_orm_1.inArray)(schema_1.food.id, enrolledFoodIds));
                    const foodPointsMap = new Map(foodPoints.map(f => [f.id, f.points ?? 0]));
                    let totalPointsEarned = 0;
                    for (const item of items) {
                        if (enrolledMap.has(item.foodId)) {
                            totalPointsEarned += (foodPointsMap.get(item.foodId) ?? 0) * item.quantity;
                        }
                    }
                    if (totalPointsEarned > 0) {
                        let [userPointRecord] = await tx
                            .select()
                            .from(schema_1.userRestaurantPoints)
                            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRestaurantPoints.userId, existingOrder.userId), (0, drizzle_orm_1.eq)(schema_1.userRestaurantPoints.restaurantId, existingOrder.restaurantId)))
                            .limit(1);
                        if (!userPointRecord) {
                            const newPointId = (0, uuid_1.v4)();
                            await tx.insert(schema_1.userRestaurantPoints).values({
                                id: newPointId,
                                userId: existingOrder.userId,
                                restaurantId: existingOrder.restaurantId,
                                points: 0,
                            });
                            [userPointRecord] = await tx
                                .select()
                                .from(schema_1.userRestaurantPoints)
                                .where((0, drizzle_orm_1.eq)(schema_1.userRestaurantPoints.id, newPointId))
                                .limit(1);
                        }
                        const pointsBefore = userPointRecord.points ?? 0;
                        const pointsAfter = pointsBefore + totalPointsEarned;
                        await tx
                            .update(schema_1.userRestaurantPoints)
                            .set({ points: pointsAfter, updatedAt: new Date() })
                            .where((0, drizzle_orm_1.eq)(schema_1.userRestaurantPoints.id, userPointRecord.id));
                        await tx.insert(schema_1.userPointsTransactions).values({
                            id: (0, uuid_1.v4)(),
                            userId: existingOrder.userId,
                            restaurantId: existingOrder.restaurantId,
                            type: "earn",
                            points: totalPointsEarned,
                            balanceBefore: pointsBefore,
                            balanceAfter: pointsAfter,
                            orderId: orderId,
                            note: `Earned ${totalPointsEarned} points from order #${existingOrder.orderNumber}`,
                            createdAt: new Date(),
                        });
                    }
                }
            }
        }
    });
    // ==========================================
    // 4. إرسال الإشعارات للعميل
    // ==========================================
    let messageBody = `Your order ${existingOrder.dailyOrderNumber} is now ${status}.`;
    if (status === "cancelled") {
        messageBody = `Your order ${existingOrder.dailyOrderNumber} was cancelled. Reason: ${reason?.name || "Not specified"}`;
    }
    await (0, notifications_1.sendPushNotification)({
        recipientType: "user",
        recipientId: existingOrder.userId,
        title: "Order Update",
        body: messageBody,
        data: {
            orderId: existingOrder.id,
            orderNumber: existingOrder.orderNumber,
            dailyOrderNumber: existingOrder.dailyOrderNumber,
            status: status,
            type: "ORDER_STATUS_UPDATE"
        }
    });
    return (0, response_1.SuccessResponse)(res, { message: `Order status successfully updated to ${status}` });
};
exports.updateOrderStatus = updateOrderStatus;
// جلب أسباب الإلغاء حسب النوع (user أو restaurant)
const getReasons = async (req, res) => {
    const type = req.query.type;
    const conditions = [(0, drizzle_orm_1.eq)(schema_1.selectReasons.status, "active")];
    if (type === "user" || type === "restaurant") {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.selectReasons.type, type));
    }
    const reasons = await connection_1.db
        .select()
        .from(schema_1.selectReasons)
        .where((0, drizzle_orm_1.and)(...conditions));
    return (0, response_1.SuccessResponse)(res, {
        message: "Active reasons fetched successfully",
        data: reasons
    });
};
exports.getReasons = getReasons;
