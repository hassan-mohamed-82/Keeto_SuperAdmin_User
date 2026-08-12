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
exports.rateOrder = exports.getCancelReasons = exports.cancelOrder = exports.getOrderPrerequisites = exports.getOrderDetails = exports.getOrderHistory = exports.getActiveOrders = exports.checkout = void 0;
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
const restaurantFeatures_1 = require("./restaurantFeatures");
const turf = __importStar(require("@turf/turf"));
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
// 🗓️ Helper لتحويل التاريخ لصيغة مقروءة وواضحة
const formatDate = (date) => {
    if (!date)
        return null;
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Cairo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    }).format(new Date(date));
};
//     if (!req.user) throw new UnauthorizedError("Unauthenticated");
//     const userId = req.user.id;
//     const { orderSource, paymentMethod, orderType, idempotencyKey, userZoneId, branchId, addressId, note, couponCode } = req.body;
//     // ==========================================
//     // 🛡️ 1. Validation (التحقق من المدخلات)
//     // ==========================================
//     const validOrderSources = ["online_order", "food_aggregator", "mykeeto", "pos"];
//     if (!validOrderSources.includes(orderSource)) {
//         throw new BadRequest("Invalid order source");
//     }
//     const [selectedPayment] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, paymentMethod)).limit(1);
//     if (!selectedPayment || !selectedPayment.isActive) {
//         throw new BadRequest("Invalid or inactive payment method");
//     }
//     const paymentMethodName = selectedPayment.name;
//     const paymentMethodNameAr = selectedPayment.nameAr;
//     const isWalletPayment = paymentMethodName === "wallet" || paymentMethodNameAr === "محفظتى";
//     const isCashPayment = paymentMethodName === "cash_on_delivery" || paymentMethodNameAr === "الدفع عند الاستلام" || paymentMethodName === "cash";
//     // ==========================================
//     // 2. Idempotency Check
//     // ==========================================
//     if (idempotencyKey) {
//         const [existing] = await db.select().from(orders).where(eq(orders.idempotencyKey, idempotencyKey)).limit(1);
//         if (existing) return SuccessResponse(res, { message: "Order already processed", data: existing });
//     }
//     // ==========================================
//     // 3. Get Cart Items
//     // ==========================================
//     const userCart = await db.select().from(cartItems).where(eq(cartItems.userId, userId));
//     if (!userCart.length) throw new BadRequest("Your cart is empty");
//     const restaurantId = userCart[0].restaurantId;
//     // ==========================================
//     // 4. Get Restaurant & Matching Business Plan
//     // ==========================================
//     const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
//     if (!restaurant) throw new BadRequest("Restaurant not found");
//     // ✅ جلب الخطة المطابقة لمصدر الطلب تحديداً
//     const [plan] = await db.select()
//         .from(restaurantBusinessPlans)
//         .where(
//             and(
//                 eq(restaurantBusinessPlans.restaurantId, restaurantId),
//                 eq(restaurantBusinessPlans.platformType, orderSource as any)
//             )
//         )
//         .limit(1);
//     // 🛑 التعديل هنا: منع الأوردر لأي مصدر (online_order أو غيره) لو ملوش خطة فعالة
//     if (!plan) {
//         throw new BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
//     }
//     // ==========================================
//     // 🛡️ 4.5 فحص مواعيد المطعم وإعدادات التشغيل
//     // ==========================================
//     const schedulesList = await db.select().from(restaurantSchedules).where(eq(restaurantSchedules.restaurantId, restaurantId));
//     const [settings] = await db.select().from(restaurantSettings).where(eq(restaurantSettings.restaurantId, restaurantId)).limit(1);
//     const resolvedOrderType = orderType || "delivery";
//     const now = new Date();
//     const cairoParts = new Intl.DateTimeFormat("en-US", {
//         timeZone: "Africa/Cairo",
//         year: "numeric", month: "2-digit", day: "2-digit",
//         hour: "2-digit", minute: "2-digit", hour12: false
//     }).formatToParts(now);
//     const getP = (type: string) => cairoParts.find(p => p.type === type)?.value || "00";
//     const cairoYear = getP("year");
//     const cairoMonth = getP("month");
//     const cairoDay = getP("day");
//     const cairoHour = getP("hour");
//     const cairoMinute = getP("minute");
//     const currentTimeStr = `${cairoHour === "24" ? "00" : cairoHour}:${cairoMinute}`;
//     const cairoDayOfWeek = new Date(`${cairoYear}-${cairoMonth}-${cairoDay}T12:00:00`).getDay();
//     const status = calculateCurrentStatus(settings, schedulesList);
//     if (!status.isOpenNow) {
//         throw new BadRequest(`Order failed. ${status.reason}`);
//     }
//     if (resolvedOrderType === "delivery" && !status.canDeliveryNow) {
//         throw new BadRequest("Order failed. Delivery service is currently disabled for this restaurant.");
//     }
//     if (resolvedOrderType === "takeaway" && !status.canTakeawayNow) {
//         throw new BadRequest("Order failed. Takeaway service is currently disabled for this restaurant.");
//     }
//     // ==========================================
//     // 5. Calculate Subtotal & Secure Variation Prices
//     // ==========================================
//     let subtotal = 0;
//     const itemsToInsert: any[] = [];
//     let initialSubtotal = 0;
//     const itemsWithData = [];
//     for (const item of userCart) {
//         const [foodItem] = await db.select().from(food).where(eq(food.id, item.foodId)).limit(1);
//         const originalBasePrice = parseFloat(foodItem.price as string || "0");
//         let safeVars = typeof item.variations === 'string' ? JSON.parse(item.variations) : item.variations;
//         if (typeof safeVars === 'string') safeVars = JSON.parse(safeVars);
//         const vars = Array.isArray(safeVars) ? safeVars : [];
//         let varPrice = 0;
//         for (const v of vars) {
//             if (v.optionId) {
//                 const [dbOption] = await db.select()
//                     .from(variationOptions) 
//                     .where(eq(variationOptions.id, v.optionId))
//                     .limit(1);
//                 if (dbOption) {
//                     const dbOptionPrice = parseFloat((dbOption.additionalPrice || "0") as string);
//                     varPrice += dbOptionPrice;
//                     v.additionalPrice = dbOptionPrice.toString(); 
//                 }
//             } else {
//                 varPrice += parseFloat(v.additionalPrice || v.price || v.amount || "0");
//             }
//         }
//         let initialDiscountPrice = originalBasePrice;
//         if (foodItem.discount_value && Number(foodItem.discount_value) > 0) {
//             if (foodItem.discount_type === "percentage") {
//                 initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(foodItem.discount_value) / 100));
//             } else if (foodItem.discount_type === "amount" || foodItem.discount_type === "fixed") {
//                 initialDiscountPrice = Math.max(0, originalBasePrice - Number(foodItem.discount_value));
//             }
//         }
//         initialSubtotal += (initialDiscountPrice + varPrice) * item.quantity;
//         itemsWithData.push({ cartItem: item, foodItem, originalBasePrice, varPrice, vars });
//     }
//     const availableDiscounts = await getAvailableDiscounts(restaurantId);
//     const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };
//     for (const data of itemsWithData) {
//         const { cartItem, foodItem, originalBasePrice, varPrice, vars } = data;
//         const { price: discountedBasePrice } = applyPriorityDiscount(
//             { id: foodItem.id, discountType: foodItem.discount_type, discountValue: foodItem.discount_value },
//             originalBasePrice,
//             initialSubtotal,
//             availableDiscounts,
//             discountState,
//             true
//         );
//         const itemTotal = (discountedBasePrice + varPrice) * cartItem.quantity;
//         subtotal += itemTotal;
//         itemsToInsert.push({
//             id: uuidv4(),
//             foodId: cartItem.foodId,
//             quantity: cartItem.quantity,
//             basePrice: discountedBasePrice.toString(),
//             variationsPrice: varPrice.toString(),
//             totalPrice: itemTotal.toString(),
//             variations: vars,
//             note: cartItem.note || null
//         });
//     }
//     // ==========================================
//     // ✅ 5.2 Calculate Fees & Commission based on Plan
//     // ==========================================
//     const serviceFee = parseFloat(plan.serviceFee as string || "0");
//     const commissionRate = parseFloat(plan.commissionRate as string || "0");
//     const appCommission = subtotal * (commissionRate / 100);
//     // ==========================================
//     // 5.5 Check Coupons 
//     // ==========================================
//     const nowTemp = new Date();
//     let totalDiscount = 0;
//     let appliedCoupon: any = null;
//     let isFreeDelivery = false;
//     if (couponCode) {
//         const [coupon] = await db.select().from(coupons).where(eq(coupons.code, couponCode)).limit(1);
//         if (!coupon || !coupon.isActive) throw new BadRequest("Invalid or inactive coupon");
//         if (coupon.startDate && new Date(coupon.startDate) > nowTemp) throw new BadRequest("Coupon not yet active");
//         if (coupon.endDate && new Date(coupon.endDate) < nowTemp) throw new BadRequest("Coupon expired");
//         if (coupon.usageLimit && coupon.usedCount! >= coupon.usageLimit) throw new BadRequest("Coupon usage limit reached");
//         if (parseFloat(coupon.minOrderAmount as string || "0") > subtotal) throw new BadRequest(`Minimum order amount of ${coupon.minOrderAmount} required for this coupon`);
//         if (!coupon.isGlobal) {
//             const [coupRest] = await db.select().from(couponRestaurants)
//                 .where(and(eq(couponRestaurants.couponId, coupon.id), eq(couponRestaurants.restaurantId, restaurantId))).limit(1);
//             if (!coupRest) throw new BadRequest("Coupon is not applicable to this restaurant");
//         }
//         if (coupon.perUserLimit) {
//             const usages = await db.select({ count: sql<number>`count(*)` }).from(couponUsages)
//                 .where(and(eq(couponUsages.couponId, coupon.id), eq(couponUsages.userId, userId)));
//             if (usages[0].count >= coupon.perUserLimit) throw new BadRequest("You have reached the usage limit for this coupon");
//         }
//         const value = parseFloat(coupon.discountValue as string);
//         if (coupon.discountType === "free_delivery") {
//             isFreeDelivery = true;
//         } else if (coupon.discountType === "fixed_amount") {
//             totalDiscount += value;
//         } else if (coupon.discountType === "percentage") {
//             let pDiscount = subtotal * (value / 100);
//             if (coupon.maxDiscount) {
//                 const max = parseFloat(coupon.maxDiscount as string);
//                 if (pDiscount > max) pDiscount = max;
//             }
//             totalDiscount += pDiscount;
//         }
//         appliedCoupon = coupon;
//     }
//     // ==========================================
//     // 6. Smart Delivery Logic
//     // ==========================================
//     let deliveryFee = 0;
//     if (resolvedOrderType === "delivery") {
//         if (!addressId) throw new BadRequest("Delivery address is required");
//         if (!branchId) throw new BadRequest("Branch is required for delivery orders");
//         const [userAddress] = await db.select().from(addresses)
//             .where(and(
//                 eq(addresses.id, addressId),
//                 eq(addresses.userId, userId)
//             )).limit(1);
//         if (!userAddress) throw new BadRequest("Invalid delivery address");
//         const [branch] = await db.select().from(branches)
//             .where(eq(branches.id, branchId)).limit(1);
//         if (!branch) throw new BadRequest("Invalid branch selected");
//         const resolvedZoneId = userZoneId || userAddress.zoneId;
//         const [selfFee] = await db.select().from(restaurantZoneDeliveryFees)
//             .where(and(
//                 eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
//                 eq(restaurantZoneDeliveryFees.zoneId, resolvedZoneId),
//                 eq(restaurantZoneDeliveryFees.status, "active")
//             )).limit(1);
//         if (!selfFee) throw new BadRequest("Restaurant does not deliver to your zone directly");
//         deliveryFee = parseFloat(selfFee.deliveryFee as string || "0");
//     }
//     if (isFreeDelivery) {
//         deliveryFee = 0;
//     }
//     let totalAmount = subtotal + deliveryFee + serviceFee - totalDiscount;
//     if (totalAmount < 0) totalAmount = 0;
//     const orderId = uuidv4();
//     const orderNumber = `ORD-${Date.now()}`;
//     // ==========================================
//     // 7. Get Customer Info
//     // ==========================================
//     const [userInfo] = await db.select({ id: users.id, name: users.name, phone: users.phone, email: users.email })
//         .from(users).where(eq(users.id, userId)).limit(1);
//     // ==========================================
//     // 🛡️ 8. فحص محفظة العميل
//     // ==========================================
//     let userWallet = null;
//     if (isWalletPayment) {
//         const walletResult = await db.select().from(userWallets).where(eq(userWallets.userId, userId)).limit(1);
//         userWallet = walletResult[0];
//         const currentBalance = parseFloat(userWallet?.balance as string || "0");
//         if (!userWallet || currentBalance < totalAmount) {
//             throw new BadRequest("Insufficient wallet balance");
//         }
//     }
//     // ==========================================
//     // 🛡️ 9. جلب محفظة المطعم 
//     // ==========================================
//     let [restaurantWallet] = await db.select().from(restaurantWallets).where(eq(restaurantWallets.restaurantId, restaurantId)).limit(1);
//     // ==========================================
//     // 10. Execute Order (Transaction)
//     // ==========================================
//     let shiftStartTime: Date;
//     if (settings && !settings.isAlwaysOpen) {
//         const todaySchedule = schedulesList.find(s => s.dayOfWeek === cairoDayOfWeek);
//         if (todaySchedule && todaySchedule.openingTime && !todaySchedule.isOffDay) {
//             if (currentTimeStr < todaySchedule.openingTime) {
//                 const yesterday = new Date(`${cairoYear}-${cairoMonth}-${cairoDay}T12:00:00`);
//                 yesterday.setDate(yesterday.getDate() - 1);
//                 const yDayOfWeek = yesterday.getDay();
//                 const yDateStr = yesterday.toISOString().slice(0, 10);
//                 const ySchedule = schedulesList.find(s => s.dayOfWeek === yDayOfWeek);
//                 const opTime = ySchedule?.openingTime || "00:00";
//                 shiftStartTime = new Date(`${yDateStr}T${opTime}:00+02:00`);
//             } else {
//                 shiftStartTime = new Date(`${cairoYear}-${cairoMonth}-${cairoDay}T${todaySchedule.openingTime}:00+02:00`);
//             }
//         } else {
//             shiftStartTime = new Date(`${cairoYear}-${cairoMonth}-${cairoDay}T00:00:00+02:00`);
//         }
//     } else {
//         shiftStartTime = new Date(`${cairoYear}-${cairoMonth}-${cairoDay}T00:00:00+02:00`);
//     }
//     const [ordersCountResult] = await db
//         .select({ count: sql<number>`count(${orders.id})` })
//         .from(orders)
//         .where(
//             and(
//                 eq(orders.restaurantId, restaurantId),
//                 gte(orders.createdAt, shiftStartTime)
//             )
//         );
//     const dailyOrderNumber = Number(ordersCountResult?.count || 0) + 1;
//     //----------------------------------------//
//     await db.transaction(async (tx) => {
//         if (isWalletPayment && userWallet) {
//             const balanceBefore = parseFloat(userWallet.balance as string);
//             const newBalance = balanceBefore - totalAmount;
//             await tx.update(userWallets)
//                 .set({ balance: newBalance.toString() })
//                 .where(eq(userWallets.userId, userId));
//             await tx.insert(userWalletTransactions).values({
//                 id: uuidv4(),
//                 userId,
//                 type: "debit",
//                 transactionType: "order_payment",
//                 amount: totalAmount.toString(),
//                 balanceBefore: balanceBefore.toString(),
//                 reference: orderNumber,
//                 status: "approved",
//                 createdAt: now
//             });
//         }
//         await tx.insert(orders).values({
//             id: orderId,
//             orderNumber,
//             idempotencyKey,
//             userId,
//             restaurantId,
//             branchId,
//             addressId: addressId || null,
//             orderSource,
//             paymentMethod, 
//             orderType: resolvedOrderType,
//             subtotal: subtotal.toString(),
//             deliveryFee: deliveryFee.toString(),
//             serviceFee: serviceFee.toString(),
//             appCommission: appCommission.toString(),
//             discountAmount: totalDiscount.toString(),
//             couponCode: couponCode || null,
//             totalAmount: totalAmount.toString(),
//             note: note || null,
//             status: "pending",
//             createdAt: now,
//             dailyOrderNumber
//         });
//         await tx.insert(orderItems).values(itemsToInsert.map(i => ({ ...i, orderId })));
//         await tx.delete(cartItems).where(eq(cartItems.userId, userId));
//         if (appliedCoupon) {
//             await tx.insert(couponUsages).values({
//                 id: uuidv4(),
//                 couponId: appliedCoupon.id,
//                 userId,
//                 orderId,
//                 discountAmount: appliedCoupon.discountType === "free_delivery" ? deliveryFee.toString() : appliedCoupon.discountType === "fixed_amount" ? appliedCoupon.discountValue.toString() : totalDiscount.toString()
//             });
//             await tx.update(coupons)
//                 .set({ usedCount: sql`used_count + 1` })
//                 .where(eq(coupons.id, appliedCoupon.id));
//         }
//         if (discountState.appliedDiscounts.size > 0) {
//             for (const dId of Array.from(discountState.appliedDiscounts)) {
//                 await tx.update(discounts)
//                     .set({ usedCount: sql`used_count + 1` })
//                     .where(eq(discounts.id, dId));
//             }
//         }
//         if (!restaurantWallet) {
//             await tx.insert(restaurantWallets).values({
//                 id: uuidv4(),
//                 restaurantId: restaurantId,
//                 balance: "0.00",
//                 collectedCash: "0.00",
//                 totalEarning: "0.00"
//             });
//             restaurantWallet = { balance: "0.00", collectedCash: "0.00", totalEarning: "0.00" } as any;
//         }
//         const currentRestBalance = parseFloat(restaurantWallet.balance as string);
//         const currentCollectedCash = parseFloat(restaurantWallet.collectedCash as string);
//         const currentTotalEarning = parseFloat(restaurantWallet.totalEarning as string);
//         const restaurantEarning = subtotal + deliveryFee - appCommission;
//         const appDues = appCommission + serviceFee;
//         let newRestBalance = currentRestBalance;
//         let newCollectedCash = currentCollectedCash;
//         if (isCashPayment) {
//             newRestBalance -= appDues;
//             newCollectedCash += totalAmount;
//         } else {
//             newRestBalance += restaurantEarning;
//         }
//         await tx.update(restaurantWallets)
//             .set({
//                 balance: newRestBalance.toString(),
//                 collectedCash: newCollectedCash.toString(),
//                 totalEarning: (currentTotalEarning + restaurantEarning).toString()
//             })
//             .where(eq(restaurantWallets.restaurantId, restaurantId));
//         const isCash = isCashPayment;
//         await tx.insert(restaurantWalletTransactions).values({
//             id: uuidv4(),
//             restaurantId,
//             type: "order_payment",
//             amount: isCash ? `-${appDues}` : `${restaurantEarning}`,
//             balanceBefore: currentRestBalance.toString(),
//             balanceAfter: newRestBalance.toString(),
//             method: paymentMethodName,
//             reference: orderNumber,
//             note: isCash ? "Commission deducted from cash order" : "Earnings added from digital payment",
//             createdAt: now
//         });
//     });
//     // ==========================================
//     // 11. Send Notification to Restaurant
//     // ==========================================
//     const cairoTimeFormatted = new Intl.DateTimeFormat("ar-EG", { timeZone: "Africa/Cairo", hour: "numeric", minute: "numeric", hour12: true }).format(now);
//     await sendPushNotification({
//         recipientType: "restaurant",
//         recipientId: restaurantId,
//         title: "طلب جديد! 🛒",
//         body: `تم استلام طلب جديد #${orderNumber} بقيمة ${totalAmount} ج.م الساعة ${cairoTimeFormatted}.`,
//         data: {
//             orderId,
//             orderNumber,
//             type: "new_order",
//             createdAt: now.toISOString(),
//             dailyOrderNumber
//         }
//     });
//     return SuccessResponse(res, {
//         message: "Order created successfully",
//         order_level: {
//             orderDetails: {
//                 orderId,
//                 orderNumber,
//                 subtotal,
//                 deliveryFee,
//                 serviceFee,
//                 discountAmount: totalDiscount,
//                 couponCode: couponCode || null,
//                 totalAmount,
//                 createdAt: now.toISOString(),
//                 dailyOrderNumber
//             },
//             customerDetails: userInfo
//         }
//     });
// };
// ==========================================
// 1. إنشاء الطلب (Checkout)
// ==========================================
// دالة مساعدة لضمان سلامة العمليات الحسابية المالية
const roundMoney = (amount) => Math.round(amount * 100) / 100;
const checkout = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderSource, paymentMethod, orderType, idempotencyKey, userZoneId, branchId, addressId, note, couponCode } = req.body;
    // ==========================================
    // 🛡️ 1. Validation
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
    // 4. Get Restaurant & Business Plan
    // ==========================================
    const [restaurant] = await connection_1.db.select().from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId)).limit(1);
    if (!restaurant)
        throw new BadRequest_1.BadRequest("Restaurant not found");
    const [plan] = await connection_1.db.select()
        .from(schema_1.restaurantBusinessPlans)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.platformType, orderSource)))
        .limit(1);
    if (!plan) {
        throw new BadRequest_1.BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }
    // ==========================================
    // 🛡️ 4.5 فحص مواعيد المطعم وإعدادات التشغيل
    // ==========================================
    const schedulesList = await connection_1.db.select().from(schema_1.restaurantSchedules).where((0, drizzle_orm_1.eq)(schema_1.restaurantSchedules.restaurantId, restaurantId));
    const [settings] = await connection_1.db.select().from(schema_1.restaurantSettings).where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId)).limit(1);
    const resolvedOrderType = orderType || "delivery";
    const status = (0, restaurantFeatures_1.calculateCurrentStatus)(settings, schedulesList);
    if (!status.isOpenNow)
        throw new BadRequest_1.BadRequest(`Order failed. ${status.reason}`);
    if (resolvedOrderType === "delivery" && !status.canDeliveryNow)
        throw new BadRequest_1.BadRequest("Order failed. Delivery service is currently disabled for this restaurant.");
    if (resolvedOrderType === "takeaway" && !status.canTakeawayNow)
        throw new BadRequest_1.BadRequest("Order failed. Takeaway service is currently disabled for this restaurant.");
    // ==========================================
    // ⚡ 5. Batch Fetching
    // ==========================================
    const foodIds = [...new Set(userCart.map(item => item.foodId))];
    const allOptionIds = [];
    const allAddonIds = [];
    userCart.forEach(item => {
        let safeVars = typeof item.variations === 'string' ? JSON.parse(item.variations) : item.variations;
        if (typeof safeVars === 'string')
            safeVars = JSON.parse(safeVars);
        let parsedVars = [];
        let parsedAddons = [];
        if (Array.isArray(safeVars)) {
            parsedVars = safeVars;
        }
        else if (safeVars && typeof safeVars === 'object') {
            parsedVars = Array.isArray(safeVars.variations) ? safeVars.variations : [];
            parsedAddons = Array.isArray(safeVars.addons) ? safeVars.addons : [];
        }
        let safeAddons = typeof item.addons === 'string' ? JSON.parse(item.addons) : item.addons;
        if (typeof safeAddons === 'string')
            safeAddons = JSON.parse(safeAddons);
        if (Array.isArray(safeAddons)) {
            parsedAddons = [...parsedAddons, ...safeAddons];
        }
        parsedVars.forEach((v) => { if (v.optionId)
            allOptionIds.push(v.optionId); });
        parsedAddons.forEach((a) => { if (a.addonId || a.id)
            allAddonIds.push(a.addonId || a.id); });
    });
    const [foodList, optionsList, addonsListDb] = await Promise.all([
        connection_1.db.select().from(schema_1.food).where((0, drizzle_orm_1.inArray)(schema_1.food.id, foodIds)),
        allOptionIds.length > 0
            ? connection_1.db.select().from(schema_1.variationOptions).where((0, drizzle_orm_1.inArray)(schema_1.variationOptions.id, [...new Set(allOptionIds)]))
            : [],
        allAddonIds.length > 0
            ? connection_1.db.select().from(schema_1.addons).where((0, drizzle_orm_1.inArray)(schema_1.addons.id, [...new Set(allAddonIds)]))
            : []
    ]);
    const foodMap = new Map(foodList.map(f => [f.id, f]));
    const optionsMap = new Map(optionsList.map(o => [o.id, o]));
    const addonsMap = new Map(addonsListDb.map(a => [a.id, a]));
    // ==========================================
    // 5.1 Calculate Subtotal, Variations & Addons
    // ==========================================
    let subtotal = 0;
    let initialSubtotal = 0;
    const itemsWithData = [];
    for (const item of userCart) {
        const foodItem = foodMap.get(item.foodId);
        if (!foodItem)
            throw new BadRequest_1.BadRequest(`Food item with ID ${item.foodId} not found`);
        const originalBasePrice = parseFloat(foodItem.price || "0");
        let safeVars = typeof item.variations === 'string' ? JSON.parse(item.variations) : item.variations;
        if (typeof safeVars === 'string')
            safeVars = JSON.parse(safeVars);
        let parsedVariations = [];
        let parsedAddons = [];
        if (Array.isArray(safeVars)) {
            parsedVariations = safeVars;
        }
        else if (safeVars && typeof safeVars === 'object') {
            parsedVariations = Array.isArray(safeVars.variations) ? safeVars.variations : [];
            parsedAddons = Array.isArray(safeVars.addons) ? safeVars.addons : [];
        }
        let safeAddons = typeof item.addons === 'string' ? JSON.parse(item.addons) : item.addons;
        if (typeof safeAddons === 'string')
            safeAddons = JSON.parse(safeAddons);
        if (Array.isArray(safeAddons)) {
            parsedAddons = [...parsedAddons, ...safeAddons];
        }
        let varPrice = 0;
        for (const v of parsedVariations) {
            if (v.optionId) {
                const dbOption = optionsMap.get(v.optionId);
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
        for (const a of parsedAddons) {
            const addonId = a.addonId || a.id;
            const dbAddon = addonsMap.get(addonId);
            if (dbAddon) {
                const dbAddonPrice = parseFloat((dbAddon.price || "0"));
                varPrice += dbAddonPrice;
                a.price = dbAddonPrice.toString();
            }
            else {
                varPrice += parseFloat(a.price || "0");
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
        itemsWithData.push({ cartItem: item, foodItem, originalBasePrice, varPrice, vars: parsedVariations, addonsList: parsedAddons });
    }
    const availableDiscounts = await (0, discount_1.getAvailableDiscounts)(restaurantId);
    const discountState = { remainingMaxDiscounts: new Map(), appliedDiscounts: new Set() };
    const itemsToInsert = [];
    for (const data of itemsWithData) {
        const { cartItem, foodItem, originalBasePrice, varPrice, vars } = data;
        const { price: discountedBasePrice } = (0, discount_1.applyPriorityDiscount)({ id: foodItem.id, discountType: foodItem.discount_type, discountValue: foodItem.discount_value }, originalBasePrice, initialSubtotal, availableDiscounts, discountState, true);
        const itemTotal = roundMoney((discountedBasePrice + varPrice) * cartItem.quantity);
        subtotal += itemTotal;
        itemsToInsert.push({
            id: (0, uuid_1.v4)(),
            foodId: cartItem.foodId,
            quantity: cartItem.quantity,
            basePrice: discountedBasePrice.toFixed(2),
            variationsPrice: varPrice.toFixed(2),
            totalPrice: itemTotal.toFixed(2),
            variations: vars,
            note: cartItem.note || null
        });
    }
    subtotal = roundMoney(subtotal);
    // ==========================================
    // 5.2 Fees & Commission
    // ==========================================
    const serviceFee = parseFloat(plan.serviceFee || "0");
    const commissionRate = parseFloat(plan.commissionRate || "0");
    const appCommission = roundMoney(subtotal * (commissionRate / 100));
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
    totalDiscount = roundMoney(totalDiscount);
    // ==========================================
    // 6. Dynamic Delivery & Turf Zone Logic
    // ==========================================
    let deliveryFee = 0;
    let resolvedZoneId = userZoneId || null;
    if (resolvedOrderType === "delivery") {
        if (!addressId)
            throw new BadRequest_1.BadRequest("Delivery address is required");
        const [userAddress] = await connection_1.db.select().from(schema_1.addresses)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId), (0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId))).limit(1);
        if (!userAddress)
            throw new BadRequest_1.BadRequest("Invalid delivery address");
        // Fallback to address zone ID if not explicitly passed in req.body
        if (!resolvedZoneId) {
            resolvedZoneId = userAddress.zoneId || null;
        }
        // 🟢 Spatial Zone Lookup via Turf.js if zone ID is missing
        if (!resolvedZoneId) {
            const lat = parseFloat(userAddress.lat || "0");
            const lng = parseFloat(userAddress.lng || "0");
            if (!lat || !lng) {
                throw new BadRequest_1.BadRequest("Delivery address requires valid latitude and longitude coordinates.");
            }
            const userPoint = turf.point([lng, lat]); // GeoJSON expects [longitude, latitude]
            // Fetch active delivery zones
            const activeZones = await connection_1.db.select().from(schema_1.zones).where((0, drizzle_orm_1.eq)(schema_1.zones.status, "active"));
            for (const zone of activeZones) {
                if (!zone.coordinates)
                    continue;
                let parsedGeoJson = typeof zone.coordinates === "string"
                    ? JSON.parse(zone.coordinates)
                    : zone.coordinates;
                // Handle nested FeatureCollection or direct Geometry
                let polygonGeom = parsedGeoJson;
                if (parsedGeoJson.type === "FeatureCollection" && parsedGeoJson.features?.[0]) {
                    polygonGeom = parsedGeoJson.features[0].geometry;
                }
                else if (parsedGeoJson.type === "Feature") {
                    polygonGeom = parsedGeoJson.geometry;
                }
                if (polygonGeom && (polygonGeom.type === "Polygon" || polygonGeom.type === "MultiPolygon")) {
                    const zonePolygon = turf.polygon(polygonGeom.coordinates);
                    if (turf.booleanPointInPolygon(userPoint, zonePolygon)) {
                        resolvedZoneId = zone.id;
                        break;
                    }
                }
            }
        }
        if (!resolvedZoneId) {
            throw new BadRequest_1.BadRequest("Your delivery address is outside our covered delivery zones.");
        }
        // Fetch restaurant delivery fee for the resolved zone
        const [selfFee] = await connection_1.db.select().from(schema_1.restaurantZoneDeliveryFees)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.zoneId, resolvedZoneId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.status, "active"))).limit(1);
        if (!selfFee)
            throw new BadRequest_1.BadRequest("Restaurant does not deliver to your zone directly");
        deliveryFee = parseFloat(selfFee.deliveryFee || "0");
    }
    if (isFreeDelivery)
        deliveryFee = 0;
    let totalAmount = roundMoney(subtotal + deliveryFee + serviceFee - totalDiscount);
    if (totalAmount < 0)
        totalAmount = 0;
    const orderId = (0, uuid_1.v4)();
    const orderNumber = `ORD-${Date.now()}`;
    const [userInfo] = await connection_1.db.select({ id: schema_1.users.id, name: schema_1.users.name, phone: schema_1.users.phone, email: schema_1.users.email })
        .from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, userId)).limit(1);
    // ==========================================
    // 🛡️ 10. Execute Order (Transaction)
    // ==========================================
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    let createdDailyOrderNumber = 1;
    await connection_1.db.transaction(async (tx) => {
        // 🔒 1. Wallet deduction with FOR UPDATE
        if (isWalletPayment) {
            const [userWallet] = await tx.select()
                .from(schema_1.userWallets)
                .where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId))
                .for("update");
            const currentBalance = parseFloat(userWallet?.balance || "0");
            if (!userWallet || currentBalance < totalAmount) {
                throw new BadRequest_1.BadRequest("Insufficient wallet balance");
            }
            const newBalance = roundMoney(currentBalance - totalAmount);
            await tx.update(schema_1.userWallets)
                .set({ balance: newBalance.toFixed(2) })
                .where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId));
            await tx.insert(schema_1.userWalletTransactions).values({
                id: (0, uuid_1.v4)(),
                userId,
                type: "debit",
                transactionType: "order_payment",
                amount: totalAmount.toFixed(2),
                balanceBefore: currentBalance.toFixed(2),
                reference: orderNumber,
                status: "approved",
                createdAt: now
            });
        }
        // 🔒 2. Daily order number calculation
        const [ordersCountResult] = await tx
            .select({ count: (0, drizzle_orm_1.sql) `count(${schema_1.orders.id})` })
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId), (0, drizzle_orm_1.gte)(schema_1.orders.createdAt, startOfToday)));
        createdDailyOrderNumber = Number(ordersCountResult?.count || 0) + 1;
        // 3. Create order record
        await tx.insert(schema_1.orders).values({
            id: orderId,
            orderNumber,
            idempotencyKey,
            userId,
            restaurantId,
            branchId,
            // zoneId: resolvedZoneId,
            addressId: addressId || null,
            orderSource,
            paymentMethod,
            orderType: resolvedOrderType,
            subtotal: subtotal.toFixed(2),
            deliveryFee: deliveryFee.toFixed(2),
            serviceFee: serviceFee.toFixed(2),
            appCommission: appCommission.toFixed(2),
            discountAmount: totalDiscount.toFixed(2),
            couponCode: couponCode || null,
            totalAmount: totalAmount.toFixed(2),
            note: note || null,
            status: "pending",
            dailyOrderNumber: createdDailyOrderNumber,
            createdAt: now
        });
        await tx.insert(schema_1.orderItems).values(itemsToInsert.map(i => ({ ...i, orderId })));
        await tx.delete(schema_1.cartItems).where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId));
        // Superadmin notification
        await tx.insert(schema_1.notifications).values({
            recipientType: "superadmin",
            recipientId: "superadmin",
            title: "New Order",
            body: `Order #${orderNumber} has been placed.`,
            data: { orderId, orderNumber }
        });
        // 4. Coupons and Discounts tracking
        if (appliedCoupon) {
            await tx.insert(schema_1.couponUsages).values({
                id: (0, uuid_1.v4)(),
                couponId: appliedCoupon.id,
                userId,
                orderId,
                discountAmount: appliedCoupon.discountType === "free_delivery"
                    ? deliveryFee.toFixed(2)
                    : appliedCoupon.discountType === "fixed_amount"
                        ? appliedCoupon.discountValue.toString()
                        : totalDiscount.toFixed(2)
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
        // 5. Restaurant wallet calculations
        let [restaurantWallet] = await tx.select().from(schema_1.restaurantWallets).where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId)).for("update");
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
        const restaurantEarning = roundMoney(subtotal + deliveryFee - appCommission);
        const appDues = roundMoney(appCommission + serviceFee);
        let newRestBalance = currentRestBalance;
        let newCollectedCash = currentCollectedCash;
        if (isCashPayment) {
            newRestBalance = roundMoney(newRestBalance - appDues);
            newCollectedCash = roundMoney(newCollectedCash + totalAmount);
        }
        else {
            newRestBalance = roundMoney(newRestBalance + restaurantEarning);
        }
        await tx.update(schema_1.restaurantWallets)
            .set({
            balance: newRestBalance.toFixed(2),
            collectedCash: newCollectedCash.toFixed(2),
            totalEarning: roundMoney(currentTotalEarning + restaurantEarning).toFixed(2)
        })
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId));
        await tx.insert(schema_1.restaurantWalletTransactions).values({
            id: (0, uuid_1.v4)(),
            restaurantId,
            type: "order_payment",
            amount: isCashPayment ? `-${appDues.toFixed(2)}` : `${restaurantEarning.toFixed(2)}`,
            balanceBefore: currentRestBalance.toFixed(2),
            balanceAfter: newRestBalance.toFixed(2),
            method: paymentMethodName,
            reference: orderNumber,
            note: isCashPayment ? "Commission deducted from cash order" : "Earnings added from digital payment",
            createdAt: now
        });
    });
    // ==========================================
    // 11. Send Notification to Restaurant
    // ==========================================
    const cairoTimeFormatted = new Intl.DateTimeFormat("ar-EG", {
        timeZone: "Africa/Cairo",
        hour: "numeric",
        minute: "numeric",
        hour12: true
    }).format(now);
    await (0, notifications_1.sendPushNotification)({
        recipientType: "restaurant",
        recipientId: restaurantId,
        title: "طلب جديد! 🛒",
        body: `تم استلام طلب جديد #${createdDailyOrderNumber} بقيمة ${totalAmount} ج.م الساعة ${cairoTimeFormatted}.`,
        data: {
            orderId,
            orderNumber,
            type: "new_order",
            createdAt: now.toISOString(),
            dailyOrderNumber: createdDailyOrderNumber
        }
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Order created successfully",
        order_level: {
            orderDetails: {
                orderId,
                orderNumber,
                zoneId: resolvedZoneId,
                subtotal,
                deliveryFee,
                serviceFee,
                discountAmount: totalDiscount,
                couponCode: couponCode || null,
                totalAmount,
                createdAt: now.toISOString(),
                dailyOrderNumber: createdDailyOrderNumber
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
        dailyOrderNumber: schema_1.orders.dailyOrderNumber,
        orderType: schema_1.orders.orderType,
        restaurantName: schema_1.restaurants.name,
        restaurantImage: schema_1.restaurants.logo,
        totalAmount: schema_1.orders.totalAmount,
        status: schema_1.orders.status,
        createdAt: schema_1.orders.createdAt,
        itemsCount: (0, drizzle_orm_1.sql) `(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${schema_1.orders.id})`,
        // Branch info (for takeaway / dine_in)
        branchName: schema_1.branches.name,
        // Address info (for delivery)
        addressTitle: schema_1.addresses.title,
        addressStreet: schema_1.addresses.street,
        addressLandmark: schema_1.addresses.landmark,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.branches, (0, drizzle_orm_1.eq)(schema_1.orders.branchId, schema_1.branches.id))
        .leftJoin(schema_1.addresses, (0, drizzle_orm_1.eq)(schema_1.orders.addressId, schema_1.addresses.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), restaurantId ? (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, String(restaurantId)) : undefined, (0, drizzle_orm_1.inArray)(schema_1.orders.status, ["pending", "accepted", "preparing", "out_for_delivery"])))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.orders.createdAt));
    // Return branch name or address depending on orderType
    const formatted = activeOrders.map(o => ({
        orderId: o.orderId,
        orderNumber: o.orderNumber,
        dailyOrderNumber: o.dailyOrderNumber,
        orderType: o.orderType,
        restaurantName: o.restaurantName,
        restaurantImage: o.restaurantImage,
        totalAmount: o.totalAmount,
        status: o.status,
        createdAt: formatDate(o.createdAt),
        itemsCount: o.itemsCount,
        location: o.orderType === "delivery"
            ? { type: "address", title: o.addressTitle, street: o.addressStreet, landmark: o.addressLandmark }
            : { type: "branch", name: o.branchName },
    }));
    return (0, response_1.SuccessResponse)(res, { data: formatted });
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
        dailyOrderNumber: schema_1.orders.dailyOrderNumber,
        orderType: schema_1.orders.orderType,
        restaurantName: schema_1.restaurants.name,
        restaurantImage: schema_1.restaurants.logo,
        totalAmount: schema_1.orders.totalAmount,
        status: schema_1.orders.status,
        createdAt: schema_1.orders.createdAt,
        rating: schema_1.orders.rating,
        ratingComment: schema_1.orders.ratingComment,
        itemsCount: (0, drizzle_orm_1.sql) `(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${schema_1.orders.id})`,
        // Branch info (for takeaway / dine_in)
        branchName: schema_1.branches.name,
        // Address info (for delivery)
        addressTitle: schema_1.addresses.title,
        addressStreet: schema_1.addresses.street,
        addressLandmark: schema_1.addresses.landmark,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.branches, (0, drizzle_orm_1.eq)(schema_1.orders.branchId, schema_1.branches.id))
        .leftJoin(schema_1.addresses, (0, drizzle_orm_1.eq)(schema_1.orders.addressId, schema_1.addresses.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), restaurantId ? (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, String(restaurantId)) : undefined, (0, drizzle_orm_1.inArray)(schema_1.orders.status, ["delivered", "cancelled", "refund"])))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.orders.createdAt));
    // Return branch name or address depending on orderType
    const formatted = historyOrders.map(o => ({
        orderId: o.orderId,
        orderNumber: o.orderNumber,
        dailyOrderNumber: o.dailyOrderNumber,
        orderType: o.orderType,
        restaurantName: o.restaurantName,
        restaurantImage: o.restaurantImage,
        totalAmount: o.totalAmount,
        status: o.status,
        createdAt: formatDate(o.createdAt),
        rating: o.rating,
        ratingComment: o.ratingComment,
        itemsCount: o.itemsCount,
        location: o.orderType === "delivery"
            ? { type: "address", title: o.addressTitle, street: o.addressStreet, landmark: o.addressLandmark }
            : { type: "branch", name: o.branchName },
    }));
    return (0, response_1.SuccessResponse)(res, { data: formatted });
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
        dailyOrderNumber: schema_1.orders.dailyOrderNumber,
        status: schema_1.orders.status,
        createdAt: schema_1.orders.createdAt,
        paymentMethod: schema_1.orders.paymentMethod,
        paymentMethodDetails: {
            id: schema_1.paymentMethods.id,
            name: schema_1.paymentMethods.name,
            nameAr: schema_1.paymentMethods.nameAr,
        },
        orderType: schema_1.orders.orderType,
        subtotal: schema_1.orders.subtotal,
        deliveryFee: schema_1.orders.deliveryFee,
        serviceFee: schema_1.orders.serviceFee,
        discountAmount: schema_1.orders.discountAmount,
        couponCode: schema_1.orders.couponCode,
        totalAmount: schema_1.orders.totalAmount,
        note: schema_1.orders.note,
        rating: schema_1.orders.rating,
        ratingComment: schema_1.orders.ratingComment,
        restaurantName: schema_1.restaurants.name,
        restaurantImage: schema_1.restaurants.logo,
        // Branch (takeaway / dine_in)
        branchId: schema_1.branches.id,
        branchName: schema_1.branches.name,
        branchAddress: schema_1.branches.address,
        // Address (delivery)
        addressId: schema_1.addresses.id,
        addressTitle: schema_1.addresses.title,
        addressStreet: schema_1.addresses.street,
        addressLandmark: schema_1.addresses.landmark,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.paymentMethods, (0, drizzle_orm_1.eq)(schema_1.orders.paymentMethod, schema_1.paymentMethods.id))
        .leftJoin(schema_1.branches, (0, drizzle_orm_1.eq)(schema_1.orders.branchId, schema_1.branches.id))
        .leftJoin(schema_1.addresses, (0, drizzle_orm_1.eq)(schema_1.orders.addressId, schema_1.addresses.id))
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId))
        .limit(1);
    if (!orderInfo.length) {
        throw new NotFound_1.NotFound("Order not found");
    }
    const o = orderInfo[0];
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
            orderId: o.orderId,
            orderNumber: o.orderNumber,
            dailyOrderNumber: o.dailyOrderNumber,
            status: o.status,
            orderType: o.orderType,
            createdAt: formatDate(o.createdAt),
            paymentMethod: o.paymentMethod,
            paymentMethodDetails: o.paymentMethodDetails,
            subtotal: o.subtotal,
            deliveryFee: o.deliveryFee,
            serviceFee: o.serviceFee,
            discountAmount: o.discountAmount,
            couponCode: o.couponCode,
            totalAmount: o.totalAmount,
            note: o.note,
            rating: o.rating,
            ratingComment: o.ratingComment,
            restaurantName: o.restaurantName,
            restaurantImage: o.restaurantImage,
            location: o.orderType === "delivery"
                ? {
                    type: "address",
                    id: o.addressId,
                    title: o.addressTitle,
                    street: o.addressStreet,
                    landmark: o.addressLandmark,
                }
                : {
                    type: "branch",
                    id: o.branchId,
                    name: o.branchName,
                    address: o.branchAddress,
                },
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
    const orderSource = req.query.orderSource;
    const validOrderSources = ["online_order", "food_aggregator", "mykeeto", "pos"];
    if (!validOrderSources.includes(orderSource)) {
        throw new BadRequest_1.BadRequest("Invalid order source");
    }
    if (!restaurantId) {
        throw new BadRequest_1.BadRequest("restaurantId is required");
    }
    // جلب البيانات المطلوبة من الداتا بيز
    const [userAddresses, restaurantBranches, zoneFees] = await Promise.all([
        // أ) عناوين اليوزر 
        connection_1.db.select().from(schema_1.addresses).where((0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId)),
        // ب) فروع المطعم
        connection_1.db.select().from(schema_1.branches).where((0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId)),
        // ج) رسوم توصيل المناطق الخاصة بالمطعم
        connection_1.db.select().from(schema_1.restaurantZoneDeliveryFees).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.status, "active"))),
    ]);
    // دمج معلومات التوصيل والرسوم مع كل عنوان
    const zoneFeeMap = new Map();
    zoneFees.forEach((fee) => {
        zoneFeeMap.set(fee.zoneId, parseFloat((fee.deliveryFee || "0")));
    });
    const addressesWithDeliveryInfo = userAddresses.map((addr) => {
        const isDeliverable = addr.zoneId ? zoneFeeMap.has(addr.zoneId) : false;
        return {
            ...addr,
            isDeliverable,
            deliveryFee: isDeliverable && addr.zoneId ? zoneFeeMap.get(addr.zoneId) : null,
        };
    });
    // د) طرق الدفع 
    const activePaymentMethods = await connection_1.db.select({
        id: schema_1.paymentMethods.id,
        name: schema_1.paymentMethods.name,
        nameAr: schema_1.paymentMethods.nameAr
    }).from(schema_1.paymentMethods).where((0, drizzle_orm_1.eq)(schema_1.paymentMethods.isActive, true));
    const getCancelReasons = await connection_1.db.select().from(schema_1.selectReasons).where((0, drizzle_orm_1.eq)(schema_1.selectReasons.type, "user"));
    const [plan] = await connection_1.db.select({ serviceFee: schema_1.restaurantBusinessPlans.serviceFee })
        .from(schema_1.restaurantBusinessPlans)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.platformType, orderSource)))
        .limit(1);
    if (!plan) {
        throw new BadRequest_1.BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }
    const serviceFee = parseFloat(plan.serviceFee || "0");
    // تجميع الداتا وإرسالها
    return (0, response_1.SuccessResponse)(res, {
        data: {
            addresses: addressesWithDeliveryInfo,
            branches: restaurantBranches,
            paymentMethods: activePaymentMethods,
            reasons: getCancelReasons,
            serviceFee: serviceFee.toFixed(2),
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
// ==========================================
// 7. Get Cancel Reasons
// ==========================================
const getCancelReasons = async (req, res) => {
    const cancelReasons = await connection_1.db
        .select()
        .from(schema_1.selectReasons)
        .where((0, drizzle_orm_1.eq)(schema_1.selectReasons.type, "user"));
    return (0, response_1.SuccessResponse)(res, { data: cancelReasons });
};
exports.getCancelReasons = getCancelReasons;
// ==========================================
// 8. Rate Order (User)
// ==========================================
const rateOrder = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;
    const { rating, comment } = req.body;
    if (!rating) {
        throw new BadRequest_1.BadRequest("Rating is required");
    }
    if (typeof rating !== "number" || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        throw new BadRequest_1.BadRequest("Rating must be an integer between 1 and 5");
    }
    const [order] = await connection_1.db
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId), (0, drizzle_orm_1.eq)(schema_1.orders.userId, userId)))
        .limit(1);
    if (!order) {
        throw new NotFound_1.NotFound("Order not found");
    }
    if (order.status !== "delivered") {
        throw new BadRequest_1.BadRequest("Only delivered orders can be rated");
    }
    await connection_1.db
        .update(schema_1.orders)
        .set({
        rating,
        ratingComment: comment ?? null,
        updatedAt: new Date()
    })
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
    return (0, response_1.SuccessResponse)(res, {
        message: "Order rated successfully",
        data: {
            orderId,
            rating,
            ratingComment: comment ?? null,
        }
    });
};
exports.rateOrder = rateOrder;
