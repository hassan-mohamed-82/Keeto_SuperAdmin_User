// controllers/user/OrderController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { orders, orderItems, restaurantBusinessPlans, food, restaurants, restaurantWallets, restaurantZoneDeliveryFees, zoneDeliveryFees, restaurantSettings, restaurantSchedules } from "../../models/schema";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";
export const checkout = async (req: Request, res: Response) => {
    // ⚠️ أضفنا orderType عشان نعرف العميل عايز الأكل إزاي (دليفري، تيك أواي، صالة)
    const { userId, items, orderSource, paymentMethod, userZoneId, orderType } = req.body;

    // 1. جلب بيانات الأكل والتأكد من وحدة المطعم
    const foodIds = items.map((i: any) => i.foodId);
    const dbFoods = await db.select().from(food).where(inArray(food.id, foodIds));

    if (dbFoods.length === 0) throw new BadRequest("السلة فارغة أو الأصناف غير موجودة");

    const restaurantIds = [...new Set(dbFoods.map(f => f.restaurantid))];
    if (restaurantIds.length > 1) {
        throw new BadRequest("عفواً، لا يمكن الطلب من أكثر من مطعم في نفس الأوردر");
    }
    const restaurantId = restaurantIds[0];

    // 2. جلب المطعم، الإعدادات، وخطة العمل
    const [restaurantInfo] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
    const [settings] = await db.select().from(restaurantSettings).where(eq(restaurantSettings.restaurantId, restaurantId)).limit(1);
    const [plan] = await db.select().from(restaurantBusinessPlans).where(
        and(eq(restaurantBusinessPlans.restaurantId, restaurantId), eq(restaurantBusinessPlans.platformType, orderSource))
    ).limit(1);

    if (!restaurantInfo || !settings || !plan) throw new BadRequest("إعدادات المطعم أو الخطة المالية غير مكتملة");

    // ==========================================
    // 🔥 3. شيك مواعيد العمل (هل المطعم مفتوح؟)
    // ==========================================
    if (!settings.isAlwaysOpen) {
        const now = new Date();
        const currentDay = now.getDay(); // 0 (Sunday) to 6 (Saturday)
        const currentTime = now.toTimeString().substring(0, 5); // "HH:MM"

        const todaySchedules = await db.select().from(restaurantSchedules)
            .where(and(eq(restaurantSchedules.restaurantId, restaurantId), eq(restaurantSchedules.dayOfWeek, currentDay)));

        if (todaySchedules.length === 0 || todaySchedules[0].isOffDay) {
            throw new BadRequest("عفواً، المطعم مغلق اليوم (عطلة).");
        }

        const isOpen = todaySchedules.some(schedule => {
            return currentTime >= schedule.openingTime! && currentTime <= schedule.closingTime!;
        });

        if (!isOpen) throw new BadRequest("عفواً، المطعم مغلق في هذا الوقت.");
    }

    // ==========================================
    // 🔥 4. شيك نوع الأوردر وحساب التوصيل
    // ==========================================
    let calculatedDeliveryFee = 0;

    if (orderType === "delivery") {
        if (!settings.homeDelivery && !settings.selfDelivery) {
            throw new BadRequest("هذا المطعم لا يدعم خدمة التوصيل");
        }

        if (settings.selfDelivery) {
            // المطعم بيوصل بنفسه
            const [selfFee] = await db.select().from(restaurantZoneDeliveryFees).where(
                and(eq(restaurantZoneDeliveryFees.restaurantId, restaurantId), eq(restaurantZoneDeliveryFees.zoneId, userZoneId))
            ).limit(1);
            if (!selfFee) throw new BadRequest("عفواً، عنوانك خارج نطاق توصيل هذا المطعم");
            calculatedDeliveryFee = parseFloat(selfFee.deliveryFee);
        } else if (settings.homeDelivery) {
            // المنصة بتوصل
            const [platformFee] = await db.select().from(zoneDeliveryFees).where(
                and(eq(zoneDeliveryFees.fromZoneId, restaurantInfo.zoneId), eq(zoneDeliveryFees.toZoneId, userZoneId))
            ).limit(1);
            if (!platformFee) throw new BadRequest("عفواً، المنصة لا تغطي التوصيل بين هاتين المنطقتين");
            calculatedDeliveryFee = parseFloat(platformFee.fee);
        }
    } else if (orderType === "takeaway") {
        if (!settings.takeaway) throw new BadRequest("المطعم لا يدعم خدمة الاستلام من الفرع (Takeaway)");
        calculatedDeliveryFee = 0; // التيك أواي ملوش توصيل
    } else if (orderType === "dine_in") {
        if (!settings.dineIn) throw new BadRequest("المطعم لا يدعم خدمة تناول الطعام بالصالة (Dine-in)");
        calculatedDeliveryFee = 0;
    }

    // ==========================================
    // 5. حساب الأصناف والتأكد من الحد الأدنى
    // ==========================================
    let subtotal = 0;
    const itemsToInsert = items.map((item: any) => {
        const itemFood = dbFoods.find(f => f.id === item.foodId);
        subtotal += parseFloat(itemFood!.price) * item.quantity;
        return { id: uuidv4(), foodId: item.foodId, quantity: item.quantity, price: itemFood!.price };
    });

    if (subtotal < parseFloat(settings.minOrderAmount || "0")) {
        throw new BadRequest(`الحد الأدنى للطلب من هذا المطعم هو ${settings.minOrderAmount} ج.م`);
    }

    // ==========================================
    // 6. الحسابات النهائية للمحفظة والتنفيذ
    // ==========================================
    const commissionAmount = (subtotal * parseFloat(plan.commissionRate || "0")) / 100;
    const serviceFee = parseFloat(plan.serviceFee || "0");
    const totalAmount = subtotal + calculatedDeliveryFee + serviceFee;
    
    const appProfit = commissionAmount + serviceFee;
    const restaurantProfit = (subtotal - commissionAmount) + (settings.selfDelivery && orderType === "delivery" ? calculatedDeliveryFee : 0);

    const orderNumber = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
    const orderId = uuidv4();

    await db.transaction(async (tx) => {
        await tx.insert(orders).values({
            id: orderId, orderNumber, userId, restaurantId, orderSource, paymentMethod, orderType, // ضفنا orderType
            subtotal: subtotal.toString(), deliveryFee: calculatedDeliveryFee.toString(),
            serviceFee: serviceFee.toString(), appCommission: commissionAmount.toString(),
            totalAmount: totalAmount.toString(), status: "pending"
        });

        await tx.insert(orderItems).values(itemsToInsert.map((i: any) => ({ ...i, orderId })));

        const [wallet] = await tx.select().from(restaurantWallets).where(eq(restaurantWallets.restaurantId, restaurantId)).limit(1);
        if (wallet) {
            if (paymentMethod === "cash") {
                const newCollected = parseFloat(wallet.collectedCash || "0") + appProfit;
                await tx.update(restaurantWallets).set({ collectedCash: newCollected.toString() }).where(eq(restaurantWallets.id, wallet.id));
            } else {
                const newBalance = parseFloat(wallet.balance || "0") + restaurantProfit;
                const newTotalEarning = parseFloat(wallet.totalEarning || "0") + restaurantProfit;
                await tx.update(restaurantWallets).set({ 
                    balance: newBalance.toString(), totalEarning: newTotalEarning.toString() 
                }).where(eq(restaurantWallets.id, wallet.id));
            }
        }
    });

    return SuccessResponse(res, { message: "تم تسجيل طلبك بنجاح", orderNumber });
};

