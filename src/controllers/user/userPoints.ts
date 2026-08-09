import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    pointsProducts,
    food,
    userRestaurantPoints,
    userPointsTransactions,
    orders,
    orderItems
} from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound, UnauthorizedError, BadRequest } from "../../Errors";
import { v4 as uuidv4 } from "uuid";

export const getRedeemableProducts = async (req: Request, res: Response) => {
    const { restaurantId } = req.query;
    const userId = req.user?.id;

    if (!userId) {
        throw new UnauthorizedError("User is not found");
    }

    if (!restaurantId || typeof restaurantId !== "string") {
        throw new BadRequest("restaurantId query parameter is required");
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

const generateOrderNumber = (): string => {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    return `ORD-${Date.now().toString().slice(-6)}-${randomSuffix}`;
};

export const generateRedeemCode = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { foodId, restaurantId, branchId } = req.body;

    if (!userId) {
        throw new UnauthorizedError("User is not found");
    }

    if (!foodId || !restaurantId || !branchId) {
        throw new BadRequest("foodId, restaurantId, and branchId are required");
    }

    // 1. Verify product is enrolled and active in the points program
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

    // 2. Execute Redemption inside DB Transaction
    const result = await db.transaction(async (tx) => {
        // Fetch user points record
        const [userPointsRecord] = await tx
            .select()
            .from(userRestaurantPoints)
            .where(
                and(
                    eq(userRestaurantPoints.userId, userId),
                    eq(userRestaurantPoints.restaurantId, restaurantId)
                )
            )
            .limit(1);

        const currentBalance = userPointsRecord?.points ?? 0;

        if (currentBalance < pointsNeeded) {
            throw new BadRequest(
                `Insufficient points balance. You have ${currentBalance} points, but need ${pointsNeeded}`
            );
        }

        const balanceAfter = currentBalance - pointsNeeded;
        const newOrderId = uuidv4();
        const redeemCode = generate6DigitCode();
        const orderNumber = generateOrderNumber();

        // A. Deduct user points
        await tx
            .update(userRestaurantPoints)
            .set({ points: balanceAfter, updatedAt: new Date() })
            .where(eq(userRestaurantPoints.id, userPointsRecord.id));

        // B. Create Order matching all required schema fields
        await tx.insert(orders).values({
            id: newOrderId,
            orderNumber,
            userId,
            restaurantId,
            branchId,
            orderSource: "online_order",
            paymentMethod: "POINTS",
            orderType: "takeaway",
            subtotal: "0.00",
            totalAmount: "0.00",
            status: "pending",
            isPointsRedeemed: true,
            redeemCode,
            createdAt: new Date()
        });

        // C. Create Order Item matching all required schema fields
        await tx.insert(orderItems).values({
            id: uuidv4(),
            orderId: newOrderId,
            foodId,
            quantity: 1,
            basePrice: "0.00",
            variationsPrice: "0.00",
            totalPrice: "0.00"
        });

        // D. Record Points Audit Transaction
        await tx.insert(userPointsTransactions).values({
            id: uuidv4(),
            userId,
            restaurantId,
            type: "redeem",
            points: pointsNeeded,
            balanceBefore: currentBalance,
            balanceAfter: balanceAfter,
            orderId: newOrderId,
            note: `Redeemed points for item: ${pointsProd.foodName} (Code: ${redeemCode})`,
            createdAt: new Date()
        });

        return {
            orderId: newOrderId,
            orderNumber,
            redeemCode,
            pointsDeducted: pointsNeeded,
            remainingPoints: balanceAfter,
            productName: pointsProd.foodName
        };
    });

    return SuccessResponse(res, {
        message: "Redemption code generated successfully",
        data: result
    });
};