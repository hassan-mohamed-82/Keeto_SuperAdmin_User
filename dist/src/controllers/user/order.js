"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelOrder = exports.getOrderPrerequisites = exports.getOrderDetails = exports.getOrderHistory = exports.getActiveOrders = exports.checkout = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const uuid_1 = require("uuid");
const Errors_1 = require("../../Errors");
const notifications_1 = require("../../utils/notifications");
const discount_1 = require("../../utils/discount");
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
    const { orderSource, paymentMethod, orderType, idempotencyKey, userZoneId, branchId, addressId, note, couponCode } = req.body;
    // ==========================================
    // 🛡️ 1. Validation (التحقق من المدخلات)
    // ==========================================
    const validOrderSources = ["online_order", "food_aggregator", "mykeeto", "pos"];
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
    // 4. Get Restaurant & Matching Business Plan
    // ==========================================
    const [restaurant] = await connection_1.db.select().from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId)).limit(1);
    if (!restaurant)
        throw new BadRequest_1.BadRequest("Restaurant not found");
    // ✅ جلب الخطة المطابقة لمصدر الطلب تحديداً
    const [plan] = await connection_1.db.select()
        .from(schema_1.restaurantBusinessPlans)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.platformType, orderSource)))
        .limit(1);
    // 🛑 التعديل هنا: منع الأوردر لأي مصدر (online_order أو غيره) لو ملوش خطة فعالة
    if (!plan) {
        throw new BadRequest_1.BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }
    // ==========================================
    // 🛡️ 4.5 فحص مواعيد المطعم وإعدادات التشغيل
    // ==========================================
    const schedulesList = await connection_1.db.select().from(schema_1.restaurantSchedules).where((0, drizzle_orm_1.eq)(schema_1.restaurantSchedules.restaurantId, restaurantId));
    const [settings] = await connection_1.db.select().from(schema_1.restaurantSettings).where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId)).limit(1);
    const resolvedOrderType = orderType || "delivery";
    const now = new Date();
    const cairoParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Africa/Cairo",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(now);
    const getP = (type) => cairoParts.find(p => p.type === type)?.value || "00";
    const cairoYear = getP("year");
    const cairoMonth = getP("month");
    const cairoDay = getP("day");
    const cairoHour = getP("hour");
    const cairoMinute = getP("minute");
    const currentTimeStr = `${cairoHour === "24" ? "00" : cairoHour}:${cairoMinute}`;
    const cairoDayOfWeek = new Date(`${cairoYear}-${cairoMonth}-${cairoDay}T12:00:00`).getDay();
    let isOpenNow = false;
    let canDeliveryNow = true;
    let canTakeawayNow = true;
    let closeReason = "Restaurant is currently closed";
    if (settings) {
        if (settings.isAlwaysOpen) {
            isOpenNow = true;
        }
        else {
            const todaySchedule = schedulesList.find(s => s.dayOfWeek === cairoDayOfWeek);
            if (todaySchedule) {
                if (todaySchedule.isOffDay) {
                    isOpenNow = false;
                    closeReason = "Today is an off day for this restaurant";
                }
                else if (todaySchedule.openingTime && todaySchedule.closingTime) {
                    const openT = todaySchedule.openingTime.slice(0, 5);
                    const closeT = todaySchedule.closingTime.slice(0, 5);
                    if (closeT > openT) {
                        if (currentTimeStr >= openT && currentTimeStr <= closeT)
                            isOpenNow = true;
                    }
                    else {
                        if (currentTimeStr >= openT || currentTimeStr <= closeT)
                            isOpenNow = true;
                    }
                }
            }
            else {
                isOpenNow = false;
                closeReason = "No active schedule found for today";
            }
        }
        canDeliveryNow = Boolean(settings.homeDelivery || settings.selfDelivery);
        canTakeawayNow = Boolean(settings.takeaway);
    }
    else {
        isOpenNow = false;
        closeReason = "Restaurant configurations are incomplete";
    }
    if (!isOpenNow) {
        throw new BadRequest_1.BadRequest(`Order failed. ${closeReason}`);
    }
    if (resolvedOrderType === "delivery" && !canDeliveryNow) {
        throw new BadRequest_1.BadRequest("Order failed. Delivery service is currently disabled for this restaurant.");
    }
    if (resolvedOrderType === "takeaway" && !canTakeawayNow) {
        throw new BadRequest_1.BadRequest("Order failed. Takeaway service is currently disabled for this restaurant.");
    }
    // ==========================================
    // 5. Calculate Subtotal & Secure Variation Prices
    // ==========================================
    let subtotal = 0;
    const itemsToInsert = [];
    let initialSubtotal = 0;
    const itemsWithData = [];
    for (const item of userCart) {
        const [foodItem] = await connection_1.db.select().from(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.id, item.foodId)).limit(1);
        const originalBasePrice = parseFloat(foodItem.price || "0");
        let safeVars = typeof item.variations === 'string' ? JSON.parse(item.variations) : item.variations;
        if (typeof safeVars === 'string')
            safeVars = JSON.parse(safeVars);
        const vars = Array.isArray(safeVars) ? safeVars : [];
        let varPrice = 0;
        for (const v of vars) {
            if (v.optionId) {
                const [dbOption] = await connection_1.db.select()
                    .from(schema_1.variationOptions)
                    .where((0, drizzle_orm_1.eq)(schema_1.variationOptions.id, v.optionId))
                    .limit(1);
                if (dbOption) {
                    const dbOptionPrice = parseFloat((dbOption.additionalPrice || "0"));
                    varPrice += dbOptionPrice;
                    v.additionalPrice = dbOptionPrice.toString();
                }
            }
            else {
                varPrice += parseFloat(v.additionalPrice || v.price || v.amount || "0");
            }
        }
        let initialDiscountPrice = originalBasePrice;
        if (foodItem.discount_value && Number(foodItem.discount_value) > 0) {
            if (foodItem.discount_type === "percentage") {
                initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(foodItem.discount_value) / 100));
            }
            else if (foodItem.discount_type === "amount" || foodItem.discount_type === "fixed") {
                initialDiscountPrice = Math.max(0, originalBasePrice - Number(foodItem.discount_value));
            }
        }
        initialSubtotal += (initialDiscountPrice + varPrice) * item.quantity;
        itemsWithData.push({ cartItem: item, foodItem, originalBasePrice, varPrice, vars });
    }
    const availableDiscounts = await (0, discount_1.getAvailableDiscounts)(restaurantId);
    const discountState = { remainingMaxDiscounts: new Map(), appliedDiscounts: new Set() };
    for (const data of itemsWithData) {
        const { cartItem, foodItem, originalBasePrice, varPrice, vars } = data;
        const { price: discountedBasePrice } = (0, discount_1.applyPriorityDiscount)({ id: foodItem.id, discountType: foodItem.discount_type, discountValue: foodItem.discount_value }, originalBasePrice, initialSubtotal, availableDiscounts, discountState, true);
        const itemTotal = (discountedBasePrice + varPrice) * cartItem.quantity;
        subtotal += itemTotal;
        itemsToInsert.push({
            id: (0, uuid_1.v4)(),
            foodId: cartItem.foodId,
            quantity: cartItem.quantity,
            basePrice: discountedBasePrice.toString(),
            variationsPrice: varPrice.toString(),
            totalPrice: itemTotal.toString(),
            variations: vars,
            note: cartItem.note || null
        });
    }
    // ==========================================
    // ✅ 5.2 Calculate Fees & Commission based on Plan
    // ==========================================
    const serviceFee = parseFloat(plan.serviceFee || "0");
    const commissionRate = parseFloat(plan.commissionRate || "0");
    const appCommission = subtotal * (commissionRate / 100);
    // ==========================================
    // 5.5 Check Coupons 
    // ==========================================
    const nowTemp = new Date();
    let totalDiscount = 0;
    let appliedCoupon = null;
    let isFreeDelivery = false;
    if (couponCode) {
        const [coupon] = await connection_1.db.select().from(schema_1.coupons).where((0, drizzle_orm_1.eq)(schema_1.coupons.code, couponCode)).limit(1);
        if (!coupon || !coupon.isActive)
            throw new BadRequest_1.BadRequest("Invalid or inactive coupon");
        if (coupon.startDate && new Date(coupon.startDate) > nowTemp)
            throw new BadRequest_1.BadRequest("Coupon not yet active");
        if (coupon.endDate && new Date(coupon.endDate) < nowTemp)
            throw new BadRequest_1.BadRequest("Coupon expired");
        if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit)
            throw new BadRequest_1.BadRequest("Coupon usage limit reached");
        if (parseFloat(coupon.minOrderAmount || "0") > subtotal)
            throw new BadRequest_1.BadRequest(`Minimum order amount of ${coupon.minOrderAmount} required for this coupon`);
        if (!coupon.isGlobal) {
            const [coupRest] = await connection_1.db.select().from(schema_1.couponRestaurants)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.couponRestaurants.couponId, coupon.id), (0, drizzle_orm_1.eq)(schema_1.couponRestaurants.restaurantId, restaurantId))).limit(1);
            if (!coupRest)
                throw new BadRequest_1.BadRequest("Coupon is not applicable to this restaurant");
        }
        if (coupon.perUserLimit) {
            const usages = await connection_1.db.select({ count: (0, drizzle_orm_1.sql) `count(*)` }).from(schema_1.couponUsages)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.couponUsages.couponId, coupon.id), (0, drizzle_orm_1.eq)(schema_1.couponUsages.userId, userId)));
            if (usages[0].count >= coupon.perUserLimit)
                throw new BadRequest_1.BadRequest("You have reached the usage limit for this coupon");
        }
        const value = parseFloat(coupon.discountValue);
        if (coupon.discountType === "free_delivery") {
            isFreeDelivery = true;
        }
        else if (coupon.discountType === "fixed_amount") {
            totalDiscount += value;
        }
        else if (coupon.discountType === "percentage") {
            let pDiscount = subtotal * (value / 100);
            if (coupon.maxDiscount) {
                const max = parseFloat(coupon.maxDiscount);
                if (pDiscount > max)
                    pDiscount = max;
            }
            totalDiscount += pDiscount;
        }
        appliedCoupon = coupon;
    }
    // ==========================================
    // 6. Smart Delivery Logic
    // ==========================================
    let deliveryFee = 0;
    if (resolvedOrderType === "delivery") {
        if (!addressId)
            throw new BadRequest_1.BadRequest("Delivery address is required");
        if (!branchId)
            throw new BadRequest_1.BadRequest("Branch is required for delivery orders");
        const [userAddress] = await connection_1.db.select().from(schema_1.addresses)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId), (0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId))).limit(1);
        if (!userAddress)
            throw new BadRequest_1.BadRequest("Invalid delivery address");
        const [branch] = await connection_1.db.select().from(schema_1.branches)
            .where((0, drizzle_orm_1.eq)(schema_1.branches.id, branchId)).limit(1);
        if (!branch)
            throw new BadRequest_1.BadRequest("Invalid branch selected");
        const resolvedZoneId = userZoneId || userAddress.zoneId;
        const [selfFee] = await connection_1.db.select().from(schema_1.restaurantZoneDeliveryFees)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.zoneId, resolvedZoneId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.status, "active"))).limit(1);
        if (!selfFee)
            throw new BadRequest_1.BadRequest("Restaurant does not deliver to your zone directly");
        deliveryFee = parseFloat(selfFee.deliveryFee || "0");
    }
    if (isFreeDelivery) {
        deliveryFee = 0;
    }
    let totalAmount = subtotal + deliveryFee + serviceFee - totalDiscount;
    if (totalAmount < 0)
        totalAmount = 0;
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
    let shiftStartTime;
    if (settings && !settings.isAlwaysOpen) {
        const todaySchedule = schedulesList.find(s => s.dayOfWeek === cairoDayOfWeek);
        if (todaySchedule && todaySchedule.openingTime && !todaySchedule.isOffDay) {
            if (currentTimeStr < todaySchedule.openingTime) {
                const yesterday = new Date(`${cairoYear}-${cairoMonth}-${cairoDay}T12:00:00`);
                yesterday.setDate(yesterday.getDate() - 1);
                const yDayOfWeek = yesterday.getDay();
                const yDateStr = yesterday.toISOString().slice(0, 10);
                const ySchedule = schedulesList.find(s => s.dayOfWeek === yDayOfWeek);
                const opTime = ySchedule?.openingTime || "00:00";
                shiftStartTime = new Date(`${yDateStr}T${opTime}:00+02:00`);
            }
            else {
                shiftStartTime = new Date(`${cairoYear}-${cairoMonth}-${cairoDay}T${todaySchedule.openingTime}:00+02:00`);
            }
        }
        else {
            shiftStartTime = new Date(`${cairoYear}-${cairoMonth}-${cairoDay}T00:00:00+02:00`);
        }
    }
    else {
        shiftStartTime = new Date(`${cairoYear}-${cairoMonth}-${cairoDay}T00:00:00+02:00`);
    }
    const [ordersCountResult] = await connection_1.db
        .select({ count: (0, drizzle_orm_1.sql) `count(${schema_1.orders.id})` })
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId), (0, drizzle_orm_1.gte)(schema_1.orders.createdAt, shiftStartTime)));
    const dailyOrderNumber = Number(ordersCountResult?.count || 0) + 1;
    //----------------------------------------//
    await connection_1.db.transaction(async (tx) => {
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
            orderType: resolvedOrderType,
            subtotal: subtotal.toString(),
            deliveryFee: deliveryFee.toString(),
            serviceFee: serviceFee.toString(),
            appCommission: appCommission.toString(),
            discountAmount: totalDiscount.toString(),
            couponCode: couponCode || null,
            totalAmount: totalAmount.toString(),
            note: note || null,
            status: "pending",
            createdAt: now,
            dailyOrderNumber
        });
        await tx.insert(schema_1.orderItems).values(itemsToInsert.map(i => ({ ...i, orderId })));
        await tx.delete(schema_1.cartItems).where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId));
        if (appliedCoupon) {
            await tx.insert(schema_1.couponUsages).values({
                id: (0, uuid_1.v4)(),
                couponId: appliedCoupon.id,
                userId,
                orderId,
                discountAmount: appliedCoupon.discountType === "free_delivery" ? deliveryFee.toString() : appliedCoupon.discountType === "fixed_amount" ? appliedCoupon.discountValue.toString() : totalDiscount.toString()
            });
            await tx.update(schema_1.coupons)
                .set({ usedCount: (0, drizzle_orm_1.sql) `used_count + 1` })
                .where((0, drizzle_orm_1.eq)(schema_1.coupons.id, appliedCoupon.id));
        }
        if (discountState.appliedDiscounts.size > 0) {
            for (const dId of Array.from(discountState.appliedDiscounts)) {
                await tx.update(schema_1.discounts)
                    .set({ usedCount: (0, drizzle_orm_1.sql) `used_count + 1` })
                    .where((0, drizzle_orm_1.eq)(schema_1.discounts.id, dId));
            }
        }
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
            createdAt: now.toISOString(),
            dailyOrderNumber
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
                discountAmount: totalDiscount,
                couponCode: couponCode || null,
                totalAmount,
                createdAt: now.toISOString(),
                dailyOrderNumber
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
    // 🔥 تجلب فقط الطلبات التي انتهت (تم إضافة المسترجع والملغى)
    (0, drizzle_orm_1.inArray)(schema_1.orders.status, ["delivered", "cancelled", "refund"])))
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
        discountAmount: schema_1.orders.discountAmount,
        couponCode: schema_1.orders.couponCode,
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
    const getCancelReasons = await connection_1.db.select().from(schema_1.selectReasons).where((0, drizzle_orm_1.eq)(schema_1.selectReasons.type, "user"));
    // تجميع الداتا وإرسالها
    return (0, response_1.SuccessResponse)(res, {
        data: {
            addresses: userAddresses,
            branches: restaurantBranches,
            paymentMethods: activePaymentMethods,
            reasons: getCancelReasons
        }
    });
};
exports.getOrderPrerequisites = getOrderPrerequisites;
// ==========================================
// 6. إلغاء الطلب من قبل المستخدم (Cancel Order)
// ==========================================
const cancelOrder = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;
    const { cancelReasonId } = req.body;
    if (!cancelReasonId)
        throw new BadRequest_1.BadRequest("Cancel reason ID is required");
    // 1. جلب الطلب والتأكد أنه للمستخدم وأنه قابل للإلغاء
    const [order] = await connection_1.db.select().from(schema_1.orders).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId), (0, drizzle_orm_1.eq)(schema_1.orders.userId, userId))).limit(1);
    if (!order)
        throw new NotFound_1.NotFound("Order not found");
    if (!["pending", "accepted"].includes(order.status)) {
        throw new BadRequest_1.BadRequest("Order cannot be cancelled at this stage");
    }
    // 2. التحقق من سبب الإلغاء
    const [reason] = await connection_1.db.select().from(schema_1.selectReasons).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.selectReasons.id, cancelReasonId), (0, drizzle_orm_1.eq)(schema_1.selectReasons.type, "user"))).limit(1);
    if (!reason)
        throw new BadRequest_1.BadRequest("Invalid cancel reason for user");
    // 3. تحديث حالة الطلب وإرجاع المبالغ المالية (إلغاء أرباح المطعم والعمولة)
    await connection_1.db.transaction(async (tx) => {
        // تحديث الطلب
        await tx.update(schema_1.orders)
            .set({
            status: "cancelled",
            cancelReasonId: reason.id,
            cancelReason: reason.name
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        // حسابات المبالغ التي تم دفعها أو خصمها
        const totalAmount = parseFloat(order.totalAmount || "0");
        const appCommission = parseFloat(order.appCommission || "0");
        const serviceFee = parseFloat(order.serviceFee || "0");
        const subtotal = parseFloat(order.subtotal || "0");
        const deliveryFee = parseFloat(order.deliveryFee || "0");
        const appDues = appCommission + serviceFee;
        const restaurantEarning = subtotal + deliveryFee - appCommission;
        const isCashPayment = order.paymentMethod === "cash_on_delivery" || order.paymentMethod === "cash"; // Assuming ID handling elsewhere or this is resolved
        // إرجاع فلوس المستخدم لو دفع بالمحفظة
        // note: paymentMethod stores UUID, so we check userWalletTransactions to know if it was a wallet payment
        const [walletTx] = await tx.select().from(schema_1.userWalletTransactions).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.reference, order.orderNumber), (0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.transactionType, "order_payment"))).limit(1);
        if (walletTx) {
            // Revert User Wallet
            const [userWallet] = await tx.select().from(schema_1.userWallets).where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId)).limit(1);
            if (userWallet) {
                const balanceBefore = parseFloat(userWallet.balance || "0");
                const newBalance = balanceBefore + totalAmount;
                await tx.update(schema_1.userWallets).set({ balance: newBalance.toString() }).where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId));
                await tx.insert(schema_1.userWalletTransactions).values({
                    id: (0, uuid_1.v4)(),
                    userId,
                    type: "credit",
                    transactionType: "refund",
                    amount: totalAmount.toString(),
                    balanceBefore: balanceBefore.toString(),
                    reference: order.orderNumber,
                    status: "approved"
                });
            }
        }
        // إرجاع الفلوس/العمولات من المطعم (حيث أن الإلغاء من المستخدم، المطعم لا يتحمل العمولة)
        const [restaurantWallet] = await tx.select().from(schema_1.restaurantWallets).where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, order.restaurantId)).limit(1);
        if (restaurantWallet) {
            let currentRestBalance = parseFloat(restaurantWallet.balance || "0");
            let currentCollectedCash = parseFloat(restaurantWallet.collectedCash || "0");
            let currentTotalEarning = parseFloat(restaurantWallet.totalEarning || "0");
            if (isCashPayment) {
                // نلغي خصم العمولة من رصيد المطعم، ونلغي الكاش المحصل
                currentRestBalance += appDues;
                currentCollectedCash -= totalAmount;
            }
            else {
                // نلغي الأرباح اللي انضافت للمطعم
                currentRestBalance -= restaurantEarning;
            }
            await tx.update(schema_1.restaurantWallets)
                .set({
                balance: currentRestBalance.toString(),
                collectedCash: currentCollectedCash.toString(),
                totalEarning: (currentTotalEarning - restaurantEarning).toString()
            })
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, order.restaurantId));
            // تسجيل العملية
            await tx.insert(schema_1.restaurantWalletTransactions).values({
                id: (0, uuid_1.v4)(),
                restaurantId: order.restaurantId,
                type: "order_payment", // Or create a new type "refund"
                amount: isCashPayment ? `${appDues}` : `-${restaurantEarning}`,
                balanceBefore: restaurantWallet.balance,
                balanceAfter: currentRestBalance.toString(),
                method: order.paymentMethod,
                reference: order.orderNumber,
                note: "Refund/Revert due to user cancellation"
            });
        }
    });
    return (0, response_1.SuccessResponse)(res, { message: "Order cancelled successfully" });
};
exports.cancelOrder = cancelOrder;
