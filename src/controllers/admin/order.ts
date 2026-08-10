import { eq, desc, and, inArray } from "drizzle-orm";
import { addresses, food, orderItems, orders, paymentMethods, pointsProducts, restaurants, restaurantWallets, restaurantWalletTransactions, selectReasons, userPointsTransactions, userRestaurantPoints, users, userWallets, userWalletTransactions } from "../../models/schema";
import { SuccessResponse } from "../../utils/response";
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { BadRequest, NotFound } from "../../Errors";
import { sendPushNotification } from "../../utils/notifications";
import { v4 as uuidv4 } from "uuid";

export const getOrdersByRestaurant = async (req: Request, res: Response) => {
    const { restaurantId } = req.params; // الأيدي بتاع المطعم اللي باعتينه في اللينك
    const { status } = req.query; // لو عايز تفلتر بـ Pending أو Delivered مثلاً

    // بناء الكويري بشكل ديناميكي
    const baseQuery = db
        .select({
            orderId: orders.orderNumber, // الرقم العشوائي (ORD-123)
            internalId: orders.id,
            orderDate: orders.createdAt,
            totalAmount: orders.totalAmount,
            orderStatus: orders.status,
            customerName: users.name, // اسم العميل من جدول اليوزرز
            customerPhone: users.phone
        })
        .from(orders)
        .leftJoin(users, eq(orders.userId, users.id)); // ربطنا الأوردر باليوزر

    // لو الأدمن داس على تابة معينة (مثلاً Pending فقط)
    let condition = eq(orders.restaurantId, restaurantId);
    if (status) {
        condition = and(eq(orders.restaurantId, restaurantId), eq(orders.status, status as any)) as any;
    }

    const result = await baseQuery.where(condition).orderBy(desc(orders.createdAt));

    return SuccessResponse(res, {
        message: "Fetched restaurant orders successfully",
        data: result
    });
};

export const getOrderDetails = async (req: Request, res: Response) => {
    // 👈 هنجيب الـ orderId والـ restaurantId من الـ params
    const { orderId, restaurantId } = req.params;

    const result = await db
        .select({
            orderNumber: orders.orderNumber,
            internalId: orders.id,
            restaurantId: orders.restaurantId, // 👈 ضفنا الـ restaurantId في النتيجة برضه لو محتاجه
            orderDate: orders.createdAt,
            totalAmount: orders.totalAmount,
            orderStatus: orders.status,
            subtotal: orders.subtotal,
            deliveryFee: orders.deliveryFee,
            serviceFee: orders.serviceFee,
            paymentMethod: orders.paymentMethod,



            customerName: users.name,
            customerPhone: users.phone,

            addressTitle: addresses.title,
            street: addresses.street,
            buildingNumber: addresses.number,
            floor: addresses.floor,
            lat: addresses.lat,
            lng: addresses.lng,
        })
        .from(orders)
        .leftJoin(users, eq(orders.userId, users.id))
        .leftJoin(addresses, eq(orders.addressId, addresses.id))
        .where(
            // 👈 شرط الأمان: لازم الـ id بتاع الأوردر يطابق، وكمان يكون تبع المطعم ده
            and(
                eq(orders.id, orderId),
                eq(orders.restaurantId, restaurantId)
            )
        )
        .limit(1);

    if (!result || result.length === 0) {
        // رسالة الخطأ دلوقتي بتغطي الحالتين (مش موجود أصلاً، أو موجود بس بتاع مطعم تاني)
        throw new NotFound("Order not found");
    }

    return SuccessResponse(res, {
        message: "Order details fetched successfully",
        data: result[0]
    });
};

export const getAllOrders = async (req: Request, res: Response) => {
    const result = await db.select({
        orderId: orders.orderNumber,
        internalId: orders.id,
        orderDate: orders.createdAt,
        totalAmount: orders.totalAmount,
        orderStatus: orders.status,
        customerName: users.name,
        customerPhone: users.phone,
        restaurantName: restaurants.name,
        restaurantId: restaurants.id,
        paymentMethod: orders.paymentMethod,
        orderType: orders.orderType,
        deliveryFee: orders.deliveryFee,
        serviceFee: orders.serviceFee,
        appCommission: orders.appCommission,
        discountAmount: orders.discountAmount,
        rating: orders.rating,
        ratingComment: orders.ratingComment,
        cancelReason: orders.cancelReason,
        cancelReasonId: orders.cancelReasonId,
        note: orders.note,
        dailyOrderNumber: orders.dailyOrderNumber,
    })
    .from(orders)
    .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
    .leftJoin(users, eq(orders.userId, users.id))
    .orderBy(desc(orders.createdAt));
    return SuccessResponse(res, {
        message: "All orders fetched successfully",
        data: result
    });
}



