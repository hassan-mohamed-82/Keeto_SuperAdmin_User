import { eq, desc, and } from "drizzle-orm";
import { addresses, orders, restaurants, users } from "../../models/schema";
import { SuccessResponse } from "../../utils/response";
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { NotFound } from "../../Errors";

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