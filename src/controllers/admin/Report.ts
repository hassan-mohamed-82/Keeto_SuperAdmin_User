// controllers/admin/FinancialReportController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { orders, restaurants, restaurantBusinessPlans, invoices, paymentMethods, selectReasons, sales, restaurant_users, users, zones, cities, cuisines } from "../../models/schema";
import { eq, and, desc, gte, lte, inArray, count, sql } from "drizzle-orm";
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
            cancelReasonType: selectReasons.type,
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
            restaurantId: restaurants.id,
            restaurantName: restaurants.name,
            city: {
                id: cities.id,
                name: cities.name,
                nameAr: cities.nameAr,
                nameFr: cities.nameFr,
            },
            status: orders.status,
            cancelReasonType: selectReasons.type,
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
                counts: { total: 0, cash: 0, digital: 0 },
                sales: { totalRevenue: 0, cashCollected: 0, digitalCollected: 0 },
                platformDues: { totalCommission: 0, totalServiceFee: 0 }, // 👈 رجعنا السيرفس فيز للمنصة
                settlementRaw: { cashCommission: 0, cashServiceFee: 0, digitalCommission: 0, digitalServiceFee: 0 }
            };
        }

        const entry = restaurantMap[rId];

        if (order.status === "cancelled") {
            if (order.cancelReasonType === "restaurant") {
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
            ordersCount: entry.counts,
            sales: {
                totalRevenue: entry.sales.totalRevenue.toFixed(2),
                cashInRestaurantDrawer: entry.sales.cashCollected.toFixed(2),
                digitalInPlatformBank: entry.sales.digitalCollected.toFixed(2),
            },
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
            cancelReasonType: selectReasons.type,
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
            cancelReasonType: selectReasons.type,
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

    const orderConditions = [];
    if (startDate) orderConditions.push(gte(orders.createdAt, new Date(startDate as string)));
    if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        orderConditions.push(lte(orders.createdAt, end));
    }

    const restConditions = [eq(restaurants.status, "active")];
    if (cityId) restConditions.push(eq(restaurants.cityId, cityId as string));

    // 1. Fetch all restaurants
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
        })
        .from(restaurants)
        .leftJoin(sales, eq(restaurants.salesId, sales.id))
        .leftJoin(cities, eq(restaurants.cityId, cities.id))
        .where(and(...restConditions));

    const allCuisines = await db.select().from(cuisines);
    const cuisineMap = new Map();
    allCuisines.forEach(c => cuisineMap.set(c.id, c));

    const allRestaurants = allRestaurantsRaw.map(r => {
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
        };
    });

    let totalRestaurants = allRestaurants.length;
    let restaurantsByType: Record<string, number> = {
        "mega": 0,
        "super": 0,
        "A": 0,
        "B": 0,
        "C": 0,
        "C-": 0,
        "test": 0
    };

    allRestaurants.forEach((r) => {
        const rType = r.type || "Unknown";
        if (restaurantsByType[rType] !== undefined) {
            restaurantsByType[rType] += 1;
        } else {
            restaurantsByType[rType] = 1;
        }
    });

    // 2. Fetch orders within date range — only for active restaurants
    const activeRestaurantIds = allRestaurants.map((r) => r.id);

    const allOrderConditions = [...orderConditions];
    if (activeRestaurantIds.length > 0) {
        allOrderConditions.push(inArray(orders.restaurantId, activeRestaurantIds));
    }

    const ordersData = await db
        .select({
            restaurantId: orders.restaurantId,
            appCommission: orders.appCommission,
            status: orders.status,
            cancelReasonType: selectReasons.type,
        })
        .from(orders)
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .where(allOrderConditions.length > 0 ? and(...allOrderConditions) : undefined);

    let totalOrders = ordersData.length;
    let total_commission = 0;
    let totalValidOrders = 0;
    let totalCanceledOrders = 0;
    let totalCanceledByUser = 0;
    let totalCanceledByRestaurant = 0;

    // Group orders by restaurantId
    const ordersStatsByRestaurant: Record<string, { count: number, commission: number, validCount: number, canceledCount: number, canceledByUser: number, canceledByRestaurant: number }> = {};
    ordersData.forEach((o) => {
        const comm = parseFloat(o.appCommission as any) || 0;
        const isCanceled = o.status === "cancelled";
        const isCanceledByRestaurant = isCanceled && o.cancelReasonType === "restaurant";

        // Add commission if valid, or if canceled by restaurant
        if (!isCanceled || isCanceledByRestaurant) {
            total_commission += comm;
        }

        if (isCanceled) {
            totalCanceledOrders += 1;
            if (o.cancelReasonType === "user") totalCanceledByUser += 1;
            if (o.cancelReasonType === "restaurant") totalCanceledByRestaurant += 1;
        } else {
            totalValidOrders += 1;
        }

        if (o.restaurantId) {
            if (!ordersStatsByRestaurant[o.restaurantId]) {
                ordersStatsByRestaurant[o.restaurantId] = { count: 0, commission: 0, validCount: 0, canceledCount: 0, canceledByUser: 0, canceledByRestaurant: 0 };
            }
            ordersStatsByRestaurant[o.restaurantId].count += 1;

            if (!isCanceled || isCanceledByRestaurant) {
                ordersStatsByRestaurant[o.restaurantId].commission += comm;
            }

            if (isCanceled) {
                ordersStatsByRestaurant[o.restaurantId].canceledCount += 1;
                if (o.cancelReasonType === "user") ordersStatsByRestaurant[o.restaurantId].canceledByUser += 1;
                if (o.cancelReasonType === "restaurant") ordersStatsByRestaurant[o.restaurantId].canceledByRestaurant += 1;
            } else {
                ordersStatsByRestaurant[o.restaurantId].validCount += 1;
            }
        }
    });

    // 3. Filter restaurants based on 'type' and/or 'restaurantId' if provided
    let filteredRestaurants = allRestaurants;
    if (type) {
        filteredRestaurants = filteredRestaurants.filter((r) => (r.type || "Unknown") === type);
    }
    if (restaurantId) {
        filteredRestaurants = filteredRestaurants.filter((r) => r.id === (restaurantId as string));
    }

    // 4. Build with/without orders lists from the full active list
    const withOrdersList = allRestaurants.filter((r) => {
        const stats = ordersStatsByRestaurant[r.id];
        return stats && stats.validCount > 0;
    });
    const withoutOrdersList = allRestaurants.filter((r) => {
        const stats = ordersStatsByRestaurant[r.id];
        return !stats || stats.validCount === 0;
    });

    // ─── Signup Users ────────────────────────────────────────────────────────
    // 1. Total number of users who signed up
    const [{ totalSignupUsers }] = await db
        .select({ totalSignupUsers: count(users.id) })
        .from(users);

    // 2. Number of signup users per restaurant
    const signupPerRestaurantRaw = await db
        .select({
            restaurantId: restaurant_users.restaurantId,
            signupCount: count(restaurant_users.userId),
        })
        .from(restaurant_users)
        .groupBy(restaurant_users.restaurantId);

    // Build a quick lookup map: restaurantId -> signupCount
    const signupByRestaurantMap: Record<string, number> = {};
    for (const row of signupPerRestaurantRaw) {
        signupByRestaurantMap[row.restaurantId] = Number(row.signupCount);
    }

    // 5. Map full filtered restaurants to detailed result
    const restaurantDetails = filteredRestaurants.map((r) => {
        const stats = ordersStatsByRestaurant[r.id] || { count: 0, commission: 0, validCount: 0, canceledCount: 0, canceledByUser: 0, canceledByRestaurant: 0 };
        // If a specific restaurantId is requested, return full restaurant details; otherwise return slim info
        const restaurantInfo = r
        // const restaurantInfo = restaurantId
        //     ? r
        //     : { id: r.id, name: r.name, nameAr: r.nameAr, type: r.type, status: r.status };
        return {
            restaurantDetails: restaurantInfo,
            ordersCount: stats.count,
            validOrders: stats.validCount,
            canceledOrders: stats.canceledCount,
            canceledByUser: stats.canceledByUser,
            canceledByRestaurant: stats.canceledByRestaurant,
            total_commission: stats.commission,
            signupUsersCount: signupByRestaurantMap[r.id] ?? 0,
        };
    });

    // 6. Decide which list to return in 'restaurants' key
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
        restaurantsResult = restaurantDetails; // already has signupUsersCount
    }

    const responseData: any = {
        summary: {
            totalOrders,
            validOrders: totalValidOrders,
            canceledOrders: totalCanceledOrders,
            canceledBreakdown: {
                user: totalCanceledByUser,
                restaurant: totalCanceledByRestaurant
            },
            totalRestaurants,
            restaurantsWithOrders: withOrdersList.length,
            restaurantsWithoutOrders: withoutOrdersList.length,
            total_commission,
            restaurantsByType,
            totalSignupUsers,
        },
        restaurants: restaurantsResult,
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