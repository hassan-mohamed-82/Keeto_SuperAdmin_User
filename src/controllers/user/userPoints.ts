import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    pointsProducts,
    food,
    userRestaurantPoints,
    userPointsTransactions,
    orders,
    orderItems,
    branches,
    users,
    notifications
} from "../../models/schema";
import { eq, and, sql, gte } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound, UnauthorizedError, BadRequest } from "../../Errors";
import { v4 as uuidv4 } from "uuid";
import { sendPushNotification } from "../../utils/notifications";

export const getRedeemableProducts = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
        throw new UnauthorizedError("User is not found");
    }

    if (!restaurantId) {
        throw new BadRequest("restaurantId is required");
    }

    // 1. جلب رصيد نقاط العميل في هذا المطعم
    const [userPointsRecord] = await db
        .select({ points: userRestaurantPoints.points })
        .from(userRestaurantPoints)
        .where(
            and(
                eq(userRestaurantPoints.userId, userId),
                eq(userRestaurantPoints.restaurantId, restaurantId)
            )
        )
        .limit(1);

    const userPoints = userPointsRecord?.points ?? 0;

    // 2. جلب المنتجات المتاحة والمفعلة للاستبدال بالنقاط لهذا المطعم
    const products = await db
        .select({
            pointsProductId: pointsProducts.id,
            pointsRequired: pointsProducts.pointsRequiredForRedeem,
            foodId: food.id,
            name: food.name,
            nameAr: food.nameAr,
            nameFr: food.nameFr,
            image: food.image,
            price: food.price,
            pointsEarned: food.points, // النقاط التي يكسبها العميل عند الشراء العادي
        })
        .from(pointsProducts)
        .innerJoin(food, eq(pointsProducts.foodId, food.id))
        .where(
            and(
                eq(pointsProducts.restaurantId, restaurantId),
                eq(pointsProducts.isActive, true),
                eq(food.status, "active")
            )
        );

    // 3. إضافة حالة إمكانية الاستبدال (canRedeem) لكل منتج بناءً على رصيد العميل
    const formattedProducts = products.map((item) => ({
        ...item,
        canRedeem: userPoints >= (item.pointsRequired ?? 0),
    }));

    return SuccessResponse(res, {
        message: "Redeemable products fetched successfully",
        data: {
            userPoints,
            products: formattedProducts,
        },
    });
};

const generate6DigitCode = (): string => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

