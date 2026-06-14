// controllers/user/OrderController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { 
    orders, orderItems, restaurantBusinessPlans, food, restaurants, 
    restaurantWallets, restaurantWalletTransactions, 
    restaurantZoneDeliveryFees, zoneDeliveryFees, restaurantSettings, 
    restaurantSchedules, cartItems, users, addresses, branches,
    userWallets, userWalletTransactions, paymentMethods,
    coupons, couponUsages, couponRestaurants, discounts, discountRestaurants, discountFoods
} from "../../models/schema";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";
import { UnauthorizedError } from "../../Errors";
import { sendPushNotification } from "../../utils/notifications";
import { calculateDistance } from "../../utils/geo";

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

// ==========================================
// 1. إنشاء الطلب (Checkout)
// ==========================================
export const checkout = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id; 
    
    const { orderSource, paymentMethod, orderType, idempotencyKey, userZoneId, branchId, addressId, note, couponCode, discountId } = req.body;

    // ==========================================
    // 🛡️ 1. Validation (التحقق من المدخلات)
    // ==========================================
    const validOrderSources = ["online_order", "food_aggregator", "mykeeto"];
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

    const [plan] = await db.select().from(restaurantBusinessPlans).where(eq(restaurantBusinessPlans.restaurantId, restaurantId)).limit(1);

    if (orderSource === "food_aggregator" && (!plan || !plan.commissionRate)) {
        throw new BadRequest("Order failed. This restaurant has no active business plan.");
    }

    // ==========================================
    // 5. Calculate Subtotal from Cart Snapshots
    // ==========================================
    let subtotal = 0;
    const itemsToInsert: any[] = [];

    for (const item of userCart) {
        const basePrice = parseFloat(item.unitPrice as string || "0");
        let varPrice = 0;

        const vars = typeof item.variations === 'string' ? JSON.parse(item.variations) : item.variations;
        
        // ⚠️ تأكد إن السعر في الفرونت إند اسمه additionalPrice، لو اسمه حاجة تانية غيرها هنا
        if (Array.isArray(vars)) {
            varPrice = vars.reduce((sum, v) => sum + parseFloat(v.additionalPrice || "0"), 0);
        }

        const itemTotal = (basePrice + varPrice) * item.quantity;
        subtotal += itemTotal;

        itemsToInsert.push({
            id: uuidv4(),
            foodId: item.foodId,
            quantity: item.quantity,
            basePrice: basePrice.toString(),
            variationsPrice: varPrice.toString(),
            totalPrice: itemTotal.toString(),
            variations: vars, // ✅ التعديل هنا: إضافة الفارييشنز عشان متكونش null
            note: item.note || null
        });
    }

    const serviceFee = plan ? parseFloat(plan.serviceFee as string || "0") : 0;
    let appCommission = orderSource === "food_aggregator" ? subtotal * (parseFloat(plan?.commissionRate as string || "0") / 100) : 0;

    // ==========================================
    // 5.5 Check Coupons and Discounts
    // ==========================================
    const nowTemp = new Date();
    let totalDiscount = 0;
    let appliedCoupon: any = null;
    let appliedDiscount: any = null;
    let isFreeDelivery = false;

    // 1. Check Discount (discountId)
    if (discountId) {
        const [discount] = await db.select().from(discounts).where(eq(discounts.id, discountId)).limit(1);
        if (!discount || !discount.isActive) throw new BadRequest("Invalid or inactive discount");
        
        if (discount.startDate && new Date(discount.startDate) > nowTemp) throw new BadRequest("Discount not yet active");
        if (discount.endDate && new Date(discount.endDate) < nowTemp) throw new BadRequest("Discount expired");
        
        if (discount.usageLimit && discount.usedCount! >= discount.usageLimit) throw new BadRequest("Discount usage limit reached");
        if (parseFloat(discount.minOrderAmount as string || "0") > subtotal) throw new BadRequest(`Minimum order amount of ${discount.minOrderAmount} required for this discount`);
        
        if (!discount.isGlobal) {
            const [discRest] = await db.select().from(discountRestaurants)
                .where(and(eq(discountRestaurants.discountId, discountId), eq(discountRestaurants.restaurantId, restaurantId))).limit(1);
            if (!discRest) throw new BadRequest("Discount is not applicable to this restaurant");
        }

        // Check specific foods
        const specificFoods = await db.select().from(discountFoods).where(eq(discountFoods.discountId, discountId));
        let applicableSubtotal = subtotal;
        if (specificFoods.length > 0) {
            const foodIds = specificFoods.map(f => f.foodId);
            applicableSubtotal = itemsToInsert.filter(i => foodIds.includes(i.foodId)).reduce((sum, i) => sum + parseFloat(i.totalPrice), 0);
            if (applicableSubtotal === 0) throw new BadRequest("Discount is not applicable to any items in your cart");
        }

        const value = parseFloat(discount.discountValue as string);
        if (discount.discountType === "fixed_amount") {
            totalDiscount += value;
        } else if (discount.discountType === "percentage") {
            let pDiscount = applicableSubtotal * (value / 100);
            if (discount.maxDiscount) {
                const max = parseFloat(discount.maxDiscount as string);
                if (pDiscount > max) pDiscount = max;
            }
            totalDiscount += pDiscount;
        }
        
        appliedDiscount = discount;
    }

    // 2. Check Coupon (couponCode)
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

        // Check per-user limit
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

    // ==========================================
    // 6. Smart Delivery Logic (Zone + Radius Hybrid)
    // ==========================================
    let deliveryFee = 0;
    if (orderType === "delivery") {
        if (!addressId) throw new BadRequest("Delivery address is required");
        if (!branchId) throw new BadRequest("Branch is required for delivery orders");

        const [userAddress] = await db.select().from(addresses)
            .where(and(
                eq(addresses.id, addressId),
                eq(addresses.userId, userId)
            )).limit(1);

        if (!userAddress) throw new BadRequest("Invalid delivery address");

        const [branch] = await db.select().from(branches)
            .where(eq(branches.id, branchId)).limit(1);
        
        if (!branch) throw new BadRequest("Invalid branch selected");

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

    if (isFreeDelivery) {
        deliveryFee = 0;
    }

    let totalAmount = subtotal + deliveryFee + serviceFee - totalDiscount;
    if (totalAmount < 0) totalAmount = 0;
    const orderId = uuidv4();
    const orderNumber = `ORD-${Date.now()}`;

    // ==========================================
    // 7. Get Customer Info
    // ==========================================
    const [userInfo] = await db.select({ id: users.id, name: users.name, phone: users.phone, email: users.email })
        .from(users).where(eq(users.id, userId)).limit(1);

    // ==========================================
    // 🛡️ 8. فحص محفظة العميل
    // ==========================================
    let userWallet = null;
    if (isWalletPayment) {
        const walletResult = await db.select().from(userWallets).where(eq(userWallets.userId, userId)).limit(1);
        userWallet = walletResult[0];

        const currentBalance = parseFloat(userWallet?.balance as string || "0");
        if (!userWallet || currentBalance < totalAmount) {
            throw new BadRequest("Insufficient wallet balance");
        }
    }

    // ==========================================
    // 🛡️ 9. جلب محفظة المطعم 
    // ==========================================
    let [restaurantWallet] = await db.select().from(restaurantWallets).where(eq(restaurantWallets.restaurantId, restaurantId)).limit(1);
    
    // ==========================================
    // 10. Execute Order (Transaction)
    // ==========================================
    const now = new Date(); 

    await db.transaction(async (tx) => {
        if (isWalletPayment && userWallet) {
            const balanceBefore = parseFloat(userWallet.balance as string);
            const newBalance = balanceBefore - totalAmount;

            await tx.update(userWallets)
                .set({ balance: newBalance.toString() })
                .where(eq(userWallets.userId, userId));

            await tx.insert(userWalletTransactions).values({
                id: uuidv4(),
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

        // تسجيل بيانات الأوردر نفسه
        await tx.insert(orders).values({
            id: orderId,
            orderNumber,
            idempotencyKey,
            userId,
            restaurantId,
            branchId, 
            addressId: addressId || null,
            orderSource,
            paymentMethod, // ✅ هيفضل بالـ ID زي ما طلبت
            orderType: orderType || "delivery",
            subtotal: subtotal.toString(),
            deliveryFee: deliveryFee.toString(),
            serviceFee: serviceFee.toString(),
            appCommission: appCommission.toString(),
            discountAmount: totalDiscount.toString(),
            couponCode: couponCode || null,
            totalAmount: totalAmount.toString(),
            note: note || null,
            status: "pending",
            createdAt: now
        });

        // تفريغ الكارت وتسجيل الأصناف
        await tx.insert(orderItems).values(itemsToInsert.map(i => ({ ...i, orderId })));
        await tx.delete(cartItems).where(eq(cartItems.userId, userId)); 

        // تسجيل استخدام الكوبون والخصم
        if (appliedCoupon) {
            await tx.insert(couponUsages).values({
                id: uuidv4(),
                couponId: appliedCoupon.id,
                userId,
                orderId,
                discountAmount: appliedCoupon.discountType === "free_delivery" ? deliveryFee.toString() : appliedCoupon.discountType === "fixed_amount" ? appliedCoupon.discountValue.toString() : totalDiscount.toString()
            });
            await tx.update(coupons)
                .set({ usedCount: sql`used_count + 1` })
                .where(eq(coupons.id, appliedCoupon.id));
        }

        if (appliedDiscount) {
            await tx.update(discounts)
                .set({ usedCount: sql`used_count + 1` })
                .where(eq(discounts.id, appliedDiscount.id));
        }

        // تسويات محفظة المطعم
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

        const restaurantEarning = subtotal + deliveryFee - appCommission;
        const appDues = appCommission + serviceFee; 

        let newRestBalance = currentRestBalance;
        let newCollectedCash = currentCollectedCash;

        if (isCashPayment) {
            newRestBalance -= appDues;
            newCollectedCash += totalAmount; 
        } else {
            newRestBalance += restaurantEarning;
        }

        await tx.update(restaurantWallets)
            .set({ 
                balance: newRestBalance.toString(),
                collectedCash: newCollectedCash.toString(),
                totalEarning: (currentTotalEarning + restaurantEarning).toString()
            })
            .where(eq(restaurantWallets.restaurantId, restaurantId));

        const isCash = isCashPayment;
        await tx.insert(restaurantWalletTransactions).values({
            id: uuidv4(),
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

    await sendPushNotification({
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
                createdAt: now.toISOString() 
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
            restaurantName: restaurants.name,
            restaurantImage: restaurants.logo,
            totalAmount: orders.totalAmount,
            status: orders.status,
            createdAt: orders.createdAt,
            itemsCount: sql<number>`(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${orders.id})`
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .where(
            and(
                eq(orders.userId, userId),
                restaurantId ? eq(orders.restaurantId, String(restaurantId)) : undefined,
                // 🔥 تجلب فقط الطلبات التي لم تنتهِ بعد
                inArray(orders.status, ["pending", "accepted", "preparing", "out_for_delivery"])
            )
        )
        .orderBy(desc(orders.createdAt));

    return SuccessResponse(res, { data: activeOrders });
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
            restaurantName: restaurants.name,
            restaurantImage: restaurants.logo,
            totalAmount: orders.totalAmount,
            status: orders.status, 
            createdAt: orders.createdAt,
            itemsCount: sql<number>`(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${orders.id})`
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .where(
            and(
                eq(orders.userId, userId),
                restaurantId ? eq(orders.restaurantId, String(restaurantId)) : undefined,
                // 🔥 تجلب فقط الطلبات التي انتهت (تم إضافة المرفوض والمسترجع)
                inArray(orders.status, ["delivered", "cancelled", "rejected", "refund"])
            )
        )
        .orderBy(desc(orders.createdAt));

    return SuccessResponse(res, { data: historyOrders });
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
            status: orders.status,
            createdAt: orders.createdAt,
            paymentMethod: orders.paymentMethod, // 👈 تم التعديل هنا (كانت orderItems بالخطأ)
            orderType: orders.orderType,

            subtotal: orders.subtotal,
            deliveryFee: orders.deliveryFee,
            serviceFee: orders.serviceFee,
            discountAmount: orders.discountAmount,
            couponCode: orders.couponCode,
            totalAmount: orders.totalAmount,

            note: orders.note,

            restaurantName: restaurants.name,
            restaurantImage: restaurants.logo
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .where(eq(orders.id, orderId))
        .limit(1);

    if (!orderInfo.length) {
        throw new NotFound("Order not found");
    }

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
            ...orderInfo[0],
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

    if (!restaurantId) {
        throw new BadRequest("restaurantId is required");
    }

    // جلب البيانات المطلوبة من الداتا بيز
    const [userAddresses, restaurantBranches] = await Promise.all([
        // أ) عناوين اليوزر 
        db.select().from(addresses).where(eq(addresses.userId, userId)),
        
        // ب) فروع المطعم
        db.select().from(branches).where(eq(branches.restaurantId, restaurantId)),
    ]);

    // ج) طرق الدفع 
    const activePaymentMethods = await db.select({
        id: paymentMethods.id,
        name: paymentMethods.name,
        nameAr: paymentMethods.nameAr
    }).from(paymentMethods).where(eq(paymentMethods.isActive, true));

    // تجميع الداتا وإرسالها
    return SuccessResponse(res, { 
        data: {
            addresses: userAddresses,
            branches: restaurantBranches,
            paymentMethods: activePaymentMethods
        }
    });
};