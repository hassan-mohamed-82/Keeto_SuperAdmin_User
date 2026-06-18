"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.markInvoiceAsPaid = exports.generateAndSaveInvoice = exports.generateRestaurantInvoicePDF = exports.getRestaurantInvoices = exports.getSingleRestaurantReport = exports.getDetailedRestaurantReport = exports.getFinancialReport = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const pdfkit_1 = __importDefault(require("pdfkit"));
const uuid_1 = require("uuid");
// ==========================================
// API 1: التقرير المالي العام 
// ==========================================
const getFinancialReport = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    // 1. استقبال متغيرات الفلترة فقط (بدون page و limit)
    const { restaurantId, startDate, endDate, status, paymentMethod } = req.query;
    const conditions = [];
    if (restaurantId)
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId));
    if (status)
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.status, status));
    if (paymentMethod)
        conditions.push((0, drizzle_orm_1.eq)(schema_1.paymentMethods.name, paymentMethod));
    if (startDate)
        conditions.push((0, drizzle_orm_1.gte)(schema_1.orders.createdAt, new Date(startDate)));
    if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        conditions.push((0, drizzle_orm_1.lte)(schema_1.orders.createdAt, end));
    }
    // 2. جلب الداتا الأساسية المطلوبة للعمليات الحسابية فقط
    const reportData = await connection_1.db
        .select({
        status: schema_1.orders.status,
        orderSource: schema_1.orders.orderSource,
        paymentMethodName: schema_1.paymentMethods.name,
        deliveryFee: schema_1.orders.deliveryFee,
        serviceFee: schema_1.orders.serviceFee,
        appCommission: schema_1.orders.appCommission,
        totalAmount: schema_1.orders.totalAmount,
        cancelReasonType: schema_1.selectReasons.type,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.selectReasons, (0, drizzle_orm_1.eq)(schema_1.orders.cancelReasonId, schema_1.selectReasons.id))
        .leftJoin(schema_1.paymentMethods, (0, drizzle_orm_1.eq)(schema_1.orders.paymentMethod, schema_1.paymentMethods.id))
        .where(conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined);
    // ==========================================
    // 📊 3. تجهيز الكيانات التحليلية (Analytics Entities)
    // ==========================================
    let grandTotalRevenue = 0;
    let grandTotalKeetoCommission = 0;
    let grandTotalServiceFees = 0;
    let grandTotalDeliveryFees = 0;
    let validOrdersCount = 0;
    const breakdownByPayment = { cash: 0, visa: 0, wallet: 0 };
    const breakdownBySource = {};
    const breakdownByStatus = {};
    for (const order of reportData) {
        const isCancelledByUser = order.status === "cancelled" && order.cancelReasonType === "user";
        // 📈 تجميع الإحصائيات حسب الحالة
        const currentStatus = order.status;
        if (!breakdownByStatus[currentStatus])
            breakdownByStatus[currentStatus] = { orders: 0, revenue: 0 };
        breakdownByStatus[currentStatus].orders += 1;
        breakdownByStatus[currentStatus].revenue += parseFloat(order.totalAmount || "0");
        // 🛑 استبعاد الأوردرات الملغية من الحسابات المالية الصافية
        if (isCancelledByUser)
            continue;
        validOrdersCount++;
        const amount = parseFloat(order.totalAmount || "0");
        const commission = parseFloat(order.appCommission || "0");
        const svcFee = parseFloat(order.serviceFee || "0");
        const dlvFee = parseFloat(order.deliveryFee || "0");
        grandTotalRevenue += amount;
        grandTotalKeetoCommission += commission;
        grandTotalServiceFees += svcFee;
        grandTotalDeliveryFees += dlvFee;
        // 📈 تجميع الإحصائيات حسب المصدر (Source)
        const source = order.orderSource || "unknown";
        if (!breakdownBySource[source])
            breakdownBySource[source] = { orders: 0, revenue: 0, commission: 0 };
        breakdownBySource[source].orders += 1;
        breakdownBySource[source].revenue += amount;
        breakdownBySource[source].commission += commission;
        // 📈 تجميع الإحصائيات حسب طريقة الدفع
        const payment = (order.paymentMethodName || "").toLowerCase();
        if (payment.includes("cash") || payment.includes("استلام")) {
            breakdownByPayment.cash += amount;
        }
        else if (payment.includes("visa") || payment.includes("بطاقة")) {
            breakdownByPayment.visa += amount;
        }
        else {
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
    return (0, response_1.SuccessResponse)(res, {
        message: "Financial macro-report generated successfully",
        data: summary
    });
};
exports.getFinancialReport = getFinancialReport;
// ==========================================
// API 2: تقرير تفصيلي حسب كل مطعم (All Restaurants Overview)
// ==========================================
// ==========================================
// API 2: تقرير تفصيلي حسب كل مطعم (All Restaurants Overview)
// ==========================================
const getDetailedRestaurantReport = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const { startDate, endDate } = req.query;
    const conditions = [];
    if (startDate)
        conditions.push((0, drizzle_orm_1.gte)(schema_1.orders.createdAt, new Date(startDate)));
    if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        conditions.push((0, drizzle_orm_1.lte)(schema_1.orders.createdAt, end));
    }
    const ordersData = await connection_1.db
        .select({
        orderId: schema_1.orders.id,
        orderSource: schema_1.orders.orderSource,
        paymentMethodName: schema_1.paymentMethods.name,
        subtotal: schema_1.orders.subtotal,
        deliveryFee: schema_1.orders.deliveryFee,
        serviceFee: schema_1.orders.serviceFee, // 👈 دي الرسوم الثابتة بتاعة كيتو (الـ 5 جنيه)
        appCommission: schema_1.orders.appCommission, // 👈 دي العمولة المئوية بتاعة كيتو
        totalAmount: schema_1.orders.totalAmount,
        restaurantId: schema_1.restaurants.id,
        restaurantName: schema_1.restaurants.name,
        status: schema_1.orders.status,
        cancelReasonType: schema_1.selectReasons.type,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.selectReasons, (0, drizzle_orm_1.eq)(schema_1.orders.cancelReasonId, schema_1.selectReasons.id))
        .leftJoin(schema_1.paymentMethods, (0, drizzle_orm_1.eq)(schema_1.orders.paymentMethod, schema_1.paymentMethods.id))
        .where(conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined);
    const restaurantMap = {};
    let grandTotalAmount = 0, grandTotalPlatformCommission = 0;
    for (const order of ordersData) {
        const isCancelledByUser = order.status === "cancelled" && order.cancelReasonType === "user";
        if (isCancelledByUser)
            continue;
        const rId = order.restaurantId || "unknown";
        if (!restaurantMap[rId]) {
            restaurantMap[rId] = {
                restaurantId: rId,
                restaurantName: order.restaurantName || "Unknown",
                counts: { total: 0, cash: 0, digital: 0 },
                sales: { totalRevenue: 0, cashCollected: 0, digitalCollected: 0 },
                platformDues: { totalCommission: 0, totalServiceFee: 0 }, // 👈 رجعنا السيرفس فيز للمنصة
                settlementRaw: { cashCommission: 0, cashServiceFee: 0, digitalCommission: 0, digitalServiceFee: 0 }
            };
        }
        const entry = restaurantMap[rId];
        const amount = parseFloat(order.totalAmount || "0");
        const commission = parseFloat(order.appCommission || "0");
        const svcFee = parseFloat(order.serviceFee || "0"); // الـ 5 جنيه
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
        }
        else {
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
    return (0, response_1.SuccessResponse)(res, {
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
exports.getDetailedRestaurantReport = getDetailedRestaurantReport;
// ==========================================
// API 3: تقرير مالي تفصيلي لمطعم واحد (Single Restaurant Breakdown)
// ==========================================
const getSingleRestaurantReport = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const { restaurantId } = req.params;
    const { startDate, endDate } = req.query;
    if (!restaurantId)
        throw new Errors_1.BadRequest("Restaurant ID is required");
    const [restaurant] = await connection_1.db.select().from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId)).limit(1);
    if (!restaurant)
        throw new Errors_1.BadRequest("Restaurant not found");
    const conditions = [(0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId)];
    if (startDate)
        conditions.push((0, drizzle_orm_1.gte)(schema_1.orders.createdAt, new Date(startDate)));
    if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        conditions.push((0, drizzle_orm_1.lte)(schema_1.orders.createdAt, end));
    }
    const ordersData = await connection_1.db
        .select({
        orderId: schema_1.orders.id,
        orderSource: schema_1.orders.orderSource,
        paymentMethodName: schema_1.paymentMethods.name,
        subtotal: schema_1.orders.subtotal,
        deliveryFee: schema_1.orders.deliveryFee,
        serviceFee: schema_1.orders.serviceFee, // 👈 رسوم كيتو الثابتة (الـ 5 جنيه)
        appCommission: schema_1.orders.appCommission, // 👈 عمولة كيتو المئوية
        totalAmount: schema_1.orders.totalAmount,
        status: schema_1.orders.status,
        cancelReasonType: schema_1.selectReasons.type,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.selectReasons, (0, drizzle_orm_1.eq)(schema_1.orders.cancelReasonId, schema_1.selectReasons.id))
        .leftJoin(schema_1.paymentMethods, (0, drizzle_orm_1.eq)(schema_1.orders.paymentMethod, schema_1.paymentMethods.id))
        .where((0, drizzle_orm_1.and)(...conditions));
    const sourceMap = {
        online_order: { orders: 0, revenue: 0, cash: 0, digital: 0, commission: 0, svcFee: 0, dlvFee: 0, cashComm: 0, cashSvc: 0, digComm: 0, digSvc: 0 },
        food_aggregator: { orders: 0, revenue: 0, cash: 0, digital: 0, commission: 0, svcFee: 0, dlvFee: 0, cashComm: 0, cashSvc: 0, digComm: 0, digSvc: 0 },
        mykeeto: { orders: 0, revenue: 0, cash: 0, digital: 0, commission: 0, svcFee: 0, dlvFee: 0, cashComm: 0, cashSvc: 0, digComm: 0, digSvc: 0 },
        pos: { orders: 0, revenue: 0, cash: 0, digital: 0, commission: 0, svcFee: 0, dlvFee: 0, cashComm: 0, cashSvc: 0, digComm: 0, digSvc: 0 },
    };
    let grandTotal = { orders: 0, revenue: 0, cash: 0, digital: 0, commission: 0, svcFee: 0, dlvFee: 0, cashComm: 0, cashSvc: 0, digComm: 0, digSvc: 0 };
    for (const order of ordersData) {
        const isCancelledByUser = order.status === "cancelled" && order.cancelReasonType === "user";
        if (isCancelledByUser)
            continue;
        const source = order.orderSource;
        const stats = sourceMap[source];
        if (!stats)
            continue;
        const amount = parseFloat(order.totalAmount || "0");
        const commission = parseFloat(order.appCommission || "0");
        const serviceFee = parseFloat(order.serviceFee || "0"); // 5 جنيه
        const deliveryFee = parseFloat(order.deliveryFee || "0");
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
        }
        else {
            stats.digital += amount;
            stats.digComm += commission;
            stats.digSvc += serviceFee; // 👈 وهنسجل إن الديجيتال عليه سيرفس فيز يتخصم منه
            grandTotal.digital += amount;
            grandTotal.digComm += commission;
            grandTotal.digSvc += serviceFee;
        }
    }
    const buildSourceReport = (sourceName, stats) => {
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
    return (0, response_1.SuccessResponse)(res, {
        message: "Single restaurant breakdown generated successfully",
        data: {
            restaurant: { id: restaurant.id, name: restaurant.name },
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
exports.getSingleRestaurantReport = getSingleRestaurantReport;
// ==========================================
// API 3.5: Get All Invoices for a Restaurant
// ==========================================
const getRestaurantInvoices = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const { restaurantId } = req.params;
    const { status } = req.query;
    if (!restaurantId) {
        throw new Errors_1.BadRequest("Restaurant ID is required");
    }
    const conditions = [
        (0, drizzle_orm_1.eq)(schema_1.invoices.restaurantId, restaurantId)
    ];
    if (status) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.invoices.status, status));
    }
    const restaurantInvoices = await connection_1.db
        .select()
        .from(schema_1.invoices)
        .where((0, drizzle_orm_1.and)(...conditions))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.invoices.createdAt));
    return (0, response_1.SuccessResponse)(res, {
        message: "Invoices retrieved successfully",
        data: restaurantInvoices
    });
};
exports.getRestaurantInvoices = getRestaurantInvoices;
// ==========================================
// API 2: Generate Restaurant Invoice PDF
// ==========================================
const generateRestaurantInvoicePDF = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const { invoiceId } = req.params;
    if (!invoiceId)
        throw new Errors_1.BadRequest("Invoice ID is required");
    const invoice = await connection_1.db
        .select()
        .from(schema_1.invoices)
        .where((0, drizzle_orm_1.eq)(schema_1.invoices.id, invoiceId))
        .limit(1);
    if (!invoice[0])
        throw new Errors_1.NotFound("Invoice not found");
    const restaurant = await connection_1.db
        .select()
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, invoice[0].restaurantId))
        .limit(1);
    if (!restaurant[0])
        throw new Errors_1.NotFound("Restaurant not found");
    const invoiceData = invoice[0];
    // Build PDF
    const doc = new pdfkit_1.default({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice_${restaurant[0].name.replace(/\s+/g, '_')}_${invoiceData.invoiceNumber}.pdf"`);
    doc.pipe(res);
    // Header
    doc.fontSize(20).text('Keeto Restaurant Invoice', { align: 'center' });
    doc.moveDown();
    // Restaurant Details
    doc.fontSize(14).fillColor('black').text(`Restaurant: ${restaurant[0].name} / ${restaurant[0].nameAr || ''}`);
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
    const netBalance = parseFloat(invoiceData.netBalance);
    if (netBalance > 0) {
        doc.fillColor('green').text(` Platform MUST TRANSFER ${Math.abs(netBalance).toFixed(2)} EGP to Restaurant`);
    }
    else if (netBalance < 0) {
        doc.fillColor('red').text(` Platform MUST COLLECT ${Math.abs(netBalance).toFixed(2)} EGP from Restaurant`);
    }
    else {
        doc.fillColor('black').text(` No pending dues (Settled)`);
    }
    doc.end();
};
exports.generateRestaurantInvoicePDF = generateRestaurantInvoicePDF;
// ==========================================
// API 3: Generate & Save Invoice 
// ==========================================
const generateAndSaveInvoice = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const { restaurantId, startDate, endDate } = req.body;
    if (!restaurantId || !startDate || !endDate)
        throw new Errors_1.BadRequest("Restaurant ID, Start Date, and End Date are required");
    const conditions = [(0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId)];
    conditions.push((0, drizzle_orm_1.gte)(schema_1.orders.createdAt, new Date(startDate)));
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    conditions.push((0, drizzle_orm_1.lte)(schema_1.orders.createdAt, end));
    // 🛡️ التعديل الجذري هنا: جلب اسم طريقة الدفع 
    const ordersData = await connection_1.db
        .select({
        id: schema_1.orders.id,
        totalAmount: schema_1.orders.totalAmount,
        appCommission: schema_1.orders.appCommission,
        serviceFee: schema_1.orders.serviceFee,
        paymentMethodName: schema_1.paymentMethods.name, // 👈 الربط السليم
        status: schema_1.orders.status,
        cancelReasonType: schema_1.selectReasons.type,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.selectReasons, (0, drizzle_orm_1.eq)(schema_1.orders.cancelReasonId, schema_1.selectReasons.id))
        .leftJoin(schema_1.paymentMethods, (0, drizzle_orm_1.eq)(schema_1.orders.paymentMethod, schema_1.paymentMethods.id)) // 👈 Join لجدول الدفع
        .where((0, drizzle_orm_1.and)(...conditions));
    let totalCash = 0, totalDigital = 0, totalSales = 0;
    let cashComm = 0, cashSvc = 0, digitalComm = 0, digitalSvc = 0;
    let validOrdersCount = 0;
    for (const order of ordersData) {
        const isCancelledByUser = order.status === "cancelled" && order.cancelReasonType === "user";
        if (isCancelledByUser)
            continue;
        validOrdersCount++;
        const amount = parseFloat(order.totalAmount || "0");
        const comm = parseFloat(order.appCommission || "0");
        const svcFee = parseFloat(order.serviceFee || "0");
        totalSales += amount;
        // 🛡️ فحص نوع الدفع من الاسم مش الـ UUID
        const payment = (order.paymentMethodName || "").toLowerCase();
        const isCash = payment.includes("cash") || payment.includes("استلام");
        if (isCash) {
            totalCash += amount;
            cashComm += comm;
            cashSvc += svcFee;
        }
        else {
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
    const invoiceId = (0, uuid_1.v4)();
    const invoiceNumber = `INV-${Math.floor(100000 + Math.random() * 900000)}`;
    await connection_1.db.insert(schema_1.invoices).values({
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
    return (0, response_1.SuccessResponse)(res, { message: "Invoice generated and saved successfully", data: { invoiceId } });
};
exports.generateAndSaveInvoice = generateAndSaveInvoice;
// ==========================================
// API 4: Mark Invoice as Paid
// ==========================================
const markInvoiceAsPaid = async (req, res) => {
    const { invoiceId } = req.params;
    const [existing] = await connection_1.db.select().from(schema_1.invoices).where((0, drizzle_orm_1.eq)(schema_1.invoices.id, invoiceId)).limit(1);
    if (!existing)
        throw new Errors_1.NotFound("Invoice not found");
    await connection_1.db.update(schema_1.invoices).set({ status: "paid" }).where((0, drizzle_orm_1.eq)(schema_1.invoices.id, invoiceId));
    return (0, response_1.SuccessResponse)(res, { message: "Invoice marked as paid successfully" });
};
exports.markInvoiceAsPaid = markInvoiceAsPaid;
