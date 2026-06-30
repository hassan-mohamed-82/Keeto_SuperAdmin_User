"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertDashboardTargets = exports.getDashboardTargets = exports.getSuperAdminDashboard = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const BadRequest_1 = require("../../Errors/BadRequest");
// =============================================
// 1. SuperAdmin Dashboard Analytics
// GET /dashboard/analytics?startDate=&endDate=
// =============================================
const getSuperAdminDashboard = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const { startDate, endDate } = req.query;
    const orderConditions = [];
    if (startDate)
        orderConditions.push((0, drizzle_orm_1.gte)(schema_1.orders.createdAt, new Date(startDate)));
    if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        orderConditions.push((0, drizzle_orm_1.lte)(schema_1.orders.createdAt, end));
    }
    const orderWhere = orderConditions.length > 0 ? (0, drizzle_orm_1.and)(...orderConditions) : undefined;
    const [totalRestaurantsData, walletsData, totalCustomersData, totalsData, trendData, restPerfData, acqData, cancelData, sourceData, locData, targetsData] = await Promise.all([
        connection_1.db.select({
            id: schema_1.restaurants.id,
            status: schema_1.restaurants.status
        }).from(schema_1.restaurants),
        connection_1.db.select({ balance: schema_1.restaurantWallets.balance }).from(schema_1.restaurantWallets),
        connection_1.db.select({ count: (0, drizzle_orm_1.sql) `count(${schema_1.users.id})` }).from(schema_1.users),
        connection_1.db.select({
            orders: (0, drizzle_orm_1.sql) `count(${schema_1.orders.id})`,
            deliveredOrders: (0, drizzle_orm_1.sql) `SUM(CASE WHEN ${schema_1.orders.status} = 'delivered' THEN 1 ELSE 0 END)`,
            revenue: (0, drizzle_orm_1.sql) `SUM(CASE WHEN ${schema_1.orders.status} = 'delivered' THEN ${schema_1.orders.totalAmount} ELSE 0 END)`
        }).from(schema_1.orders).where(orderWhere),
        connection_1.db.select({
            month: (0, drizzle_orm_1.sql) `DATE_FORMAT(${schema_1.orders.createdAt}, '%Y-%m')`,
            revenue: (0, drizzle_orm_1.sql) `SUM(CASE WHEN ${schema_1.orders.status} = 'delivered' THEN ${schema_1.orders.totalAmount} ELSE 0 END)`
        })
            .from(schema_1.orders)
            .where(orderWhere)
            .groupBy((0, drizzle_orm_1.sql) `DATE_FORMAT(${schema_1.orders.createdAt}, '%Y-%m')`)
            .orderBy((0, drizzle_orm_1.sql) `DATE_FORMAT(${schema_1.orders.createdAt}, '%Y-%m')`),
        connection_1.db.select({
            restaurantId: schema_1.restaurants.id,
            restaurantName: schema_1.restaurants.name,
            status: schema_1.restaurants.status,
            totalRevenue: (0, drizzle_orm_1.sql) `SUM(CASE WHEN ${schema_1.orders.status} = 'delivered' THEN ${schema_1.orders.totalAmount} ELSE 0 END)`,
            totalOrders: (0, drizzle_orm_1.sql) `SUM(CASE WHEN ${schema_1.orders.status} = 'delivered' THEN 1 ELSE 0 END)`
        })
            .from(schema_1.restaurants)
            .leftJoin(schema_1.orders, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
            .groupBy(schema_1.restaurants.id),
        connection_1.db.select({
            restaurantId: schema_1.restaurant_users.restaurantId,
            restaurantName: schema_1.restaurants.name,
            usersCount: (0, drizzle_orm_1.sql) `count(${schema_1.restaurant_users.id})`
        })
            .from(schema_1.restaurant_users)
            .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.restaurant_users.restaurantId, schema_1.restaurants.id))
            .groupBy(schema_1.restaurant_users.restaurantId)
            .orderBy((0, drizzle_orm_1.desc)((0, drizzle_orm_1.sql) `count(${schema_1.restaurant_users.id})`))
            .limit(5),
        // 8. أسباب الإلغاء (Pie Chart)
        connection_1.db.select({
            type: schema_1.selectReasons.type,
            count: (0, drizzle_orm_1.sql) `count(${schema_1.orders.id})`
        })
            .from(schema_1.orders)
            .leftJoin(schema_1.selectReasons, (0, drizzle_orm_1.eq)(schema_1.orders.cancelReasonId, schema_1.selectReasons.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.status, 'cancelled'), orderWhere))
            .groupBy(schema_1.selectReasons.type),
        // 9. مصادر الطلبات (Donut Chart)
        connection_1.db.select({
            source: schema_1.orders.orderSource,
            count: (0, drizzle_orm_1.sql) `count(${schema_1.orders.id})`
        }).from(schema_1.orders).where(orderWhere).groupBy(schema_1.orders.orderSource),
        // 10. الطلبات حسب المدينة والمنطقة
        connection_1.db.select({
            cityName: schema_1.cities.name,
            zoneName: schema_1.zones.name,
            ordersCount: (0, drizzle_orm_1.sql) `count(${schema_1.orders.id})`
        })
            .from(schema_1.orders)
            .innerJoin(schema_1.addresses, (0, drizzle_orm_1.eq)(schema_1.orders.addressId, schema_1.addresses.id))
            .innerJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.addresses.zoneId, schema_1.zones.id))
            .innerJoin(schema_1.cities, (0, drizzle_orm_1.eq)(schema_1.zones.cityId, schema_1.cities.id))
            .where(orderWhere)
            .groupBy(schema_1.cities.id, schema_1.zones.id),
        // 11. Dashboard Targets
        connection_1.db.select().from(schema_1.dashboardTargets).limit(1)
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
        const bal = parseFloat(w.balance || "0");
        if (bal > 0)
            payableToRestaurant += bal;
        else if (bal < 0)
            receivableFromRestaurants += Math.abs(bal);
    });
    // Monthly Growth %
    let monthlyGrowth = 0;
    if (trendData.length >= 2) {
        const currentM = Number(trendData[trendData.length - 1].revenue || 0);
        const prevM = Number(trendData[trendData.length - 2].revenue || 0);
        if (prevM > 0)
            monthlyGrowth = ((currentM - prevM) / prevM) * 100;
        else
            monthlyGrowth = 100;
    }
    // --- Dynamic Segmentation ---
    let totalRevSum = 0;
    let revRestCount = 0;
    restPerfData.forEach(r => {
        const rev = Number(r.totalRevenue || 0);
        if (rev > 0) {
            totalRevSum += rev;
            revRestCount++;
        }
    });
    const avgRev = revRestCount > 0 ? totalRevSum / revRestCount : 0;
    const highThreshold = avgRev * 1.5;
    const lowThreshold = avgRev * 0.5;
    const segmentation = { high: 0, medium: 0, low: 0, inactive: 0 };
    restPerfData.forEach(rp => {
        const rev = Number(rp.totalRevenue || 0);
        if (rp.status !== "active" || rev === 0)
            segmentation.inactive++;
        else if (rev >= highThreshold)
            segmentation.high++;
        else if (rev >= lowThreshold)
            segmentation.medium++;
        else
            segmentation.low++;
    });
    // --- Matrix Data (X: Customers, Y: Orders, Bubble: Revenue) ---
    const performanceMatrix = restPerfData.map(rp => {
        const acq = acqData.find(a => a.restaurantId === rp.restaurantId);
        return {
            restaurantName: rp.restaurantName,
            customers: Number(acq?.usersCount || 0), // X
            orders: Number(rp.totalOrders || 0), // Y
            revenue: Number(rp.totalRevenue || 0) // Bubble Size
        };
    }).filter(m => m.orders > 0 || m.customers > 0);
    // --- Cancellation Rate ---
    const cancellationRate = { user: 0, restaurant: 0, system: 0 };
    cancelData.forEach(c => {
        if (c.type === 'user')
            cancellationRate.user += Number(c.count);
        else if (c.type === 'restaurant')
            cancellationRate.restaurant += Number(c.count);
        else
            cancellationRate.system += Number(c.count);
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
    return (0, response_1.SuccessResponse)(res, {
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
exports.getSuperAdminDashboard = getSuperAdminDashboard;
// =============================================
// 2. Get Dashboard Targets
// GET /dashboard/targets
// =============================================
const getDashboardTargets = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const targets = await connection_1.db.select().from(schema_1.dashboardTargets).limit(1);
    return (0, response_1.SuccessResponse)(res, {
        message: "Dashboard targets fetched successfully",
        data: targets.length > 0 ? targets[0] : null,
    });
};
exports.getDashboardTargets = getDashboardTargets;
// =============================================
// 3. Create / Update Dashboard Targets (Upsert)
// PUT /dashboard/targets
// Body: { totalOrdersTarget, totalCustomersTarget, totalRestaurantsTarget }
// =============================================
const upsertDashboardTargets = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const { totalOrdersTarget, totalCustomersTarget, totalRestaurantsTarget } = req.body;
    if (totalOrdersTarget === undefined && totalCustomersTarget === undefined && totalRestaurantsTarget === undefined) {
        throw new BadRequest_1.BadRequest("At least one target value is required");
    }
    // شوف لو فيه Row موجودة بالفعل
    const existing = await connection_1.db.select().from(schema_1.dashboardTargets).limit(1);
    if (existing.length > 0) {
        // Update
        const updateData = { updatedAt: new Date() };
        if (totalOrdersTarget !== undefined)
            updateData.totalOrdersTarget = totalOrdersTarget;
        if (totalCustomersTarget !== undefined)
            updateData.totalCustomersTarget = totalCustomersTarget;
        if (totalRestaurantsTarget !== undefined)
            updateData.totalRestaurantsTarget = totalRestaurantsTarget;
        await connection_1.db.update(schema_1.dashboardTargets)
            .set(updateData)
            .where((0, drizzle_orm_1.eq)(schema_1.dashboardTargets.id, existing[0].id));
        const [updated] = await connection_1.db.select().from(schema_1.dashboardTargets).where((0, drizzle_orm_1.eq)(schema_1.dashboardTargets.id, existing[0].id));
        return (0, response_1.SuccessResponse)(res, {
            message: "Dashboard targets updated successfully",
            data: updated,
        });
    }
    else {
        // Insert
        await connection_1.db.insert(schema_1.dashboardTargets).values({
            totalOrdersTarget: totalOrdersTarget || 0,
            totalCustomersTarget: totalCustomersTarget || 0,
            totalRestaurantsTarget: totalRestaurantsTarget || 0,
        });
        const [created] = await connection_1.db.select().from(schema_1.dashboardTargets).limit(1);
        return (0, response_1.SuccessResponse)(res, {
            message: "Dashboard targets created successfully",
            data: created,
        }, 201);
    }
};
exports.upsertDashboardTargets = upsertDashboardTargets;
