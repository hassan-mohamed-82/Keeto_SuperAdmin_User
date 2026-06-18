import { Request, Response } from "express";
import { db } from "../../models/connection";
import { 
    orders, restaurants, users, selectReasons, 
    zones, cities, addresses, restaurant_users, restaurantWallets 
} from "../../models/schema";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError } from "../../Errors";

export const getSuperAdminDashboard = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    // ==========================================
    // 1. فلترة التاريخ (Date Filter)
    // ==========================================
    const { startDate, endDate } = req.query;
    const orderConditions = [];
    
    if (startDate) orderConditions.push(gte(orders.createdAt, new Date(startDate as string)));
    if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        orderConditions.push(lte(orders.createdAt, end));
    }
    const orderWhere = orderConditions.length > 0 ? and(...orderConditions) : undefined;

    // ==========================================
    // 2. تنفيذ كل الاستعلامات في نفس اللحظة (Parallel Execution) لسرعة خرافية 🚀
    // ==========================================
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
        locData
    ] = await Promise.all([
        // 1. المطاعم (النشطة والإجمالي)
        db.select({
            id: restaurants.id,
            status: restaurants.status
        }).from(restaurants),

        // 2. المحافظ (Payable & Receivable)
        db.select({ balance: restaurantWallets.balance }).from(restaurantWallets),

        // 3. إجمالي العملاء في المنصة
        db.select({ count: sql<number>`count(${users.id})` }).from(users),

        // 4. إجمالي الطلبات والمبيعات
        db.select({
            orders: sql<number>`count(${orders.id})`,
            deliveredOrders: sql<number>`SUM(CASE WHEN ${orders.status} = 'delivered' THEN 1 ELSE 0 END)`,
            revenue: sql<number>`SUM(CASE WHEN ${orders.status} = 'delivered' THEN ${orders.totalAmount} ELSE 0 END)`
        }).from(orders).where(orderWhere),

        // 5. تريند المبيعات الشهري (Line Chart)
        db.select({
            month: sql<string>`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`,
            revenue: sql<number>`SUM(CASE WHEN ${orders.status} = 'delivered' THEN ${orders.totalAmount} ELSE 0 END)`
        })
        .from(orders)
        .where(orderWhere)
        .groupBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`)
        .orderBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`),

        // 6. أداء كل مطعم (Revenue & Orders) للرانكينج والماتريكس
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

        // 7. الاستحواذ على العملاء (Top 5 User Acquisition)
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
        .groupBy(cities.id, zones.id)
    ]);

    // ==========================================
    // 3. معالجة الداتا للحصول على المؤشرات المطلوبة (Data Processing)
    // ==========================================

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

    // --- Gauge Score (Platform Health Metric 0-100) ---
    // 60% weight on Delivery Success Rate + 40% weight on Active Restaurants Ratio
    const deliveryRate = totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : 0;
    const activeRatio = totalRestaurants > 0 ? (activeRestaurants / totalRestaurants) * 100 : 0;
    const gaugeScore = (deliveryRate * 0.6) + (activeRatio * 0.4);

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
                
                // Gauge Chart Score
                platformHealthScore: gaugeScore.toFixed(1),
                
                // Vertical Bar Chart
                userAcquisitionTop5: acqData.map(a => ({ restaurantName: a.restaurantName, usersAcquired: Number(a.usersCount) })),
                
                // Bubble Chart (4-Quadrant Matrix)
                performanceMatrix
            }
        }
    });
};