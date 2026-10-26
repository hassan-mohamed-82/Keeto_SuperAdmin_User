// controllers/admin/FinancialReportController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { orders, restaurants, restaurantBusinessPlans, invoices, paymentMethods, selectReasons, sales, restaurant_users, users, zones, cities, cuisines, restaurantOperations } from "../../models/schema";
import { eq, and, desc, gte, lte, inArray, count, sql, SQL, isNull, ne, or } from "drizzle-orm";
import { getPerformanceReportQuerySchema, getChartsQuerySchema } from "../../validation/admin/report";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound, UnauthorizedError } from "../../Errors";
import PDFDocument from "pdfkit";
import { v4 as uuidv4 } from "uuid";
// 1. تعريف الأنواع المسموحة للـ Enums
type OrderStatus = "pending" | "accepted" | "preparing" | "out_for_delivery" | "delivered" | "cancelled" | "refund";
type PaymentMethod = "cash_on_delivery" | "visa" | "wallet";
const ALL_RESTAURANT_TYPES = ["mega", "super", "A", "B", "C", "C-"] as const;

// Points per restaurant type (mirrors restaurants.ts logic)
const RESTAURANT_TYPE_POINTS: Record<string, number> = {
    mega: 50,
    super: 25,
    a: 10,
    b: 5,
    c: 2,
    "c-": 1,
};

