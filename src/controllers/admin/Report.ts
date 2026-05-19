// controllers/admin/FinancialReportController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { orders, restaurants, restaurantBusinessPlans } from "../../models/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError } from "../../Errors";

// 1. تعريف الأنواع المسموحة للـ Enums
type OrderStatus = "pending" | "accepted" | "preparing" | "out_for_delivery" | "delivered" | "cancelled" | "rejected" | "refund";
type PaymentMethod = "cash_on_delivery" | "visa" | "wallet";

// ==========================================
// API 1: التقرير المالي العام (القديم)
// ==========================================
export const getFinancialReport = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { restaurantId, startDate, endDate, status, paymentMethod } = req.query;

    const conditions = [];

    if (restaurantId) {
        conditions.push(eq(orders.restaurantId, restaurantId as string));
    }
    
    // 👇 التعديل هنا: استخدام الأنواع اللي عرفناها فوق بدل as string
    if (status) {
        conditions.push(eq(orders.status, status as OrderStatus)); 
    }
    if (paymentMethod) {
        conditions.push(eq(orders.paymentMethod, paymentMethod as PaymentMethod)); 
    }
    // 👆
    
    if (startDate) {
        conditions.push(gte(orders.createdAt, new Date(startDate as string)));
    }
    if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(orders.createdAt, end));
    }

    // ... باقي الكود زي ما هو بدون تعديل ...
    const reportData = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            status: orders.status,
            paymentMethod: orders.paymentMethod,
            orderType: orders.orderType,
            
            subtotal: orders.subtotal,
            deliveryFee: orders.deliveryFee,
            serviceFee: orders.serviceFee,
            appCommission: orders.appCommission,
            totalAmount: orders.totalAmount,
            
            createdAt: orders.createdAt,
            
            restaurantId: restaurants.id,
            restaurantName: restaurants.name,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(orders.createdAt));

    let totalRevenue = 0; 
    let totalAppCommission = 0; 
    let totalCashCollected = 0; 
    let totalDigitalCollected = 0; 
    let totalDeliveredOrders = 0;
    let totalCancelledOrders = 0;

    reportData.forEach((order) => {
        const amount = parseFloat(order.totalAmount as string || "0");
        const commission = parseFloat(order.appCommission as string || "0");

        if (order.status === "delivered") {
            totalRevenue += amount;
            totalAppCommission += commission;
            totalDeliveredOrders += 1;

            if (order.paymentMethod === "cash_on_delivery") {
                totalCashCollected += amount;
            } else {
                totalDigitalCollected += amount;
            }
        } else if (order.status === "cancelled" || order.status === "rejected") {
            totalCancelledOrders += 1;
        }
    });

    const summary = {
        totalOrders: reportData.length,
        totalDeliveredOrders,
        totalCancelledOrders,
        financials: {
            totalRevenue: totalRevenue.toFixed(2),
            totalAppCommission: totalAppCommission.toFixed(2),
            totalCashCollected: totalCashCollected.toFixed(2),
            totalDigitalCollected: totalDigitalCollected.toFixed(2),
        }
    };

    return SuccessResponse(res, {
        message: "Financial report generated successfully",
        data: {
            summary,
            orders: reportData
        }
    });
};

