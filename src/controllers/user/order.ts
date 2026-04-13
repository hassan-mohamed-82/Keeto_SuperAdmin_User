// controllers/user/OrderController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { orders, orderItems, restaurantBusinessPlans, food, restaurants, restaurantWallets, restaurantZoneDeliveryFees, zoneDeliveryFees, restaurantSettings, restaurantSchedules, cartItems, users } from "../../models/schema";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";


export const checkout = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { orderSource, paymentMethodId, orderType, idempotencyKey, userZoneId } = req.body;

    // 1. Idempotency Check
    if (idempotencyKey) {
        const [existing] = await db.select().from(orders).where(eq(orders.idempotencyKey, idempotencyKey)).limit(1);
        if (existing) return SuccessResponse(res, { message: "Order already processed", data: existing });
    }

    // 2. Get Cart Items
    const userCart = await db.select().from(cartItems).where(eq(cartItems.userId, userId));
    if (!userCart.length) throw new BadRequest("Your cart is empty");

    const restaurantId = userCart[0].restaurantId;

    // 3. Get Restaurant & Business Plan (In one go)
    const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
    if (!restaurant) throw new BadRequest("Restaurant not found");

    const [plan] = await db.select().from(restaurantBusinessPlans).where(eq(restaurantBusinessPlans.restaurantId, restaurantId)).limit(1);

    // Enforce Business Plan for Aggregators
    if (orderSource === "food_aggregator" && (!plan || !plan.commissionRate)) {
        throw new BadRequest("Order failed. This restaurant has no active business plan.");
    }

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

    // 5. Calculate Service Fee & Commission
    const serviceFee = plan ? parseFloat(plan.serviceFee as string || "0") : 0;
    let appCommission = 0;
    if (orderSource === "food_aggregator") {
        const rate = parseFloat(plan?.commissionRate as string || "0");
        appCommission = subtotal * (rate / 100);
    }

    // ==========================================
    // 🛡️ 6. Smart Delivery Logic (Zone-Based)
    // ==========================================
    let deliveryFee = 0;
    if (orderType === "delivery") {
        if (!userZoneId) throw new BadRequest("Delivery zone is required");

        if (orderSource === "online_order") {
            // 🏠 Check Restaurant's own zone pricing
            const [selfFee] = await db.select().from(restaurantZoneDeliveryFees)
                .where(and(
                    eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
                    eq(restaurantZoneDeliveryFees.zoneId, userZoneId),
                    eq(restaurantZoneDeliveryFees.status, "active")
                )).limit(1);

            if (!selfFee) throw new BadRequest("Restaurant does not deliver to your zone directly");
            deliveryFee = parseFloat(selfFee.deliveryFee as string || "0");

        } else if (orderSource === "food_aggregator") {
            // 🛵 Check Keeto Platform zone-to-zone pricing
            if (!restaurant.zoneId) throw new BadRequest("Restaurant zone location is not configured");

            const [platformFee] = await db.select().from(zoneDeliveryFees)
                .where(and(
                    eq(zoneDeliveryFees.fromZoneId, restaurant.zoneId),
                    eq(zoneDeliveryFees.toZoneId, userZoneId)
                )).limit(1);

            if (!platformFee) throw new BadRequest("No platform delivery coverage for this route");
            deliveryFee = parseFloat(platformFee.fee as string || "0");
        }
    }

    const totalAmount = subtotal + deliveryFee + serviceFee;
    const orderId = uuidv4();
    const orderNumber = `ORD-${Date.now()}`;

    // 7. Get Customer Info for Response
    const [userInfo] = await db.select({ id: users.id, name: users.name, phone: users.phone, email: users.email })
        .from(users).where(eq(users.id, userId)).limit(1);

    // 8. Execute Order (Transaction)
    await db.transaction(async (tx) => {
        await tx.insert(orders).values({
            id: orderId,
            orderNumber,
            idempotencyKey,
            userId,
            restaurantId,
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

        await tx.insert(orderItems).values(itemsToInsert.map(i => ({ ...i, orderId })));
        await tx.delete(cartItems).where(eq(cartItems.userId, userId)); // 🔥 Clear Cart
    });

    return SuccessResponse(res, {
        message: "Order created successfully",
        data: {
            orderDetails: { orderId, orderNumber, subtotal, deliveryFee, serviceFee, totalAmount },
            customerDetails: userInfo
        }
    });
};
// GET /api/user/orders/:userId
export const getUserOrders = async (req: Request, res: Response) => {
    const { userId } = req.params;

    const userOrders = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            restaurantName: restaurants.name,
            restaurantImage: restaurants.logo,
            totalAmount: orders.totalAmount,
            status: orders.status,
            createdAt: orders.createdAt,

            // 🔥 subquery بديل لـ count (أصح)
            itemsCount: sql<number>`
                (SELECT COUNT(*) FROM order_items 
                 WHERE order_items.order_id = ${orders.id})
            `
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .where(eq(orders.userId, userId))
        .orderBy(desc(orders.createdAt));

    return SuccessResponse(res, { data: userOrders });
};

// GET /api/user/orders/:orderId
export const getOrderDetails = async (req: Request, res: Response) => {
    const { orderId } = req.params;

    const orderInfo = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            status: orders.status,
            createdAt: orders.createdAt,
            paymentMethod: orders.paymentMethodId,

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

