// controllers/user/OrderController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    restaurantWallets, restaurantWalletTransactions,
    restaurantZoneDeliveryFees, zoneDeliveryFees, restaurantSettings,
    restaurantSchedules, cartItems, users, addresses, branches,
    userWallets, userWalletTransactions, paymentMethods,
    coupons, couponUsages, couponRestaurants, discounts, discountRestaurants, discountFoods,
    selectReasons,
    orders,
    restaurants,
    orderItems,
    notifications,
    restaurantBusinessPlans, food,
    variationOptions
} from "../../models/schema";
import { eq, and, inArray, sql, desc, gte } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";
import { UnauthorizedError } from "../../Errors";
import { sendPushNotification } from "../../utils/notifications";
import { calculateDistance } from "../../utils/geo";
import { getAvailableDiscounts, applyPriorityDiscount } from "../../utils/discount";
import { calculateCurrentStatus } from "./restaurantFeatures";

// 👇 1. دالة تظبيط الوقت لتوقيت مصر عشان نص الإشعار
const formatToEgyptTime = (date: Date) => {
    return new Intl.DateTimeFormat("ar-EG", { // غيرتها لـ ar-EG عشان تطلع بالعربي لو حابة
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
const formatDate = (date: Date | null | undefined): string | null => {
    if (!date) return null;
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

const roundMoney = (amount: number): number => Math.round(amount * 100) / 100;
export const checkout = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;

    const { orderSource, paymentMethod, orderType, idempotencyKey, userZoneId, branchId, addressId, note, couponCode } = req.body;

    // ==========================================
    // 🛡️ 1. Validation
    // ==========================================
    const validOrderSources = ["online_order", "food_aggregator", "mykeeto", "pos"];
    if (!validOrderSources.includes(orderSource)) {
        throw new BadRequest("Invalid order source");
    }

    const [selectedPayment] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, paymentMethod)).limit(1);
    if (!selectedPayment || !selectedPayment.isActive) {
        throw new BadRequest("Invalid or inactive payment method");
    }
    const paymentMethodName = selectedPayment.name;
    const paymentMethodNameAr = selectedPayment.nameAr;
    const isWalletPayment = paymentMethodName === "wallet" || paymentMethodNameAr === "محفظتى";
    const isCashPayment = paymentMethodName === "cash_on_delivery" || paymentMethodNameAr === "الدفع عند الاستلام" || paymentMethodName === "cash";

    // ==========================================
    // 2. Idempotency Check
    // ==========================================
    if (idempotencyKey) {
        const [existing] = await db.select().from(orders).where(eq(orders.idempotencyKey, idempotencyKey)).limit(1);
        if (existing) return SuccessResponse(res, { message: "Order already processed", data: existing });
    }

    // ==========================================
    // 3. Get Cart Items
    // ==========================================
    const userCart = await db.select().from(cartItems).where(eq(cartItems.userId, userId));
    if (!userCart.length) throw new BadRequest("Your cart is empty");

    const restaurantId = userCart[0].restaurantId;

    // ==========================================
    // 4. Get Restaurant & Business Plan
    // ==========================================
    const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
    if (!restaurant) throw new BadRequest("Restaurant not found");

    const [plan] = await db.select()
        .from(restaurantBusinessPlans)
        .where(
            and(
                eq(restaurantBusinessPlans.restaurantId, restaurantId),
                eq(restaurantBusinessPlans.platformType, orderSource as any)
            )
        )
        .limit(1);

    if (!plan) {
        throw new BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }

    // ==========================================
    // 🛡️ 4.5 فحص مواعيد المطعم وإعدادات التشغيل
    // ==========================================
    const schedulesList = await db.select().from(restaurantSchedules).where(eq(restaurantSchedules.restaurantId, restaurantId));
    const [settings] = await db.select().from(restaurantSettings).where(eq(restaurantSettings.restaurantId, restaurantId)).limit(1);

    const resolvedOrderType = orderType || "delivery";
    const status = calculateCurrentStatus(settings, schedulesList);

    if (!status.isOpenNow) throw new BadRequest(`Order failed. ${status.reason}`);
    if (resolvedOrderType === "delivery" && !status.canDeliveryNow) throw new BadRequest("Order failed. Delivery service is currently disabled for this restaurant.");
    if (resolvedOrderType === "takeaway" && !status.canTakeawayNow) throw new BadRequest("Order failed. Takeaway service is currently disabled for this restaurant.");

    // ==========================================
    // ⚡ 5. Batch Fetching (حل مشكلة N+1 Queries)
    // ==========================================
    const foodIds = [...new Set(userCart.map(item => item.foodId))];

    // استخراج جميع الـ optionIds الموجودة بالخيارات
    const allOptionIds: string[] = [];
    userCart.forEach(item => {
        let safeVars = typeof item.variations === 'string' ? JSON.parse(item.variations) : item.variations;
        if (typeof safeVars === 'string') safeVars = JSON.parse(safeVars);
        const vars = Array.isArray(safeVars) ? safeVars : [];
        vars.forEach((v: any) => { if (v.optionId) allOptionIds.push(v.optionId); });
    });

    // جلب البيانات دفعة واحدة بدلاً من اللوب
    const [foodList, optionsList] = await Promise.all([
        db.select().from(food).where(inArray(food.id, foodIds)),
        allOptionIds.length > 0
            ? db.select().from(variationOptions).where(inArray(variationOptions.id, [...new Set(allOptionIds)]))
            : []
    ]);

    const foodMap = new Map(foodList.map(f => [f.id, f]));
    const optionsMap = new Map(optionsList.map(o => [o.id, o]));

    // ==========================================
    // 5.1 Calculate Subtotal & Variations
    // ==========================================
    let subtotal = 0;
    let initialSubtotal = 0;
    const itemsWithData = [];

    for (const item of userCart) {
        const foodItem = foodMap.get(item.foodId);
        if (!foodItem) throw new BadRequest(`Food item with ID ${item.foodId} not found`);

        const originalBasePrice = parseFloat(foodItem.price as string || "0");
        let safeVars = typeof item.variations === 'string' ? JSON.parse(item.variations) : item.variations;
        if (typeof safeVars === 'string') safeVars = JSON.parse(safeVars);
        const vars = Array.isArray(safeVars) ? safeVars : [];

        let varPrice = 0;
        for (const v of vars) {
            if (v.optionId) {
                const dbOption = optionsMap.get(v.optionId);
                if (dbOption) {
                    const dbOptionPrice = parseFloat((dbOption.additionalPrice || "0") as string);
                    varPrice += dbOptionPrice;
                    v.additionalPrice = dbOptionPrice.toString();
                }
            } else {
                varPrice += parseFloat(v.additionalPrice || v.price || v.amount || "0");
            }
        }

        let initialDiscountPrice = originalBasePrice;
        if (foodItem.discount_value && Number(foodItem.discount_value) > 0) {
            if (foodItem.discount_type === "percentage") {
                initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(foodItem.discount_value) / 100));
            } else if (foodItem.discount_type === "amount" || foodItem.discount_type === "fixed") {
                initialDiscountPrice = Math.max(0, originalBasePrice - Number(foodItem.discount_value));
            }
        }

        initialSubtotal += (initialDiscountPrice + varPrice) * item.quantity;
        itemsWithData.push({ cartItem: item, foodItem, originalBasePrice, varPrice, vars });
    }

    const availableDiscounts = await getAvailableDiscounts(restaurantId);
    const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };
    const itemsToInsert: any[] = [];

    for (const data of itemsWithData) {
        const { cartItem, foodItem, originalBasePrice, varPrice, vars } = data;

        const { price: discountedBasePrice } = applyPriorityDiscount(
            { id: foodItem.id, discountType: foodItem.discount_type, discountValue: foodItem.discount_value },
            originalBasePrice,
            initialSubtotal,
            availableDiscounts,
            discountState,
            true
        );

        const itemTotal = roundMoney((discountedBasePrice + varPrice) * cartItem.quantity);
        subtotal += itemTotal;

        itemsToInsert.push({
            id: uuidv4(),
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
    const serviceFee = parseFloat(plan.serviceFee as string || "0");
    const commissionRate = parseFloat(plan.commissionRate as string || "0");
    const appCommission = roundMoney(subtotal * (commissionRate / 100));

    // ==========================================
    // 5.5 Check Coupons
    // ==========================================
    const nowTemp = new Date();
    let totalDiscount = 0;
    let appliedCoupon: any = null;
    let isFreeDelivery = false;

    if (couponCode) {
        const [coupon] = await db.select().from(coupons).where(eq(coupons.code, couponCode)).limit(1);
        if (!coupon || !coupon.isActive) throw new BadRequest("Invalid or inactive coupon");

        if (coupon.startDate && new Date(coupon.startDate) > nowTemp) throw new BadRequest("Coupon not yet active");
        if (coupon.endDate && new Date(coupon.endDate) < nowTemp) throw new BadRequest("Coupon expired");

        if (coupon.usageLimit && coupon.usedCount! >= coupon.usageLimit) throw new BadRequest("Coupon usage limit reached");
        if (parseFloat(coupon.minOrderAmount as string || "0") > subtotal) throw new BadRequest(`Minimum order amount of ${coupon.minOrderAmount} required for this coupon`);

        if (!coupon.isGlobal) {
            const [coupRest] = await db.select().from(couponRestaurants)
                .where(and(eq(couponRestaurants.couponId, coupon.id), eq(couponRestaurants.restaurantId, restaurantId))).limit(1);
            if (!coupRest) throw new BadRequest("Coupon is not applicable to this restaurant");
        }

        if (coupon.perUserLimit) {
            const usages = await db.select({ count: sql<number>`count(*)` }).from(couponUsages)
                .where(and(eq(couponUsages.couponId, coupon.id), eq(couponUsages.userId, userId)));
            if (usages[0].count >= coupon.perUserLimit) throw new BadRequest("You have reached the usage limit for this coupon");
        }

        const value = parseFloat(coupon.discountValue as string);
        if (coupon.discountType === "free_delivery") {
            isFreeDelivery = true;
        } else if (coupon.discountType === "fixed_amount") {
            totalDiscount += value;
        } else if (coupon.discountType === "percentage") {
            let pDiscount = subtotal * (value / 100);
            if (coupon.maxDiscount) {
                const max = parseFloat(coupon.maxDiscount as string);
                if (pDiscount > max) pDiscount = max;
            }
            totalDiscount += pDiscount;
        }

        appliedCoupon = coupon;
    }

    totalDiscount = roundMoney(totalDiscount);

    // ==========================================
    // 6. Delivery Logic
    // ==========================================
    let deliveryFee = 0;

    if (resolvedOrderType === "delivery") {
        if (!addressId) throw new BadRequest("Delivery address is required");
        // if (!branchId) throw new BadRequest("Branch is required for delivery orders");

        const [userAddress] = await db.select().from(addresses)
            .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId))).limit(1);
        if (!userAddress) throw new BadRequest("Invalid delivery address");

        // const [branch] = await db.select().from(branches).where(eq(branches.id, branchId)).limit(1);
        // if (!branch) throw new BadRequest("Invalid branch selected");

        const resolvedZoneId = userZoneId || userAddress.zoneId;

        const [selfFee] = await db.select().from(restaurantZoneDeliveryFees)
            .where(and(
                eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
                eq(restaurantZoneDeliveryFees.zoneId, resolvedZoneId),
                eq(restaurantZoneDeliveryFees.status, "active")
            )).limit(1);

        if (!selfFee) throw new BadRequest("Restaurant does not deliver to your zone directly");
        deliveryFee = parseFloat(selfFee.deliveryFee as string || "0");
    }

    if (isFreeDelivery) deliveryFee = 0;

    let totalAmount = roundMoney(subtotal + deliveryFee + serviceFee - totalDiscount);
    if (totalAmount < 0) totalAmount = 0;

    const orderId = uuidv4();
    const orderNumber = `ORD-${Date.now()}`;

    const [userInfo] = await db.select({ id: users.id, name: users.name, phone: users.phone, email: users.email })
        .from(users).where(eq(users.id, userId)).limit(1);

    // ==========================================
    // 🛡️ 10. Execute Order (Transaction)
    // ==========================================
    const now = new Date();

    // 🟢 إنشاء كائن منفصل لبداية اليوم لمنع تعديل متغير now الأصلي
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    let createdDailyOrderNumber = 1;

    await db.transaction(async (tx) => {
        // 🔒 1. التأكد الحرج المباشر للمحفظة داخل الـ Transaction مع القفل (FOR UPDATE)
        if (isWalletPayment) {
            const [userWallet] = await tx.select()
                .from(userWallets)
                .where(eq(userWallets.userId, userId))
                .for("update");

            const currentBalance = parseFloat(userWallet?.balance as string || "0");
            if (!userWallet || currentBalance < totalAmount) {
                throw new BadRequest("Insufficient wallet balance");
            }

            const newBalance = roundMoney(currentBalance - totalAmount);

            await tx.update(userWallets)
                .set({ balance: newBalance.toFixed(2) })
                .where(eq(userWallets.userId, userId));

            await tx.insert(userWalletTransactions).values({
                id: uuidv4(),
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

        // 🔒 2. حساب رقم الطلب اليومي بأمان باستخدام startOfToday
        const [ordersCountResult] = await tx
            .select({ count: sql<number>`count(${orders.id})` })
            .from(orders)
            .where(
                and(
                    eq(orders.restaurantId, restaurantId),
                    gte(orders.createdAt, startOfToday) // 👈 تم الاستبدال هنا للحفاظ على قيمة now الحقيقية
                )
            );

        createdDailyOrderNumber = Number(ordersCountResult?.count || 0) + 1;

        // 3. إنشاء الطلب
        await tx.insert(orders).values({
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

        await tx.insert(orderItems).values(itemsToInsert.map(i => ({ ...i, orderId })));
        await tx.delete(cartItems).where(eq(cartItems.userId, userId));

        // إرسال إشعار للـ superadmin
        // await tx.insert(notifications).values({
        //     recipientType: "admin",
        //     recipientId: "superadmin_dashboard",
        //     title: "New Order",
        //     body: `Order #${orderNumber} has been placed.`,
        //     data: { orderId, orderNumber }
        // });


        // 4. إدارات الكوبونات والتخفيضات
        if (appliedCoupon) {
            await tx.insert(couponUsages).values({
                id: uuidv4(),
                couponId: appliedCoupon.id,
                userId,
                orderId,
                discountAmount: appliedCoupon.discountType === "free_delivery" ? deliveryFee.toFixed(2) : appliedCoupon.discountType === "fixed_amount" ? appliedCoupon.discountValue.toString() : totalDiscount.toFixed(2)
            });

            await tx.update(coupons)
                .set({ usedCount: sql`used_count + 1` })
                .where(eq(coupons.id, appliedCoupon.id));
        }

        if (discountState.appliedDiscounts.size > 0) {
            for (const dId of Array.from(discountState.appliedDiscounts)) {
                await tx.update(discounts)
                    .set({ usedCount: sql`used_count + 1` })
                    .where(eq(discounts.id, dId));
            }
        }

        // 5. محفظة المطعم والحسابات المالية
        let [restaurantWallet] = await tx.select().from(restaurantWallets).where(eq(restaurantWallets.restaurantId, restaurantId)).for("update");

        if (!restaurantWallet) {
            await tx.insert(restaurantWallets).values({
                id: uuidv4(),
                restaurantId: restaurantId,
                balance: "0.00",
                collectedCash: "0.00",
                totalEarning: "0.00"
            });
            restaurantWallet = { balance: "0.00", collectedCash: "0.00", totalEarning: "0.00" } as any;
        }

        const currentRestBalance = parseFloat(restaurantWallet.balance as string);
        const currentCollectedCash = parseFloat(restaurantWallet.collectedCash as string);
        const currentTotalEarning = parseFloat(restaurantWallet.totalEarning as string);

        const restaurantEarning = roundMoney(subtotal + deliveryFee - appCommission);
        const appDues = roundMoney(appCommission + serviceFee);

        let newRestBalance = currentRestBalance;
        let newCollectedCash = currentCollectedCash;

        if (isCashPayment) {
            newRestBalance = roundMoney(newRestBalance - appDues);
            newCollectedCash = roundMoney(newCollectedCash + totalAmount);
        } else {
            newRestBalance = roundMoney(newRestBalance + restaurantEarning);
        }

        await tx.update(restaurantWallets)
            .set({
                balance: newRestBalance.toFixed(2),
                collectedCash: newCollectedCash.toFixed(2),
                totalEarning: roundMoney(currentTotalEarning + restaurantEarning).toFixed(2)
            })
            .where(eq(restaurantWallets.restaurantId, restaurantId));

        await tx.insert(restaurantWalletTransactions).values({
            id: uuidv4(),
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
    // 🟢 تنسيق الوقت بتوقيت القاهرة المحلي (Africa/Cairo)
    const cairoTimeFormatted = new Intl.DateTimeFormat("ar-EG", {
        timeZone: "Africa/Cairo",
        hour: "numeric",
        minute: "numeric",
        hour12: true
    }).format(now);

    await sendPushNotification({
        recipientType: "restaurant",
        recipientId: restaurantId,
        title: "طلب جديد! 🛒",
        body: `تم استلام طلب جديد #${orderNumber} بقيمة ${totalAmount} ج.م الساعة ${cairoTimeFormatted}.`,
        data: {
            orderId,
            orderNumber,
            type: "new_order",
            createdAt: now.toISOString(),
            dailyOrderNumber: createdDailyOrderNumber
        }
    });

    return SuccessResponse(res, {
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
                dailyOrderNumber: createdDailyOrderNumber
            },
            customerDetails: userInfo
        }
    });
};
// ==========================================
// 2. جلب الطلبات النشطة (الحالية)
// ==========================================
export const getActiveOrders = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { restaurantId } = req.query;

    const activeOrders = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            dailyOrderNumber: orders.dailyOrderNumber,
            orderType: orders.orderType,
            restaurantName: restaurants.name,
            restaurantImage: restaurants.logo,
            totalAmount: orders.totalAmount,
            status: orders.status,
            createdAt: orders.createdAt,
            itemsCount: sql<number>`(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${orders.id})`,
            // Branch info (for takeaway / dine_in)
            branchName: branches.name,
            // Address info (for delivery)
            addressTitle: addresses.title,
            addressStreet: addresses.street,
            addressLandmark: addresses.landmark,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(addresses, eq(orders.addressId, addresses.id))
        .where(
            and(
                eq(orders.userId, userId),
                restaurantId ? eq(orders.restaurantId, String(restaurantId)) : undefined,
                inArray(orders.status, ["pending", "accepted", "preparing", "out_for_delivery"])
            )
        )
        .orderBy(desc(orders.createdAt));

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

    return SuccessResponse(res, { data: formatted });
};

// ==========================================
// 3. جلب سجل الطلبات (History) - المكتملة والملغية
// ==========================================
export const getOrderHistory = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { restaurantId } = req.query;

    const historyOrders = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            dailyOrderNumber: orders.dailyOrderNumber,
            orderType: orders.orderType,
            restaurantName: restaurants.name,
            restaurantImage: restaurants.logo,
            totalAmount: orders.totalAmount,
            status: orders.status,
            createdAt: orders.createdAt,
            rating: orders.rating,
            ratingComment: orders.ratingComment,
            itemsCount: sql<number>`(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${orders.id})`,
            // Branch info (for takeaway / dine_in)
            branchName: branches.name,
            // Address info (for delivery)
            addressTitle: addresses.title,
            addressStreet: addresses.street,
            addressLandmark: addresses.landmark,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(addresses, eq(orders.addressId, addresses.id))
        .where(
            and(
                eq(orders.userId, userId),
                restaurantId ? eq(orders.restaurantId, String(restaurantId)) : undefined,
                inArray(orders.status, ["delivered", "cancelled", "refund"])
            )
        )
        .orderBy(desc(orders.createdAt));

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

    return SuccessResponse(res, { data: formatted });
};

// ==========================================
// 4. تفاصيل الطلب (Order Details)
// ==========================================
export const getOrderDetails = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;

    const orderInfo = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            dailyOrderNumber: orders.dailyOrderNumber,
            status: orders.status,
            createdAt: orders.createdAt,
            paymentMethod: orders.paymentMethod,
            paymentMethodDetails: {
                id: paymentMethods.id,
                name: paymentMethods.name,
                nameAr: paymentMethods.nameAr,
            },
            orderType: orders.orderType,

            subtotal: orders.subtotal,
            deliveryFee: orders.deliveryFee,
            serviceFee: orders.serviceFee,
            discountAmount: orders.discountAmount,
            couponCode: orders.couponCode,
            totalAmount: orders.totalAmount,

            note: orders.note,
            rating: orders.rating,
            ratingComment: orders.ratingComment,

            restaurantName: restaurants.name,
            restaurantImage: restaurants.logo,

            // Branch (takeaway / dine_in)
            branchId: branches.id,
            branchName: branches.name,
            branchAddress: branches.address,

            // Address (delivery)
            addressId: addresses.id,
            addressTitle: addresses.title,
            addressStreet: addresses.street,
            addressLandmark: addresses.landmark,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(paymentMethods, eq(orders.paymentMethod, paymentMethods.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(addresses, eq(orders.addressId, addresses.id))
        .where(eq(orders.id, orderId))
        .limit(1);

    if (!orderInfo.length) {
        throw new NotFound("Order not found");
    }

    const o = orderInfo[0];

    const items = await db
        .select({
            foodId: orderItems.foodId,
            foodName: food.name,
            quantity: orderItems.quantity,
            basePrice: orderItems.basePrice,
            variationsPrice: orderItems.variationsPrice,
            totalPrice: orderItems.totalPrice,
            note: orderItems.note
        })
        .from(orderItems)
        .leftJoin(food, eq(orderItems.foodId, food.id))
        .where(eq(orderItems.orderId, orderId));

    return SuccessResponse(res, {
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

// ==========================================
// 5. متطلبات الطلب المسبقة (Order Prerequisites)
// ==========================================
export const getOrderPrerequisites = async (req: Request | any, res: Response) => {
    if (!req.user) {
        throw new UnauthorizedError("Unauthenticated: Token is missing or invalid");
    }
    
    const userId = req.user.id;
    const restaurantId = req.query.restaurantId as string;
    const orderSource = req.query.orderSource as string;

        const validOrderSources = ["online_order", "food_aggregator", "mykeeto", "pos"];
    if (!validOrderSources.includes(orderSource)) {
        throw new BadRequest("Invalid order source");
    }

    if (!restaurantId) {
        throw new BadRequest("restaurantId is required");
    }

    // جلب البيانات المطلوبة من الداتا بيز
    const [userAddresses, restaurantBranches, zoneFees] = await Promise.all([
        // أ) عناوين اليوزر 
        db.select().from(addresses).where(eq(addresses.userId, userId)),

        // ب) فروع المطعم
        db.select().from(branches).where(eq(branches.restaurantId, restaurantId)),

        // ج) رسوم توصيل المناطق الخاصة بالمطعم
        db.select().from(restaurantZoneDeliveryFees).where(
            and(
                eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
                eq(restaurantZoneDeliveryFees.status, "active")
            )
        ),
    ]);

    // دمج معلومات التوصيل والرسوم مع كل عنوان
    const zoneFeeMap = new Map<string, number>();
    zoneFees.forEach((fee) => {
        zoneFeeMap.set(fee.zoneId, parseFloat((fee.deliveryFee || "0") as string));
    });

    const addressesWithDeliveryInfo = userAddresses.map((addr) => {
        const isDeliverable = zoneFeeMap.has(addr.zoneId);
        return {
            ...addr,
            isDeliverable,
            deliveryFee: isDeliverable ? zoneFeeMap.get(addr.zoneId)! : null,
        };
    });

    // د) طرق الدفع 
    const activePaymentMethods = await db.select({
        id: paymentMethods.id,
        name: paymentMethods.name,
        nameAr: paymentMethods.nameAr
    }).from(paymentMethods).where(eq(paymentMethods.isActive, true));

    const getCancelReasons = await db.select().from(selectReasons).where(eq(selectReasons.type, "user"));

    const [plan] = await db.select({serviceFee: restaurantBusinessPlans.serviceFee})
        .from(restaurantBusinessPlans)
        .where(
            and(
                eq(restaurantBusinessPlans.restaurantId, restaurantId),
                eq(restaurantBusinessPlans.platformType, orderSource as any)
            )
        )
        .limit(1);

    if (!plan) {
        throw new BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }

    const serviceFee = parseFloat(plan.serviceFee as string || "0");


    // تجميع الداتا وإرسالها
    return SuccessResponse(res, {
        data: {
            addresses: addressesWithDeliveryInfo,
            branches: restaurantBranches,
            paymentMethods: activePaymentMethods,
            reasons: getCancelReasons,
            serviceFee: serviceFee.toFixed(2),
        }
    });
};

// ==========================================
// 6. إلغاء الطلب من قبل المستخدم (Cancel Order)
// ==========================================
export const cancelOrder = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;
    const { cancelReasonId } = req.body;

    if (!cancelReasonId) throw new BadRequest("Cancel reason ID is required");

    // 1. جلب الطلب والتأكد أنه للمستخدم وأنه قابل للإلغاء
    const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).limit(1);
    if (!order) throw new NotFound("Order not found");
    if (!["pending", "accepted"].includes(order.status as string)) {
        throw new BadRequest("Order cannot be cancelled at this stage");
    }

    // 2. التحقق من سبب الإلغاء
    const [reason] = await db.select().from(selectReasons).where(and(eq(selectReasons.id, cancelReasonId), eq(selectReasons.type, "user"))).limit(1);
    if (!reason) throw new BadRequest("Invalid cancel reason for user");

    // 3. تحديث حالة الطلب وإرجاع المبالغ المالية (إلغاء أرباح المطعم والعمولة)
    await db.transaction(async (tx) => {
        // تحديث الطلب
        await tx.update(orders)
            .set({
                status: "cancelled",
                cancelReasonId: reason.id,
                cancelReason: reason.name
            })
            .where(eq(orders.id, orderId));

        // حسابات المبالغ التي تم دفعها أو خصمها
        const totalAmount = parseFloat(order.totalAmount as string || "0");
        const appCommission = parseFloat(order.appCommission as string || "0");
        const serviceFee = parseFloat(order.serviceFee as string || "0");
        const subtotal = parseFloat(order.subtotal as string || "0");
        const deliveryFee = parseFloat(order.deliveryFee as string || "0");
        const appDues = appCommission + serviceFee;
        const restaurantEarning = subtotal + deliveryFee - appCommission;

        const isCashPayment = order.paymentMethod === "cash_on_delivery" || order.paymentMethod === "cash"; // Assuming ID handling elsewhere or this is resolved

        // إرجاع فلوس المستخدم لو دفع بالمحفظة
        // note: paymentMethod stores UUID, so we check userWalletTransactions to know if it was a wallet payment
        const [walletTx] = await tx.select().from(userWalletTransactions).where(and(eq(userWalletTransactions.reference, order.orderNumber), eq(userWalletTransactions.transactionType, "order_payment"))).limit(1);

        if (walletTx) {
            // Revert User Wallet
            const [userWallet] = await tx.select().from(userWallets).where(eq(userWallets.userId, userId)).limit(1);
            if (userWallet) {
                const balanceBefore = parseFloat(userWallet.balance as string || "0");
                const newBalance = balanceBefore + totalAmount;
                await tx.update(userWallets).set({ balance: newBalance.toString() }).where(eq(userWallets.userId, userId));
                await tx.insert(userWalletTransactions).values({
                    id: uuidv4(),
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
        const [restaurantWallet] = await tx.select().from(restaurantWallets).where(eq(restaurantWallets.restaurantId, order.restaurantId)).limit(1);
        if (restaurantWallet) {
            let currentRestBalance = parseFloat(restaurantWallet.balance as string || "0");
            let currentCollectedCash = parseFloat(restaurantWallet.collectedCash as string || "0");
            let currentTotalEarning = parseFloat(restaurantWallet.totalEarning as string || "0");

            if (isCashPayment) {
                // نلغي خصم العمولة من رصيد المطعم، ونلغي الكاش المحصل
                currentRestBalance += appDues;
                currentCollectedCash -= totalAmount;
            } else {
                // نلغي الأرباح اللي انضافت للمطعم
                currentRestBalance -= restaurantEarning;
            }

            await tx.update(restaurantWallets)
                .set({
                    balance: currentRestBalance.toString(),
                    collectedCash: currentCollectedCash.toString(),
                    totalEarning: (currentTotalEarning - restaurantEarning).toString()
                })
                .where(eq(restaurantWallets.restaurantId, order.restaurantId));

            // تسجيل العملية
            await tx.insert(restaurantWalletTransactions).values({
                id: uuidv4(),
                restaurantId: order.restaurantId,
                type: "order_payment", // Or create a new type "refund"
                amount: isCashPayment ? `${appDues}` : `-${restaurantEarning}`,
                balanceBefore: restaurantWallet.balance as string,
                balanceAfter: currentRestBalance.toString(),
                method: order.paymentMethod,
                reference: order.orderNumber,
                note: "Refund/Revert due to user cancellation"
            });
        }
    });

    return SuccessResponse(res, { message: "Order cancelled successfully" });
};

// ==========================================
// 7. Get Cancel Reasons
// ==========================================
export const getCancelReasons = async (req: Request | any, res: Response) => {
    const cancelReasons = await db
        .select()
        .from(selectReasons)
        .where(eq(selectReasons.type, "user"));
    return SuccessResponse(res, { data: cancelReasons });
};

// ==========================================
// 8. Rate Order (User)
// ==========================================
export const rateOrder = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;
    const { rating, comment } = req.body;

    if (!rating) {
        throw new BadRequest("Rating is required");
    }

    if (typeof rating !== "number" || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        throw new BadRequest("Rating must be an integer between 1 and 5");
    }

    const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
        .limit(1);

    if (!order) {
        throw new NotFound("Order not found");
    }

    if (order.status !== "delivered") {
        throw new BadRequest("Only delivered orders can be rated");
    }

    await db
        .update(orders)
        .set({
            rating,
            ratingComment: comment ?? null,
            updatedAt: new Date()
        })
        .where(eq(orders.id, orderId));

    return SuccessResponse(res, {
        message: "Order rated successfully",
        data: {
            orderId,
            rating,
            ratingComment: comment ?? null,
        }
    });
};