// ==========================================
// API 2: تقرير تفصيلي حسب كل مطعم (الجديد)
// ==========================================
export const getDetailedRestaurantReport = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { startDate, endDate } = req.query;

    // ==========================================
    // 1. بناء شروط الفلترة بالتاريخ
    // ==========================================
    const conditions = [];

    // بنجيب بس الأوردرات المسلمة (delivered) عشان الحسابات المالية
    conditions.push(eq(orders.status, "delivered" as OrderStatus));

    if (startDate) {
        conditions.push(gte(orders.createdAt, new Date(startDate as string)));
    }
    if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(orders.createdAt, end));
    }

    // ==========================================
    // 2. جلب كل الأوردرات المسلمة مع بيانات المطعم
    // ==========================================
    const deliveredOrders = await db
        .select({
            orderId: orders.id,
            orderSource: orders.orderSource,
            paymentMethod: orders.paymentMethod,
            subtotal: orders.subtotal,
            deliveryFee: orders.deliveryFee,
            serviceFee: orders.serviceFee,
            appCommission: orders.appCommission,
            totalAmount: orders.totalAmount,
            restaurantId: restaurants.id,
            restaurantName: restaurants.name,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .where(and(...conditions));

    // ==========================================
    // 3. جلب خطط العمل لكل المطاعم
    // ==========================================
    const allBusinessPlans = await db
        .select()
        .from(restaurantBusinessPlans);

    // عمل Map عشان نوصل لخطة كل مطعم بسرعة
    const businessPlansMap: Record<string, typeof allBusinessPlans> = {};
    for (const plan of allBusinessPlans) {
        if (!businessPlansMap[plan.restaurantId]) {
            businessPlansMap[plan.restaurantId] = [];
        }
        businessPlansMap[plan.restaurantId].push(plan);
    }

    // ==========================================
    // 4. تجميع البيانات حسب كل مطعم
    // ==========================================
    interface RestaurantEntry {
        restaurantId: string;
        restaurantName: string;
        totalOrders: number;
        onlineOrders: number;
        totalOrdersAmount: number;
        totalCashAmount: number;
        totalDigitalAmount: number;
        totalAppCommission: number;
        totalServiceFee: number;
        totalDeliveryFee: number;
    }

    const restaurantMap: Record<string, RestaurantEntry> = {};
    let grandTotalAmount = 0;

    for (const order of deliveredOrders) {
        const rId = order.restaurantId || "unknown";
        const rName = order.restaurantName || "Unknown Restaurant";

        if (!restaurantMap[rId]) {
            restaurantMap[rId] = {
                restaurantId: rId,
                restaurantName: rName,
                totalOrders: 0,
                onlineOrders: 0,
                totalOrdersAmount: 0,
                totalCashAmount: 0,
                totalDigitalAmount: 0,
                totalAppCommission: 0,
                totalServiceFee: 0,
                totalDeliveryFee: 0,
            };
        }

        const entry = restaurantMap[rId];
        const amount = parseFloat(order.totalAmount as string || "0");
        const commission = parseFloat(order.appCommission as string || "0");
        const svcFee = parseFloat(order.serviceFee as string || "0");
        const dlvFee = parseFloat(order.deliveryFee as string || "0");

        entry.totalOrders += 1;
        entry.totalOrdersAmount += amount;
        entry.totalAppCommission += commission;
        entry.totalServiceFee += svcFee;
        entry.totalDeliveryFee += dlvFee;
        grandTotalAmount += amount;

        if (order.orderSource === "online_order") {
            entry.onlineOrders += 1;
        }

        if (order.paymentMethod === "cash_on_delivery") {
            entry.totalCashAmount += amount;
        } else {
            entry.totalDigitalAmount += amount;
        }
    }

    // ==========================================
    // 5. بناء الـ Response لكل مطعم مع خطة العمل والعمولة
    // ==========================================
    const restaurantReports = Object.values(restaurantMap).map(entry => {
        const plans = businessPlansMap[entry.restaurantId] || [];

        // حساب العمولة بناءً على نسبة الخطة
        let commissionRate = "0.00";
        let calculatedCommission = 0;

        if (plans.length > 0) {
            // لو عنده خطة online_order نستخدمها
            const onlinePlan = plans.find(p => p.platformType === "online_order");
            const activePlan = onlinePlan || plans[0];
            commissionRate = activePlan.commissionRate || "0.00";
            const rate = parseFloat(commissionRate);
            calculatedCommission = (entry.totalOrdersAmount * rate) / 100;
        }

        return {
            restaurantId: entry.restaurantId,
            restaurantName: entry.restaurantName,

            // عدد الأوردرات
            totalOrders: entry.totalOrders,
            onlineOrders: entry.onlineOrders,

            // الماليات
            totalOrdersAmount: entry.totalOrdersAmount.toFixed(2),
            totalCashAmount: entry.totalCashAmount.toFixed(2),
            totalDigitalAmount: entry.totalDigitalAmount.toFixed(2),
            totalServiceFee: entry.totalServiceFee.toFixed(2),
            totalDeliveryFee: entry.totalDeliveryFee.toFixed(2),

            // خطة العمل
            businessPlan: plans.map(p => ({
                platformType: p.platformType,
                commissionRate: p.commissionRate || "0.00",
                serviceFee: p.serviceFee || "0.00",
            })),

            // العمولة
            commissionRate: commissionRate + "%",
            calculatedCommission: calculatedCommission.toFixed(2),
            recordedAppCommission: entry.totalAppCommission.toFixed(2),
        };
    });

    // ==========================================
    // 6. الـ Response النهائي
    // ==========================================
    return SuccessResponse(res, {
        message: "Detailed restaurant report generated successfully",
        data: {
            grandTotalOrdersAmount: grandTotalAmount.toFixed(2),
            totalRestaurants: restaurantReports.length,
            restaurants: restaurantReports,
        }
    });
};