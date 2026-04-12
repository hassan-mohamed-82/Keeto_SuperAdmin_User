import { eq, desc, and } from "drizzle-orm";
import { orders, users } from "../../models/schema";
import { SuccessResponse } from "../../utils/response";
import { Request, Response } from "express";
import { db } from "../../models/connection";
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
        message: "تم جلب طلبات المطعم بنجاح", 
        data: result 
    });
};