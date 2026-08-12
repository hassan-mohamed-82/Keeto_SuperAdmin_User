"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRedeemCode = exports.getRedeemableProducts = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const uuid_1 = require("uuid");
const getRedeemableProducts = async (req, res) => {
    const { restaurantId } = req.params;
    const userId = req.user?.id;
    if (!userId) {
        throw new Errors_1.UnauthorizedError("User is not found");
    }
    if (!restaurantId) {
        throw new Errors_1.BadRequest("restaurantId is required");
    }
    // 1. جلب رصيد نقاط العميل في هذا المطعم
    const [userPointsRecord] = await connection_1.db
        .select({ points: schema_1.userRestaurantPoints.points })
        .from(schema_1.userRestaurantPoints)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRestaurantPoints.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userRestaurantPoints.restaurantId, restaurantId)))
        .limit(1);
    const userPoints = userPointsRecord?.points ?? 0;
    // 2. جلب المنتجات المتاحة والمفعلة للاستبدال بالنقاط لهذا المطعم
    const products = await connection_1.db
        .select({
        pointsProductId: schema_1.pointsProducts.id,
        pointsRequired: schema_1.pointsProducts.pointsRequiredForRedeem,
        foodId: schema_1.food.id,
        name: schema_1.food.name,
        nameAr: schema_1.food.nameAr,
        nameFr: schema_1.food.nameFr,
        image: schema_1.food.image,
        price: schema_1.food.price,
        pointsEarned: schema_1.food.points, // النقاط التي يكسبها العميل عند الشراء العادي
    })
        .from(schema_1.pointsProducts)
        .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.pointsProducts.foodId, schema_1.food.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.pointsProducts.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.pointsProducts.isActive, true), (0, drizzle_orm_1.eq)(schema_1.food.status, "active")));
    // 3. إضافة حالة إمكانية الاستبدال (canRedeem) لكل منتج بناءً على رصيد العميل
    const formattedProducts = products.map((item) => ({
        ...item,
        canRedeem: userPoints >= (item.pointsRequired ?? 0),
    }));
    return (0, response_1.SuccessResponse)(res, {
        message: "Redeemable products fetched successfully",
        data: {
            userPoints,
            products: formattedProducts,
        },
    });
};
exports.getRedeemableProducts = getRedeemableProducts;
const generate6DigitCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};
const generateRedeemCode = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { restaurantId } = req.params;
    const { foodId } = req.body;
    // ==========================================
    // 🛡️ 1. Validation
    // ==========================================
    if (!restaurantId)
        throw new Errors_1.BadRequest("restaurantId is required");
    if (!foodId)
        throw new Errors_1.BadRequest("foodId is required");
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
    const [pointsProd] = await connection_1.db
        .select({
        id: schema_1.pointsProducts.id,
        pointsRequired: schema_1.pointsProducts.pointsRequiredForRedeem,
        isActive: schema_1.pointsProducts.isActive,
        foodPrice: schema_1.food.price,
        foodName: schema_1.food.name
    })
        .from(schema_1.pointsProducts)
        .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.pointsProducts.foodId, schema_1.food.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.pointsProducts.foodId, foodId), (0, drizzle_orm_1.eq)(schema_1.pointsProducts.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.pointsProducts.isActive, true)))
        .limit(1);
    if (!pointsProd) {
        throw new Errors_1.NotFound("This product is not available for points redemption");
    }
    const pointsNeeded = pointsProd.pointsRequired || 0;
    if (pointsNeeded <= 0) {
        throw new Errors_1.BadRequest("This product does not have a valid redemption points value set");
    }
    // جلب بيانات المستخدم للإرجاع في الاستجابة
    const [userInfo] = await connection_1.db
        .select({ id: schema_1.users.id, name: schema_1.users.name, phone: schema_1.users.phone, email: schema_1.users.email })
        .from(schema_1.users)
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId))
        .limit(1);
    // ==========================================
    // 🛡️ 2. Execute Order (Transaction)
    // ==========================================
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const newOrderId = (0, uuid_1.v4)();
    const redeemCode = generate6DigitCode();
    const redeemExpiresAt = new Date(now.getTime() + 3 * 60 * 1000);
    const orderNumber = `ORD-${Date.now()}`;
    const result = await connection_1.db.transaction(async (tx) => {
        // A. قفل صف النقاط للعميل لمنع الـ Race Condition
        const [userPointsRecord] = await tx
            .select()
            .from(schema_1.userRestaurantPoints)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRestaurantPoints.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userRestaurantPoints.restaurantId, restaurantId)))
            .for("update")
            .limit(1);
        const currentBalance = userPointsRecord?.points ?? 0;
        if (!userPointsRecord || currentBalance < pointsNeeded) {
            throw new Errors_1.BadRequest(`Insufficient points balance. You have ${currentBalance} points, but need ${pointsNeeded}`);
        }
        const balanceAfter = currentBalance - pointsNeeded;
        // B. خصم النقاط من رصيد المستخدم
        await tx
            .update(schema_1.userRestaurantPoints)
            .set({ points: balanceAfter, updatedAt: now })
            .where((0, drizzle_orm_1.eq)(schema_1.userRestaurantPoints.id, userPointsRecord.id));
        // C. حساب رقم الطلب اليومي للمطعم
        const [ordersCountResult] = await tx
            .select({ count: (0, drizzle_orm_1.sql) `count(${schema_1.orders.id})` })
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId), (0, drizzle_orm_1.gte)(schema_1.orders.createdAt, startOfToday)));
        const createdDailyOrderNumber = Number(ordersCountResult?.count || 0) + 1;
        // D. إنشاء الطلب الرئيسي
        await tx.insert(schema_1.orders).values({
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
        await tx.insert(schema_1.orderItems).values({
            id: (0, uuid_1.v4)(),
            orderId: newOrderId,
            foodId,
            quantity: 1,
            basePrice: "0.00",
            variationsPrice: "0.00",
            totalPrice: "0.00",
        });
        // F. تسجيل المعاملة في سجل النقاط
        await tx.insert(schema_1.userPointsTransactions).values({
            id: (0, uuid_1.v4)(),
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
    return (0, response_1.SuccessResponse)(res, {
        message: "Redemption order created successfully",
        order_level: {
            orderDetails: {
                orderId: result.orderId,
                orderNumber: result.orderNumber,
                redeemCode: result.redeemCode,
                redeemCodeExpiresAt: result.redeemCodeExpiresAt.toISOString(), pointsDeducted: result.pointsDeducted,
                remainingPoints: result.remainingPoints,
                productName: result.productName,
                createdAt: now.toISOString(),
                dailyOrderNumber: result.dailyOrderNumber,
            },
            customerDetails: userInfo,
        },
    });
};
exports.generateRedeemCode = generateRedeemCode;
