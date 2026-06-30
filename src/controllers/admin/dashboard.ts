import { Request, Response } from "express";
import { db } from "../../models/connection";
import { 
    orders, restaurants, users, selectReasons, 
    zones, cities, addresses, restaurant_users, restaurantWallets,
    dashboardTargets
} from "../../models/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError } from "../../Errors";
import { BadRequest } from "../../Errors/BadRequest";

// =============================================
// 1. SuperAdmin Dashboard Analytics
// GET /dashboard/analytics?startDate=&endDate=
// =============================================
export const getSuperAdminDashboard = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    
    const { startDate, endDate } = req.query;
    const orderConditions = [];
    
    if (startDate) orderConditions.push(gte(orders.createdAt, new Date(startDate as string)));
    if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        orderConditions.push(lte(orders.createdAt, end));
    }
    const orderWhere = orderConditions.length > 0 ? and(...orderConditions) : undefined;

  
    const [
        totalRestaurantsData,
        walletsData,
        totalCustomersData,
        totalsData,
        trendData,
        restPerfData,
        acqData,
        cancelData,
        sourceData,
        locData,
        targetsData
    ] = await Promise.all([
        db.select({
            id: restaurants.id,
            status: restaurants.status
        }).from(restaurants),

        db.select({ balance: restaurantWallets.balance }).from(restaurantWallets),

        db.select({ count: sql<number>`count(${users.id})` }).from(users),

        db.select({
            orders: sql<number>`count(${orders.id})`,
            deliveredOrders: sql<number>`SUM(CASE WHEN ${orders.status} = 'delivered' THEN 1 ELSE 0 END)`,
            revenue: sql<number>`SUM(CASE WHEN ${orders.status} = 'delivered' THEN ${orders.totalAmount} ELSE 0 END)`
        }).from(orders).where(orderWhere),

        db.select({
            month: sql<string>`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`,
            revenue: sql<number>`SUM(CASE WHEN ${orders.status} = 'delivered' THEN ${orders.totalAmount} ELSE 0 END)`
        })
        .from(orders)
        .where(orderWhere)
        .groupBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`)
        .orderBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`),

        db.select({
            restaurantId: restaurants.id,
            restaurantName: restaurants.name,
            status: restaurants.status,
            totalRevenue: sql<number>`SUM(CASE WHEN ${orders.status} = 'delivered' THEN ${orders.totalAmount} ELSE 0 END)`,
            totalOrders: sql<number>`SUM(CASE WHEN ${orders.status} = 'delivered' THEN 1 ELSE 0 END)`
        })
        .from(restaurants)
        .leftJoin(orders, eq(orders.restaurantId, restaurants.id))
        .groupBy(restaurants.id),

        db.select({
            restaurantId: restaurant_users.restaurantId,
            restaurantName: restaurants.name,
            usersCount: sql<number>`count(${restaurant_users.id})`
        })
        .from(restaurant_users)
        .leftJoin(restaurants, eq(restaurant_users.restaurantId, restaurants.id))
        .groupBy(restaurant_users.restaurantId)
        .orderBy(desc(sql`count(${restaurant_users.id})`))
        .limit(5),

        // 8. أسباب الإلغاء (Pie Chart)
        db.select({
            type: selectReasons.type,
            count: sql<number>`count(${orders.id})`
        })
        .from(orders)
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .where(and(eq(orders.status, 'cancelled'), orderWhere))
        .groupBy(selectReasons.type),

        // 9. مصادر الطلبات (Donut Chart)
        db.select({
            source: orders.orderSource,
            count: sql<number>`count(${orders.id})`
        }).from(orders).where(orderWhere).groupBy(orders.orderSource),

        // 10. الطلبات حسب المدينة والمنطقة
        db.select({
            cityName: cities.name,
            zoneName: zones.name,
            ordersCount: sql<number>`count(${orders.id})`
        })
        .from(orders)
        .innerJoin(addresses, eq(orders.addressId, addresses.id))
        .innerJoin(zones, eq(addresses.zoneId, zones.id))
        .innerJoin(cities, eq(zones.cityId, cities.id))
        .where(orderWhere)
        .groupBy(cities.id, zones.id),

        // 11. Dashboard Targets
        db.select().from(dashboardTargets).limit(1)
    ]);



    // --- Cards Calculations ---
    const totalRestaurants = totalRestaurantsData.length;
    const activeRestaurants = totalRestaurantsData.filter(r => r.status === 'active').length;
    const totalCustomers = totalCustomersData[0]?.count || 0;
    const totalOrders = Number(totalsData[0]?.orders || 0);
    const totalRevenue = Number(totalsData[0]?.revenue || 0);
    const deliveredOrders = Number(totalsData[0]?.deliveredOrders || 0);

    let payableToRestaurant = 0; // المنصة مديونة للمطاعم (+)
    let receivableFromRestaurants = 0; // المطاعم مديونة للمنصة (-)
    
    walletsData.forEach(w => {
        const bal = parseFloat(w.balance as string || "0");
        if (bal > 0) payableToRestaurant += bal;
        else if (bal < 0) receivableFromRestaurants += Math.abs(bal);
    });

    // Monthly Growth %
    let monthlyGrowth = 0;
    if (trendData.length >= 2) {
        const currentM = Number(trendData[trendData.length - 1].revenue || 0);
        const prevM = Number(trendData[trendData.length - 2].revenue || 0);
        if (prevM > 0) monthlyGrowth = ((currentM - prevM) / prevM) * 100;
        else monthlyGrowth = 100;
    }

    // --- Dynamic Segmentation ---
    let totalRevSum = 0;
    let revRestCount = 0;
    restPerfData.forEach(r => {
        const rev = Number(r.totalRevenue || 0);
        if (rev > 0) { totalRevSum += rev; revRestCount++; }
    });
    
    const avgRev = revRestCount > 0 ? totalRevSum / revRestCount : 0;
    const highThreshold = avgRev * 1.5;
    const lowThreshold = avgRev * 0.5;

    const segmentation = { high: 0, medium: 0, low: 0, inactive: 0 };
    restPerfData.forEach(rp => {
        const rev = Number(rp.totalRevenue || 0);
        if (rp.status !== "active" || rev === 0) segmentation.inactive++;
        else if (rev >= highThreshold) segmentation.high++;
        else if (rev >= lowThreshold) segmentation.medium++;
        else segmentation.low++;
    });

    // --- Matrix Data (X: Customers, Y: Orders, Bubble: Revenue) ---
    const performanceMatrix = restPerfData.map(rp => {
        const acq = acqData.find(a => a.restaurantId === rp.restaurantId);
        return {
            restaurantName: rp.restaurantName,
            customers: Number(acq?.usersCount || 0), // X
            orders: Number(rp.totalOrders || 0),     // Y
            revenue: Number(rp.totalRevenue || 0)    // Bubble Size
        };
    }).filter(m => m.orders > 0 || m.customers > 0);

    // --- Cancellation Rate ---
    const cancellationRate = { user: 0, restaurant: 0, system: 0 };
    cancelData.forEach(c => {
        if (c.type === 'user') cancellationRate.user += Number(c.count);
        else if (c.type === 'restaurant') cancellationRate.restaurant += Number(c.count);
        else cancellationRate.system += Number(c.count);
    });

    // --- Gauge Data (مقارنة الأرقام الفعلية بالتارجت اللي الأدمن دخله) ---
    const target = targetsData.length > 0 ? targetsData[0] : null;
    
    const gaugeData = {
        orders: {
            current: totalOrders,
            target: target?.totalOrdersTarget || 0,
            percentage: target?.totalOrdersTarget && target.totalOrdersTarget > 0 
                ? Math.min(((totalOrders / target.totalOrdersTarget) * 100), 100).toFixed(1)
                : "0.0"
        },
        customers: {
            current: totalCustomers,
            target: target?.totalCustomersTarget || 0,
            percentage: target?.totalCustomersTarget && target.totalCustomersTarget > 0
                ? Math.min(((totalCustomers / target.totalCustomersTarget) * 100), 100).toFixed(1)
                : "0.0"
        },
        restaurants: {
            current: totalRestaurants,
            target: target?.totalRestaurantsTarget || 0,
            percentage: target?.totalRestaurantsTarget && target.totalRestaurantsTarget > 0
                ? Math.min(((totalRestaurants / target.totalRestaurantsTarget) * 100), 100).toFixed(1)
                : "0.0"
        }
    };

    // ==========================================
    // 4. بناء الـ Response النهائي للـ Frontend
    // ==========================================
    return SuccessResponse(res, {
        message: "Super Admin Dashboard Data fetched successfully",
        data: {
            cards: {
                totalRestaurants,
                activeRestaurants,
                totalRevenue: totalRevenue.toFixed(2),
                totalOrders,
                monthlyGrowthPercentage: monthlyGrowth.toFixed(2),
                totalCustomers,
                payableToRestaurant: payableToRestaurant.toFixed(2),
                receivableFromRestaurants: receivableFromRestaurants.toFixed(2),
            },
            charts: {
                // Horizontal Bar
                restaurantsRanking: restPerfData
                    .map(r => ({ name: r.restaurantName, revenue: Number(r.totalRevenue || 0) }))
                    .sort((a, b) => b.revenue - a.revenue)
                    .slice(0, 10), // Top 10 for clean UI
                
                // Line Chart
                revenueTrend: trendData.map(t => ({ month: t.month, revenue: Number(t.revenue).toFixed(2) })),
                
                // Donut Chart 1
                restaurantSegmentation: segmentation,
                
                // Pie Chart
                cancellationRate,
                
                // Donut Chart 2
                ordersBySource: sourceData.map(s => ({ source: s.source, orders: Number(s.count) })),
                
                // Location Chart (Map or Bar)
                ordersByLocation: locData.map(l => ({ city: l.cityName, zone: l.zoneName, orders: Number(l.ordersCount) })),
                
                // Gauge Chart (مبني على التارجت)
                gaugeData,
                
                // Vertical Bar Chart
                userAcquisitionTop5: acqData.map(a => ({ restaurantName: a.restaurantName, usersAcquired: Number(a.usersCount) })),
                
                // Bubble Chart (4-Quadrant Matrix)
                performanceMatrix
            },
            // الأرقام المستهدفة
            targets: target ? {
                totalOrdersTarget: target.totalOrdersTarget,
                totalCustomersTarget: target.totalCustomersTarget,
                totalRestaurantsTarget: target.totalRestaurantsTarget,
            } : null
        }
    });
};

