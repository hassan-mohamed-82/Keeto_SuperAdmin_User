"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
    const { restaurantId, startDate, endDate, status, paymentMethod } = req.query;
    const conditions = [];
    if (restaurantId)
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId));
    if (status)
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.status, status));
    // 💡 ملاحظة: paymentMethod بقت varchar
    if (paymentMethod)
        conditions.push((0, drizzle_orm_1.eq)(schema_1.orders.paymentMethod, paymentMethod));
    if (startDate)
        conditions.push((0, drizzle_orm_1.gte)(schema_1.orders.createdAt, new Date(startDate)));
    if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        conditions.push((0, drizzle_orm_1.lte)(schema_1.orders.createdAt, end));
    }
    const reportData = await connection_1.db
        .select({
        orderId: schema_1.orders.id,
        orderNumber: schema_1.orders.orderNumber,
        status: schema_1.orders.status,
        paymentMethod: schema_1.orders.paymentMethod, // من جدول orders مباشرة
        orderType: schema_1.orders.orderType,
        subtotal: schema_1.orders.subtotal,
        deliveryFee: schema_1.orders.deliveryFee,
        serviceFee: schema_1.orders.serviceFee,
        appCommission: schema_1.orders.appCommission,
        totalAmount: schema_1.orders.totalAmount,
        createdAt: schema_1.orders.createdAt,
        restaurantId: schema_1.restaurants.id,
        restaurantName: schema_1.restaurants.name,
        cancelReasonType: schema_1.selectReasons.type, // 👈 نوع الإلغاء
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.selectReasons, (0, drizzle_orm_1.eq)(schema_1.orders.cancelReasonId, schema_1.selectReasons.id))
        .where(conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined)
        .orderBy((0, drizzle_orm_1.desc)(schema_1.orders.createdAt));
    let totalRevenue = 0;
    let totalAppCommission = 0;
    let totalCashCollected = 0;
    let totalDigitalCollected = 0;
    let validOrdersCount = 0;
    for (const order of reportData) {
        const isCancelledByUser = order.status === "cancelled" && order.cancelReasonType === "user";
        // لو اليوزر لغاه، مش هنحسبه خالص ماليًا
        if (isCancelledByUser)
            continue;
        validOrdersCount++;
        const amount = parseFloat(order.totalAmount || "0");
        const commission = parseFloat(order.appCommission || "0");
        totalRevenue += amount;
        totalAppCommission += commission;
        const payment = (order.paymentMethod || "").toLowerCase();
        const isCash = payment.includes("cash") || payment.includes("استلام");
        if (isCash) {
            totalCashCollected += amount;
        }
        else {
            totalDigitalCollected += amount;
        }
    }
    const summary = {
        totalAttemptedOrders: reportData.length,
        totalFinanciallyValidOrders: validOrdersCount,
        financials: {
            totalRevenue: totalRevenue.toFixed(2),
            totalAppCommission: totalAppCommission.toFixed(2),
            totalCashCollected: totalCashCollected.toFixed(2),
            totalDigitalCollected: totalDigitalCollected.toFixed(2),
        }
    };
    return (0, response_1.SuccessResponse)(res, {
        message: "Financial report generated successfully",
        data: { summary, orders: reportData }
    });
};
exports.getFinancialReport = getFinancialReport;
// ==========================================
// API 2: تقرير تفصيلي حسب كل مطعم 
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
        paymentMethod: schema_1.orders.paymentMethod,
        subtotal: schema_1.orders.subtotal,
        deliveryFee: schema_1.orders.deliveryFee,
        serviceFee: schema_1.orders.serviceFee,
        appCommission: schema_1.orders.appCommission,
        totalAmount: schema_1.orders.totalAmount,
        restaurantId: schema_1.restaurants.id,
        restaurantName: schema_1.restaurants.name,
        status: schema_1.orders.status,
        cancelReasonType: schema_1.selectReasons.type,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.selectReasons, (0, drizzle_orm_1.eq)(schema_1.orders.cancelReasonId, schema_1.selectReasons.id))
        .where(conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined);
    const allBusinessPlans = await connection_1.db.select().from(schema_1.restaurantBusinessPlans);
    const businessPlansMap = {};
    for (const plan of allBusinessPlans) {
        if (!businessPlansMap[plan.restaurantId])
            businessPlansMap[plan.restaurantId] = [];
        businessPlansMap[plan.restaurantId].push(plan);
    }
    const restaurantMap = {};
    let grandTotalAmount = 0, grandTotalCash = 0, grandTotalDigital = 0;
    for (const order of ordersData) {
        const isCancelledByUser = order.status === "cancelled" && order.cancelReasonType === "user";
        if (isCancelledByUser)
            continue;
        const rId = order.restaurantId || "unknown";
        if (!restaurantMap[rId]) {
            restaurantMap[rId] = {
                restaurantId: rId,
                restaurantName: order.restaurantName || "Unknown",
                totalOrders: 0, onlineOrders: 0, aggregatorOrders: 0,
                totalOrdersAmount: 0, totalSubtotal: 0, totalDeliveryFee: 0,
                totalCashAmount: 0, totalDigitalAmount: 0,
                // هنفصل العمولات للكاش والديجيتال لحساب المديونية بدقة
                cashCommission: 0, cashServiceFee: 0,
                digitalCommission: 0, digitalServiceFee: 0,
            };
        }
        const entry = restaurantMap[rId];
        const amount = parseFloat(order.totalAmount || "0");
        const subtotal = parseFloat(order.subtotal || "0");
        const commission = parseFloat(order.appCommission || "0");
        const svcFee = parseFloat(order.serviceFee || "0");
        const dlvFee = parseFloat(order.deliveryFee || "0");
        entry.totalOrders += 1;
        entry.totalOrdersAmount += amount;
        entry.totalSubtotal += subtotal;
        entry.totalDeliveryFee += dlvFee;
        grandTotalAmount += amount;
        if (order.orderSource === "online_order")
            entry.onlineOrders += 1;
        else if (order.orderSource === "food_aggregator")
            entry.aggregatorOrders += 1;
        const payment = (order.paymentMethod || "").toLowerCase();
        const isCash = payment.includes("cash") || payment.includes("استلام");
        if (isCash) {
            entry.totalCashAmount += amount;
            entry.cashCommission += commission;
            entry.cashServiceFee += svcFee;
            grandTotalCash += amount;
        }
        else {
            entry.totalDigitalAmount += amount;
            entry.digitalCommission += commission;
            entry.digitalServiceFee += svcFee;
            grandTotalDigital += amount;
        }
    }
    const restaurantReports = Object.values(restaurantMap).map(entry => {
        const plans = businessPlansMap[entry.restaurantId] || [];
        const totalPlatformCommission = entry.cashCommission + entry.digitalCommission;
        const totalPlatformServiceFee = entry.cashServiceFee + entry.digitalServiceFee;
        const restaurantNetSales = entry.totalOrdersAmount - totalPlatformCommission - totalPlatformServiceFee;
        // 💰 حساب المديونية الدقيق (Settlement)
        const restaurantOwesToPlatform = entry.cashCommission + entry.cashServiceFee;
        const platformOwesToRestaurant = entry.totalDigitalAmount - (entry.digitalCommission + entry.digitalServiceFee);
        const netBalance = platformOwesToRestaurant - restaurantOwesToPlatform;
        return {
            restaurantId: entry.restaurantId,
            restaurantName: entry.restaurantName,
            orders: { total: entry.totalOrders, online: entry.onlineOrders, aggregator: entry.aggregatorOrders },
            financials: {
                totalSales: entry.totalOrdersAmount.toFixed(2),
                subtotal: entry.totalSubtotal.toFixed(2),
                cashOrders: entry.totalCashAmount.toFixed(2),
                digitalOrders: entry.totalDigitalAmount.toFixed(2),
                deliveryFee: entry.totalDeliveryFee.toFixed(2),
                serviceFee: totalPlatformServiceFee.toFixed(2),
                platformCommission: totalPlatformCommission.toFixed(2),
                restaurantNetSales: restaurantNetSales.toFixed(2),
            },
            cashDue: {
                cashCollectedByRestaurant: entry.totalCashAmount.toFixed(2),
                restaurantOwesToPlatform: restaurantOwesToPlatform.toFixed(2),
                platformOwesToRestaurant: platformOwesToRestaurant.toFixed(2),
                netBalance: netBalance.toFixed(2),
                balanceStatus: netBalance > 0
                    ? `Platform owes restaurant ${Math.abs(netBalance).toFixed(2)} EGP`
                    : netBalance < 0
                        ? `Restaurant owes platform ${Math.abs(netBalance).toFixed(2)} EGP`
                        : "No pending dues",
            },
            businessPlan: plans.map(p => ({
                platformType: p.platformType,
                commissionRate: p.commissionRate || "0.00",
                serviceFee: p.serviceFee || "0.00",
            })),
        };
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Detailed restaurant report generated successfully",
        data: {
            summary: {
                totalRestaurants: restaurantReports.length,
                grandTotalSales: grandTotalAmount.toFixed(2),
                grandTotalCash: grandTotalCash.toFixed(2),
                grandTotalDigital: grandTotalDigital.toFixed(2),
            },
            restaurants: restaurantReports,
        }
    });
};
exports.getDetailedRestaurantReport = getDetailedRestaurantReport;
// ==========================================
// API 3: تقرير مالي تفصيلي لمطعم واحد (Single Restaurant Report)
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
        paymentMethod: schema_1.orders.paymentMethod,
        subtotal: schema_1.orders.subtotal,
        deliveryFee: schema_1.orders.deliveryFee,
        serviceFee: schema_1.orders.serviceFee,
        appCommission: schema_1.orders.appCommission,
        totalAmount: schema_1.orders.totalAmount,
        status: schema_1.orders.status,
        cancelReasonType: schema_1.selectReasons.type,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.selectReasons, (0, drizzle_orm_1.eq)(schema_1.orders.cancelReasonId, schema_1.selectReasons.id))
        .where((0, drizzle_orm_1.and)(...conditions));
    const businessPlans = await connection_1.db.select().from(schema_1.restaurantBusinessPlans).where((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, restaurantId));
    const sourceMap = {
        online_order: { totalOrders: 0, totalRevenue: 0, subtotal: 0, deliveryFee: 0, cashAmount: 0, visaAmount: 0, walletAmount: 0, cashComm: 0, cashSvc: 0, digitalComm: 0, digitalSvc: 0 },
        food_aggregator: { totalOrders: 0, totalRevenue: 0, subtotal: 0, deliveryFee: 0, cashAmount: 0, visaAmount: 0, walletAmount: 0, cashComm: 0, cashSvc: 0, digitalComm: 0, digitalSvc: 0 },
        mykeeto: { totalOrders: 0, totalRevenue: 0, subtotal: 0, deliveryFee: 0, cashAmount: 0, visaAmount: 0, walletAmount: 0, cashComm: 0, cashSvc: 0, digitalComm: 0, digitalSvc: 0 },
    };
    let grandTotal = { orders: 0, revenue: 0, cash: 0, visa: 0, wallet: 0, cashComm: 0, cashSvc: 0, digitalComm: 0, digitalSvc: 0, deliveryFee: 0, subtotal: 0 };
    for (const order of ordersData) {
        const isCancelledByUser = order.status === "cancelled" && order.cancelReasonType === "user";
        if (isCancelledByUser)
            continue;
        const source = order.orderSource;
        const stats = sourceMap[source];
        if (!stats)
            continue;
        const amount = parseFloat(order.totalAmount || "0");
        const subtotal = parseFloat(order.subtotal || "0");
        const commission = parseFloat(order.appCommission || "0");
        const serviceFee = parseFloat(order.serviceFee || "0");
        const deliveryFee = parseFloat(order.deliveryFee || "0");
        stats.totalOrders += 1;
        stats.totalRevenue += amount;
        stats.subtotal += subtotal;
        stats.deliveryFee += deliveryFee;
        grandTotal.orders += 1;
        grandTotal.revenue += amount;
        grandTotal.subtotal += subtotal;
        grandTotal.deliveryFee += deliveryFee;
        const payment = (order.paymentMethod || "").toLowerCase();
        const isCash = payment.includes("cash") || payment.includes("استلام");
        if (isCash) {
            stats.cashAmount += amount;
            stats.cashComm += commission;
            stats.cashSvc += serviceFee;
            grandTotal.cash += amount;
            grandTotal.cashComm += commission;
            grandTotal.cashSvc += serviceFee;
        }
        else {
            if (payment.includes("visa") || payment.includes("بطاقة")) {
                stats.visaAmount += amount;
                grandTotal.visa += amount;
            }
            else {
                stats.walletAmount += amount;
                grandTotal.wallet += amount;
            }
            stats.digitalComm += commission;
            stats.digitalSvc += serviceFee;
            grandTotal.digitalComm += commission;
            grandTotal.digitalSvc += serviceFee;
        }
    }
    const buildCashDue = (cashCollected, digitalTotal, cashComm, cashSvc, digComm, digSvc) => {
        const restaurantOwes = cashComm + cashSvc;
        const platformOwes = digitalTotal - (digComm + digSvc);
        const netBalance = platformOwes - restaurantOwes;
        return { cashCollected, restaurantOwes, platformOwes, netBalance };
    };
    const reportBySource = Object.entries(sourceMap).map(([source, stats]) => {
        const digitalTotal = stats.visaAmount + stats.walletAmount;
        const cashDue = buildCashDue(stats.cashAmount, digitalTotal, stats.cashComm, stats.cashSvc, stats.digitalComm, stats.digitalSvc);
        return {
            orderSource: source,
            statistics: { totalOrders: stats.totalOrders, totalRevenue: stats.totalRevenue.toFixed(2), subtotal: stats.subtotal.toFixed(2) },
            paymentBreakdown: { cash: stats.cashAmount.toFixed(2), visa: stats.visaAmount.toFixed(2), wallet: stats.walletAmount.toFixed(2) },
            fees: {
                deliveryFee: stats.deliveryFee.toFixed(2),
                serviceFee: (stats.cashSvc + stats.digitalSvc).toFixed(2),
                commission: (stats.cashComm + stats.digitalComm).toFixed(2)
            },
            cashDue: {
                cashCollected: cashDue.cashCollected.toFixed(2),
                restaurantOwesToPlatform: cashDue.restaurantOwes.toFixed(2),
                platformOwesToRestaurant: cashDue.platformOwes.toFixed(2),
                netBalance: cashDue.netBalance.toFixed(2),
            },
        };
    });
    const grandDigitalTotal = grandTotal.visa + grandTotal.wallet;
    const finalCashDue = buildCashDue(grandTotal.cash, grandDigitalTotal, grandTotal.cashComm, grandTotal.cashSvc, grandTotal.digitalComm, grandTotal.digitalSvc);
    return (0, response_1.SuccessResponse)(res, {
        message: "Single restaurant report generated successfully",
        data: {
            restaurant: { id: restaurant.id, name: restaurant.name },
            reportBySource,
            totals: {
                totalOrders: grandTotal.orders,
                totalRevenue: grandTotal.revenue.toFixed(2),
                paymentBreakdown: { cash: grandTotal.cash.toFixed(2), visa: grandTotal.visa.toFixed(2), wallet: grandTotal.wallet.toFixed(2) },
                fees: {
                    totalDeliveryFee: grandTotal.deliveryFee.toFixed(2),
                    totalServiceFee: (grandTotal.cashSvc + grandTotal.digitalSvc).toFixed(2),
                    totalCommission: (grandTotal.cashComm + grandTotal.digitalComm).toFixed(2)
                },
                cashDue: {
                    cashCollected: finalCashDue.cashCollected.toFixed(2),
                    restaurantOwesToPlatform: finalCashDue.restaurantOwes.toFixed(2),
                    platformOwesToRestaurant: finalCashDue.platformOwes.toFixed(2),
                    netBalance: finalCashDue.netBalance.toFixed(2),
                    balanceStatus: finalCashDue.netBalance > 0 ? `Platform owes restaurant ${Math.abs(finalCashDue.netBalance).toFixed(2)} EGP` : finalCashDue.netBalance < 0 ? `Restaurant owes platform ${Math.abs(finalCashDue.netBalance).toFixed(2)} EGP` : "No pending dues",
                },
            },
            businessPlan: businessPlans.map(p => ({ platformType: p.platformType, commissionRate: p.commissionRate || "0.00" })),
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
        const { BadRequest } = await Promise.resolve().then(() => __importStar(require("../../Errors/BadRequest")));
        throw new BadRequest("Restaurant ID is required");
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
// API 4: Generate Restaurant Invoice PDF
// ==========================================
const generateRestaurantInvoicePDF = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const { invoiceId } = req.params;
    if (!invoiceId) {
        const { BadRequest } = await Promise.resolve().then(() => __importStar(require("../../Errors/BadRequest")));
        throw new BadRequest("Invoice ID is required");
    }
    const invoice = await connection_1.db
        .select()
        .from(schema_1.invoices)
        .where((0, drizzle_orm_1.eq)(schema_1.invoices.id, invoiceId))
        .limit(1);
    if (!invoice[0]) {
        const { NotFound } = await Promise.resolve().then(() => __importStar(require("../../Errors/NotFound")));
        throw new NotFound("Invoice not found");
    }
    const restaurant = await connection_1.db
        .select()
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, invoice[0].restaurantId))
        .limit(1);
    if (!restaurant[0]) {
        const { NotFound } = await Promise.resolve().then(() => __importStar(require("../../Errors/NotFound")));
        throw new NotFound("Restaurant not found");
    }
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
    doc.fontSize(12).text(`Cash Collected: ${invoiceData.totalCashCollected} EGP`);
    doc.text(`Digital Collected: ${invoiceData.totalDigitalCollected} EGP`);
    doc.moveDown();
    // Fees
    doc.fontSize(14).text('Fees & Commissions', { underline: true });
    doc.fontSize(12).text(`Total Commission: ${invoiceData.totalCommission} EGP`);
    doc.text(`Total Service Fee: ${invoiceData.totalServiceFee} EGP`);
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();
    // Cash Due Analysis
    doc.fontSize(16).text('Cash Due Analysis', { underline: true });
    doc.fontSize(12).text(`Restaurant Owes Platform: ${invoiceData.restaurantOwesPlatform} EGP`);
    doc.text(`Platform Owes Restaurant: ${invoiceData.platformOwesRestaurant} EGP`);
    doc.moveDown();
    doc.fontSize(14).text('Final Balance:', { continued: true });
    const netBalance = parseFloat(invoiceData.netBalance);
    if (netBalance > 0) {
        doc.fillColor('green').text(` Platform owes restaurant ${Math.abs(netBalance).toFixed(2)} EGP`);
    }
    else if (netBalance < 0) {
        doc.fillColor('red').text(` Restaurant owes platform ${Math.abs(netBalance).toFixed(2)} EGP`);
    }
    else {
        doc.fillColor('black').text(` No pending dues (Settled)`);
    }
    doc.end();
};
exports.generateRestaurantInvoicePDF = generateRestaurantInvoicePDF;
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
    const ordersData = await connection_1.db
        .select({
        id: schema_1.orders.id,
        totalAmount: schema_1.orders.totalAmount,
        appCommission: schema_1.orders.appCommission,
        serviceFee: schema_1.orders.serviceFee,
        paymentMethod: schema_1.orders.paymentMethod,
        status: schema_1.orders.status,
        cancelReasonType: schema_1.selectReasons.type,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.selectReasons, (0, drizzle_orm_1.eq)(schema_1.orders.cancelReasonId, schema_1.selectReasons.id))
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
        const payment = (order.paymentMethod || "").toLowerCase();
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
    // 💰 حساب المديونية الموحد والدقيق
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
// دالة عشان السوبر أدمن يغير حالة الفاتورة لـ Paid لما يتحاسبوا
const markInvoiceAsPaid = async (req, res) => {
    const { invoiceId } = req.params;
    await connection_1.db.update(schema_1.invoices).set({ status: "paid" }).where((0, drizzle_orm_1.eq)(schema_1.invoices.id, invoiceId));
    return (0, response_1.SuccessResponse)(res, { message: "Invoice marked as paid" });
};
exports.markInvoiceAsPaid = markInvoiceAsPaid;
