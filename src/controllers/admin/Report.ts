// controllers/admin/FinancialReportController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { orders, restaurants, restaurantBusinessPlans } from "../../models/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError } from "../../Errors";
import PDFDocument from "pdfkit";
// 1. تعريف الأنواع المسموحة للـ Enums
type OrderStatus = "pending" | "accepted" | "preparing" | "out_for_delivery" | "delivered" | "cancelled" | "rejected" | "refund";
type PaymentMethod = "cash_on_delivery" | "visa" | "wallet";

// ==========================================
// API 1: التقرير المالي العام 
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
// API 2: تقرير تفصيلي حسب كل مطعم 
// ==========================================
export const getDetailedRestaurantReport = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { startDate, endDate } = req.query;

    // ==========================================
    // 1. Build date filtering conditions
    // ==========================================
    const conditions = [];

    // Only fetch delivered orders for financial calculations
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
    // 2. Fetch all delivered orders with restaurant data
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
    // 3. Fetch business plans for all restaurants
    // ==========================================
    const allBusinessPlans = await db
        .select()
        .from(restaurantBusinessPlans);

    // Create a Map to quickly access each restaurant's plan
    const businessPlansMap: Record<string, typeof allBusinessPlans> = {};
    for (const plan of allBusinessPlans) {
        if (!businessPlansMap[plan.restaurantId]) {
            businessPlansMap[plan.restaurantId] = [];
        }
        businessPlansMap[plan.restaurantId].push(plan);
    }

    // ==========================================
    // 4. Group data by restaurant
    // ==========================================
    interface RestaurantEntry {
        restaurantId: string;
        restaurantName: string;
        totalOrders: number;
        onlineOrders: number;
        aggregatorOrders: number;
        totalOrdersAmount: number;
        totalCashAmount: number;
        totalDigitalAmount: number;
        totalAppCommission: number;
        totalServiceFee: number;
        totalDeliveryFee: number;
        totalSubtotal: number;
    }

    const restaurantMap: Record<string, RestaurantEntry> = {};
    let grandTotalAmount = 0;
    let grandTotalCommission = 0;
    let grandTotalCash = 0;
    let grandTotalDigital = 0;

    for (const order of deliveredOrders) {
        const rId = order.restaurantId || "unknown";
        const rName = order.restaurantName || "Unknown Restaurant";

        if (!restaurantMap[rId]) {
            restaurantMap[rId] = {
                restaurantId: rId,
                restaurantName: rName,
                totalOrders: 0,
                onlineOrders: 0,
                aggregatorOrders: 0,
                totalOrdersAmount: 0,
                totalCashAmount: 0,
                totalDigitalAmount: 0,
                totalAppCommission: 0,
                totalServiceFee: 0,
                totalDeliveryFee: 0,
                totalSubtotal: 0,
            };
        }

        const entry = restaurantMap[rId];
        const amount = parseFloat(order.totalAmount as string || "0");
        const subtotal = parseFloat(order.subtotal as string || "0");
        const commission = parseFloat(order.appCommission as string || "0");
        const svcFee = parseFloat(order.serviceFee as string || "0");
        const dlvFee = parseFloat(order.deliveryFee as string || "0");

        entry.totalOrders += 1;
        entry.totalOrdersAmount += amount;
        entry.totalSubtotal += subtotal;
        entry.totalAppCommission += commission;
        entry.totalServiceFee += svcFee;
        entry.totalDeliveryFee += dlvFee;
        
        grandTotalAmount += amount;
        grandTotalCommission += commission;

        if (order.orderSource === "online_order") {
            entry.onlineOrders += 1;
        } else if (order.orderSource === "food_aggregator") {
            entry.aggregatorOrders += 1;
        }

        if (order.paymentMethod === "cash_on_delivery") {
            entry.totalCashAmount += amount;
            grandTotalCash += amount;
        } else {
            entry.totalDigitalAmount += amount;
            grandTotalDigital += amount;
        }
    }

    // ==========================================
    // 5. Build response for each restaurant with business plan and commission
    // ==========================================
    const restaurantReports = Object.values(restaurantMap).map(entry => {
        const plans = businessPlansMap[entry.restaurantId] || [];

        // Calculate commission based on plan rate
        let commissionRate = "0.00";
        let calculatedCommission = 0;

        if (plans.length > 0) {
            // If they have an online_order plan, use it
            const onlinePlan = plans.find(p => p.platformType === "online_order");
            const activePlan = onlinePlan || plans[0];
            commissionRate = activePlan.commissionRate || "0.00";
            const rate = parseFloat(commissionRate);
            calculatedCommission = (entry.totalSubtotal * rate) / 100;
        }

        // ==========================================
        // 💰 Detailed Financial Calculations
        // ==========================================
        
        // 1️⃣ Total Sales
        const totalSales = entry.totalOrdersAmount;
        
        // 2️⃣ Platform Commission
        const platformCommission = entry.totalAppCommission;
        
        // 3️⃣ Service Fee (For Platform)
        const platformServiceFee = entry.totalServiceFee;
        
        // 4️⃣ Delivery Fee (For Restaurant)
        const restaurantDeliveryFee = entry.totalDeliveryFee;
        
        // 5️⃣ Restaurant Net Sales
        // = Total Sales - Commission - Service Fee
        const restaurantNetSales = totalSales - platformCommission - platformServiceFee;
        
        // 6️⃣ Cash Collected
        const cashCollected = entry.totalCashAmount;
        
        // 7️⃣ Digital Payments (Transferred to Restaurant)
        const digitalPayments = entry.totalDigitalAmount;
        
        // 8️⃣ Cash Due Analysis
        // If the restaurant collected more cash than its due
        // Cash Due = Cash Collected - Restaurant Net Sales from Cash Orders
        const cashOrdersNet = cashCollected - (cashCollected * parseFloat(commissionRate)) / 100 - 
                              (entry.totalServiceFee * (cashCollected / totalSales));
        
        // Restaurant owes platform = Commission + Service Fee from cash orders
        const restaurantOwesToPlatform = (cashCollected * parseFloat(commissionRate)) / 100 + 
                                         (entry.totalServiceFee * (cashCollected / totalSales));
        
        // Platform owes restaurant = Net Digital Sales
        const platformOwesToRestaurant = digitalPayments - 
                                         (digitalPayments * parseFloat(commissionRate)) / 100 - 
                                         (entry.totalServiceFee * (digitalPayments / totalSales));
        
        // Net Balance
        // Positive = Platform owes restaurant
        // Negative = Restaurant owes platform
        const netBalance = platformOwesToRestaurant - restaurantOwesToPlatform;

        return {
            restaurantId: entry.restaurantId,
            restaurantName: entry.restaurantName,

            // 📊 Order Statistics
            orders: {
                total: entry.totalOrders,
                online: entry.onlineOrders,
                aggregator: entry.aggregatorOrders,
            },

            // 💰 Detailed Financials
            financials: {
                // Total Sales
                totalSales: totalSales.toFixed(2),
                subtotal: entry.totalSubtotal.toFixed(2),
                
                // Breakdown by payment method
                cashOrders: cashCollected.toFixed(2),
                digitalOrders: digitalPayments.toFixed(2),
                
                // Fees
                deliveryFee: restaurantDeliveryFee.toFixed(2),
                serviceFee: platformServiceFee.toFixed(2),
                
                // Commission
                commissionRate: commissionRate + "%",
                platformCommission: platformCommission.toFixed(2),
                calculatedCommission: calculatedCommission.toFixed(2),
                
                // Net Sales
                restaurantNetSales: restaurantNetSales.toFixed(2),
            },

            // 💵 Cash Due Analysis
            cashDue: {
                // Cash collected by restaurant
                cashCollectedByRestaurant: cashCollected.toFixed(2),
                
                // Restaurant owes platform (from cash orders)
                restaurantOwesToPlatform: restaurantOwesToPlatform.toFixed(2),
                
                // Platform owes restaurant (from digital orders)
                platformOwesToRestaurant: platformOwesToRestaurant.toFixed(2),
                
                // Net Balance
                netBalance: netBalance.toFixed(2),
                balanceStatus: netBalance > 0 
                    ? `Platform owes restaurant ${Math.abs(netBalance).toFixed(2)} EGP`
                    : netBalance < 0 
                    ? `Restaurant owes platform ${Math.abs(netBalance).toFixed(2)} EGP`
                    : "No pending dues",
            },

            // Business Plan
            businessPlan: plans.map(p => ({
                platformType: p.platformType,
                commissionRate: p.commissionRate || "0.00",
                serviceFee: p.serviceFee || "0.00",
            })),
        };
    });

    // ==========================================
    // 6. Final Response with General Summary
    // ==========================================
    
    // Calculate general summary for all restaurants
    let totalPlatformCommission = 0;
    let totalPlatformOwes = 0;
    let totalRestaurantOwes = 0;
    
    restaurantReports.forEach(report => {
        totalPlatformCommission += parseFloat(report.financials.platformCommission);
        const netBalance = parseFloat(report.cashDue.netBalance);
        if (netBalance > 0) {
            totalPlatformOwes += netBalance;
        } else {
            totalRestaurantOwes += Math.abs(netBalance);
        }
    });

    return SuccessResponse(res, {
        message: "Detailed restaurant report generated successfully",
        data: {
            // General Summary
            summary: {
                totalRestaurants: restaurantReports.length,
                grandTotalSales: grandTotalAmount.toFixed(2),
                grandTotalCash: grandTotalCash.toFixed(2),
                grandTotalDigital: grandTotalDigital.toFixed(2),
                totalPlatformCommission: totalPlatformCommission.toFixed(2),
                totalPlatformOwesToRestaurants: totalPlatformOwes.toFixed(2),
                totalRestaurantsOweToPlatform: totalRestaurantOwes.toFixed(2),
                netPlatformBalance: (totalRestaurantOwes - totalPlatformOwes).toFixed(2),
            },
            
            // Details per restaurant
            restaurants: restaurantReports,
        }
    });
};


