"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDetailedRestaurantReport = exports.getFinancialReport = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
// ==========================================
// API 1: التقرير المالي العام (القديم)
// ==========================================
const getFinancialReport = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const { restaurantId, startDate, endDate, status, paymentMethod } = req.query;
    const conditions = [];
    if (restaurantId) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId));
    }
    // 👇 التعديل هنا: استخدام الأنواع اللي عرفناها فوق بدل as string
    if (status) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.status, status));
    }
    if (paymentMethod) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.paymentMethod, paymentMethod));
    }
    // 👆
    if (startDate) {
        conditions.push((0, drizzle_orm_1.gte)(schema_1.orders.createdAt, new Date(startDate)));
    }
    if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        conditions.push((0, drizzle_orm_1.lte)(schema_1.orders.createdAt, end));
    }
    // ... باقي الكود زي ما هو بدون تعديل ...
    const reportData = await connection_1.db
        .select({
        orderId: schema_1.orders.id,
        orderNumber: schema_1.orders.orderNumber,
        status: schema_1.orders.status,
        paymentMethod: schema_1.orders.paymentMethod,
        orderType: schema_1.orders.orderType,
        subtotal: schema_1.orders.subtotal,
        deliveryFee: schema_1.orders.deliveryFee,
        serviceFee: schema_1.orders.serviceFee,
        appCommission: schema_1.orders.appCommission,
        totalAmount: schema_1.orders.totalAmount,
        createdAt: schema_1.orders.createdAt,
        restaurantId: schema_1.restaurants.id,
        restaurantName: schema_1.restaurants.name,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .where(conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined)
        .orderBy((0, drizzle_orm_1.desc)(schema_1.orders.createdAt));
    let totalRevenue = 0;
    let totalAppCommission = 0;
    let totalCashCollected = 0;
    let totalDigitalCollected = 0;
    let totalDeliveredOrders = 0;
    let totalCancelledOrders = 0;
    reportData.forEach((order) => {
        const amount = parseFloat(order.totalAmount || "0");
        const commission = parseFloat(order.appCommission || "0");
        if (order.status === "delivered") {
            totalRevenue += amount;
            totalAppCommission += commission;
            totalDeliveredOrders += 1;
            if (order.paymentMethod === "cash_on_delivery") {
                totalCashCollected += amount;
            }
            else {
                totalDigitalCollected += amount;
            }
        }
        else if (order.status === "cancelled" || order.status === "rejected") {
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
    return (0, response_1.SuccessResponse)(res, {
        message: "Financial report generated successfully",
        data: {
            summary,
            orders: reportData
        }
    });
};
exports.getFinancialReport = getFinancialReport;
// ==========================================
// API 2: تقرير تفصيلي حسب كل مطعم (الجديد)
// ==========================================
const getDetailedRestaurantReport = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const { startDate, endDate } = req.query;
    // ==========================================
    // 1. بناء شروط الفلترة بالتاريخ
    // ==========================================
    const conditions = [];
    // بنجيب بس الأوردرات المسلمة (delivered) عشان الحسابات المالية
    conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.status, "delivered"));
    if (startDate) {
        conditions.push((0, drizzle_orm_1.gte)(schema_1.orders.createdAt, new Date(startDate)));
    }
    if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        conditions.push((0, drizzle_orm_1.lte)(schema_1.orders.createdAt, end));
    }
    // ==========================================
    // 2. جلب كل الأوردرات المسلمة مع بيانات المطعم
    // ==========================================
    const deliveredOrders = await connection_1.db
        .select({
        orderId: schema_1.orders.id,
        orderSource: schema_1.orders.orderSource,
        paymentMethod: schema_1.orders.paymentMethod,
        subtotal: schema_1.orders.subtotal,
        deliveryFee: schema_1.orders.deliveryFee,
        serviceFee: schema_1.orders.serviceFee,
        appCommission: schema_1.orders.appCommission,
        totalAmount: schema_1.orders.totalAmount,
        restaurantId: schema_1.restaurants.id,
        restaurantName: schema_1.restaurants.name,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.and)(...conditions));
    // ==========================================
    // 3. جلب خطط العمل لكل المطاعم
    // ==========================================
    const allBusinessPlans = await connection_1.db
        .select()
        .from(schema_1.restaurantBusinessPlans);
    // عمل Map عشان نوصل لخطة كل مطعم بسرعة
    const businessPlansMap = {};
    for (const plan of allBusinessPlans) {
        if (!businessPlansMap[plan.restaurantId]) {
            businessPlansMap[plan.restaurantId] = [];
        }
        businessPlansMap[plan.restaurantId].push(plan);
    }
    const restaurantMap = {};
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
        const amount = parseFloat(order.totalAmount || "0");
        const commission = parseFloat(order.appCommission || "0");
        const svcFee = parseFloat(order.serviceFee || "0");
        const dlvFee = parseFloat(order.deliveryFee || "0");
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
        }
        else {
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
    return (0, response_1.SuccessResponse)(res, {
        message: "Detailed restaurant report generated successfully",
        data: {
            grandTotalOrdersAmount: grandTotalAmount.toFixed(2),
            totalRestaurants: restaurantReports.length,
            restaurants: restaurantReports,
        }
    });
};
exports.getDetailedRestaurantReport = getDetailedRestaurantReport;