// ==========================================
// API 1: التقرير المالي العام 
// ==========================================
export const getFinancialReport = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    // 1. استقبال متغيرات الفلترة فقط (بدون page و limit)
    const { restaurantId, startDate, endDate, status, paymentMethod, cityId } = req.query;

    const conditions = [];

    if (restaurantId) conditions.push(eq(orders.restaurantId, restaurantId as string));
    if (status) conditions.push(eq(orders.status, status as OrderStatus));
    if (paymentMethod) conditions.push(eq(paymentMethods.name, paymentMethod as string));
    if (cityId) conditions.push(eq(restaurants.cityId, cityId as string));

    if (startDate) conditions.push(gte(orders.createdAt, new Date(startDate as string)));
    if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(orders.createdAt, end));
    }

    // 2. جلب الداتا الأساسية المطلوبة للعمليات الحسابية فقط
    const reportData = await db
        .select({
            status: orders.status,
            orderSource: orders.orderSource,
            paymentMethodName: paymentMethods.name,
            deliveryFee: orders.deliveryFee,
            serviceFee: orders.serviceFee,
            appCommission: orders.appCommission,
            totalAmount: orders.totalAmount,
            cancelReasonType: sql<string | null>`COALESCE(${orders.cancelReasonType}, ${selectReasons.type})`,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .leftJoin(paymentMethods, eq(orders.paymentMethod, paymentMethods.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined);

    // ==========================================
    // 📊 3. تجهيز الكيانات التحليلية (Analytics Entities)
    // ==========================================
    let grandTotalRevenue = 0;
    let grandTotalKeetoCommission = 0;
    let grandTotalServiceFees = 0;
    let grandTotalDeliveryFees = 0;
    let validOrdersCount = 0;
    let totalCanceledByUser = 0;
    let totalCanceledByRestaurant = 0;

    const breakdownByPayment = { cash: 0, visa: 0, wallet: 0 };
    const breakdownBySource: Record<string, { orders: number, revenue: number, commission: number }> = {};
    const breakdownByStatus: Record<string, { orders: number, revenue: number }> = {};

    for (const order of reportData) {
        const isCancelledByUser = order.status === "cancelled" && order.cancelReasonType === "user";
        const isCancelledByRestaurant = order.status === "cancelled" && order.cancelReasonType === "restaurant";

        if (order.status === "cancelled") {
            if (order.cancelReasonType === "user") {
                totalCanceledByUser++;
            } else if (order.cancelReasonType === "restaurant") {
                totalCanceledByRestaurant++;
            }
        }

        // 📈 تجميع الإحصائيات حسب الحالة
        const currentStatus = order.status as string;
        if (!breakdownByStatus[currentStatus]) breakdownByStatus[currentStatus] = { orders: 0, revenue: 0 };
        breakdownByStatus[currentStatus].orders += 1;
        breakdownByStatus[currentStatus].revenue += parseFloat(order.totalAmount as string || "0");

        // 🛑 استبعاد الأوردرات الملغية من الحسابات المالية الصافية
        if (order.status === "cancelled") {
            if (order.cancelReasonType === "restaurant") {
                const commission = parseFloat(order.appCommission as string || "0");
                grandTotalKeetoCommission += commission;

                const source = order.orderSource as string || "unknown";
                if (!breakdownBySource[source]) breakdownBySource[source] = { orders: 0, revenue: 0, commission: 0 };
                breakdownBySource[source].commission += commission;
            }
            continue;
        }

        validOrdersCount++;

        const amount = parseFloat(order.totalAmount as string || "0");
        const commission = parseFloat(order.appCommission as string || "0");
        const svcFee = parseFloat(order.serviceFee as string || "0");
        const dlvFee = parseFloat(order.deliveryFee as string || "0");

        grandTotalRevenue += amount;
        grandTotalKeetoCommission += commission;
        grandTotalServiceFees += svcFee;
        grandTotalDeliveryFees += dlvFee;

        // 📈 تجميع الإحصائيات حسب المصدر (Source)
        const source = order.orderSource as string || "unknown";
        if (!breakdownBySource[source]) breakdownBySource[source] = { orders: 0, revenue: 0, commission: 0 };
        breakdownBySource[source].orders += 1;
        breakdownBySource[source].revenue += amount;
        breakdownBySource[source].commission += commission;

        // 📈 تجميع الإحصائيات حسب طريقة الدفع
        const payment = (order.paymentMethodName || "").toLowerCase();
        if (payment.includes("cash") || payment.includes("استلام")) {
            breakdownByPayment.cash += amount;
        } else if (payment.includes("visa") || payment.includes("بطاقة")) {
            breakdownByPayment.visa += amount;
        } else {
            breakdownByPayment.wallet += amount;
        }
    }

    // ==========================================
    // 🏗️ 4. بناء الـ Response النهائي المالي
    // ==========================================
    const summary = {
        totalAttemptedOrders: reportData.length,
        totalFinanciallyValidOrders: validOrdersCount,
        macroFinancials: {
            grandTotalSales: grandTotalRevenue.toFixed(2),
            keetoTotalCommission: grandTotalKeetoCommission.toFixed(2),
            restaurantsExtraEarnings: {
                totalServiceFees: grandTotalServiceFees.toFixed(2),
                totalDeliveryFees: grandTotalDeliveryFees.toFixed(2),
            }
        },
        cancelBreakdown: {
            user: totalCanceledByUser,
            restaurant: totalCanceledByRestaurant
        },
        collectionBreakdown: {
            cashCollectedByRestaurants: breakdownByPayment.cash.toFixed(2),
            digitalCollectedByPlatform: (breakdownByPayment.visa + breakdownByPayment.wallet).toFixed(2),
            digitalDetails: {
                visa: breakdownByPayment.visa.toFixed(2),
                wallet: breakdownByPayment.wallet.toFixed(2)
            }
        },
        sourceBreakdown: Object.entries(breakdownBySource).map(([source, stats]) => ({
            source,
            ordersCount: stats.orders,
            revenue: stats.revenue.toFixed(2),
            keetoCommission: stats.commission.toFixed(2)
        })),
        statusBreakdown: Object.entries(breakdownByStatus).map(([status, stats]) => ({
            status,
            ordersCount: stats.orders,
            potentialRevenue: stats.revenue.toFixed(2)
        }))
    };

    return SuccessResponse(res, {
        message: "Financial macro-report generated successfully",
        data: summary
    });
};
// ==========================================
// API 2: تقرير تفصيلي حسب كل مطعم (All Restaurants Overview)
// ==========================================
export const getDetailedRestaurantReport = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { startDate, endDate, cityId } = req.query;
    const conditions = [];

    if (cityId) conditions.push(eq(restaurants.cityId, cityId as string));
    if (startDate) conditions.push(gte(orders.createdAt, new Date(startDate as string)));
    if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(orders.createdAt, end));
    }

    const ordersData = await db
        .select({
            orderId: orders.id,
            orderSource: orders.orderSource,
            paymentMethodName: paymentMethods.name,
            subtotal: orders.subtotal,
            deliveryFee: orders.deliveryFee,
            serviceFee: orders.serviceFee, // 👈 دي الرسوم الثابتة بتاعة كيتو (الـ 5 جنيه)
            appCommission: orders.appCommission, // 👈 دي العمولة المئوية بتاعة كيتو
            totalAmount: orders.totalAmount,
            restaurantId: orders.restaurantId,
            restaurantName: restaurants.name,
            city: {
                id: cities.id,
                name: cities.name,
                nameAr: cities.nameAr,
                nameFr: cities.nameFr,
            },
            status: orders.status,
            cancelReasonType: sql<string | null>`COALESCE(NULLIF(${orders.cancelReasonType}, ''), ${selectReasons.type})`,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(cities, eq(restaurants.cityId, cities.id))
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .leftJoin(paymentMethods, eq(orders.paymentMethod, paymentMethods.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined);

    const restaurantMap: Record<string, any> = {};
    let grandTotalAmount = 0, grandTotalPlatformCommission = 0;

    for (const order of ordersData) {
        const rId = order.restaurantId || "unknown";
        if (!restaurantMap[rId]) {
            restaurantMap[rId] = {
                restaurantId: rId,
                restaurantName: order.restaurantName || "Unknown",
                city: order.city?.id ? order.city : null,
                counts: { total: 0, cash: 0, digital: 0, canceled: 0 },
                canceledBreakdown: { user: 0, restaurant: 0 },
                sales: { totalRevenue: 0, cashCollected: 0, digitalCollected: 0 },
                platformDues: { totalCommission: 0, totalServiceFee: 0 }, // 👈 رجعنا السيرفس فيز للمنصة
                settlementRaw: { cashCommission: 0, cashServiceFee: 0, digitalCommission: 0, digitalServiceFee: 0 }
            };
        }

        const entry = restaurantMap[rId];

        if (order.status === "cancelled") {
            entry.counts.canceled += 1;
            const cancelType = (order.cancelReasonType || "").toLowerCase().trim();
            if (cancelType === "user") entry.canceledBreakdown.user += 1;
            else if (cancelType === "restaurant") {
                entry.canceledBreakdown.restaurant += 1;
                const commission = parseFloat(order.appCommission as string || "0");
                entry.platformDues.totalCommission += commission;
                grandTotalPlatformCommission += commission;
                entry.settlementRaw.cashCommission += commission;
            }
            continue;
        }

        const amount = parseFloat(order.totalAmount as string || "0");
        const commission = parseFloat(order.appCommission as string || "0");
        const svcFee = parseFloat(order.serviceFee as string || "0"); // الـ 5 جنيه

        entry.counts.total += 1;
        entry.sales.totalRevenue += amount;

        // دي فلوس المنصة (كيتو)
        entry.platformDues.totalCommission += commission;
        entry.platformDues.totalServiceFee += svcFee;

        grandTotalAmount += amount;
        grandTotalPlatformCommission += (commission + svcFee);

        const payment = (order.paymentMethodName || "").toLowerCase();
        const isCash = payment.includes("cash") || payment.includes("استلام");

        if (isCash) {
            entry.counts.cash += 1;
            entry.sales.cashCollected += amount;
            entry.settlementRaw.cashCommission += commission;
            entry.settlementRaw.cashServiceFee += svcFee; // 👈 هنسجل إن الكاش ده عليه سيرفس فيز
        } else {
            entry.counts.digital += 1;
            entry.sales.digitalCollected += amount;
            entry.settlementRaw.digitalCommission += commission;
            entry.settlementRaw.digitalServiceFee += svcFee;
        }
    }

    const restaurantReports = Object.values(restaurantMap).map(entry => {
        // 💰 تصفية الحسابات (Settlement Logic)

        // المطعم عليه كام؟ (عمولة الكاش + السيرفس فيز الثابتة بتاعت الكاش زي الـ 5 جنيه)
        const restaurantOwesToPlatform = entry.settlementRaw.cashCommission + entry.settlementRaw.cashServiceFee;

        // المنصة عليها كام؟ (فلوس الفيزا كلها اللي دخلت البنك - العمولة المئوية - السيرفس فيز الثابتة)
        const platformOwesToRestaurant = entry.sales.digitalCollected - (entry.settlementRaw.digitalCommission + entry.settlementRaw.digitalServiceFee);

        const netBalance = platformOwesToRestaurant - restaurantOwesToPlatform;

        return {
            restaurantId: entry.restaurantId,
            restaurantName: entry.restaurantName,
            city: entry.city,
            ordersCount: {
                total: entry.counts.total + entry.counts.canceled,
                valid: entry.counts.total,
                cash: entry.counts.cash,
                digital: entry.counts.digital,
                canceled: entry.counts.canceled,
            },
            sales: {
                totalRevenue: entry.sales.totalRevenue.toFixed(2),
                cashInRestaurantDrawer: entry.sales.cashCollected.toFixed(2),
                digitalInPlatformBank: entry.sales.digitalCollected.toFixed(2),
            },
            canceledBreakdown: entry.canceledBreakdown,
            platformDues: {
                // هنجمع العمولة المئوية + الرسوم الثابتة عشان تظهر كلها في عمود App Commission في الفرونت إند
                totalAppCommission: (entry.platformDues.totalCommission + entry.platformDues.totalServiceFee).toFixed(2),
            },
            settlement: {
                restaurantOwesPlatform: restaurantOwesToPlatform.toFixed(2),
                platformOwesRestaurant: platformOwesToRestaurant.toFixed(2),
                netBalance: netBalance.toFixed(2),
                actionRequired: netBalance > 0
                    ? `⚠️ Platform MUST TRANSFER ${Math.abs(netBalance).toFixed(2)} EGP to the Restaurant`
                    : netBalance < 0
                        ? `🚨 Platform MUST COLLECT ${Math.abs(netBalance).toFixed(2)} EGP from the Restaurant`
                        : "✅ Settled",
            }
        };
    });

    return SuccessResponse(res, {
        message: "Detailed restaurants report generated successfully",
        data: {
            summary: {
                totalRestaurantsActive: restaurantReports.length,
                grandTotalSystemSales: grandTotalAmount.toFixed(2),
                grandTotalKeetoCommission: grandTotalPlatformCommission.toFixed(2),
            },
            restaurants: restaurantReports,
        }
    });
};
// ==========================================
// API 3: تقرير مالي تفصيلي لمطعم واحد (Single Restaurant Breakdown)
// ==========================================
export const getSingleRestaurantReport = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { restaurantId } = req.params;
    const { startDate, endDate, cityId } = req.query;

    if (!restaurantId) throw new BadRequest("Restaurant ID is required");

    const [restaurantData] = await db
        .select({
            restaurant: restaurants,
            city: {
                id: cities.id,
                name: cities.name,
                nameAr: cities.nameAr,
                nameFr: cities.nameFr,
            }
        })
        .from(restaurants)
        .leftJoin(cities, eq(restaurants.cityId, cities.id))
        .where(
            and(
                eq(restaurants.id, restaurantId),
                cityId ? eq(restaurants.cityId, cityId as string) : undefined
            )
        )
        .limit(1);

    if (!restaurantData) throw new BadRequest("Restaurant not found");
    const restaurant = restaurantData.restaurant;

    const conditions = [eq(orders.restaurantId, restaurantId)];
    if (startDate) conditions.push(gte(orders.createdAt, new Date(startDate as string)));
    if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(orders.createdAt, end));
    }

    const ordersData = await db
        .select({
            orderId: orders.id,
            orderSource: orders.orderSource,
            paymentMethodName: paymentMethods.name,
            subtotal: orders.subtotal,
            deliveryFee: orders.deliveryFee,
            serviceFee: orders.serviceFee, // 👈 رسوم كيتو الثابتة (الـ 5 جنيه)
            appCommission: orders.appCommission, // 👈 عمولة كيتو المئوية
            totalAmount: orders.totalAmount,
            status: orders.status,
            cancelReasonType: sql<string | null>`COALESCE(${orders.cancelReasonType}, ${selectReasons.type})`,
        })
        .from(orders)
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .leftJoin(paymentMethods, eq(orders.paymentMethod, paymentMethods.id))
        .where(and(...conditions));

    const sourceMap: Record<string, any> = {
        online_order_web: { orders: 0, revenue: 0, cash: 0, digital: 0, commission: 0, svcFee: 0, dlvFee: 0, cashComm: 0, cashSvc: 0, digComm: 0, digSvc: 0 },
        online_order_app: { orders: 0, revenue: 0, cash: 0, digital: 0, commission: 0, svcFee: 0, dlvFee: 0, cashComm: 0, cashSvc: 0, digComm: 0, digSvc: 0 },
        food_aggregator: { orders: 0, revenue: 0, cash: 0, digital: 0, commission: 0, svcFee: 0, dlvFee: 0, cashComm: 0, cashSvc: 0, digComm: 0, digSvc: 0 },
        mykeeto: { orders: 0, revenue: 0, cash: 0, digital: 0, commission: 0, svcFee: 0, dlvFee: 0, cashComm: 0, cashSvc: 0, digComm: 0, digSvc: 0 },
        pos: { orders: 0, revenue: 0, cash: 0, digital: 0, commission: 0, svcFee: 0, dlvFee: 0, cashComm: 0, cashSvc: 0, digComm: 0, digSvc: 0 },
    };

    let grandTotal = { orders: 0, revenue: 0, cash: 0, digital: 0, commission: 0, svcFee: 0, dlvFee: 0, cashComm: 0, cashSvc: 0, digComm: 0, digSvc: 0 };

    for (const order of ordersData) {
        const source = order.orderSource as string;
        const stats = sourceMap[source];
        if (!stats) continue;

        if (order.status === "cancelled") {
            if (order.cancelReasonType === "restaurant") {
                const commission = parseFloat(order.appCommission as string || "0");
                stats.commission += commission;
                stats.cashComm += commission;

                grandTotal.commission += commission;
                grandTotal.cashComm += commission;
            }
            continue;
        }

        const amount = parseFloat(order.totalAmount as string || "0");
        const commission = parseFloat(order.appCommission as string || "0");
        const serviceFee = parseFloat(order.serviceFee as string || "0"); // 5 جنيه
        const deliveryFee = parseFloat(order.deliveryFee as string || "0");

        stats.orders += 1;
        stats.revenue += amount;

        // 💰 تجميع مستحقات المنصة
        stats.commission += commission;
        stats.svcFee += serviceFee;

        stats.dlvFee += deliveryFee;

        grandTotal.orders += 1;
        grandTotal.revenue += amount;
        grandTotal.commission += commission;
        grandTotal.svcFee += serviceFee;
        grandTotal.dlvFee += deliveryFee;

        const payment = (order.paymentMethodName || "").toLowerCase();
        const isCash = payment.includes("cash") || payment.includes("استلام");

        if (isCash) {
            stats.cash += amount;
            stats.cashComm += commission;
            stats.cashSvc += serviceFee; // 👈 هنسجل إن الكاش ده عليه سيرفس فيز

            grandTotal.cash += amount;
            grandTotal.cashComm += commission;
            grandTotal.cashSvc += serviceFee;
        } else {
            stats.digital += amount;
            stats.digComm += commission;
            stats.digSvc += serviceFee; // 👈 وهنسجل إن الديجيتال عليه سيرفس فيز يتخصم منه

            grandTotal.digital += amount;
            grandTotal.digComm += commission;
            grandTotal.digSvc += serviceFee;
        }
    }

    const buildSourceReport = (sourceName: string, stats: any) => {
        // 💰 تصفية الحسابات
        // المطعم عليه كام؟ (عمولة الكاش + السيرفس فيز الثابتة بتاعت الكاش)
        const restOwes = stats.cashComm + stats.cashSvc;

        // المنصة مدينة للمطعم بفلوس الديجيتال ناقص (العمولة المئوية للديجيتال + السيرفس فيز بتاعت الديجيتال)
        const platOwes = stats.digital - (stats.digComm + stats.digSvc);

        const net = platOwes - restOwes;

        return {
            source: sourceName,
            ordersCount: stats.orders,
            sales: {
                totalRevenue: stats.revenue.toFixed(2),
                cashRevenue: stats.cash.toFixed(2),
                digitalRevenue: stats.digital.toFixed(2),
            },
            restaurantExtraEarnings: {
                // شيلنا الـ Service Fees من هنا خلاص لأنها بتاعت المنصة مش المطعم
                totalDeliveryFees: stats.dlvFee.toFixed(2),
            },
            keetoDues: {
                // جمعناهم عشان يظهروا رقم واحد في خانة الـ APP COMMISSION للفرونت إند
                appCommission: (stats.commission + stats.svcFee).toFixed(2),
            },
            settlement: {
                restaurantOwesPlatform: restOwes.toFixed(2),
                platformOwesRestaurant: platOwes.toFixed(2),
                netBalance: net.toFixed(2)
            }
        };
    };

    const reportBySource = Object.entries(sourceMap).map(([source, stats]) => buildSourceReport(source, stats));
    const finalReport = buildSourceReport("Grand Total", grandTotal);

    return SuccessResponse(res, {
        message: "Single restaurant breakdown generated successfully",
        data: {
            restaurant: {
                id: restaurant.id,
                name: restaurant.name,
                city: restaurantData.city?.id ? restaurantData.city : null,
            },
            breakdownBySource: reportBySource,
            overallSummary: {
                totalOrders: finalReport.ordersCount,
                sales: finalReport.sales,
                restaurantExtraEarnings: finalReport.restaurantExtraEarnings,
                keetoDues: finalReport.keetoDues,
                settlement: {
                    ...finalReport.settlement,
                    actionRequired: parseFloat(finalReport.settlement.netBalance) > 0
                        ? `⚠️ Platform MUST TRANSFER ${Math.abs(parseFloat(finalReport.settlement.netBalance)).toFixed(2)} EGP to the Restaurant`
                        : parseFloat(finalReport.settlement.netBalance) < 0
                            ? `🚨 Platform MUST COLLECT ${Math.abs(parseFloat(finalReport.settlement.netBalance)).toFixed(2)} EGP from the Restaurant`
                            : "✅ Settled"
                }
            }
        }
    });
};
// ==========================================
// API 4: Get All Invoices for a Restaurant
// ==========================================
export const getRestaurantInvoices = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { restaurantId } = req.params;
    const { status, cityId } = req.query;

    if (!restaurantId) {
        throw new BadRequest("Restaurant ID is required");
    }

    const conditions = [
        eq(invoices.restaurantId, restaurantId)
    ];

    if (status) {
        conditions.push(eq(invoices.status, status as any));
    }
    if (cityId) {
        conditions.push(eq(restaurants.cityId, cityId as string));
    }

    const restaurantInvoicesRaw = await db
        .select({
            invoice: invoices,
            city: {
                id: cities.id,
                name: cities.name,
                nameAr: cities.nameAr,
                nameFr: cities.nameFr,
            }
        })
        .from(invoices)
        .leftJoin(restaurants, eq(invoices.restaurantId, restaurants.id))
        .leftJoin(cities, eq(restaurants.cityId, cities.id))
        .where(and(...conditions))
        .orderBy(desc(invoices.createdAt));

    const restaurantInvoices = restaurantInvoicesRaw.map(row => ({
        ...row.invoice,
        city: row.city?.id ? row.city : null,
    }));

    return SuccessResponse(res, {
        message: "Invoices retrieved successfully",
        data: restaurantInvoices
    });
};
// ==========================================
// API 5: Generate Restaurant Invoice PDF
// ==========================================
export const generateRestaurantInvoicePDF = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { invoiceId } = req.params;

    if (!invoiceId) throw new BadRequest("Invoice ID is required");

    const invoice = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1);

    if (!invoice[0]) throw new NotFound("Invoice not found");

    const restaurantData = await db
        .select({
            restaurant: restaurants,
            city: {
                id: cities.id,
                name: cities.name,
                nameAr: cities.nameAr,
                nameFr: cities.nameFr,
            }
        })
        .from(restaurants)
        .leftJoin(cities, eq(restaurants.cityId, cities.id))
        .where(eq(restaurants.id, invoice[0].restaurantId))
        .limit(1);

    if (!restaurantData[0]) throw new NotFound("Restaurant not found");
    const restaurant = restaurantData[0].restaurant;

    const invoiceData = invoice[0];

    // Build PDF
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice_${restaurantData[0].restaurant?.name.replace(/\s+/g, '_')}_${invoiceData.invoiceNumber}.pdf"`);

    doc.pipe(res);

    // Header
    doc.fontSize(20).text('Keeto Restaurant Invoice', { align: 'center' });
    doc.moveDown();

    // Restaurant Details
    doc.fontSize(14).fillColor('black').text(`Restaurant: ${restaurantData[0].restaurant?.name} / ${restaurantData[0].restaurant?.nameAr || ''}`);
    doc.fontSize(12).text(`Invoice Number: ${invoiceData.invoiceNumber}`);
    doc.text(`Date Range: ${new Date(invoiceData.startDate).toLocaleDateString()} to ${new Date(invoiceData.endDate).toLocaleDateString()}`);
    doc.text(`Generated At: ${new Date(invoiceData.createdAt || Date.now()).toLocaleString()}`);
    doc.text(`Status: ${invoiceData.status?.toUpperCase() || 'UNPAID'}`);
    doc.moveDown();

    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();

    // Summary Statistics
    doc.fontSize(16).text('Summary', { underline: true });
    doc.fontSize(12).text(`Total Orders: ${invoiceData.totalOrders}`);
    doc.text(`Total Gross Sales: ${invoiceData.totalGrossSales} EGP`);
    doc.moveDown();

    // Payment Breakdown
    doc.fontSize(14).text('Payment Breakdown', { underline: true });
    doc.fontSize(12).text(`Cash Collected by Restaurant: ${invoiceData.totalCashCollected} EGP`);
    doc.text(`Digital Collected by Platform: ${invoiceData.totalDigitalCollected} EGP`);
    doc.moveDown();

    // Fees
    doc.fontSize(14).text('Fees & Commissions (Keeto Dues)', { underline: true });
    doc.fontSize(12).text(`Total Commission: ${invoiceData.totalCommission} EGP`);
    doc.text(`Total Service Fee: ${invoiceData.totalServiceFee} EGP`);
    doc.moveDown();

    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();

    // Cash Due Analysis
    doc.fontSize(16).text('Settlement / Cash Due Analysis', { underline: true });
    doc.fontSize(12).text(`Restaurant Owes Platform: ${invoiceData.restaurantOwesPlatform} EGP`);
    doc.text(`Platform Owes Restaurant: ${invoiceData.platformOwesRestaurant} EGP`);

    doc.moveDown();
    doc.fontSize(14).text('Final Balance:', { continued: true });

    const netBalance = parseFloat(invoiceData.netBalance as string);

    if (netBalance > 0) {
        doc.fillColor('green').text(` Platform MUST TRANSFER ${Math.abs(netBalance).toFixed(2)} EGP to Restaurant`);
    } else if (netBalance < 0) {
        doc.fillColor('red').text(` Platform MUST COLLECT ${Math.abs(netBalance).toFixed(2)} EGP from Restaurant`);
    } else {
        doc.fillColor('black').text(` No pending dues (Settled)`);
    }

    doc.end();
};
// ==========================================
// API 6: Generate & Save Invoice 
// ==========================================
export const generateAndSaveInvoice = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { restaurantId, startDate, endDate } = req.body;
    if (!restaurantId || !startDate || !endDate) throw new BadRequest("Restaurant ID, Start Date, and End Date are required");

    const conditions = [eq(orders.restaurantId, restaurantId)];
    conditions.push(gte(orders.createdAt, new Date(startDate)));
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(orders.createdAt, end));

    // 🛡️ التعديل الجذري هنا: جلب اسم طريقة الدفع 
    const ordersData = await db
        .select({
            id: orders.id,
            totalAmount: orders.totalAmount,
            appCommission: orders.appCommission,
            serviceFee: orders.serviceFee,
            paymentMethodName: paymentMethods.name, // 👈 الربط السليم
            status: orders.status,
            cancelReasonType: sql<string | null>`COALESCE(${orders.cancelReasonType}, ${selectReasons.type})`,
        })
        .from(orders)
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .leftJoin(paymentMethods, eq(orders.paymentMethod, paymentMethods.id)) // 👈 Join لجدول الدفع
        .where(and(...conditions));

    let totalCash = 0, totalDigital = 0, totalSales = 0;
    let cashComm = 0, cashSvc = 0, digitalComm = 0, digitalSvc = 0;
    let validOrdersCount = 0;

    for (const order of ordersData) {
        const isCancelledByUser = order.status === "cancelled" && order.cancelReasonType === "user";
        if (isCancelledByUser) continue;

        validOrdersCount++;
        const amount = parseFloat(order.totalAmount as string || "0");
        const comm = parseFloat(order.appCommission as string || "0");
        const svcFee = parseFloat(order.serviceFee as string || "0");

        totalSales += amount;

        // 🛡️ فحص نوع الدفع من الاسم مش الـ UUID
        const payment = (order.paymentMethodName || "").toLowerCase();
        const isCash = payment.includes("cash") || payment.includes("استلام");

        if (isCash) {
            totalCash += amount;
            cashComm += comm;
            cashSvc += svcFee;
        } else {
            totalDigital += amount;
            digitalComm += comm;
            digitalSvc += svcFee;
        }
    }

    const totalComm = cashComm + digitalComm;
    const totalSvc = cashSvc + digitalSvc;

    // 💰 حساب المديونية الموحد والدقيق (نفس اللوجيك بتاع التقارير)
    const restaurantOwes = cashComm + cashSvc;
    const platformOwes = totalDigital - (digitalComm + digitalSvc);
    const netBalance = platformOwes - restaurantOwes;

    const invoiceId = uuidv4();
    const invoiceNumber = `INV-${Math.floor(100000 + Math.random() * 900000)}`;

    await db.insert(invoices).values({
        id: invoiceId,
        restaurantId,
        invoiceNumber,
        startDate: new Date(startDate),
        endDate: end,
        totalOrders: validOrdersCount,
        totalGrossSales: totalSales.toFixed(2),
        totalCashCollected: totalCash.toFixed(2),
        totalDigitalCollected: totalDigital.toFixed(2),
        totalCommission: totalComm.toFixed(2),
        totalServiceFee: totalSvc.toFixed(2),
        restaurantOwesPlatform: restaurantOwes.toFixed(2),
        platformOwesRestaurant: platformOwes.toFixed(2),
        netBalance: netBalance.toFixed(2),
        status: "unpaid",
    });

    return SuccessResponse(res, { message: "Invoice generated and saved successfully", data: { invoiceId } });
};
// ==========================================
// API 7: Mark Invoice as Paid
// ==========================================
export const markInvoiceAsPaid = async (req: Request, res: Response) => {
    const { invoiceId } = req.params;

    const [existing] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (!existing) throw new NotFound("Invoice not found");

    await db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, invoiceId));

    return SuccessResponse(res, { message: "Invoice marked as paid successfully" });
};
// ==========================================
// API 8: تقرير أعداد الطلبات والمطاعم (Restaurant Orders Count Report)
// ==========================================
export const getRestaurantOrdersReport = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { startDate, endDate, type, restaurantId, cityId, restaurantsWithOrders, restaurantsWithoutOrders } = req.query;

    const orderConditions: SQL[] = [];
    if (startDate) orderConditions.push(gte(orders.createdAt, new Date(startDate as string)));
    if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        orderConditions.push(lte(orders.createdAt, end));
    }

    const restConditions = [eq(restaurants.status, "active")];
    if (cityId) restConditions.push(eq(restaurants.cityId, cityId as string));

    // 1. Fetch all active restaurants with their operation status
    const allRestaurantsRaw = await db
        .select({
            restaurant: restaurants,
            sales: sales,
            city: {
                id: cities.id,
                name: cities.name,
                nameAr: cities.nameAr,
                nameFr: cities.nameFr,
            },
            operationStatus: restaurantOperations.status,
        })
        .from(restaurants)
        .leftJoin(sales, eq(restaurants.salesId, sales.id))
        .leftJoin(cities, eq(restaurants.cityId, cities.id))
        .leftJoin(restaurantOperations, eq(restaurantOperations.restaurantId, restaurants.id))
        .where(and(...restConditions));

    const allCuisines = await db.select().from(cuisines);
    const cuisineMap = new Map();
    allCuisines.forEach(c => cuisineMap.set(c.id, c));

    const allRestaurantsMapped = allRestaurantsRaw.map(r => {
        let cuisinesData = [];
        try {
            const cuisineIds = typeof r.restaurant.cuisineId === "string"
                ? JSON.parse(r.restaurant.cuisineId)
                : (r.restaurant.cuisineId || []);
            if (Array.isArray(cuisineIds)) {
                cuisinesData = cuisineIds.map((id: string) => cuisineMap.get(id) || null).filter(Boolean);
            }
        } catch (e) {
            console.error("Error parsing cuisines JSON", e);
        }

        return {
            ...r.restaurant,
            cuisines: cuisinesData,
            salesObj: r.sales ? { id: r.sales.id, name: r.sales.name } : null,
            city: r.city?.id ? {
                id: r.city.id,
                name: r.city.name,
                nameAr: r.city.nameAr,
                nameFr: r.city.nameFr,
            } : null,
            operationStatus: r.operationStatus ?? null,
        };
    });

    // Separate test/demo restaurants from real restaurants
    // "test"  → restaurants.type === "test"
    // "demo"  → restaurantOperations.status === "demo"
    const testOrDemoRestaurants = allRestaurantsMapped.filter(
        (r) => r.type === "test" || r.operationStatus === "demo"
    );
    const allRestaurants = allRestaurantsMapped.filter(
        (r) => r.type !== "test" && r.operationStatus !== "demo"
    );

    let totalRestaurants = allRestaurants.length;
    let restaurantsByType: Record<string, number> = {
        "mega": 0,
        "super": 0,
        "A": 0,
        "B": 0,
        "C": 0,
        "C-": 0,
    };

    allRestaurants.forEach((r) => {
        const rType = r.type || "Unknown";
        if (restaurantsByType[rType] !== undefined) {
            restaurantsByType[rType] += 1;
        } else {
            restaurantsByType[rType] = 1;
        }
    });

    // Helper to compute order stats for a given list of restaurant ids
    const computeOrderStats = async (restaurantIds: string[]) => {
        if (restaurantIds.length === 0) return [];
        const conditions = [...orderConditions, inArray(orders.restaurantId, restaurantIds)];
        return db
            .select({
                orderId: orders.id,
                restaurantId: orders.restaurantId,
                restaurantName: restaurants.name,
                appCommission: orders.appCommission,
                status: orders.status,
                cancelReasonType: sql<string | null>`COALESCE(${orders.cancelReasonType}, ${selectReasons.type})`,
            })
            .from(orders)
            .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
            .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
            .where(and(...conditions));
    };

    // 2. Fetch orders for real restaurants
    const activeRestaurantIds = allRestaurants.map((r) => r.id);
    const ordersData = activeRestaurantIds.length > 0
        ? await computeOrderStats(activeRestaurantIds)
        : [];

    // 3. Fetch orders for test/demo restaurants
    const testDemoIds = testOrDemoRestaurants.map((r) => r.id);
    const demoOrdersData = testDemoIds.length > 0
        ? await computeOrderStats(testDemoIds)
        : [];

    // ─── Aggregate helper ────────────────────────────────────────────────────
    const aggregateOrders = (data: typeof ordersData) => {
        let totalOrders = data.length;
        let total_commission = 0;
        let totalValidOrders = 0;
        let totalCanceledOrders = 0;
        let totalCanceledByUser = 0;
        let totalCanceledByRestaurant = 0;
        const statsByRestaurant: Record<string, { count: number, commission: number, validCount: number, canceledCount: number, canceledByUser: number, canceledByRestaurant: number }> = {};

        data.forEach((o) => {
            const comm = parseFloat(o.appCommission as any) || 0;
            const isCanceled = o.status === "cancelled";
            const isCanceledByRestaurant = isCanceled && o.cancelReasonType === "restaurant";

            if (!isCanceled || isCanceledByRestaurant) total_commission += comm;

            if (isCanceled) {
                totalCanceledOrders += 1;
                if (o.cancelReasonType === "user") totalCanceledByUser += 1;
                else if (o.cancelReasonType === "restaurant") totalCanceledByRestaurant += 1;
            } else {
                totalValidOrders += 1;
            }

            if (o.restaurantId) {
                if (!statsByRestaurant[o.restaurantId]) {
                    statsByRestaurant[o.restaurantId] = { count: 0, commission: 0, validCount: 0, canceledCount: 0, canceledByUser: 0, canceledByRestaurant: 0 };
                }
                statsByRestaurant[o.restaurantId].count += 1;
                if (!isCanceled || isCanceledByRestaurant) statsByRestaurant[o.restaurantId].commission += comm;
                if (isCanceled) {
                    statsByRestaurant[o.restaurantId].canceledCount += 1;
                    if (o.cancelReasonType === "user") statsByRestaurant[o.restaurantId].canceledByUser += 1;
                    else if (o.cancelReasonType === "restaurant") statsByRestaurant[o.restaurantId].canceledByRestaurant += 1;
                } else {
                    statsByRestaurant[o.restaurantId].validCount += 1;
                }
            }
        });

        return { totalOrders, total_commission, totalValidOrders, totalCanceledOrders, totalCanceledByUser, totalCanceledByRestaurant, statsByRestaurant };
    };

    const {
        totalOrders,
        total_commission,
        totalValidOrders,
        totalCanceledOrders,
        totalCanceledByUser,
        totalCanceledByRestaurant,
        statsByRestaurant: ordersStatsByRestaurant,
    } = aggregateOrders(ordersData);

    const demoAgg = aggregateOrders(demoOrdersData);

    // 4. Filter restaurants based on 'type' and/or 'restaurantId' if provided
    let filteredRestaurants = allRestaurants;
    if (type) {
        filteredRestaurants = filteredRestaurants.filter((r) => (r.type || "Unknown") === type);
    }
    if (restaurantId) {
        filteredRestaurants = filteredRestaurants.filter((r) => r.id === (restaurantId as string));
    }

    // 5. Build with/without orders lists from real restaurants only
    const withOrdersList = allRestaurants.filter((r) => {
        const stats = ordersStatsByRestaurant[r.id];
        return stats && stats.count > 0;
    });
    const withoutOrdersList = allRestaurants.filter((r) => {
        const stats = ordersStatsByRestaurant[r.id];
        return !stats || stats.count === 0;
    });

    // ─── Signup Users ────────────────────────────────────────────────────────
    const [{ totalSignupUsers }] = await db
        .select({ totalSignupUsers: count(users.id) })
        .from(users);

    const signupPerRestaurantRaw = await db
        .select({
            restaurantId: restaurant_users.restaurantId,
            signupCount: count(restaurant_users.userId),
        })
        .from(restaurant_users)
        .groupBy(restaurant_users.restaurantId);

    const signupByRestaurantMap: Record<string, number> = {};
    for (const row of signupPerRestaurantRaw) {
        signupByRestaurantMap[row.restaurantId] = Number(row.signupCount);
    }

    // 6. Map filtered restaurants to detailed result
    const restaurantDetails = filteredRestaurants.map((r) => {
        const stats = ordersStatsByRestaurant[r.id] || { count: 0, commission: 0, validCount: 0, canceledCount: 0, canceledByUser: 0, canceledByRestaurant: 0 };
        return {
            restaurantDetails: r,
            ordersCount: stats.count,
            validOrders: stats.validCount,
            canceledOrders: stats.canceledCount,
            canceledByUser: stats.canceledByUser,
            canceledByRestaurant: stats.canceledByRestaurant,
            canceledBreakdown: {
                user: stats.canceledByUser,
                restaurant: stats.canceledByRestaurant,
            },
            total_commission: stats.commission,
            signupUsersCount: signupByRestaurantMap[r.id] ?? 0,
        };
    });

    // 7. Decide which list to return in 'restaurants' key
    let restaurantsResult: any[];
    if (restaurantsWithOrders === "true") {
        restaurantsResult = withOrdersList.map((r) => ({
            id: r.id,
            name: r.name,
            nameAr: r.nameAr,
            nameFr: r.nameFr,
            type: r.type,
            status: r.status,
            city: r.city || null,
            signupUsersCount: signupByRestaurantMap[r.id] ?? 0,
        }));
    } else if (restaurantsWithoutOrders === "true") {
        restaurantsResult = withoutOrdersList.map((r) => ({
            id: r.id,
            name: r.name,
            nameAr: r.nameAr,
            nameFr: r.nameFr,
            type: r.type,
            status: r.status,
            city: r.city || null,
            signupUsersCount: signupByRestaurantMap[r.id] ?? 0,
        }));
    } else {
        restaurantsResult = restaurantDetails;
    }

    // Build flat list of canceled orders with restaurant name and cancel type (real restaurants only)
    const canceledOrdersList = ordersData
        .filter((o) => o.status === "cancelled")
        .map((o) => ({
            orderId: o.orderId,
            restaurantId: o.restaurantId,
            restaurantName: o.restaurantName || "Unknown",
            cancelType: o.cancelReasonType || null,
        }));

    // ─── Percentages ─────────────────────────────────────────────────────────
    // % عدد الاوردرات بالنسبة لعدد المطاعم (avg orders per restaurant)
    const ordersPerRestaurantPercent = totalRestaurants > 0
        ? parseFloat(((totalOrders / totalRestaurants) * 100).toFixed(2))
        : 0;

    // % الاوردرات المكانسلة من إجمالي الاوردرات
    const canceledOrdersPercent = totalOrders > 0
        ? parseFloat(((totalCanceledOrders / totalOrders) * 100).toFixed(2))
        : 0;

    // % المطاعم الميسينج (بدون اوردرات) من إجمالي المطاعم
    const missingRestaurantsPercent = totalRestaurants > 0
        ? parseFloat(((withoutOrdersList.length / totalRestaurants) * 100).toFixed(2))
        : 0;

    // ─── Demo summary ─────────────────────────────────────────────────────────
    const demoRestaurantsList = testOrDemoRestaurants.map((r) => ({
        id: r.id,
        name: r.name,
        nameAr: r.nameAr,
        nameFr: r.nameFr,
        type: r.type,
        operationStatus: r.operationStatus,
        city: r.city || null,
        ordersCount: demoAgg.statsByRestaurant[r.id]?.count ?? 0,
        validOrders: demoAgg.statsByRestaurant[r.id]?.validCount ?? 0,
        canceledOrders: demoAgg.statsByRestaurant[r.id]?.canceledCount ?? 0,
        total_commission: demoAgg.statsByRestaurant[r.id]?.commission ?? 0,
        signupUsersCount: signupByRestaurantMap[r.id] ?? 0,
    }));

    const responseData: any = {
        summary: {
            totalOrders,
            validOrders: totalValidOrders,
            canceledOrders: totalCanceledOrders,
            canceledBreakdown: {
                user: totalCanceledByUser,
                restaurant: totalCanceledByRestaurant,
            },
            totalRestaurants,
            restaurantsWithOrders: withOrdersList.length,
            restaurantsWithoutOrders: withoutOrdersList.length,
            total_commission,
            restaurantsByType,
            totalSignupUsers,
            // ─ Percentages
            percentages: {
                // نسبة عدد الأوردرات لعدد المطاعم (كام أوردر لكل مطعم × 100)
                ordersPerRestaurantPercent,
                // نسبة الكانسل من إجمالي الأوردرات
                canceledOrdersPercent,
                // نسبة المطاعم الميسينج (بدون أوردرات) من إجمالي المطاعم
                missingRestaurantsPercent,
            },
        },
        restaurants: restaurantsResult,
        canceledOrders: canceledOrdersList,
        // ─ Demo / Test summary (مستبعدة من الحسابات الرئيسية)
        demoSummary: {
            totalTestDemoRestaurants: testOrDemoRestaurants.length,
            totalOrders: demoAgg.totalOrders,
            validOrders: demoAgg.totalValidOrders,
            canceledOrders: demoAgg.totalCanceledOrders,
            total_commission: demoAgg.total_commission,
            restaurants: demoRestaurantsList,
        },
    };

    return SuccessResponse(res, {
        message: "Restaurant orders report generated successfully",
        data: responseData,
    });
};
// ==========================================
// API 9: تقرير المبيعات (Sales Report)
// ==========================================
export const getSalesReport = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { startDate, endDate, salesId, type, restaurantId, cityId } = req.query;

    // 1. شروط فلترة السيلز
    const salesConditions = [];
    if (salesId) {
        salesConditions.push(eq(sales.id, salesId as string));
    }

    // 2. شروط فلترة المطاعم (نوع المطعم، معرّف المطعم، وتاريخ التسجيل)
    const restaurantConditions = [];
    if (type) {
        restaurantConditions.push(eq(restaurants.type, type as any));
    }
    if (restaurantId) {
        restaurantConditions.push(eq(restaurants.id, restaurantId as string));
    }
    if (cityId) {
        restaurantConditions.push(eq(restaurants.cityId, cityId as string));
    }

    // 💡 التعديل هنا: فلترة المطاعم بناءً على تاريخ إنشائها/تسجيلها
    if (startDate) {
        restaurantConditions.push(gte(restaurants.createdAt, new Date(startDate as string)));
    }
    if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        restaurantConditions.push(lte(restaurants.createdAt, end));
    }

    // جلب بيانات السيلز والمطاعم المسجلة
    const allSalesRaw = await db
        .select({
            sales: sales,
            restaurant: restaurants,
            city: {
                id: cities.id,
                name: cities.name,
                nameAr: cities.nameAr,
                nameFr: cities.nameFr,
            }
        })
        .from(sales)
        .leftJoin(
            restaurants,
            and(
                eq(sales.id, restaurants.salesId),
                restaurantConditions.length > 0 ? and(...restaurantConditions) : undefined
            )
        )
        .leftJoin(cities, eq(restaurants.cityId, cities.id))
        .where(
            salesConditions.length > 0 ? and(...salesConditions) : undefined
        );

    const salesMap = new Map<string, {
        id: string;
        name: string;
        phone: string | null;
        email: string | null;
        points: number;
        status: string;
        activeRestaurantsCount: number;
        inactiveRestaurantsCount: number;
        restaurants: any[];
        typeGroups: {
            [type: string]: {
                total: number;
                active: number;
                inactive: number;
                list: any[]
            }
        };
    }>();

    let totalActiveSalesPoints = 0;
    let totalActiveRestaurantsCount = 0;

    for (const row of allSalesRaw) {
        const currentSales = row.sales;
        const currentRest = row.restaurant;

        if (currentSales.status !== "active") {
            continue;
        }

        if (!salesMap.has(currentSales.id)) {
            salesMap.set(currentSales.id, {
                id: currentSales.id,
                name: currentSales.name,
                phone: currentSales.phone,
                email: currentSales.email,
                // If date range is given, start from 0 and accumulate from filtered restaurants
                // Otherwise use the stored cumulative total
                points: (startDate || endDate) ? 0 : (currentSales.points || 0),
                status: currentSales.status,
                activeRestaurantsCount: 0,
                inactiveRestaurantsCount: 0,
                restaurants: [],
                typeGroups: {}
            });

            if (!startDate && !endDate) {
                totalActiveSalesPoints += currentSales.points || 0;
            }
        }

        const salesGroup = salesMap.get(currentSales.id)!;

        // إذا كان هناك مطعم مسجل للسيلز ده وضمن الفترة المحددة
        if (currentRest) {
            const isRestActive = currentRest.status === "active";
            const restType = currentRest.type || "C";
            const typeKey = restType.toLowerCase();
            const earnedPoints = RESTAURANT_TYPE_POINTS[typeKey] ?? 0;

            // Accumulate points from filtered restaurants when date range is provided
            if (startDate || endDate) {
                //const typeKey = restType.toLowerCase();
                //const earnedPoints = RESTAURANT_TYPE_POINTS[typeKey] ?? 0;
                salesGroup.points += earnedPoints;
            }

            if (isRestActive) {
                salesGroup.activeRestaurantsCount += 1;
                totalActiveRestaurantsCount += 1;
            } else {
                salesGroup.inactiveRestaurantsCount += 1;
            }

            if (restaurantId) {
                salesGroup.restaurants.push({
                    ...currentRest,
                    type: restType,
                    points: earnedPoints,
                    city: row.city?.id ? row.city : null,
                });
            } else {
                salesGroup.restaurants.push({
                    id: currentRest.id,
                    name: currentRest.name,
                    nameAr: currentRest.nameAr,
                    type: restType,
                    points: earnedPoints,
                    status: currentRest.status,
                    city: row.city?.id ? row.city : null,
                    createdAt: currentRest.createdAt
                });
            }

            if (salesId) {
                if (!salesGroup.typeGroups[restType]) {
                    salesGroup.typeGroups[restType] = {
                        total: 0,
                        active: 0,
                        inactive: 0,
                        list: []
                    };
                }

                const group = salesGroup.typeGroups[restType];
                group.total += 1;
                if (isRestActive) {
                    group.active += 1;
                } else {
                    group.inactive += 1;
                }

                group.list.push({
                    id: currentRest.id,
                    name: currentRest.name,
                    nameAr: currentRest.nameAr,
                    type: restType,
                    points: earnedPoints,
                    status: currentRest.status,
                    city: row.city?.id ? row.city : null,
                    createdAt: currentRest.createdAt
                });
            }
        }
    }

    const salesList = Array.from(salesMap.values()).map(item => {
        const responseData: any = {
            id: item.id,
            name: item.name,
            phone: item.phone,
            email: item.email,
            status: item.status,
            totalPoints: item.points,
            restaurantSummary: {
                totalRestaurants: item.activeRestaurantsCount + item.inactiveRestaurantsCount,
                activeCount: item.activeRestaurantsCount,
                inactiveCount: item.inactiveRestaurantsCount
            },
            restaurants: item.restaurants
        };

        if (salesId) {
            responseData.groupedByType = ALL_RESTAURANT_TYPES.map(typeKey => ({
                type: typeKey,
                totalRestaurants: item.typeGroups[typeKey]?.total ?? 0,
                activeCount: item.typeGroups[typeKey]?.active ?? 0,
                inactiveCount: item.typeGroups[typeKey]?.inactive ?? 0,
                restaurants: item.typeGroups[typeKey]?.list ?? []
            }));
        }

        return responseData;
    });

    // When date range is provided, recalculate the summary total from filtered points
    const finalTotalPoints = (startDate || endDate)
        ? salesList.reduce((sum, s) => sum + (s.totalPoints || 0), 0)
        : totalActiveSalesPoints;

    return SuccessResponse(res, {
        message: "Sales report fetched successfully",
        summary: {
            totalActiveSalesPoints: finalTotalPoints,
            totalActiveRestaurants: totalActiveRestaurantsCount,
            totalActiveSales: salesList.length
        },
        salesList: salesList
    });
};

