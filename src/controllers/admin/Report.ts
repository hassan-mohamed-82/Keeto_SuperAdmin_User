// controllers/admin/FinancialReportController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { orders, restaurants, restaurantBusinessPlans, invoices, paymentMethods, selectReasons } from "../../models/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, UnauthorizedError } from "../../Errors";
import PDFDocument from "pdfkit";
import { v4 as uuidv4 } from "uuid";
// 1. تعريف الأنواع المسموحة للـ Enums
type OrderStatus = "pending" | "accepted" | "preparing" | "out_for_delivery" | "delivered" | "cancelled" | "refund";
type PaymentMethod = "cash_on_delivery" | "visa" | "wallet";

// ==========================================
// API 1: التقرير المالي العام 
// ==========================================
export const getFinancialReport = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { restaurantId, startDate, endDate, status, paymentMethod } = req.query;
    const conditions = [];

    if (restaurantId) conditions.push(eq(orders.restaurantId, restaurantId as string));
    if (status) conditions.push(eq(orders.status, status as OrderStatus));
    // 💡 ملاحظة: paymentMethod بقت varchar
    if (paymentMethod) conditions.push(eq(orders.paymentMethod, paymentMethod as string));

    if (startDate) conditions.push(gte(orders.createdAt, new Date(startDate as string)));
    if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(orders.createdAt, end));
    }

    const reportData = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            status: orders.status,
            paymentMethod: orders.paymentMethod, // من جدول orders مباشرة
            orderType: orders.orderType,
            subtotal: orders.subtotal,
            deliveryFee: orders.deliveryFee,
            serviceFee: orders.serviceFee,
            appCommission: orders.appCommission,
            totalAmount: orders.totalAmount,
            createdAt: orders.createdAt,
            restaurantId: restaurants.id,
            restaurantName: restaurants.name,
            cancelReasonType: selectReasons.type, // 👈 نوع الإلغاء
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(orders.createdAt));

    let totalRevenue = 0; 
    let totalAppCommission = 0; 
    let totalCashCollected = 0; 
    let totalDigitalCollected = 0; 
    let validOrdersCount = 0;

    for (const order of reportData) {
        const isCancelledByUser = order.status === "cancelled" && order.cancelReasonType === "user";
        
        // لو اليوزر لغاه، مش هنحسبه خالص ماليًا
        if (isCancelledByUser) continue;

        validOrdersCount++;
        const amount = parseFloat(order.totalAmount as string || "0");
        const commission = parseFloat(order.appCommission as string || "0");

        totalRevenue += amount;
        totalAppCommission += commission;

        const payment = (order.paymentMethod || "").toLowerCase();
        const isCash = payment.includes("cash") || payment.includes("استلام");

        if (isCash) {
            totalCashCollected += amount;
        } else {
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

    return SuccessResponse(res, {
        message: "Financial report generated successfully",
        data: { summary, orders: reportData }
    });
};
// ==========================================
// API 2: تقرير تفصيلي حسب كل مطعم 
// ==========================================
export const getDetailedRestaurantReport = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { startDate, endDate } = req.query;
    const conditions = [];

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
            paymentMethod: orders.paymentMethod,
            subtotal: orders.subtotal,
            deliveryFee: orders.deliveryFee,
            serviceFee: orders.serviceFee,
            appCommission: orders.appCommission,
            totalAmount: orders.totalAmount,
            restaurantId: restaurants.id,
            restaurantName: restaurants.name,
            status: orders.status,
            cancelReasonType: selectReasons.type,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined);

    const allBusinessPlans = await db.select().from(restaurantBusinessPlans);
    const businessPlansMap: Record<string, typeof allBusinessPlans> = {};
    for (const plan of allBusinessPlans) {
        if (!businessPlansMap[plan.restaurantId]) businessPlansMap[plan.restaurantId] = [];
        businessPlansMap[plan.restaurantId].push(plan);
    }

    const restaurantMap: Record<string, any> = {};
    let grandTotalAmount = 0, grandTotalCash = 0, grandTotalDigital = 0;

    for (const order of ordersData) {
        const isCancelledByUser = order.status === "cancelled" && order.cancelReasonType === "user";
        if (isCancelledByUser) continue;

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
        const amount = parseFloat(order.totalAmount as string || "0");
        const subtotal = parseFloat(order.subtotal as string || "0");
        const commission = parseFloat(order.appCommission as string || "0");
        const svcFee = parseFloat(order.serviceFee as string || "0");
        const dlvFee = parseFloat(order.deliveryFee as string || "0");

        entry.totalOrders += 1;
        entry.totalOrdersAmount += amount;
        entry.totalSubtotal += subtotal;
        entry.totalDeliveryFee += dlvFee;
        grandTotalAmount += amount;

        if (order.orderSource === "online_order") entry.onlineOrders += 1;
        else if (order.orderSource === "food_aggregator") entry.aggregatorOrders += 1;

        const payment = (order.paymentMethod || "").toLowerCase();
        const isCash = payment.includes("cash") || payment.includes("استلام");

        if (isCash) {
            entry.totalCashAmount += amount;
            entry.cashCommission += commission;
            entry.cashServiceFee += svcFee;
            grandTotalCash += amount;
        } else {
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

    return SuccessResponse(res, {
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

// ==========================================
// API 3: تقرير مالي تفصيلي لمطعم واحد (Single Restaurant Report)
// ==========================================
export const getSingleRestaurantReport = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { restaurantId } = req.params;
    const { startDate, endDate } = req.query;

    if (!restaurantId) throw new BadRequest("Restaurant ID is required");

    const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
    if (!restaurant) throw new BadRequest("Restaurant not found");

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
            paymentMethod: orders.paymentMethod,
            subtotal: orders.subtotal,
            deliveryFee: orders.deliveryFee,
            serviceFee: orders.serviceFee,
            appCommission: orders.appCommission,
            totalAmount: orders.totalAmount,
            status: orders.status,
            cancelReasonType: selectReasons.type,
        })
        .from(orders)
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .where(and(...conditions));

    const businessPlans = await db.select().from(restaurantBusinessPlans).where(eq(restaurantBusinessPlans.restaurantId, restaurantId));

    const sourceMap: Record<string, any> = {
        online_order: { totalOrders: 0, totalRevenue: 0, subtotal: 0, deliveryFee: 0, cashAmount: 0, visaAmount: 0, walletAmount: 0, cashComm: 0, cashSvc: 0, digitalComm: 0, digitalSvc: 0 },
        food_aggregator: { totalOrders: 0, totalRevenue: 0, subtotal: 0, deliveryFee: 0, cashAmount: 0, visaAmount: 0, walletAmount: 0, cashComm: 0, cashSvc: 0, digitalComm: 0, digitalSvc: 0 },
        mykeeto: { totalOrders: 0, totalRevenue: 0, subtotal: 0, deliveryFee: 0, cashAmount: 0, visaAmount: 0, walletAmount: 0, cashComm: 0, cashSvc: 0, digitalComm: 0, digitalSvc: 0 },
    };

    let grandTotal = { orders: 0, revenue: 0, cash: 0, visa: 0, wallet: 0, cashComm: 0, cashSvc: 0, digitalComm: 0, digitalSvc: 0, deliveryFee: 0, subtotal: 0 };

    for (const order of ordersData) {
        const isCancelledByUser = order.status === "cancelled" && order.cancelReasonType === "user";
        if (isCancelledByUser) continue;

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
        } else {
            if (payment.includes("visa") || payment.includes("بطاقة")) {
                stats.visaAmount += amount;
                grandTotal.visa += amount;
            } else {
                stats.walletAmount += amount;
                grandTotal.wallet += amount;
            }
            stats.digitalComm += commission;
            stats.digitalSvc += serviceFee;
            grandTotal.digitalComm += commission;
            grandTotal.digitalSvc += serviceFee;
        }
    }

    const buildCashDue = (cashCollected: number, digitalTotal: number, cashComm: number, cashSvc: number, digComm: number, digSvc: number) => {
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

    return SuccessResponse(res, {
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

// ==========================================
// API 3.5: Get All Invoices for a Restaurant
// ==========================================
export const getRestaurantInvoices = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { restaurantId } = req.params;
    const { status } = req.query;

    if (!restaurantId) {
        const { BadRequest } = await import("../../Errors/BadRequest");
        throw new BadRequest("Restaurant ID is required");
    }

    const conditions = [
        eq(invoices.restaurantId, restaurantId)
    ];

    if (status) {
        conditions.push(eq(invoices.status, status as any));
    }

    const restaurantInvoices = await db
        .select()
        .from(invoices)
        .where(and(...conditions))
        .orderBy(desc(invoices.createdAt));

    return SuccessResponse(res, {
        message: "Invoices retrieved successfully",
        data: restaurantInvoices
    });
};

// ==========================================
// API 4: Generate Restaurant Invoice PDF
// ==========================================
export const generateRestaurantInvoicePDF = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { invoiceId } = req.params;

    if (!invoiceId) {
        const { BadRequest } = await import("../../Errors/BadRequest");
        throw new BadRequest("Invoice ID is required");
    }

    const invoice = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1);

    if (!invoice[0]) {
        const { NotFound } = await import("../../Errors/NotFound");
        throw new NotFound("Invoice not found");
    }

    const restaurant = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, invoice[0].restaurantId))
        .limit(1);

    if (!restaurant[0]) {
        const { NotFound } = await import("../../Errors/NotFound");
        throw new NotFound("Restaurant not found");
    }

    const invoiceData = invoice[0];

    // Build PDF
    const doc = new PDFDocument({ margin: 50 });
    
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
    
    const netBalance = parseFloat(invoiceData.netBalance as string);
    
    if (netBalance > 0) {
        doc.fillColor('green').text(` Platform owes restaurant ${Math.abs(netBalance).toFixed(2)} EGP`);
    } else if (netBalance < 0) {
        doc.fillColor('red').text(` Restaurant owes platform ${Math.abs(netBalance).toFixed(2)} EGP`);
    } else {
        doc.fillColor('black').text(` No pending dues (Settled)`);
    }
    
    doc.end();
};

export const generateAndSaveInvoice = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const { restaurantId, startDate, endDate } = req.body; 
    if (!restaurantId || !startDate || !endDate) throw new BadRequest("Restaurant ID, Start Date, and End Date are required");

    const conditions = [eq(orders.restaurantId, restaurantId)];
    conditions.push(gte(orders.createdAt, new Date(startDate)));
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(orders.createdAt, end));

    const ordersData = await db
        .select({
            id: orders.id,
            totalAmount: orders.totalAmount,
            appCommission: orders.appCommission,
            serviceFee: orders.serviceFee,
            paymentMethod: orders.paymentMethod,
            status: orders.status,
            cancelReasonType: selectReasons.type,
        })
        .from(orders)
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
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

        const payment = (order.paymentMethod || "").toLowerCase();
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

    // 💰 حساب المديونية الموحد والدقيق
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
// دالة عشان السوبر أدمن يغير حالة الفاتورة لـ Paid لما يتحاسبوا
export const markInvoiceAsPaid = async (req: Request, res: Response) => {
    const { invoiceId } = req.params;
    
    await db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, invoiceId));
    
    return SuccessResponse(res, { message: "Invoice marked as paid" });
};