// ==========================================
// API 3: تقرير مالي تفصيلي لمطعم واحد (Single Restaurant Report)
// ==========================================
export const getSingleRestaurantReport = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { restaurantId } = req.params;
    const { startDate, endDate } = req.query;

    if (!restaurantId) {
        const { BadRequest } = await import("../../Errors/BadRequest");
        throw new BadRequest("Restaurant ID is required");
    }

    // ==========================================
    // 1. Check if restaurant exists
    // ==========================================
    const restaurant = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

    if (!restaurant[0]) {
        const { NotFound } = await import("../../Errors/NotFound");
        throw new NotFound("Restaurant not found");
    }

    // ==========================================
    // 2. Build filtering conditions
    // ==========================================
    const conditions = [
        eq(orders.restaurantId, restaurantId),
        eq(orders.status, "delivered" as OrderStatus)
    ];

    if (startDate) {
        conditions.push(gte(orders.createdAt, new Date(startDate as string)));
    }
    if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(orders.createdAt, end));
    }

    // ==========================================
    // 3. Fetch all delivered orders
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
        })
        .from(orders)
        .where(and(...conditions));

    // ==========================================
    // 4. Fetch restaurant business plans
    // ==========================================
    const businessPlans = await db
        .select()
        .from(restaurantBusinessPlans)
        .where(eq(restaurantBusinessPlans.restaurantId, restaurantId));

    // ==========================================
    // 5. Group data by order source
    // ==========================================
    interface SourceStats {
        totalOrders: number;
        totalRevenue: number;
        cashAmount: number;
        visaAmount: number;
        walletAmount: number;
        commission: number;
        serviceFee: number;
        deliveryFee: number;
        subtotal: number;
    }

    const sourceMap: Record<string, SourceStats> = {
        online_order: {
            totalOrders: 0,
            totalRevenue: 0,
            cashAmount: 0,
            visaAmount: 0,
            walletAmount: 0,
            commission: 0,
            serviceFee: 0,
            deliveryFee: 0,
            subtotal: 0,
        },
        food_aggregator: {
            totalOrders: 0,
            totalRevenue: 0,
            cashAmount: 0,
            visaAmount: 0,
            walletAmount: 0,
            commission: 0,
            serviceFee: 0,
            deliveryFee: 0,
            subtotal: 0,
        },
        mykeeto: {
            totalOrders: 0,
            totalRevenue: 0,
            cashAmount: 0,
            visaAmount: 0,
            walletAmount: 0,
            commission: 0,
            serviceFee: 0,
            deliveryFee: 0,
            subtotal: 0,
        },
    };

    // Grand total variables
    let grandTotal = {
        orders: 0,
        revenue: 0,
        cash: 0,
        visa: 0,
        wallet: 0,
        commission: 0,
        serviceFee: 0,
        deliveryFee: 0,
        subtotal: 0,
    };

    // ==========================================
    // 6. Process each order
    // ==========================================
    for (const order of deliveredOrders) {
        const source = order.orderSource as string;
        const stats = sourceMap[source];

        if (!stats) continue;

        const amount = parseFloat(order.totalAmount as string || "0");
        const subtotal = parseFloat(order.subtotal as string || "0");
        const commission = parseFloat(order.appCommission as string || "0");
        const serviceFee = parseFloat(order.serviceFee as string || "0");
        const deliveryFee = parseFloat(order.deliveryFee as string || "0");

        stats.totalOrders += 1;
        stats.totalRevenue += amount;
        stats.subtotal += subtotal;
        stats.commission += commission;
        stats.serviceFee += serviceFee;
        stats.deliveryFee += deliveryFee;

        // Breakdown by payment method
        if (order.paymentMethod === "cash_on_delivery") {
            stats.cashAmount += amount;
            grandTotal.cash += amount;
        } else if (order.paymentMethod === "visa") {
            stats.visaAmount += amount;
            grandTotal.visa += amount;
        } else if (order.paymentMethod === "wallet") {
            stats.walletAmount += amount;
            grandTotal.wallet += amount;
        }

        // Totals
        grandTotal.orders += 1;
        grandTotal.revenue += amount;
        grandTotal.subtotal += subtotal;
        grandTotal.commission += commission;
        grandTotal.serviceFee += serviceFee;
        grandTotal.deliveryFee += deliveryFee;
    }

    // ==========================================
    // 7. Calculate dues for each order source
    // ==========================================
    const calculateCashDue = (stats: SourceStats, commissionRate: number) => {
        // Restaurant owes platform (from cash orders)
        const restaurantOwes = (stats.cashAmount * commissionRate) / 100 + 
                               (stats.serviceFee * (stats.cashAmount / stats.totalRevenue || 0));

        // Platform owes restaurant (from digital orders)
        const digitalTotal = stats.visaAmount + stats.walletAmount;
        const platformOwes = digitalTotal - 
                            (digitalTotal * commissionRate) / 100 - 
                            (stats.serviceFee * (digitalTotal / stats.totalRevenue || 0));

        // Net balance
        const netBalance = platformOwes - restaurantOwes;

        return {
            cashCollected: stats.cashAmount,
            restaurantOwesToPlatform: restaurantOwes,
            platformOwesToRestaurant: platformOwes,
            netBalance: netBalance,
        };
    };

    // Get commission rate
    let commissionRate = 0;
    if (businessPlans.length > 0) {
        const onlinePlan = businessPlans.find(p => p.platformType === "online_order");
        const activePlan = onlinePlan || businessPlans[0];
        commissionRate = parseFloat(activePlan.commissionRate || "0");
    }

    // ==========================================
    // 8. Build Response
    // ==========================================
    const reportBySource = Object.entries(sourceMap).map(([source, stats]) => {
        const cashDue = calculateCashDue(stats, commissionRate);
        
        return {
            orderSource: source,
            orderSourceName: 
                source === "online_order" ? "Online Orders" :
                source === "food_aggregator" ? "Aggregator Orders" :
                "Mykeeto Orders",
            
            statistics: {
                totalOrders: stats.totalOrders,
                totalRevenue: stats.totalRevenue.toFixed(2),
                subtotal: stats.subtotal.toFixed(2),
            },

            paymentBreakdown: {
                cash: stats.cashAmount.toFixed(2),
                visa: stats.visaAmount.toFixed(2),
                wallet: stats.walletAmount.toFixed(2),
            },

            fees: {
                deliveryFee: stats.deliveryFee.toFixed(2),
                serviceFee: stats.serviceFee.toFixed(2),
                commission: stats.commission.toFixed(2),
                commissionRate: commissionRate + "%",
            },

            cashDue: {
                cashCollected: cashDue.cashCollected.toFixed(2),
                restaurantOwesToPlatform: cashDue.restaurantOwesToPlatform.toFixed(2),
                platformOwesToRestaurant: cashDue.platformOwesToRestaurant.toFixed(2),
                netBalance: cashDue.netBalance.toFixed(2),
                balanceStatus: cashDue.netBalance > 0 
                    ? `Platform owes restaurant ${Math.abs(cashDue.netBalance).toFixed(2)} EGP`
                    : cashDue.netBalance < 0 
                    ? `Restaurant owes platform ${Math.abs(cashDue.netBalance).toFixed(2)} EGP`
                    : "No pending dues",
            },
        };
    });

    // ==========================================
    // 9. Calculate final totals
    // ==========================================
    const totalCashDue = calculateCashDue({
        totalOrders: grandTotal.orders,
        totalRevenue: grandTotal.revenue,
        cashAmount: grandTotal.cash,
        visaAmount: grandTotal.visa,
        walletAmount: grandTotal.wallet,
        commission: grandTotal.commission,
        serviceFee: grandTotal.serviceFee,
        deliveryFee: grandTotal.deliveryFee,
        subtotal: grandTotal.subtotal,
    }, commissionRate);

    return SuccessResponse(res, {
        message: "Single restaurant report generated successfully",
        data: {
            restaurant: {
                id: restaurant[0].id,
                name: restaurant[0].name,
                nameAr: restaurant[0].nameAr,
                nameFr: restaurant[0].nameFr,
            },

            // Report by order source
            reportBySource: reportBySource,

            // Totals
            totals: {
                totalOrders: grandTotal.orders,
                totalRevenue: grandTotal.revenue.toFixed(2),
                totalSubtotal: grandTotal.subtotal.toFixed(2),

                paymentBreakdown: {
                    cash: grandTotal.cash.toFixed(2),
                    visa: grandTotal.visa.toFixed(2),
                    wallet: grandTotal.wallet.toFixed(2),
                },

                fees: {
                    totalDeliveryFee: grandTotal.deliveryFee.toFixed(2),
                    totalServiceFee: grandTotal.serviceFee.toFixed(2),
                    totalCommission: grandTotal.commission.toFixed(2),
                    commissionRate: commissionRate + "%",
                },

                cashDue: {
                    cashCollected: totalCashDue.cashCollected.toFixed(2),
                    restaurantOwesToPlatform: totalCashDue.restaurantOwesToPlatform.toFixed(2),
                    platformOwesToRestaurant: totalCashDue.platformOwesToRestaurant.toFixed(2),
                    netBalance: totalCashDue.netBalance.toFixed(2),
                    balanceStatus: totalCashDue.netBalance > 0 
                        ? `Platform owes restaurant ${Math.abs(totalCashDue.netBalance).toFixed(2)} EGP`
                        : totalCashDue.netBalance < 0 
                        ? `Restaurant owes platform ${Math.abs(totalCashDue.netBalance).toFixed(2)} EGP`
                        : "No pending dues",
                },
            },

            businessPlan: businessPlans.map(p => ({
                platformType: p.platformType,
                commissionRate: p.commissionRate || "0.00",
                serviceFee: p.serviceFee || "0.00",
            })),
        }
    });
};