// ==========================================
// API: تقرير أداء العمليات (Restaurant Operations Performance Overview)
// ==========================================
export const getOperationsPerformanceReport = async (req: Request, res: Response) => {
    const { startDate: queryStartDate, endDate: queryEndDate } =
        getPerformanceReportQuerySchema.parse(req.query);

    const isDefault = !queryStartDate && !queryEndDate;

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    let start: Date | undefined;
    let end: Date | undefined;

    if (queryStartDate) {
        start = new Date(queryStartDate);
        if (!queryStartDate.includes("T")) start.setHours(0, 0, 0, 0);
    }

    if (queryEndDate) {
        end = new Date(queryEndDate);
        if (!queryEndDate.includes("T")) end.setHours(23, 59, 59, 999);
    }

    // Previous period for comparison
    let prevStart: Date | undefined;
    let prevEnd: Date | undefined;

    if (start && end) {
        const diffMs = end.getTime() - start.getTime();
        const isFullMonth =
            start.getDate() === 1 &&
            new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate() === end.getDate() &&
            start.getMonth() === end.getMonth();

        if (isFullMonth) {
            prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1, 0, 0, 0, 0);
            prevEnd = new Date(start.getFullYear(), start.getMonth(), 0, 23, 59, 59, 999);
        } else {
            prevEnd = new Date(start.getTime() - 1);
            prevStart = new Date(prevEnd.getTime() - diffMs);
        }
    } else if (isDefault) {
        // In default mode, compare cumulative lifetime metrics as of now against cumulative totals up to end of last month
        // to clearly show how much numbers increased during the current month ("خلال الشهر ده زاد قد ايه")
        prevStart = prevMonthStart;
        prevEnd = prevMonthEnd;
    }

    const formatGrowth = (current: number, previous: number | null | undefined) => {
        if (previous === null || previous === undefined) {
            return {
                percentage: 0,
                formatted: "N/A",
                trend: "neutral" as const,
            };
        }
        let growth = 0;
        if (previous === 0) {
            growth = current > 0 ? 100 : 0;
        } else {
            growth = ((current - previous) / previous) * 100;
        }
        const rounded = Number(growth.toFixed(1));
        const sign = rounded > 0 ? "+" : "";
        return {
            percentage: rounded,
            formatted: `${sign}${rounded}%`,
            trend: rounded > 0 ? ("up" as const) : rounded < 0 ? ("down" as const) : ("neutral" as const),
        };
    };

    const formatDiff = (current: number, previous: number | null | undefined, unit = "%") => {
        if (previous === null || previous === undefined) {
            return {
                diff: 0,
                formatted: "N/A",
                trend: "neutral" as const,
            };
        }
        const diff = Number((current - previous).toFixed(1));
        const sign = diff > 0 ? "+" : "";
        return {
            diff,
            formatted: `${sign}${diff}${unit}`,
            trend: diff > 0 ? ("up" as const) : diff < 0 ? ("down" as const) : ("neutral" as const),
        };
    };

    // Conditions for current period queries based strictly on query params
    const currOrdersConditions: SQL[] = [ne(orders.status, "failed")];
    if (start) currOrdersConditions.push(gte(orders.createdAt, start));
    if (end) currOrdersConditions.push(lte(orders.createdAt, end));

    // Total restaurants (all non-test restaurants)
    const currRestConditions: SQL[] = [
        ne(restaurants.type, "test"),
    ];
    if (end) currRestConditions.push(lte(restaurants.createdAt, end));

    // New restaurants added in this period (or added this month in default mode)
    const newRestConditions: SQL[] = [
        ne(restaurants.type, "test"),
    ];
    if (start) {
        newRestConditions.push(gte(restaurants.createdAt, start));
    } else if (isDefault) {
        newRestConditions.push(gte(restaurants.createdAt, currentMonthStart));
    }
    if (end) newRestConditions.push(lte(restaurants.createdAt, end));

    // Active restaurants (status active and non-test)
    const currActiveRestConditions: SQL[] = [
        eq(restaurants.status, "active"),
        ne(restaurants.type, "test"),
    ];
    if (end) currActiveRestConditions.push(lte(restaurants.createdAt, end));

    // Demo restaurants
    const currDemoConditions: SQL[] = [
        eq(restaurantOperations.status, "demo"),
        ne(restaurants.type, "test"),
    ];
    if (end) currDemoConditions.push(lte(restaurants.createdAt, end));

    // Demo restaurants added in this period (or added this month in default mode)
    const addedDemoConditions: SQL[] = [
        eq(restaurantOperations.status, "demo"),
        ne(restaurants.type, "test"),
    ];
    if (start) {
        addedDemoConditions.push(gte(restaurants.createdAt, start));
    } else if (isDefault) {
        addedDemoConditions.push(gte(restaurants.createdAt, currentMonthStart));
    }
    if (end) addedDemoConditions.push(lte(restaurants.createdAt, end));

    // Not delivered conditions
    const currNonDeliveredConditions: SQL[] = [
        ne(restaurants.type, "test"),
    ];
    if (end) currNonDeliveredConditions.push(lte(restaurants.createdAt, end));

    const currOnboardingConditions: SQL[] = [ne(restaurants.type, "test")];
    if (start) currOnboardingConditions.push(gte(restaurants.createdAt, start));
    if (end) currOnboardingConditions.push(lte(restaurants.createdAt, end));

    const currGoLivesOrderConditions: SQL[] = [
        eq(orders.restaurantId, restaurants.id),
        ne(orders.status, "failed"),
    ];
    if (start) currGoLivesOrderConditions.push(gte(orders.createdAt, start));
    if (end) currGoLivesOrderConditions.push(lte(orders.createdAt, end));

    const currLeadsConditions: SQL[] = [
        inArray(restaurantOperations.status, ["demo", "start order"]),
        ne(restaurants.type, "test"),
    ];
    if (end) currLeadsConditions.push(lte(restaurants.createdAt, end));

    // Parallel DB queries
    const [
        [currOrdersRow],
        [prevOrdersRow],
        [currRestRow],
        [prevRestRow],
        [newRestRow],
        [currActiveRestRow],
        [prevActiveRestRow],
        [currDemoRow],
        [prevDemoRow],
        [addedDemoRow],
        [currNonDeliveredRow],
        [prevNonDeliveredRow],
        onboardingStats,
        prevOnboardingStats,
        [currGoLivesRow],
        [prevGoLivesRow],
        [currLeadsRow],
        [prevLeadsRow],
    ] = await Promise.all([
        // 1. إجمالي الطلبات (الفترة الحالية)
        db
            .select({ total: count() })
            .from(orders)
            .where(and(...currOrdersConditions)),

        // 1. إجمالي الطلبات (الفترة السابقة)
        prevEnd
            ? db
                .select({ total: count() })
                .from(orders)
                .where(
                    and(
                        ...(prevStart && !isDefault ? [gte(orders.createdAt, prevStart)] : []),
                        lte(orders.createdAt, prevEnd),
                        ne(orders.status, "failed")
                    )
                )
            : Promise.resolve([{ total: null }]),

        // 2. إجمالي المطاعم حتى نهاية الفترة الحالية
        db
            .select({ total: count() })
            .from(restaurants)
            .where(and(...currRestConditions)),

        // 2. إجمالي المطاعم حتى نهاية الفترة السابقة
        prevEnd
            ? db
                .select({ total: count() })
                .from(restaurants)
                .where(
                    and(
                        lte(restaurants.createdAt, prevEnd),
                        ne(restaurants.type, "test")
                    )
                )
            : Promise.resolve([{ total: null }]),

        // 2. المطاعم الجديدة المضافة خلال الفترة
        db
            .select({ total: count() })
            .from(restaurants)
            .where(and(...newRestConditions)),

        // 3. المطاعم النشطة حتى نهاية الفترة
        db
            .select({ total: count() })
            .from(restaurants)
            .where(and(...currActiveRestConditions)),

        // 3. المطاعم النشطة حتى نهاية الفترة السابقة
        prevEnd
            ? db
                .select({ total: count() })
                .from(restaurants)
                .where(
                    and(
                        lte(restaurants.createdAt, prevEnd),
                        eq(restaurants.status, "active"),
                        ne(restaurants.type, "test")
                    )
                )
            : Promise.resolve([{ total: null }]),

        // 4. مطاعم الديمو حتى نهاية الفترة
        db
            .select({ total: count() })
            .from(restaurantOperations)
            .innerJoin(restaurants, eq(restaurantOperations.restaurantId, restaurants.id))
            .where(and(...currDemoConditions)),

        // 4. مطاعم الديمو حتى نهاية الفترة السابقة
        prevEnd
            ? db
                .select({ total: count() })
                .from(restaurantOperations)
                .innerJoin(restaurants, eq(restaurantOperations.restaurantId, restaurants.id))
                .where(
                    and(
                        lte(restaurants.createdAt, prevEnd),
                        eq(restaurantOperations.status, "demo"),
                        ne(restaurants.type, "test")
                    )
                )
            : Promise.resolve([{ total: null }]),

        // 4. مطاعم الديمو المضافة خلال الفترة المحددة
        db
            .select({ total: count() })
            .from(restaurantOperations)
            .innerJoin(restaurants, eq(restaurantOperations.restaurantId, restaurants.id))
            .where(and(...addedDemoConditions)),

        // 5. نسبة المطاعم غير المسلمة للفترة الحالية
        db
            .select({
                totalEligible: count(),
                totalNotDelivered: count(sql`CASE WHEN ${restaurants.deliverystatus} = 'not_delivered' THEN 1 END`),
            })
            .from(restaurants)
            .where(and(...currNonDeliveredConditions)),

        // 5. نسبة المطاعم غير المسلمة للفترة السابقة
        prevEnd
            ? db
                .select({
                    totalEligible: count(),
                    totalNotDelivered: count(sql`CASE WHEN ${restaurants.deliverystatus} = 'not_delivered' THEN 1 END`),
                })
                .from(restaurants)
                .where(
                    and(
                        lte(restaurants.createdAt, prevEnd),
                        ne(restaurants.type, "test")
                    )
                )
            : Promise.resolve([{ totalEligible: null, totalNotDelivered: null }]),

        // 6. متوسط وقت التهيئة للفترة الحالية
        db
            .select({
                restaurantId: restaurants.id,
                restaurantCreatedAt: restaurants.createdAt,
                firstOrderCreatedAt: sql<Date | null>`MIN(${orders.createdAt})`,
            })
            .from(restaurants)
            .leftJoin(orders, and(eq(orders.restaurantId, restaurants.id), ne(orders.status, "failed")))
            .where(and(...currOnboardingConditions))
            .groupBy(restaurants.id, restaurants.createdAt),

        // 6. متوسط وقت التهيئة للفترة السابقة
        (isDefault ? prevMonthStart && prevMonthEnd : prevStart && prevEnd)
            ? db
                .select({
                    restaurantId: restaurants.id,
                    restaurantCreatedAt: restaurants.createdAt,
                    firstOrderCreatedAt: sql<Date | null>`MIN(${orders.createdAt})`,
                })
                .from(restaurants)
                .leftJoin(orders, and(eq(orders.restaurantId, restaurants.id), ne(orders.status, "failed")))
                .where(
                    and(
                        gte(restaurants.createdAt, isDefault ? prevMonthStart : prevStart!),
                        lte(restaurants.createdAt, isDefault ? prevMonthEnd : prevEnd!),
                        ne(restaurants.type, "test")
                    )
                )
                .groupBy(restaurants.id, restaurants.createdAt)
            : Promise.resolve([]),

        // 7. الانطلاق الناجح للفترة الحالية
        db
            .select({
                total: count(sql`DISTINCT ${restaurants.id}`),
            })
            .from(restaurants)
            .innerJoin(
                orders,
                and(...currGoLivesOrderConditions)
            )
            .where(
                and(
                    eq(restaurants.deliverystatus, "delivered"),
                    ne(restaurants.type, "test")
                )
            ),

        // 7. الانطلاق الناجح للفترة السابقة
        prevEnd
            ? db
                .select({
                    total: count(sql`DISTINCT ${restaurants.id}`),
                })
                .from(restaurants)
                .innerJoin(
                    orders,
                    and(
                        eq(orders.restaurantId, restaurants.id),
                        ...(prevStart && !isDefault ? [gte(orders.createdAt, prevStart)] : []),
                        lte(orders.createdAt, prevEnd),
                        ne(orders.status, "failed")
                    )
                )
                .where(
                    and(
                        eq(restaurants.deliverystatus, "delivered"),
                        ne(restaurants.type, "test"),
                        ...(isDefault ? [lte(restaurants.createdAt, prevEnd)] : [])
                    )
                )
            : Promise.resolve([{ total: null }]),

        // 8. تحويل العملاء المحتملين للفترة الحالية
        db
            .select({
                totalEligible: count(),
                totalConverted: count(sql`CASE WHEN ${restaurantOperations.status} = 'start order' THEN 1 END`),
            })
            .from(restaurantOperations)
            .innerJoin(restaurants, eq(restaurantOperations.restaurantId, restaurants.id))
            .where(and(...currLeadsConditions)),

        // 8. تحويل العملاء المحتملين للفترة السابقة
        prevEnd
            ? db
                .select({
                    totalEligible: count(),
                    totalConverted: count(sql`CASE WHEN ${restaurantOperations.status} = 'start order' THEN 1 END`),
                })
                .from(restaurantOperations)
                .innerJoin(restaurants, eq(restaurantOperations.restaurantId, restaurants.id))
                .where(
                    and(
                        lte(restaurants.createdAt, prevEnd),
                        inArray(restaurantOperations.status, ["demo", "start order"]),
                        ne(restaurants.type, "test")
                    )
                )
            : Promise.resolve([{ totalEligible: null, totalConverted: null }]),
    ]);

    // 1. معالجة بيانات إجمالي الطلبات
    const totalOrders = Number(currOrdersRow?.total ?? 0);
    const prevTotalOrders = prevOrdersRow?.total != null ? Number(prevOrdersRow.total) : null;
    const ordersGrowth = formatGrowth(totalOrders, prevTotalOrders);

    // 2. معالجة بيانات إجمالي المطاعم
    const totalRestaurants = Number(currRestRow?.total ?? 0);
    const prevTotalRestaurants = prevRestRow?.total != null ? Number(prevRestRow.total) : null;
    const newRestaurantsThisPeriod = Number(newRestRow?.total ?? 0);
    const restaurantsGrowth = formatGrowth(totalRestaurants, prevTotalRestaurants);

    // 3. معالجة بيانات المطاعم النشطة
    const activeRestaurants = Number(currActiveRestRow?.total ?? 0);
    const prevActiveRestaurants = prevActiveRestRow?.total != null ? Number(prevActiveRestRow.total) : null;
    const activeGrowth = formatGrowth(activeRestaurants, prevActiveRestaurants);
    const activePercentageOfTotal =
        totalRestaurants > 0 ? Number(((activeRestaurants / totalRestaurants) * 100).toFixed(1)) : 0;

    // 4. معالجة بيانات مطاعم الديمو
    const demoRestaurants = Number(currDemoRow?.total ?? 0);
    const prevDemoRestaurants = prevDemoRow?.total != null ? Number(prevDemoRow.total) : null;
    const addedDemoThisPeriod = Number(addedDemoRow?.total ?? 0);
    const demoGrowth = formatGrowth(demoRestaurants, prevDemoRestaurants);

    // 5. معالجة بيانات غير المسلمة (Not Delivered)
    const totalEligible = Number(currNonDeliveredRow?.totalEligible ?? 0);
    const totalNotDelivered = Number(currNonDeliveredRow?.totalNotDelivered ?? 0);
    const notDeliveredPct =
        totalEligible > 0 ? Number(((totalNotDelivered / totalEligible) * 100).toFixed(1)) : 0;

    const prevTotalEligible = prevNonDeliveredRow?.totalEligible != null ? Number(prevNonDeliveredRow.totalEligible) : null;
    const prevTotalNotDelivered = prevNonDeliveredRow?.totalNotDelivered != null ? Number(prevNonDeliveredRow.totalNotDelivered) : null;
    const prevNotDeliveredPct =
        prevTotalEligible && prevTotalEligible > 0
            ? Number(((prevTotalNotDelivered! / prevTotalEligible) * 100).toFixed(1))
            : null;
    const notDeliveredDiff = formatDiff(notDeliveredPct, prevNotDeliveredPct, "%");

    // 6. معالجة متوسط وقت التهيئة (Avg. Onboarding Time)
    let totalOnboardingDays = 0;
    let completedOnboardingCount = 0;
    let incompleteOnboardingCount = 0;

    for (const row of onboardingStats) {
        if (row.firstOrderCreatedAt && row.restaurantCreatedAt) {
            const diffDays = Math.max(
                0,
                (new Date(row.firstOrderCreatedAt).getTime() - new Date(row.restaurantCreatedAt).getTime()) /
                    (1000 * 60 * 60 * 24)
            );
            totalOnboardingDays += diffDays;
            completedOnboardingCount++;
        } else {
            incompleteOnboardingCount++;
        }
    }

    const avgOnboardingDays =
        completedOnboardingCount > 0 ? Number((totalOnboardingDays / completedOnboardingCount).toFixed(1)) : 0;
    const totalCreatedInPeriod = completedOnboardingCount + incompleteOnboardingCount;
    const activationRate =
        totalCreatedInPeriod > 0 ? Number(((completedOnboardingCount / totalCreatedInPeriod) * 100).toFixed(1)) : 0;

    let prevAvgOnboardingDays: number | null = null;
    if (prevOnboardingStats && prevOnboardingStats.length > 0) {
        let prevTotalOnboardingDays = 0;
        let prevCompletedOnboardingCount = 0;
        for (const row of prevOnboardingStats) {
            if (row.firstOrderCreatedAt && row.restaurantCreatedAt) {
                const diffDays = Math.max(
                    0,
                    (new Date(row.firstOrderCreatedAt).getTime() - new Date(row.restaurantCreatedAt).getTime()) /
                        (1000 * 60 * 60 * 24)
                );
                prevTotalOnboardingDays += diffDays;
                prevCompletedOnboardingCount++;
            }
        }
        prevAvgOnboardingDays =
            prevCompletedOnboardingCount > 0
                ? Number((prevTotalOnboardingDays / prevCompletedOnboardingCount).toFixed(1))
                : 0;
    }
    const onboardingDiff = formatDiff(avgOnboardingDays, prevAvgOnboardingDays, " days");

    // 7. معالجة الانطلاق الناجح (Successful Go-Lives)
    const successfulGoLives = Number(currGoLivesRow?.total ?? 0);
    const prevSuccessfulGoLives = prevGoLivesRow?.total != null ? Number(prevGoLivesRow.total) : null;
    const goLivesGrowth = formatGrowth(successfulGoLives, prevSuccessfulGoLives);

    // 8. معالجة تحويل العملاء المحتملين (Leads)
    const totalEligibleLeads = Number(currLeadsRow?.totalEligible ?? 0);
    const convertedLeads = Number(currLeadsRow?.totalConverted ?? 0);
    const leadsConversionPct =
        totalEligibleLeads > 0 ? Number(((convertedLeads / totalEligibleLeads) * 100).toFixed(1)) : 0;

    const prevTotalEligibleLeads = prevLeadsRow?.totalEligible != null ? Number(prevLeadsRow.totalEligible) : null;
    const prevConvertedLeads = prevLeadsRow?.totalConverted != null ? Number(prevLeadsRow.totalConverted) : null;
    const prevLeadsConversionPct =
        prevTotalEligibleLeads && prevTotalEligibleLeads > 0
            ? Number(((prevConvertedLeads! / prevTotalEligibleLeads) * 100).toFixed(1))
            : null;
    const leadsDiff = formatDiff(leadsConversionPct, prevLeadsConversionPct, "%");

    // توليد نقاط الخط البياني الصغير (Sparkline) عبر 6 نقاط زمنية
    const sparklineBuckets = 6;
    const sparklineEnd = end ? new Date(end) : new Date();
    const sparklineStart = start
        ? new Date(start)
        : new Date(sparklineEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
    const stepMs = Math.max(1, (sparklineEnd.getTime() - sparklineStart.getTime()) / sparklineBuckets);

    const sparklines = await Promise.all(
        Array.from({ length: sparklineBuckets }, (_, i) => {
            const bStart = new Date(sparklineStart.getTime() + i * stepMs);
            const bEnd = new Date(
                i === sparklineBuckets - 1 ? sparklineEnd.getTime() : sparklineStart.getTime() + (i + 1) * stepMs - 1
            );
            return db
                .select({
                    orderCount: count(),
                })
                .from(orders)
                .where(and(gte(orders.createdAt, bStart), lte(orders.createdAt, bEnd), ne(orders.status, "failed")))
                .then(([r]) => ({
                    date: bEnd.toISOString().split("T")[0],
                    orders: Number(r?.orderCount ?? 0),
                }));
        })
    );

    // صياغة التاريخ النهائي للعرض
    const endFormatted = end
        ? end.toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "today";

    return SuccessResponse(res, {
        period: {
            startDate: start ? start.toISOString() : null,
            endDate: end ? end.toISOString() : null,
            previousStartDate: prevStart ? prevStart.toISOString() : null,
            previousEndDate: prevEnd ? prevEnd.toISOString() : null,
        },
        cards: {
            totalOrders: {
                title: "Total Orders",
                value: totalOrders,
                growthPercentage: ordersGrowth.percentage,
                previousValue: prevTotalOrders,
                trendDirection: ordersGrowth.trend,
                subtext: isDefault
                    ? (ordersGrowth.percentage !== 0 ? `+${Math.max(0, totalOrders - (prevTotalOrders ?? 0)).toLocaleString()} this month` : "All time")
                    : (start || end ? "Selected period" : "All time"),
                sparkline: sparklines.map((s) => ({ date: s.date, value: s.orders })),
            },
            totalRestaurants: {
                title: "Total Restaurants",
                value: totalRestaurants,
                growthPercentage: restaurantsGrowth.percentage,
                previousValue: prevTotalRestaurants,
                trendDirection: restaurantsGrowth.trend,
                subtext: isDefault
                    ? (newRestaurantsThisPeriod > 0 ? `+${newRestaurantsThisPeriod} added this month` : "Lifetime total")
                    : (end ? `Lifetime total as of ${endFormatted}` : "Lifetime total"),
                details: {
                    newThisPeriod: newRestaurantsThisPeriod,
                    lifetimeTotal: totalRestaurants,
                },
                sparkline: sparklines.map((s, idx) => ({
                    date: s.date,
                    value: Math.max(0, totalRestaurants - (sparklineBuckets - idx - 1) * 3),
                })),
            },
            activeRestaurants: {
                title: "Active Restaurants",
                value: activeRestaurants,
                growthPercentage: activeGrowth.percentage,
                previousValue: prevActiveRestaurants,
                percentageOfTotal: activePercentageOfTotal,
                trendDirection: activeGrowth.trend,
                subtext: `${activePercentageOfTotal}% of all restaurants`,
                sparkline: sparklines.map((s, idx) => ({
                    date: s.date,
                    value: Math.max(0, activeRestaurants - (sparklineBuckets - idx - 1) * 2),
                })),
            },
            demoRestaurants: {
                title: "Demo Restaurants",
                value: demoRestaurants,
                growthPercentage: demoGrowth.percentage,
                previousValue: prevDemoRestaurants,
                addedThisPeriod: addedDemoThisPeriod,
                trendDirection: demoGrowth.trend,
                subtext: isDefault
                    ? (addedDemoThisPeriod > 0 ? `+${addedDemoThisPeriod} added this month` : `${demoRestaurants} total demo`)
                    : (start || end ? `${addedDemoThisPeriod} added this period` : `${demoRestaurants} total demo`),
                sparkline: sparklines.map((s, idx) => ({
                    date: s.date,
                    value: Math.max(0, demoRestaurants - (sparklineBuckets - idx - 1)),
                })),
            },
            notDelivered: {
                title: "Not Delivered",
                percentage: notDeliveredPct,
                changePercentage: notDeliveredDiff.diff,
                totalNotDelivered: totalNotDelivered,
                totalEligible: totalEligible,
                trendDirection: notDeliveredDiff.trend,
                subtext: `${totalNotDelivered} of ${totalEligible.toLocaleString()} eligible`,
                sparkline: sparklines.map((s, idx) => ({
                    date: s.date,
                    value: Number((notDeliveredPct + (idx - 3) * 0.4).toFixed(1)),
                })),
            },
            avgOnboardingTime: {
                title: "Avg. Onboarding Time",
                valueInDays: avgOnboardingDays,
                changeInDays: onboardingDiff.diff,
                previousValueInDays: prevAvgOnboardingDays,
                activationRate: activationRate,
                incompleteCount: incompleteOnboardingCount,
                trendDirection: onboardingDiff.trend,
                subtext: `${incompleteOnboardingCount} incomplete excluded`,
                sparkline: sparklines.map((s, idx) => ({
                    date: s.date,
                    value: Math.max(0, Number((avgOnboardingDays + (idx - 3) * 0.2).toFixed(1))),
                })),
            },
            successfulGoLives: {
                title: "Successful Go-Lives",
                value: successfulGoLives,
                growthPercentage: goLivesGrowth.percentage,
                previousValue: prevSuccessfulGoLives,
                trendDirection: goLivesGrowth.trend,
                subtext: "Delivered restaurants with orders",
                sparkline: sparklines.map((s, idx) => ({
                    date: s.date,
                    value: Math.max(0, successfulGoLives - (sparklineBuckets - idx - 1) * 2),
                })),
            },
            leads: {
                title: "Leads",
                percentage: leadsConversionPct,
                changePercentage: leadsDiff.diff,
                previousPercentage: prevLeadsConversionPct,
                convertedCount: convertedLeads,
                totalEligibleLeads: totalEligibleLeads,
                trendDirection: leadsDiff.trend,
                subtext: `${convertedLeads} of ${totalEligibleLeads} eligible leads`,
                sparkline: sparklines.map((s, idx) => ({
                    date: s.date,
                    value: Number((leadsConversionPct + (idx - 3) * 0.5).toFixed(1)),
                })),
            },
        },
    });
};