export const generateRedeemCode = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { restaurantId } = req.params;
    const { foodId } = req.body;

    // ==========================================
    // 🛡️ 1. Validation
    // ==========================================
    if (!restaurantId) throw new BadRequest("restaurantId is required");
    if (!foodId) throw new BadRequest("foodId is required");

    // 🟢 1. التأكد أن الفرع موجود ومملوك لنفس المطعم
    // const [branch] = await db
    //     .select({ id: branches.id })
    //     .from(branches)
    //     .where(
    //         and(
    //             eq(branches.id, branchId),
    //             eq(branches.restaurantId, restaurantId)
    //         )
    //     )
    //     .limit(1);

    // if (!branch) {
    //     throw new BadRequest("Invalid branch selected or does not belong to this restaurant");
    // }

    // 1.1 التأكد من أن المنتج مسجل ونشط في برنامج النقاط
    const [pointsProd] = await db
        .select({
            id: pointsProducts.id,
            pointsRequired: pointsProducts.pointsRequiredForRedeem,
            isActive: pointsProducts.isActive,
            foodPrice: food.price,
            foodName: food.name
        })
        .from(pointsProducts)
        .innerJoin(food, eq(pointsProducts.foodId, food.id))
        .where(
            and(
                eq(pointsProducts.foodId, foodId),
                eq(pointsProducts.restaurantId, restaurantId),
                eq(pointsProducts.isActive, true)
            )
        )
        .limit(1);

    if (!pointsProd) {
        throw new NotFound("This product is not available for points redemption");
    }

    const pointsNeeded = pointsProd.pointsRequired || 0;
    if (pointsNeeded <= 0) {
        throw new BadRequest("This product does not have a valid redemption points value set");
    }

    // جلب بيانات المستخدم للإرجاع في الاستجابة
    const [userInfo] = await db
        .select({ id: users.id, name: users.name, phone: users.phone, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    // ==========================================
    // 🛡️ 2. Execute Order (Transaction)
    // ==========================================
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const newOrderId = uuidv4();
    const redeemCode = generate6DigitCode();
    const redeemExpiresAt = new Date(now.getTime() + 3 * 60 * 1000);
    const orderNumber = `ORD-${Date.now()}`;

    const result = await db.transaction(async (tx) => {
        // A. قفل صف النقاط للعميل لمنع الـ Race Condition
        const [userPointsRecord] = await tx
            .select()
            .from(userRestaurantPoints)
            .where(
                and(
                    eq(userRestaurantPoints.userId, userId),
                    eq(userRestaurantPoints.restaurantId, restaurantId)
                )
            )
            .for("update")
            .limit(1);

        const currentBalance = userPointsRecord?.points ?? 0;

        if (!userPointsRecord || currentBalance < pointsNeeded) {
            throw new BadRequest(
                `Insufficient points balance. You have ${currentBalance} points, but need ${pointsNeeded}`
            );
        }

        const balanceAfter = currentBalance - pointsNeeded;

        // B. خصم النقاط من رصيد المستخدم
        await tx
            .update(userRestaurantPoints)
            .set({ points: balanceAfter, updatedAt: now })
            .where(eq(userRestaurantPoints.id, userPointsRecord.id));

        // C. حساب رقم الطلب اليومي للمطعم
        const [ordersCountResult] = await tx
            .select({ count: sql<number>`count(${orders.id})` })
            .from(orders)
            .where(
                and(
                    eq(orders.restaurantId, restaurantId),
                    gte(orders.createdAt, startOfToday)
                )
            );

        const createdDailyOrderNumber = Number(ordersCountResult?.count || 0) + 1;

        // D. إنشاء الطلب الرئيسي
        await tx.insert(orders).values({
            id: newOrderId,
            orderNumber,
            userId,
            restaurantId,
            // branchId,
            orderSource: "online_order",
            paymentMethod: null,
            orderType: "takeaway",
            subtotal: "0.00",
            deliveryFee: "0.00",
            serviceFee: "0.00",
            appCommission: "0.00",
            discountAmount: "0.00",
            totalAmount: "0.00",
            status: "pending",
            isPointsRedeemed: true,
            redeemCode,
            redeemCodeExpiresAt: redeemExpiresAt,
            dailyOrderNumber: createdDailyOrderNumber,
            createdAt: now,
            updatedAt: now,
        });

        // E. إنشاء عنصر الطلب (Order Item)
        await tx.insert(orderItems).values({
            id: uuidv4(),
            orderId: newOrderId,
            foodId,
            quantity: 1,
            basePrice: "0.00",
            variationsPrice: "0.00",
            totalPrice: "0.00",
        });

        // F. تسجيل المعاملة في سجل النقاط
        await tx.insert(userPointsTransactions).values({
            id: uuidv4(),
            userId,
            restaurantId,
            type: "redeem",
            points: pointsNeeded,
            balanceBefore: currentBalance,
            balanceAfter,
            orderId: newOrderId,
            note: `Redeemed points for item: ${pointsProd.foodName} (Code: ${redeemCode})`,
            createdAt: now,
        });

        return {
            orderId: newOrderId,
            orderNumber,
            redeemCode,
            pointsDeducted: pointsNeeded,
            remainingPoints: balanceAfter,
            productName: pointsProd.foodName,
            dailyOrderNumber: createdDailyOrderNumber,
            redeemCodeExpiresAt: redeemExpiresAt,
        };
    });

    return SuccessResponse(res, {
        message: "Redemption order created successfully",
        order_level: {
            orderDetails: {
                orderId: result.orderId,
                orderNumber: result.orderNumber,
                redeemCode: result.redeemCode,
                redeemCodeExpiresAt: result.redeemCodeExpiresAt.toISOString(),                pointsDeducted: result.pointsDeducted,
                remainingPoints: result.remainingPoints,
                productName: result.productName,
                createdAt: now.toISOString(),
                dailyOrderNumber: result.dailyOrderNumber,
            },
            customerDetails: userInfo,
        },
    });
};