// ==========================================
// API 4: Generate Restaurant Invoice PDF
// ==========================================
export const generateRestaurantInvoicePDF = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { restaurantId } = req.params;
    const { startDate, endDate } = req.query;

    if (!restaurantId) {
        const { BadRequest } = await import("../../Errors/BadRequest");
        throw new BadRequest("Restaurant ID is required");
    }

    const restaurant = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

    if (!restaurant[0]) {
        const { NotFound } = await import("../../Errors/NotFound");
        throw new NotFound("Restaurant not found");
    }

    const conditions = [
        eq(orders.restaurantId, restaurantId),
        eq(orders.status, "delivered" as OrderStatus)
    ];

    if (startDate) {
        conditions.push(gte(orders.createdAt, new Date(startDate as string)));
    }
    if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(orders.createdAt, end));
    }

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
        })
        .from(orders)
        .where(and(...conditions));

    const businessPlans = await db
        .select()
        .from(restaurantBusinessPlans)
        .where(eq(restaurantBusinessPlans.restaurantId, restaurantId));

    let grandTotal = {
        orders: 0,
        revenue: 0,
        cash: 0,
        visa: 0,
        wallet: 0,
        commission: 0,
        serviceFee: 0,
        deliveryFee: 0,
        subtotal: 0,
    };

    for (const order of deliveredOrders) {
        const amount = parseFloat(order.totalAmount as string || "0");
        const subtotal = parseFloat(order.subtotal as string || "0");
        const commission = parseFloat(order.appCommission as string || "0");
        const serviceFee = parseFloat(order.serviceFee as string || "0");
        const deliveryFee = parseFloat(order.deliveryFee as string || "0");

        if (order.paymentMethod === "cash_on_delivery") {
            grandTotal.cash += amount;
        } else if (order.paymentMethod === "visa") {
            grandTotal.visa += amount;
        } else if (order.paymentMethod === "wallet") {
            grandTotal.wallet += amount;
        }

        grandTotal.orders += 1;
        grandTotal.revenue += amount;
        grandTotal.subtotal += subtotal;
        grandTotal.commission += commission;
        grandTotal.serviceFee += serviceFee;
        grandTotal.deliveryFee += deliveryFee;
    }

    let commissionRate = 0;
    if (businessPlans.length > 0) {
        const onlinePlan = businessPlans.find(p => p.platformType === "online_order");
        const activePlan = onlinePlan || businessPlans[0];
        commissionRate = parseFloat(activePlan.commissionRate || "0");
    }

    const restaurantOwes = (grandTotal.cash * commissionRate) / 100 + 
                           (grandTotal.serviceFee * (grandTotal.cash / grandTotal.revenue || 0));

    const digitalTotal = grandTotal.visa + grandTotal.wallet;
    const platformOwes = digitalTotal - 
                        (digitalTotal * commissionRate) / 100 - 
                        (grandTotal.serviceFee * (digitalTotal / grandTotal.revenue || 0));

    const netBalance = platformOwes - restaurantOwes;

    // Build PDF
    const doc = new PDFDocument({ margin: 50 });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice_${restaurant[0].name.replace(/\\s+/g, '_')}_${Date.now()}.pdf"`);
    
    doc.pipe(res);
    
    // Header
    doc.fontSize(20).text('Keeto Restaurant Invoice', { align: 'center' });
    doc.moveDown();
    
    // Restaurant Details
    doc.fontSize(14).fillColor('black').text(`Restaurant: ${restaurant[0].name} / ${restaurant[0].nameAr}`);
    doc.fontSize(12).text(`Date Range: ${startDate || 'All Time'} to ${endDate || 'All Time'}`);
    doc.text(`Generated At: ${new Date().toLocaleString()}`);
    doc.moveDown();
    
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();

    // Summary Statistics
    doc.fontSize(16).text('Summary', { underline: true });
    doc.fontSize(12).text(`Total Orders: ${grandTotal.orders}`);
    doc.text(`Total Revenue: ${grandTotal.revenue.toFixed(2)} EGP`);
    doc.text(`Total Subtotal: ${grandTotal.subtotal.toFixed(2)} EGP`);
    doc.moveDown();

    // Payment Breakdown
    doc.fontSize(14).text('Payment Breakdown', { underline: true });
    doc.fontSize(12).text(`Cash on Delivery: ${grandTotal.cash.toFixed(2)} EGP`);
    doc.text(`Visa: ${grandTotal.visa.toFixed(2)} EGP`);
    doc.text(`Wallet: ${grandTotal.wallet.toFixed(2)} EGP`);
    doc.moveDown();

    // Fees
    doc.fontSize(14).text('Fees & Commissions', { underline: true });
    doc.fontSize(12).text(`Commission Rate: ${commissionRate}%`);
    doc.text(`Total App Commission: ${grandTotal.commission.toFixed(2)} EGP`);
    doc.text(`Total Service Fee (to Platform): ${grandTotal.serviceFee.toFixed(2)} EGP`);
    doc.text(`Total Delivery Fee (to Restaurant): ${grandTotal.deliveryFee.toFixed(2)} EGP`);
    doc.moveDown();

    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();

    // Cash Due Analysis
    doc.fontSize(16).text('Cash Due Analysis', { underline: true });
    doc.fontSize(12).text(`Restaurant Owes Platform (from Cash Orders): ${restaurantOwes.toFixed(2)} EGP`);
    doc.text(`Platform Owes Restaurant (from Digital Orders): ${platformOwes.toFixed(2)} EGP`);
    
    doc.moveDown();
    doc.fontSize(14).text('Final Balance:', { continued: true });
    
    if (netBalance > 0) {
        doc.fillColor('green').text(` Platform owes restaurant ${Math.abs(netBalance).toFixed(2)} EGP`);
    } else if (netBalance < 0) {
        doc.fillColor('red').text(` Restaurant owes platform ${Math.abs(netBalance).toFixed(2)} EGP`);
    } else {
        doc.fillColor('black').text(` No pending dues (Settled)`);
    }
    
    doc.end();
};