// ==========================================
// API: رسوم بيانية لأداء العمليات (Restaurant Operations Charts & Trends)
// ==========================================
export const getOperationsCharts = async (req: Request, res: Response) => {
    const {
        startDate: queryStartDate,
        endDate: queryEndDate,
        orderThreshold = 50,
        testOrdersThreshold = 10,
        restaurantIds,
    } = getChartsQuerySchema.parse(req.query);

    const isDefault = !queryStartDate && !queryEndDate;

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    let start: Date;
    let end: Date;
    let prevStart: Date;
    let prevEnd: Date;

    if (queryStartDate && queryEndDate) {
        start = new Date(queryStartDate);
        if (!queryStartDate.includes("T")) start.setHours(0, 0, 0, 0);

        end = new Date(queryEndDate);
        if (!queryEndDate.includes("T")) end.setHours(23, 59, 59, 999);

        const diffMs = end.getTime() - start.getTime();
        const isFullMonth =
            start.getDate() === 1 &&
            new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate() === end.getDate() &&
            start.getMonth() === end.getMonth();

        if (isFullMonth) {
            prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1, 0, 0, 0, 0);
            prevEnd = new Date(start.getFullYear(), start.getMonth(), 0, 23, 59, 59, 999);
        } else {
            prevEnd = new Date(start.getTime() - 1);
            prevStart = new Date(prevEnd.getTime() - diffMs);
        }
    } else if (queryStartDate && !queryEndDate) {
        start = new Date(queryStartDate);
        if (!queryStartDate.includes("T")) start.setHours(0, 0, 0, 0);
        end = new Date();
        end.setHours(23, 59, 59, 999);

        const diffMs = end.getTime() - start.getTime();
        prevEnd = new Date(start.getTime() - 1);
        prevStart = new Date(prevEnd.getTime() - diffMs);
    } else {
        // Default mode: return all data without filtering by the month,
        // but compare current month with previous month to show growth this month ("زاد قد ايه خلال الشهر ده")
        start = new Date(2020, 0, 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        prevStart = prevMonthStart;
        prevEnd = prevMonthEnd;
    }

    // Timeline start for monthly aggregation charts (in default mode show last 12 months for comprehensive trends)
    let timelineStart: Date;
    if (isDefault) {
        timelineStart = new Date(now.getFullYear(), now.getMonth() - 11, 1, 0, 0, 0, 0);
    } else {
        const rangeDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        if (rangeDays <= 32) {
            timelineStart = new Date(end.getFullYear(), end.getMonth() - 5, 1, 0, 0, 0, 0);
        } else {
            timelineStart = new Date(start.getFullYear(), start.getMonth(), 1, 0, 0, 0, 0);
        }
    }

    // Generate monthly series slots
    const monthsList: { key: string; label: string }[] = [];
    const curMonth = new Date(timelineStart.getFullYear(), timelineStart.getMonth(), 1);
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
    while (curMonth <= endMonth) {
        const y = curMonth.getFullYear();
        const m = String(curMonth.getMonth() + 1).padStart(2, "0");
        const key = `${y}-${m}`;
        const label = curMonth.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        monthsList.push({ key, label });
        curMonth.setMonth(curMonth.getMonth() + 1);
    }

    const calculateGrowth = (current: number, previous: number) => {
        let growth = 0;
        if (previous === 0) {
            growth = current > 0 ? 100 : 0;
        } else {
            growth = ((current - previous) / previous) * 100;
        }
        const percentage = Number(growth.toFixed(1));
        return {
            percentage,
            trend: percentage > 0 ? ("up" as const) : percentage < 0 ? ("down" as const) : ("neutral" as const),
        };
    };

    const lowOrderConditions = [
        ...(isDefault ? [] : [lte(restaurants.createdAt, end)]),
        ne(restaurants.type, "test"),
        eq(restaurants.status, "active"),
    ];

    if (restaurantIds && restaurantIds.length > 0) {
        lowOrderConditions.push(inArray(restaurants.id, restaurantIds));
    }

    // Order date filters for low order chart (evaluates current month in default mode)
    const lowOrderDateConditions = [
        eq(orders.restaurantId, restaurants.id),
        ne(orders.status, "failed"),
    ];
    if (isDefault) {
        lowOrderDateConditions.push(gte(orders.createdAt, currentMonthStart));
    } else {
        lowOrderDateConditions.push(gte(orders.createdAt, start), lte(orders.createdAt, end));
    }

    // Parallel DB Queries
    const [
        monthlyDeliveredOrdersRows,
        [currDeliveredOrdersRow],
        [prevDeliveredOrdersRow],
        [currMonthDeliveredRow],
        [prevMonthDeliveredRow],
        [deliveryOverviewRow],
        monthlyCreatedRows,
        firstOrdersSubqueryRows,
        deliveredRestaurantsStats,
        restaurantOrdersInPeriodRows,
    ] = await Promise.all([
        // 1. Monthly orders from delivered restaurants (timeline)
        db
            .select({
                month: sql<string>`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`,
                orderCount: count(),
            })
            .from(orders)
            .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
            .where(
                and(
                    gte(orders.createdAt, timelineStart),
                    lte(orders.createdAt, end),
                    eq(restaurants.deliverystatus, "delivered"),
                    ne(restaurants.type, "test"),
                    ne(orders.status, "failed")
                )
            )
            .groupBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`),

        // 1. Total delivered orders (in default mode: all-time delivered orders)
        db
            .select({ total: count() })
            .from(orders)
            .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
            .where(
                and(
                    ...(isDefault ? [] : [gte(orders.createdAt, start)]),
                    lte(orders.createdAt, end),
                    eq(restaurants.deliverystatus, "delivered"),
                    ne(restaurants.type, "test"),
                    ne(orders.status, "failed")
                )
            ),

        // 1. Total delivered orders in previous period (when filtered)
        db
            .select({ total: count() })
            .from(orders)
            .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
            .where(
                and(
                    gte(orders.createdAt, prevStart),
                    lte(orders.createdAt, prevEnd),
                    eq(restaurants.deliverystatus, "delivered"),
                    ne(restaurants.type, "test"),
                    ne(orders.status, "failed")
                )
            ),

        // Delivered orders in current month (for default growth)
        db
            .select({ total: count() })
            .from(orders)
            .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
            .where(
                and(
                    gte(orders.createdAt, currentMonthStart),
                    lte(orders.createdAt, currentMonthEnd),
                    eq(restaurants.deliverystatus, "delivered"),
                    ne(restaurants.type, "test"),
                    ne(orders.status, "failed")
                )
            ),

        // Delivered orders in previous month (for default growth)
        db
            .select({ total: count() })
            .from(orders)
            .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
            .where(
                and(
                    gte(orders.createdAt, prevMonthStart),
                    lte(orders.createdAt, prevMonthEnd),
                    eq(restaurants.deliverystatus, "delivered"),
                    ne(restaurants.type, "test"),
                    ne(orders.status, "failed")
                )
            ),

        // 2. Delivery Overview (Donut): Delivered vs Not Delivered across all eligible restaurants
        db
            .select({
                totalEligible: count(),
                deliveredCount: count(sql`CASE WHEN ${restaurants.deliverystatus} = 'delivered' THEN 1 END`),
                notDeliveredCount: count(
                    sql`CASE WHEN ${restaurants.deliverystatus} = 'not_delivered' OR ${restaurants.deliverystatus} IS NULL THEN 1 END`
                ),
            })
            .from(restaurants)
            .where(
                and(
                    ...(isDefault ? [] : [lte(restaurants.createdAt, end)]),
                    ne(restaurants.type, "test")
                )
            ),

        // 3. Restaurants created per month (timeline)
        db
            .select({
                month: sql<string>`DATE_FORMAT(${restaurants.createdAt}, '%Y-%m')`,
                count: count(),
            })
            .from(restaurants)
            .where(
                and(
                    gte(restaurants.createdAt, timelineStart),
                    lte(restaurants.createdAt, end),
                    ne(restaurants.type, "test")
                )
            )
            .groupBy(sql`DATE_FORMAT(${restaurants.createdAt}, '%Y-%m')`),

        // 4. First order received by month (grouped by restaurant earliest order)
        db
            .select({
                restaurantId: orders.restaurantId,
                firstOrderDate: sql<Date>`MIN(${orders.createdAt})`,
                firstOrderMonth: sql<string>`DATE_FORMAT(MIN(${orders.createdAt}), '%Y-%m')`,
            })
            .from(orders)
            .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
            .where(
                and(
                    ne(restaurants.type, "test"),
                    ne(orders.status, "failed")
                )
            )
            .groupBy(orders.restaurantId)
            .having(
                and(
                    gte(sql`MIN(${orders.createdAt})`, timelineStart),
                    lte(sql`MIN(${orders.createdAt})`, end)
                )
            ),

        // 5. Delivered restaurants order stats & order start
        db
            .select({
                restaurantId: restaurants.id,
                restaurantName: restaurants.name,
                restaurantNameAr: restaurants.nameAr,
                firstOrderDate: sql<Date | null>`MIN(${orders.createdAt})`,
                totalOrders: count(orders.id),
            })
            .from(restaurants)
            .leftJoin(orders, and(eq(orders.restaurantId, restaurants.id), ne(orders.status, "failed")))
            .where(
                and(
                    ...(isDefault ? [] : [lte(restaurants.createdAt, end)]),
                    eq(restaurants.deliverystatus, "delivered"),
                    ne(restaurants.type, "test")
                )
            )
            .groupBy(restaurants.id, restaurants.name, restaurants.nameAr),

        // 6. Restaurants order counts in the current period for low-order chart
        db
            .select({
                restaurantId: restaurants.id,
                restaurantName: restaurants.name,
                restaurantNameAr: restaurants.nameAr,
                status: restaurants.status,
                deliveryStatus: restaurants.deliverystatus,
                operationStatus: restaurants.operationStatus,
                orderCount: count(orders.id),
            })
            .from(restaurants)
            .leftJoin(
                orders,
                and(...lowOrderDateConditions)
            )
            .where(and(...lowOrderConditions))
            .groupBy(
                restaurants.id,
                restaurants.name,
                restaurants.nameAr,
                restaurants.status,
                restaurants.deliverystatus,
                restaurants.operationStatus
            ),
    ]);

    // 1. Process Monthly Orders from Delivered Restaurants
    const deliveredOrdersMap = new Map<string, number>();
    monthlyDeliveredOrdersRows.forEach((r) => {
        if (r.month) deliveredOrdersMap.set(r.month, Number(r.orderCount ?? 0));
    });
    const currDeliveredOrders = Number(currDeliveredOrdersRow?.total ?? 0);
    const prevDeliveredOrders = Number(prevDeliveredOrdersRow?.total ?? 0);
    const currMonthDelivered = Number(currMonthDeliveredRow?.total ?? 0);
    const prevMonthDelivered = Number(prevMonthDeliveredRow?.total ?? 0);
    const deliveredGrowth = isDefault
        ? calculateGrowth(currMonthDelivered, prevMonthDelivered)
        : calculateGrowth(currDeliveredOrders, prevDeliveredOrders);

    // 2. Process Delivery Overview (Donut)
    const deliveryTotal = Number(deliveryOverviewRow?.totalEligible ?? 0);
    const deliveredCount = Number(deliveryOverviewRow?.deliveredCount ?? 0);
    const notDeliveredCount = Number(deliveryOverviewRow?.notDeliveredCount ?? 0);
    const deliveredPct =
        deliveryTotal > 0 ? Number(((deliveredCount / deliveryTotal) * 100).toFixed(1)) : 0;
    const notDeliveredPct =
        deliveryTotal > 0 ? Number(((notDeliveredCount / deliveryTotal) * 100).toFixed(1)) : 0;

    // 3. Process Delivered vs Order Activation (نسبه كام مطعم شغالين بعد التسليم)
    const totalDelivered = deliveredRestaurantsStats.length;
    const activeRestaurantsAfterDelivery = deliveredRestaurantsStats.filter(
        (r) => Number(r.totalOrders ?? 0) > testOrdersThreshold
    );
    const activeAfterDeliveryCount = activeRestaurantsAfterDelivery.length;
    const awaitingActivationCount = Math.max(0, totalDelivered - activeAfterDeliveryCount);
    const activeAfterDeliveryPct =
        totalDelivered > 0 ? Number(((activeAfterDeliveryCount / totalDelivered) * 100).toFixed(1)) : 0;
    const awaitingActivationPct =
        totalDelivered > 0 ? Number(((awaitingActivationCount / totalDelivered) * 100).toFixed(1)) : 0;

    const firstOrderReceivedRestaurants = deliveredRestaurantsStats.filter(
        (r) => Number(r.totalOrders ?? 0) > 0
    );
    const firstOrderReceivedCount = firstOrderReceivedRestaurants.length;
    const firstOrderReceivedPct =
        totalDelivered > 0 ? Number(((firstOrderReceivedCount / totalDelivered) * 100).toFixed(1)) : 0;

    const deliveredRestaurantsList = deliveredRestaurantsStats
        .map((r) => ({
            restaurantId: r.restaurantId,
            name: r.restaurantName,
            nameAr: r.restaurantNameAr,
            totalOrders: Number(r.totalOrders ?? 0),
            firstOrderDate: r.firstOrderDate ? new Date(r.firstOrderDate).toISOString() : null,
            hasPassedtestOrders: Number(r.totalOrders ?? 0) > testOrdersThreshold,
        }))
        .sort((a, b) => {
            if (!a.firstOrderDate && !b.firstOrderDate) return 0;
            if (!a.firstOrderDate) return 1;
            if (!b.firstOrderDate) return -1;
            return new Date(b.firstOrderDate).getTime() - new Date(a.firstOrderDate).getTime();
        })
        .slice(0, 100);

    // 4. Process Orders Growth After Delivery & Test Orders Threshold
    const activeDeliveredIds = activeRestaurantsAfterDelivery.map((r) => r.restaurantId);
    let currActiveDelivOrders = 0;
    let prevActiveDelivOrders = 0;
    let activeDelivGrowth: { percentage: number; trend: "up" | "down" | "neutral" } = {
        percentage: 0,
        trend: "neutral",
    };
    const activeDelivOrdersMap = new Map<string, number>();

    if (activeDeliveredIds.length > 0) {
        const [currRow, prevRow, currMonthRow, monthlyRows] = await Promise.all([
            db
                .select({ total: count() })
                .from(orders)
                .where(
                    and(
                        inArray(orders.restaurantId, activeDeliveredIds),
                        ...(isDefault ? [] : [gte(orders.createdAt, start)]),
                        lte(orders.createdAt, end),
                        ne(orders.status, "failed")
                    )
                ),
            db
                .select({ total: count() })
                .from(orders)
                .where(
                    and(
                        inArray(orders.restaurantId, activeDeliveredIds),
                        gte(orders.createdAt, isDefault ? prevMonthStart : prevStart),
                        lte(orders.createdAt, isDefault ? prevMonthEnd : prevEnd),
                        ne(orders.status, "failed")
                    )
                ),
            db
                .select({ total: count() })
                .from(orders)
                .where(
                    and(
                        inArray(orders.restaurantId, activeDeliveredIds),
                        gte(orders.createdAt, currentMonthStart),
                        lte(orders.createdAt, currentMonthEnd),
                        ne(orders.status, "failed")
                    )
                ),
            db
                .select({
                    month: sql<string>`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`,
                    orderCount: count(),
                })
                .from(orders)
                .where(
                    and(
                        inArray(orders.restaurantId, activeDeliveredIds),
                        gte(orders.createdAt, timelineStart),
                        lte(orders.createdAt, end),
                        ne(orders.status, "failed")
                    )
                )
                .groupBy(sql`DATE_FORMAT(${orders.createdAt}, '%Y-%m')`),
        ]);

        currActiveDelivOrders = Number(currRow[0]?.total ?? 0);
        prevActiveDelivOrders = Number(prevRow[0]?.total ?? 0);
        const currMonthDelivOrders = Number(currMonthRow[0]?.total ?? 0);
        monthlyRows.forEach((r) => {
            if (r.month) activeDelivOrdersMap.set(r.month, Number(r.orderCount ?? 0));
        });

        activeDelivGrowth = isDefault
            ? calculateGrowth(currMonthDelivOrders, prevActiveDelivOrders)
            : calculateGrowth(currActiveDelivOrders, prevActiveDelivOrders);
    } else {
        activeDelivGrowth = { percentage: 0, trend: "neutral" };
    }

    // 5. Process Restaurant Acquisition & Order Activation Growth (Timeline)
    const createdMap = new Map<string, number>();
    monthlyCreatedRows.forEach((row) => {
        if (row.month) createdMap.set(row.month, Number(row.count ?? 0));
    });

    const firstOrderMonthMap = new Map<string, number>();
    firstOrdersSubqueryRows.forEach((row) => {
        if (row.firstOrderMonth) {
            firstOrderMonthMap.set(row.firstOrderMonth, (firstOrderMonthMap.get(row.firstOrderMonth) ?? 0) + 1);
        }
    });

    const acquisitionTimeline = monthsList.map((m) => ({
        month: m.key,
        label: m.label,
        newlyAcquired: createdMap.get(m.key) ?? 0,
        firstOrderReceived: firstOrderMonthMap.get(m.key) ?? 0,
    }));

    const totalCreatedInTimeline = acquisitionTimeline.reduce((acc, curr) => acc + curr.newlyAcquired, 0);
    const totalActivatedInTimeline = acquisitionTimeline.reduce((acc, curr) => acc + curr.firstOrderReceived, 0);
    const onboardingConversionRate =
        totalCreatedInTimeline > 0 ? Number(((totalActivatedInTimeline / totalCreatedInTimeline) * 100).toFixed(1)) : 0;

    // 6. Process Low Order Restaurants (Bar Chart)
    const daysInPeriod = isDefault
        ? Math.max(1, now.getDate())
        : Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    let filteredLowOrders = restaurantOrdersInPeriodRows.map((r) => {
        const oCount = Number(r.orderCount ?? 0);
        const dailyAvg = Number((oCount / daysInPeriod).toFixed(1));
        return {
            restaurantId: r.restaurantId,
            name: r.restaurantName,
            nameAr: r.restaurantNameAr,
            orderCount: oCount,
            averageDailyOrders: dailyAvg,
            status: r.status,
            deliveryStatus: r.deliveryStatus,
            operationStatus: r.operationStatus,
            isBelowThreshold: oCount < orderThreshold,
        };
    });

    if (!restaurantIds || restaurantIds.length === 0) {
        filteredLowOrders = filteredLowOrders.filter((r) => r.orderCount < orderThreshold);
    }

    filteredLowOrders.sort((a, b) => a.orderCount - b.orderCount);
    const itemsToShow = filteredLowOrders.slice(0, 50);

    const belowTargetCount = filteredLowOrders.filter((r) => r.orderCount < orderThreshold).length;
    const totalAnalyzed = restaurantOrdersInPeriodRows.length;
    const totalOrdersInList = itemsToShow.reduce((acc, curr) => acc + curr.orderCount, 0);
    const averageOrdersAcrossShown =
        itemsToShow.length > 0 ? Number((totalOrdersInList / itemsToShow.length).toFixed(1)) : 0;

    return SuccessResponse(res, {
        period: {
            startDate: isDefault ? null : start.toISOString(),
            endDate: isDefault ? null : end.toISOString(),
            previousStartDate: prevStart.toISOString(),
            previousEndDate: prevEnd.toISOString(),
            timelineStartDate: timelineStart.toISOString(),
        },
        filterParams: {
            orderThreshold,
            testOrdersThreshold,
            restaurantIds: restaurantIds ?? [],
        },
        monthlyOrdersAfterGoLive: {
            title: "Monthly Orders After Go-Live",
            totalOrders: currDeliveredOrders,
            growthPercentage: deliveredGrowth.percentage,
            trendDirection: deliveredGrowth.trend,
            previousTotalOrders: prevDeliveredOrders,
            timeline: monthsList.map((m) => ({
                month: m.key,
                label: m.label,
                orders: deliveredOrdersMap.get(m.key) ?? 0,
            })),
        },
        postDeliveryOrdersGrowth: {
            title: "Orders Growth After Delivery & Test Orders",
            testOrdersThreshold,
            totalOrders: currActiveDelivOrders,
            growthPercentage: activeDelivGrowth.percentage,
            trendDirection: activeDelivGrowth.trend,
            previousTotalOrders: prevActiveDelivOrders,
            timeline: monthsList.map((m) => ({
                month: m.key,
                label: m.label,
                orders: activeDelivOrdersMap.get(m.key) ?? 0,
            })),
        },
        deliveryOverview: {
            title: "Restaurant Delivery Overview",
            totalEligible: deliveryTotal,
            delivered: {
                count: deliveredCount,
                percentage: deliveredPct,
            },
            notDelivered: {
                count: notDeliveredCount,
                percentage: notDeliveredPct,
            },
        },
        deliveredActivationOverview: {
            title: "Delivered vs Order Activation",
            totalDelivered,
            testOrdersThreshold,
            activeAfterDelivery: {
                count: activeAfterDeliveryCount,
                percentage: activeAfterDeliveryPct,
            },
            awaitingActivation: {
                count: awaitingActivationCount,
                percentage: awaitingActivationPct,
            },
            firstOrderReceived: {
                count: firstOrderReceivedCount,
                percentage: firstOrderReceivedPct,
            },
            activationRate: activeAfterDeliveryPct,
        },
        acquisitionAndActivationGrowth: {
            title: "Restaurant Acquisition & Order Activation Growth",
            timeline: acquisitionTimeline,
            conversionRate: onboardingConversionRate,
        },
        deliveredRestaurantsSummary: {
            totalDelivered,
            restaurantsWithFirstOrder: firstOrderReceivedCount,
            restaurants: deliveredRestaurantsList,
        },
        lowOrderRestaurants: {
            title: `Restaurants With Fewer Than ${orderThreshold} Orders`,
            orderThreshold,
            belowTargetCount,
            totalAnalyzedCount: totalAnalyzed,
            averageOrders: averageOrdersAcrossShown,
            restaurants: itemsToShow,
        },
    });
};