// ==========================================
// 3. تحديث حالة الأوردر (مع إرجاع الفلوس والعمولة لو المطعم كنسل)
// تحديث حالة الأوردر (إرجاع المحفظة + التسوية + إضافة النقاط عند delivered)
// ==========================================
export const updateOrderStatus = async (req: Request, res: Response) => {
    const { orderId } = req.params;
    const { status, cancelReasonId } = req.body;

    const adminRestaurantId = req.user?.restaurantId || req.user?.id;
    const adminBranchId = req.user?.branchId;

    if (!status) throw new BadRequest("Status is required");

    if (status === "cancelled" && !cancelReasonId) {
        throw new BadRequest("Cancel reason ID is required when cancelling an order");
    }

    const [existingOrder] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!existingOrder) throw new NotFound("Order not found");

    // Only restaurant admins are restricted to their own restaurant/branch.
    // SuperAdmins (type === "super_admin") can update any order.
    const isSuperAdmin = req.user?.type === "super_admin";
    if (!isSuperAdmin) {
        if (existingOrder.restaurantId !== adminRestaurantId) throw new BadRequest("Unauthorized");
        if (adminBranchId && existingOrder.branchId !== adminBranchId) throw new BadRequest("Unauthorized");
    }

    const currentStatus = existingOrder.status as string;

    const finalStatuses = ["delivered", "cancelled", "refund"];
    if (finalStatuses.includes(currentStatus)) {
        throw new BadRequest(`Order is already ${currentStatus} and cannot be changed`);
    }

    const statusFlowOrder: Record<string, number> = {
        "pending": 1,
        "accepted": 2,
        "preparing": 3,
        "out_for_delivery": 4,
        "delivered": 5,
    };

    if (statusFlowOrder[currentStatus] && statusFlowOrder[status]) {
        if (statusFlowOrder[status] === statusFlowOrder[currentStatus]) {
            throw new BadRequest(`Order is already ${currentStatus}`);
        }
        if (statusFlowOrder[status] < statusFlowOrder[currentStatus]) {
            throw new BadRequest(`Cannot revert status from ${currentStatus} to ${status}`);
        }
    } else if (currentStatus === status) {
        throw new BadRequest(`Order is already ${currentStatus}`);
    }

    let reason: any = null;
    if (status === "cancelled") {
        const [found] = await db.select().from(selectReasons)
            .where(and(eq(selectReasons.id, cancelReasonId), eq(selectReasons.type, "restaurant")))
            .limit(1);
        if (!found) throw new BadRequest("Invalid cancel reason for restaurant");
        reason = found;
    }

    await db.transaction(async (tx) => {
        // 1. تحديث حالة الطلب
        await tx.update(orders)
            .set({
                status: status,
                cancelReasonId: status === "cancelled" ? reason.id : null,
                cancelReason: status === "cancelled" ? reason.name : null,
                updatedAt: new Date()
            })
            .where(eq(orders.id, orderId));

        // ==========================================
        // 💰 2. الـ Refund لمحفظة العميل (User Wallet) عند الإلغاء
        // ==========================================
        if (status === "cancelled" || status === "rejected") {
            // البحث هل تم الدفع سابقاً بواسطة المحفظة
            const [walletTx] = await tx.select().from(userWalletTransactions)
                .where(and(
                    eq(userWalletTransactions.reference, existingOrder.orderNumber),
                    eq(userWalletTransactions.transactionType, "order_payment")
                )).limit(1);

            if (walletTx) {
                const [userWallet] = await tx.select().from(userWallets)
                    .where(eq(userWallets.userId, existingOrder.userId)).limit(1);

                if (userWallet) {
                    const balanceBefore = parseFloat(userWallet.balance ?? "0.00");
                    const amountToRefund = parseFloat(existingOrder.totalAmount as string || "0.00");
                    const newBalance = balanceBefore + amountToRefund;

                    // تحديث رصيد محفظة العميل
                    await tx.update(userWallets)
                        .set({
                            balance: newBalance.toFixed(2),
                            updatedAt: new Date()
                        })
                        .where(eq(userWallets.id, userWallet.id));

                    // إضافة حركة إرجاع الرصيد (Refund Transaction)
                    await tx.insert(userWalletTransactions).values({
                        id: uuidv4(),
                        userId: existingOrder.userId,
                        paymentMethodId: existingOrder.paymentMethod ?? null,
                        type: "credit",
                        transactionType: "refund",
                        amount: amountToRefund.toFixed(2),
                        balanceBefore: balanceBefore.toFixed(2),
                        reference: existingOrder.orderNumber,
                        status: "approved",
                        createdAt: new Date()
                    });
                }
            }

            // ==========================================
            // 💰 3. التسوية العكسية لمحفظة المطعم (Restaurant Wallet Reversal)
            // ==========================================
            const [payment] = await tx.select().from(paymentMethods).where(eq(paymentMethods.id, existingOrder.paymentMethod)).limit(1);
            const pmName = (payment?.name || "").toLowerCase();
            const isCashPayment = pmName.includes("cash") || pmName.includes("استلام");

            const appCommission = parseFloat(existingOrder.appCommission as string || "0");
            const serviceFee = parseFloat(existingOrder.serviceFee as string || "0");
            const totalAmount = parseFloat(existingOrder.totalAmount as string || "0");
            const subtotal = parseFloat(existingOrder.subtotal as string || "0");
            const deliveryFee = parseFloat(existingOrder.deliveryFee as string || "0");

            const appDues = appCommission + serviceFee;
            const restaurantEarning = subtotal + deliveryFee - appCommission;

            let [restWallet] = await tx.select().from(restaurantWallets)
                .where(eq(restaurantWallets.restaurantId, existingOrder.restaurantId)).limit(1);

            if (!restWallet) {
                await tx.insert(restaurantWallets).values({ id: uuidv4(), restaurantId: existingOrder.restaurantId });
                [restWallet] = await tx.select().from(restaurantWallets)
                    .where(eq(restaurantWallets.restaurantId, existingOrder.restaurantId)).limit(1);
            }

            let currentBalance = parseFloat(restWallet.balance as string || "0");
            let currentCollectedCash = parseFloat(restWallet.collectedCash as string || "0");
            let currentTotalEarning = parseFloat(restWallet.totalEarning as string || "0");

            if (isCashPayment) {
                currentBalance += appDues;
                currentCollectedCash -= totalAmount;
            } else {
                currentBalance -= restaurantEarning;
            }
            currentTotalEarning -= restaurantEarning;

            const balanceAfterPenalty = currentBalance - appDues;

            await tx.update(restaurantWallets)
                .set({
                    balance: balanceAfterPenalty.toFixed(2),
                    collectedCash: currentCollectedCash.toFixed(2),
                    totalEarning: currentTotalEarning.toFixed(2),
                    updatedAt: new Date()
                })
                .where(eq(restaurantWallets.restaurantId, existingOrder.restaurantId));

            await tx.insert(restaurantWalletTransactions).values({
                id: uuidv4(),
                restaurantId: existingOrder.restaurantId,
                type: "order_payment",
                amount: `-${appDues.toFixed(2)}`,
                balanceBefore: currentBalance.toFixed(2),
                balanceAfter: balanceAfterPenalty.toFixed(2),
                method: existingOrder.paymentMethod,
                reference: existingOrder.orderNumber,
                note: `Order Reversal & Penalty: Cancelled by restaurant. Commission deducted: ${appDues}`,
                createdAt: new Date()
            });
        }

        // ==========================================
        // ⭐ LOYALTY POINTS: إضافة نقاط المطعم عند التوصيل (DELIVERED)
        // ==========================================
        if (status === "delivered") {
            const items = await tx
                .select({ foodId: orderItems.foodId, quantity: orderItems.quantity })
                .from(orderItems)
                .where(eq(orderItems.orderId, orderId));

            if (items.length > 0) {
                const foodIds = items.map(i => i.foodId);

                const enrolledRows = await tx
                    .select({ foodId: pointsProducts.foodId, isActive: pointsProducts.isActive })
                    .from(pointsProducts)
                    .where(
                        and(
                            eq(pointsProducts.restaurantId, existingOrder.restaurantId),
                            inArray(pointsProducts.foodId, foodIds)
                        )
                    );

                const enrolledMap = new Map(
                    enrolledRows.filter(r => r.isActive).map(r => [r.foodId, true])
                );

                if (enrolledMap.size > 0) {
                    const enrolledFoodIds = foodIds.filter(id => enrolledMap.has(id));
                    const foodPoints = await tx
                        .select({ id: food.id, points: food.points })
                        .from(food)
                        .where(inArray(food.id, enrolledFoodIds));

                    const foodPointsMap = new Map(foodPoints.map(f => [f.id, f.points ?? 0]));

                    let totalPointsEarned = 0;
                    for (const item of items) {
                        if (enrolledMap.has(item.foodId)) {
                            totalPointsEarned += (foodPointsMap.get(item.foodId) ?? 0) * item.quantity;
                        }
                    }

                    if (totalPointsEarned > 0) {
                        let [userPointRecord] = await tx
                            .select()
                            .from(userRestaurantPoints)
                            .where(
                                and(
                                    eq(userRestaurantPoints.userId, existingOrder.userId),
                                    eq(userRestaurantPoints.restaurantId, existingOrder.restaurantId)
                                )
                            )
                            .limit(1);

                        if (!userPointRecord) {
                            const newPointId = uuidv4();
                            await tx.insert(userRestaurantPoints).values({
                                id: newPointId,
                                userId: existingOrder.userId,
                                restaurantId: existingOrder.restaurantId,
                                points: 0,
                            });
                            [userPointRecord] = await tx
                                .select()
                                .from(userRestaurantPoints)
                                .where(eq(userRestaurantPoints.id, newPointId))
                                .limit(1);
                        }

                        const pointsBefore = userPointRecord.points ?? 0;
                        const pointsAfter = pointsBefore + totalPointsEarned;

                        await tx
                            .update(userRestaurantPoints)
                            .set({ points: pointsAfter, updatedAt: new Date() })
                            .where(eq(userRestaurantPoints.id, userPointRecord.id));

                        await tx.insert(userPointsTransactions).values({
                            id: uuidv4(),
                            userId: existingOrder.userId,
                            restaurantId: existingOrder.restaurantId,
                            type: "earn",
                            points: totalPointsEarned,
                            balanceBefore: pointsBefore,
                            balanceAfter: pointsAfter,
                            orderId: orderId,
                            note: `Earned ${totalPointsEarned} points from order #${existingOrder.orderNumber}`,
                            createdAt: new Date(),
                        });
                    }
                }
            }
        }
    });

    // ==========================================
    // 4. إرسال الإشعارات للعميل
    // ==========================================
    let messageBody = `Your order ${existingOrder.orderNumber} is now ${status}.`;
    if (status === "cancelled") {
        messageBody = `Your order ${existingOrder.orderNumber} was cancelled. Reason: ${reason?.name || "Not specified"}`;
    }

    await sendPushNotification({
        recipientType: "user",
        recipientId: existingOrder.userId,
        title: "Order Update",
        body: messageBody,
        data: {
            orderId: existingOrder.id,
            orderNumber: existingOrder.orderNumber,
            status: status,
            type: "ORDER_STATUS_UPDATE"
        }
    });

    return SuccessResponse(res, { message: `Order status successfully updated to ${status}` });
};

// جلب أسباب الإلغاء حسب النوع (user أو restaurant)
export const getReasons = async (req: Request, res: Response) => {
    const type = req.query.type as string;

    const conditions: any[] = [eq(selectReasons.status, "active")];
    if (type === "user" || type === "restaurant") {
        conditions.push(eq(selectReasons.type, type));
    }

    const reasons = await db
        .select()
        .from(selectReasons)
        .where(and(...conditions));

    return SuccessResponse(res, {
        message: "Active reasons fetched successfully",
        data: reasons
    });
};
