// controllers/user/OrderController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { 
    orders, orderItems, restaurantBusinessPlans, food, restaurants, 
    restaurantWallets, restaurantWalletTransactions, // 👈 ضفنا جداول محفظة المطعم
    restaurantZoneDeliveryFees, zoneDeliveryFees, restaurantSettings, 
    restaurantSchedules, cartItems, users, addresses, branches,
    userWallets, userWalletTransactions 
} from "../../models/schema";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";
import { UnauthorizedError } from "../../Errors";
import { sendPushNotification } from "../../utils/notifications";

// ==========================================
// 1. إنشاء الطلب (Checkout)
// ==========================================
export const checkout = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id; 
    
    const { orderSource, paymentMethod, orderType, idempotencyKey, userZoneId, branchId, addressId } = req.body;

    // ==========================================
    // 🛡️ 1. Validation (التحقق من المدخلات)
    // ==========================================
    
   
    
    const validOrderSources = ["online_order", "food_aggregator", "mykeeto"];
    if (!validOrderSources.includes(orderSource)) {
        throw new BadRequest("Invalid order source");
    }

    const validPaymentMethods = ["cash_on_delivery", "visa", "wallet"];
    if (!validPaymentMethods.includes(paymentMethod)) {
        throw new BadRequest("Invalid payment method");
    }

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

    // ==========================================
    // 6. Smart Delivery Logic
    // ==========================================
    let deliveryFee = 0;
    if (orderType === "delivery") {
        if (!addressId) throw new BadRequest("Delivery address is required");

        const [userAddress] = await db.select().from(addresses)
            .where(and(
                eq(addresses.id, addressId),
                eq(addresses.userId, userId)
            )).limit(1);

        if (!userAddress) throw new BadRequest("Invalid delivery address");

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

    const totalAmount = subtotal + deliveryFee + serviceFee;
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
    if (paymentMethod === "wallet") {
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
    await db.transaction(async (tx) => {
        
        // أ. خصم محفظة العميل (لو الدفع محفظة)
        if (paymentMethod === "wallet" && userWallet) {
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
            addressId: addressId || null,
            orderSource,
            paymentMethod,
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

        // د. تسويات محفظة المطعم
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

        if (paymentMethod === "cash_on_delivery") {
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

        await tx.insert(restaurantWalletTransactions).values({
            id: uuidv4(),
            restaurantId,
            type: "order_payment",
            amount: paymentMethod === "cash_on_delivery" ? `-${appDues}` : `${restaurantEarning}`,
            balanceBefore: currentRestBalance.toString(),
            balanceAfter: newRestBalance.toString(),
            method: paymentMethod,
            reference: orderNumber,
            note: paymentMethod === "cash_on_delivery" ? "Commission deducted from cash order" : "Earnings added from digital payment"
        });
    });

    // ==========================================
    // 11. Send Notification to Restaurant
    // ==========================================
    await sendPushNotification({
        recipientType: "restaurant",
        recipientId: restaurantId,
        title: "New Order Received! 🛒",
        body: `You have received a new order #${orderNumber} for ${totalAmount}.`,
        data: {
            orderId,
            orderNumber,
            type: "new_order"
        }
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
export const getActiveOrders = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id; 
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
export const getOrderHistory = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id; 
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

// ==========================================
// 5. متطلبات الطلب المسبقة (Order Prerequisites)
// ==========================================
export const getOrderPrerequisites = async (req: Request | any, res: Response) => {
    try {
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

        // ج) طرق الدفع (بقت Static Array بدل الداتا بيز)
        const activePaymentMethods = [
            { id: "cash_on_delivery", name: "Cash on Delivery" },
            { id: "visa", name: "Credit Card (Visa/Mastercard)" },
            { id: "wallet", name: "My Wallet" }
        ];

        // تجميع الداتا وإرسالها
        return SuccessResponse(res, { 
            data: {
                addresses: userAddresses,
                branches: restaurantBranches,
                paymentMethods: activePaymentMethods
            }
        });

    } catch (error) {
        console.error("Error fetching order prerequisites:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};