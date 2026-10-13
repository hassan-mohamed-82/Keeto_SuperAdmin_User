import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    orders,
    deliveryMen,
    shippingCompanies,
    dispatchAssignments,
} from "../../models/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError } from "../../Errors";
import { catchAsync } from "../../utils/catchAsync";

// =========================================================================
// 1. Summary Report (Orders count, commission, avg assign/delivery times)
// =========================================================================
export const getSummaryReport = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const { fromDate, toDate } = req.query;

    const [company] = await db
        .select({
            commissionType: shippingCompanies.commissionType,
            commissionValue: shippingCompanies.commissionValue,
        })
        .from(shippingCompanies)
        .where(eq(shippingCompanies.id, companyId))
        .limit(1);

    const conditions = [
        eq(orders.shippingCompanyId, companyId),
    ];

    if (fromDate && typeof fromDate === "string") {
        conditions.push(sql`${orders.createdAt} >= ${fromDate}`);
    }

    if (toDate && typeof toDate === "string") {
        conditions.push(sql`${orders.createdAt} <= ${toDate}`);
    }

    const whereClause = and(...conditions);

    // Fetch aggregate statistics
    const [stats] = await db
        .select({
            totalOrders: sql<number>`COUNT(*)`,
            assignedOrders: sql<number>`SUM(CASE WHEN ${orders.shippingStatus} = 'assigned' THEN 1 ELSE 0 END)`,
            pickedUpOrders: sql<number>`SUM(CASE WHEN ${orders.shippingStatus} = 'picked_up' THEN 1 ELSE 0 END)`,
            deliveredOrders: sql<number>`SUM(CASE WHEN ${orders.shippingStatus} = 'delivered' THEN 1 ELSE 0 END)`,
            manualRequiredOrders: sql<number>`SUM(CASE WHEN ${orders.shippingStatus} = 'manual_required' THEN 1 ELSE 0 END)`,
            totalDeliveryFees: sql<string>`COALESCE(SUM(CASE WHEN ${orders.shippingStatus} = 'delivered' THEN ${orders.deliveryFee} ELSE 0 END), 0)`,
            avgAssignSeconds: sql<number>`COALESCE(AVG(CASE WHEN ${orders.shippingAssignedAt} IS NOT NULL THEN TIMESTAMPDIFF(SECOND, ${orders.createdAt}, ${orders.shippingAssignedAt}) ELSE NULL END), 0)`,
            avgDeliverySeconds: sql<number>`COALESCE(AVG(CASE WHEN ${orders.deliveredAt} IS NOT NULL AND ${orders.shippingAssignedAt} IS NOT NULL THEN TIMESTAMPDIFF(SECOND, ${orders.shippingAssignedAt}, ${orders.deliveredAt}) ELSE NULL END), 0)`,
        })
        .from(orders)
        .where(whereClause);

    // Calculate commission (D8)
    const commType = company?.commissionType || "percentage";
    const commVal = parseFloat(company?.commissionValue || "0");
    const deliveredCount = Number(stats?.deliveredOrders || 0);
    const totalFees = parseFloat(String(stats?.totalDeliveryFees || "0"));

    let estimatedCommission = 0;
    if (commType === "percentage") {
        estimatedCommission = totalFees * (commVal / 100);
    } else {
        estimatedCommission = deliveredCount * commVal;
    }

    return SuccessResponse(res, {
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
export const getCourierPerformanceReport = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const { fromDate, toDate, courierId } = req.query;

    const conditions = [
        eq(deliveryMen.shippingCompanyId, companyId),
        eq(deliveryMen.isDeleted, false),
    ];

    if (courierId && typeof courierId === "string") {
        conditions.push(eq(deliveryMen.id, courierId));
    }

    const courierList = await db
        .select({
            id: deliveryMen.id,
            name: deliveryMen.name,
            phone: deliveryMen.phone,
            workType: deliveryMen.workType,
            allZones: deliveryMen.allZones,
            isOnline: deliveryMen.isOnline,
            activeOrdersCount: deliveryMen.activeOrdersCount,
        })
        .from(deliveryMen)
        .where(and(...conditions));

    // Gather metrics for each courier
    const result = await Promise.all(
        courierList.map(async (c) => {
            const assignmentConditions = [
                eq(dispatchAssignments.deliveryManId, c.id),
                eq(dispatchAssignments.shippingCompanyId, companyId),
            ];

            if (fromDate && typeof fromDate === "string") {
                assignmentConditions.push(sql`${dispatchAssignments.createdAt} >= ${fromDate}`);
            }
            if (toDate && typeof toDate === "string") {
                assignmentConditions.push(sql`${dispatchAssignments.createdAt} <= ${toDate}`);
            }

            const [assignStats] = await db
                .select({
                    totalOffered: sql<number>`COUNT(*)`,
                    rejected: sql<number>`SUM(CASE WHEN ${dispatchAssignments.status} = 'rejected' THEN 1 ELSE 0 END)`,
                    completed: sql<number>`SUM(CASE WHEN ${dispatchAssignments.status} = 'completed' THEN 1 ELSE 0 END)`,
                })
                .from(dispatchAssignments)
                .where(and(...assignmentConditions));

            // Delivered orders metrics from orders table
            const orderConditions = [
                eq(orders.deliveryManId, c.id),
                eq(orders.shippingCompanyId, companyId),
                eq(orders.shippingStatus, "delivered"),
            ];

            if (fromDate && typeof fromDate === "string") {
                orderConditions.push(sql`${orders.createdAt} >= ${fromDate}`);
            }
            if (toDate && typeof toDate === "string") {
                orderConditions.push(sql`${orders.createdAt} <= ${toDate}`);
            }

            const [orderStats] = await db
                .select({
                    deliveredCount: sql<number>`COUNT(*)`,
                    avgDeliverySeconds: sql<number>`COALESCE(AVG(CASE WHEN ${orders.deliveredAt} IS NOT NULL AND ${orders.pickedUpAt} IS NOT NULL THEN TIMESTAMPDIFF(SECOND, ${orders.pickedUpAt}, ${orders.deliveredAt}) ELSE NULL END), 0)`,
                })
                .from(orders)
                .where(and(...orderConditions));

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
        })
    );

    return SuccessResponse(res, {
        message: "Courier performance report retrieved successfully",
        data: result,
    });
});