// GET /api/user/orders/:userId
export const getUserOrders = async (req: Request, res: Response) => {
    const { userId } = req.params;

    const userOrders = await db
        .select({
            orderNumber: orders.orderNumber,
            restaurantName: restaurants.name,
            restaurantImage: restaurants.logo, // لو ضايف حقل الصورة
            totalAmount: orders.totalAmount,
            status: orders.status,
            createdAt: orders.createdAt,
            itemsCount: sql<number>`count(${orderItems.id})` // عدد الأصناف في الأوردر
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(orderItems, eq(orders.id, orderItems.orderId))
        .where(eq(orders.userId, userId))
        .groupBy(orders.id)
        .orderBy(desc(orders.createdAt));

    return SuccessResponse(res, { data: userOrders });
};

// GET /api/user/orders/:orderId
export const getOrderDetails = async (req: Request, res: Response) => {
    const { orderId } = req.params;

    // 1. جلب تفاصيل الأوردر الأساسية والفاتورة
    const orderInfo = await db
        .select({
            orderNumber: orders.orderNumber,
            status: orders.status,
            createdAt: orders.createdAt,
            paymentMethod: orders.paymentMethod,
            subtotal: orders.subtotal,
            deliveryFee: orders.deliveryFee,
            serviceFee: orders.serviceFee,
            totalAmount: orders.totalAmount,
            restaurantName: restaurants.name,
            // restaurantImage: restaurants.image // لو موجودة عندك
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .where(eq(orders.id, orderId))
        .limit(1);

    if (!orderInfo[0]) {
        throw new NotFound("Order not found");
    }

    // 2. جلب الأصناف اللي جوه الأوردر (Order Items)
    const items = await db
        .select({
            foodName: food.name, // بنجيب اسم الأكلة من جدول الأكل
            // foodImage: foods.image, 
            quantity: orderItems.quantity,
            price: orderItems.price // 💡 بنعرض السعر اللي اتسجل وقت الطلب، مش السعر الحالي للأكلة
        })
        .from(orderItems)
        .leftJoin(food, eq(orderItems.foodId, food.id))
        .where(eq(orderItems.orderId, orderId));

    // 3. دمج البيانات وإرسالها للفرونت إند
    return SuccessResponse(res, { 
        data: {
            ...orderInfo[0], // بيفرد بيانات الأوردر
            items: items     // بيحط جواها مصفوفة الأصناف
        } 
    });
};