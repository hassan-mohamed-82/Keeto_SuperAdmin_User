"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCourierPerformanceReport = exports.getSummaryReport = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const catchAsync_1 = require("../../utils/catchAsync");
// =========================================================================
// 1. Summary Report (Orders count, commission, avg assign/delivery times)
// =========================================================================
exports.getSummaryReport = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const { fromDate, toDate } = req.query;
    const [company] = await connection_1.db
        .select({
        commissionType: schema_1.shippingCompanies.commissionType,
        commissionValue: schema_1.shippingCompanies.commissionValue,
    })
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, companyId))
        .limit(1);
    const conditions = [
        (0, drizzle_orm_1.eq)(schema_1.orders.shippingCompanyId, companyId),
    ];
    if (fromDate && typeof fromDate === "string") {
        conditions.push((0, drizzle_orm_1.sql) `${schema_1.orders.createdAt} >= ${fromDate}`);
    }
    if (toDate && typeof toDate === "string") {
        conditions.push((0, drizzle_orm_1.sql) `${schema_1.orders.createdAt} <= ${toDate}`);
    }
    const whereClause = (0, drizzle_orm_1.and)(...conditions);
    // Fetch aggregate statistics
    const [stats] = await connection_1.db
        .select({
        totalOrders: (0, drizzle_orm_1.sql) `COUNT(*)`,
        assignedOrders: (0, drizzle_orm_1.sql) `SUM(CASE WHEN ${schema_1.orders.shippingStatus} = 'assigned' THEN 1 ELSE 0 END)`,
        pickedUpOrders: (0, drizzle_orm_1.sql) `SUM(CASE WHEN ${schema_1.orders.shippingStatus} = 'picked_up' THEN 1 ELSE 0 END)`,
        deliveredOrders: (0, drizzle_orm_1.sql) `SUM(CASE WHEN ${schema_1.orders.shippingStatus} = 'delivered' THEN 1 ELSE 0 END)`,
        manualRequiredOrders: (0, drizzle_orm_1.sql) `SUM(CASE WHEN ${schema_1.orders.shippingStatus} = 'manual_required' THEN 1 ELSE 0 END)`,
        totalDeliveryFees: (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${schema_1.orders.shippingStatus} = 'delivered' THEN ${schema_1.orders.deliveryFee} ELSE 0 END), 0)`,
        avgAssignSeconds: (0, drizzle_orm_1.sql) `COALESCE(AVG(CASE WHEN ${schema_1.orders.shippingAssignedAt} IS NOT NULL THEN TIMESTAMPDIFF(SECOND, ${schema_1.orders.createdAt}, ${schema_1.orders.shippingAssignedAt}) ELSE NULL END), 0)`,
        avgDeliverySeconds: (0, drizzle_orm_1.sql) `COALESCE(AVG(CASE WHEN ${schema_1.orders.deliveredAt} IS NOT NULL AND ${schema_1.orders.shippingAssignedAt} IS NOT NULL THEN TIMESTAMPDIFF(SECOND, ${schema_1.orders.shippingAssignedAt}, ${schema_1.orders.deliveredAt}) ELSE NULL END), 0)`,
    })
        .from(schema_1.orders)
        .where(whereClause);
    // Calculate commission (D8)
    const commType = company?.commissionType || "percentage";
    const commVal = parseFloat(company?.commissionValue || "0");
    const deliveredCount = Number(stats?.deliveredOrders || 0);
    const totalFees = parseFloat(String(stats?.totalDeliveryFees || "0"));
    let estimatedCommission = 0;
    if (commType === "percentage") {
        estimatedCommission = totalFees * (commVal / 100);
    }
    else {
        estimatedCommission = deliveredCount * commVal;
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Summary report retrieved successfully",
        data: {
            orders: {
                total: Number(stats?.totalOrders || 0),
                assigned: Number(stats?.assignedOrders || 0),
                pickedUp: Number(stats?.pickedUpOrders || 0),
                delivered: deliveredCount,
                manualRequired: Number(stats?.manualRequiredOrders || 0),
            },
            financials: {
                totalDeliveryFees: totalFees.toFixed(2),
                commissionType: commType,
                commissionRate: commVal,
                estimatedCommission: estimatedCommission.toFixed(2),
            },
            durations: {
                avgAssignMinutes: (Number(stats?.avgAssignSeconds || 0) / 60).toFixed(1),
                avgDeliveryMinutes: (Number(stats?.avgDeliverySeconds || 0) / 60).toFixed(1),
            },
        },
    });
});
// =========================================================================
// 2. Courier Performance Report (Accepted, rejected, delivered count, avg delivery time)
// =========================================================================
exports.getCourierPerformanceReport = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const { fromDate, toDate, courierId } = req.query;
    const conditions = [
        (0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, companyId),
        (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false),
    ];
    if (courierId && typeof courierId === "string") {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, courierId));
    }
    const courierList = await connection_1.db
        .select({
        id: schema_1.deliveryMen.id,
        name: schema_1.deliveryMen.name,
        phone: schema_1.deliveryMen.phone,
        deliveryType: schema_1.deliveryMen.deliveryType,
        allZones: schema_1.deliveryMen.allZones,
        isOnline: schema_1.deliveryMen.isOnline,
        activeOrdersCount: schema_1.deliveryMen.activeOrdersCount,
    })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)(...conditions));
    // Gather metrics for each courier
    const result = await Promise.all(courierList.map(async (c) => {
        const assignmentConditions = [
            (0, drizzle_orm_1.eq)(schema_1.dispatchAssignments.deliveryManId, c.id),
            (0, drizzle_orm_1.eq)(schema_1.dispatchAssignments.shippingCompanyId, companyId),
        ];
        if (fromDate && typeof fromDate === "string") {
            assignmentConditions.push((0, drizzle_orm_1.sql) `${schema_1.dispatchAssignments.createdAt} >= ${fromDate}`);
        }
        if (toDate && typeof toDate === "string") {
            assignmentConditions.push((0, drizzle_orm_1.sql) `${schema_1.dispatchAssignments.createdAt} <= ${toDate}`);
        }
        const [assignStats] = await connection_1.db
            .select({
            totalOffered: (0, drizzle_orm_1.sql) `COUNT(*)`,
            rejected: (0, drizzle_orm_1.sql) `SUM(CASE WHEN ${schema_1.dispatchAssignments.status} = 'rejected' THEN 1 ELSE 0 END)`,
            completed: (0, drizzle_orm_1.sql) `SUM(CASE WHEN ${schema_1.dispatchAssignments.status} = 'completed' THEN 1 ELSE 0 END)`,
        })
            .from(schema_1.dispatchAssignments)
            .where((0, drizzle_orm_1.and)(...assignmentConditions));
        // Delivered orders metrics from orders table
        const orderConditions = [
            (0, drizzle_orm_1.eq)(schema_1.orders.deliveryManId, c.id),
            (0, drizzle_orm_1.eq)(schema_1.orders.shippingCompanyId, companyId),
            (0, drizzle_orm_1.eq)(schema_1.orders.shippingStatus, "delivered"),
        ];
        if (fromDate && typeof fromDate === "string") {
            orderConditions.push((0, drizzle_orm_1.sql) `${schema_1.orders.createdAt} >= ${fromDate}`);
        }
        if (toDate && typeof toDate === "string") {
            orderConditions.push((0, drizzle_orm_1.sql) `${schema_1.orders.createdAt} <= ${toDate}`);
        }
        const [orderStats] = await connection_1.db
            .select({
            deliveredCount: (0, drizzle_orm_1.sql) `COUNT(*)`,
            avgDeliverySeconds: (0, drizzle_orm_1.sql) `COALESCE(AVG(CASE WHEN ${schema_1.orders.deliveredAt} IS NOT NULL AND ${schema_1.orders.pickedUpAt} IS NOT NULL THEN TIMESTAMPDIFF(SECOND, ${schema_1.orders.pickedUpAt}, ${schema_1.orders.deliveredAt}) ELSE NULL END), 0)`,
        })
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.and)(...orderConditions));
        const totalOffers = Number(assignStats?.totalOffered || 0);
        const totalRejects = Number(assignStats?.rejected || 0);
        const acceptanceRate = totalOffers > 0 ? (((totalOffers - totalRejects) / totalOffers) * 100).toFixed(1) : "100.0";
        return {
            courier: c,
            metrics: {
                totalAssignments: totalOffers,
                rejected: totalRejects,
                acceptanceRate: `${acceptanceRate}%`,
                delivered: Number(orderStats?.deliveredCount || 0),
                avgDeliveryMinutes: (Number(orderStats?.avgDeliverySeconds || 0) / 60).toFixed(1),
            },
        };
    }));
    return (0, response_1.SuccessResponse)(res, {
        message: "Courier performance report retrieved successfully",
        data: result,
    });
});
