// controllers/user/OrderController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { orders, orderItems, restaurantBusinessPlans, food, restaurants, restaurantWallets, restaurantZoneDeliveryFees, zoneDeliveryFees, restaurantSettings, restaurantSchedules, cartItems, users, paymentMethods } from "../../models/schema";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";
import { userWallets, userWalletTransactions } from "../../models/schema";
import { UnauthorizedError } from "../../Errors";

// ==========================================
// 1. إنشاء الطلب (Checkout)
// ==========================================
export const checkout = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id; 
    const { orderSource, paymentMethodId, orderType, idempotencyKey, userZoneId, branchId } = req.body;

    // 1. Idempotency Check
    if (idempotencyKey) {
        const [existing] = await db.select().from(orders).where(eq(orders.idempotencyKey, idempotencyKey)).limit(1);
        if (existing) return SuccessResponse(res, { message: "Order already processed", data: existing });
    }

    // 2. Get Cart Items
    const userCart = await db.select().from(cartItems).where(eq(cartItems.userId, userId));
    if (!userCart.length) throw new BadRequest("Your cart is empty");

    const restaurantId = userCart[0].restaurantId;

    // 3. Get Restaurant & Business Plan
    const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
    if (!restaurant) throw new BadRequest("Restaurant not found");

    const [plan] = await db.select().from(restaurantBusinessPlans).where(eq(restaurantBusinessPlans.restaurantId, restaurantId)).limit(1);

    if (orderSource === "food_aggregator" && (!plan || !plan.commissionRate)) {
        throw new BadRequest("Order failed. This restaurant has no active business plan.");
    }

    // جلب نوع وسيلة الدفع 
    const [paymentMethod] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, paymentMethodId)).limit(1);
    if (!paymentMethod) throw new BadRequest("Invalid payment method");

    // 4. Calculate Subtotal from Cart Snapshots
    let subtotal = 0;
    const itemsToInsert: any[] = [];

    for (const item of userCart) {
        const basePrice = parseFloat(item.unitPrice as string || "0");
        let varPrice = 0;

        const vars = typeof item.variations === 'string' ? JSON.parse(item.variations) : item.variations;
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
            totalPrice: itemTotal.toString()
        });
    }

    const serviceFee = plan ? parseFloat(plan.serviceFee as string || "0") : 0;
    let appCommission = orderSource === "food_aggregator" ? subtotal * (parseFloat(plan?.commissionRate as string || "0") / 100) : 0;

    // 5. Smart Delivery Logic
    let deliveryFee = 0;
    if (orderType === "delivery") {
        if (!userZoneId) throw new BadRequest("Delivery zone is required");

        const [selfFee] = await db.select().from(restaurantZoneDeliveryFees)
            .where(and(
                eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
                eq(restaurantZoneDeliveryFees.zoneId, userZoneId),
                eq(restaurantZoneDeliveryFees.status, "active")
            )).limit(1);

        if (!selfFee) throw new BadRequest("Restaurant does not deliver to your zone directly");
        deliveryFee = parseFloat(selfFee.deliveryFee as string || "0");
    }

    const totalAmount = subtotal + deliveryFee + serviceFee;
    const orderId = uuidv4();
    const orderNumber = `ORD-${Date.now()}`;

    // 6. Get Customer Info (شيلنا الـ walletBalance من هنا لأنها بقت في جدول لوحدها)
    const [userInfo] = await db.select({ id: users.id, name: users.name, phone: users.phone, email: users.email })
        .from(users).where(eq(users.id, userId)).limit(1);

    // ==========================================
    // 🛡️ 7. فحص محفظة العميل (من جدول userWallets)
    // ==========================================
    let userWallet = null;
    if (paymentMethod.type === "wallet") {
        const walletResult = await db.select().from(userWallets).where(eq(userWallets.userId, userId)).limit(1);
        userWallet = walletResult[0];

        const currentBalance = parseFloat(userWallet?.balance as string || "0");
        if (!userWallet || currentBalance < totalAmount) {
            throw new BadRequest("Insufficient wallet balance");
        }
    }

    // 8. Execute Order (Transaction)
    await db.transaction(async (tx) => {
        
        // ==========================================
        // 🛡️ أ. خصم المحفظة وتسجيل الحركة (لو الدفع محفظة)
        // ==========================================
        if (paymentMethod.type === "wallet" && userWallet) {
            const balanceBefore = parseFloat(userWallet.balance as string);
            const newBalance = balanceBefore - totalAmount;

            // 1. تحديث رصيد المحفظة
            await tx.update(userWallets)
                .set({ balance: newBalance.toString() })
                .where(eq(userWallets.userId, userId));

            // 2. تسجيل حركة الخصم في دفتر الأستاذ (Ledger)
            await tx.insert(userWalletTransactions).values({
                id: uuidv4(),
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
        await tx.insert(orders).values({
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
        await tx.insert(orderItems).values(itemsToInsert.map(i => ({ ...i, orderId })));
        await tx.delete(cartItems).where(eq(cartItems.userId, userId)); 
    });

    return SuccessResponse(res, {
        message: "Order created successfully",
        data: {
            orderDetails: { orderId, orderNumber, subtotal, deliveryFee, serviceFee, totalAmount },
            customerDetails: userInfo
        }
    });
};
// ==========================================
// 2. جلب الطلبات النشطة (الحالية)
// ==========================================
export const getActiveOrders = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id; 
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
export const getOrderHistory = async (req: Request, res: Response) => {
     
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id; 
    const historyOrders = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            restaurantName: restaurants.name,
            restaurantImage: restaurants.logo,
            totalAmount: orders.totalAmount,
            status: orders.status, // سيكون إما delivered أو cancelled
            createdAt: orders.createdAt,
            itemsCount: sql<number>`(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${orders.id})`
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .where(
            and(
                eq(orders.userId, userId),
                // 🔥 تجلب فقط الطلبات التي انتهت (وصلت أو أُلغيت/رُفضت)
                inArray(orders.status, ["delivered", "cancelled"])
            )
        )
        .orderBy(desc(orders.createdAt));

    return SuccessResponse(res, { data: historyOrders });
};

// ==========================================
// 4. تفاصيل الطلب (Order Details)
// ==========================================
export const getOrderDetails = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id; 
    const { orderId } = req.params;

    const orderInfo = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            status: orders.status,
            createdAt: orders.createdAt,
            paymentMethod: orders.paymentMethodId,
            orderType: orders.orderType,

            subtotal: orders.subtotal,
            deliveryFee: orders.deliveryFee,
            serviceFee: orders.serviceFee,
            totalAmount: orders.totalAmount,

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
            totalPrice: orderItems.totalPrice
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