// =============================================
// 2. Get Dashboard Targets
// GET /dashboard/targets
// =============================================
export const getDashboardTargets = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const targets = await db.select().from(dashboardTargets).limit(1);

    return SuccessResponse(res, {
        message: "Dashboard targets fetched successfully",
        data: targets.length > 0 ? targets[0] : null,
    });
};

// =============================================
// 3. Create / Update Dashboard Targets (Upsert)
// PUT /dashboard/targets
// Body: { totalOrdersTarget, totalCustomersTarget, totalRestaurantsTarget }
// =============================================
export const upsertDashboardTargets = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { totalOrdersTarget, totalCustomersTarget, totalRestaurantsTarget } = req.body;

    if (totalOrdersTarget === undefined && totalCustomersTarget === undefined && totalRestaurantsTarget === undefined) {
        throw new BadRequest("At least one target value is required");
    }

    // شوف لو فيه Row موجودة بالفعل
    const existing = await db.select().from(dashboardTargets).limit(1);

    if (existing.length > 0) {
        // Update
        const updateData: any = { updatedAt: new Date() };
        if (totalOrdersTarget !== undefined) updateData.totalOrdersTarget = totalOrdersTarget;
        if (totalCustomersTarget !== undefined) updateData.totalCustomersTarget = totalCustomersTarget;
        if (totalRestaurantsTarget !== undefined) updateData.totalRestaurantsTarget = totalRestaurantsTarget;

        await db.update(dashboardTargets)
            .set(updateData)
            .where(eq(dashboardTargets.id, existing[0].id));

        const [updated] = await db.select().from(dashboardTargets).where(eq(dashboardTargets.id, existing[0].id));

        return SuccessResponse(res, {
            message: "Dashboard targets updated successfully",
            data: updated,
        });
    } else {
        // Insert
        await db.insert(dashboardTargets).values({
            totalOrdersTarget: totalOrdersTarget || 0,
            totalCustomersTarget: totalCustomersTarget || 0,
            totalRestaurantsTarget: totalRestaurantsTarget || 0,
        });

        const [created] = await db.select().from(dashboardTargets).limit(1);

        return SuccessResponse(res, {
            message: "Dashboard targets created successfully",
            data: created,
        }, 201);
    }
};
