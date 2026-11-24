"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleGeideaRedirect = exports.handleGeideaWebhook = exports.generateGeideaPaymentSession = void 0;
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const geidea_service_1 = require("../../services/payments/geidea/geidea.service");
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const Safedecrypt_1 = require("../../utils/Safedecrypt");
const getActiveCustomGateway_1 = require("../../utils/getActiveCustomGateway");
const getActivePlatformGateway_1 = require("../../utils/getActivePlatformGateway");
const orderPaymentConfirmation_1 = require("../../helpers/orderPaymentConfirmation");
/**
 * Controller: Create Geidea Payment Session
 * Endpoint: POST /api/payments/geidea/session
 */
const generateGeideaPaymentSession = async (req, res) => {
    let { orderId, amount, currency = "EGP", customerEmail } = req.body;
    if (!orderId) {
        throw new Errors_1.BadRequest("orderId is required to create a Geidea session.");
    }
    const [existingOrder] = await connection_1.db
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, String(orderId)))
        .limit(1);
    if (!existingOrder) {
        throw new Errors_1.BadRequest("Order does not exist.");
    }
    if (!amount) {
        amount = parseFloat(existingOrder.totalAmount);
    }
    let customerName = "Customer";
    let customerPhone = "+201000000000";
    if (existingOrder.userId) {
        const [customer] = await connection_1.db
            .select({
            email: schema_1.users.email,
            name: schema_1.users.name,
            phone: schema_1.users.phone,
        })
            .from(schema_1.users)
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, existingOrder.userId))
            .limit(1);
        if (customer) {
            if (!customerEmail && customer.email)
                customerEmail = customer.email;
            if (customer.name)
                customerName = customer.name;
            if (customer.phone)
                customerPhone = customer.phone;
        }
    }
    if (!amount || isNaN(Number(amount))) {
        throw new Errors_1.BadRequest("Order amount is required or order does not exist.");
    }
    const [settings] = await connection_1.db
        .select({ paymentGatewayType: schema_1.restaurantSettings.paymentGatewayType })
        .from(schema_1.restaurantSettings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, existingOrder.restaurantId))
        .limit(1);
    if (settings?.paymentGatewayType !== "CUSTOM") {
        throw new Errors_1.BadRequest("This restaurant is not configured for a custom Geidea payment gateway.");
    }
    const activeGateway = await (0, getActiveCustomGateway_1.getActiveCustomGateway)(existingOrder.restaurantId);
    if (!activeGateway) {
        throw new Errors_1.BadRequest("Restaurant is configured for custom gateway, but no active payment credentials were found.");
    }
    if (activeGateway.provider !== "GEIDEA") {
        throw new Errors_1.BadRequest(`This restaurant's active payment provider is ${activeGateway.provider}, not Geidea.`);
    }
    const rawCreds = activeGateway.record.credentials;
    const decryptedCredentials = {
        ...rawCreds,
        publicKey: rawCreds.publicKey,
        apiPassword: rawCreds.apiPassword ? (0, Safedecrypt_1.safeDecrypt)(rawCreds.apiPassword) : "",
        environment: rawCreds.environment,
    };
    const backendBaseUrl = (process.env.Back_BASE_URL || "").replace(/\/$/, "");
    const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const session = await geidea_service_1.GeideaService.createPaymentSession({
        credentials: decryptedCredentials,
        orderId: String(orderId),
        orderNumber: existingOrder.orderNumber || String(orderId),
        amount: typeof amount === "string" ? parseFloat(amount) : amount,
        currency,
        customer: {
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
        },
        callbackUrl: decryptedCredentials.callbackUrl || `${backendBaseUrl}/api/payments/geidea/webhook`,
        returnUrl: `${backendBaseUrl}/api/payments/geidea/callback`,
    });
    // Save session ID into order
    await connection_1.db
        .update(schema_1.orders)
        .set({
        paymentOrderId: String(session.sessionId),
        paymentGateway: "geidea",
        paymentStatus: "pending_payment",
    })
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, existingOrder.id));
    return (0, response_1.SuccessResponse)(res, {
        gateway: "GEIDEA",
        sessionId: session.sessionId,
        sessionUrl: session.sessionUrl,
        status: session.status,
    });
};
exports.generateGeideaPaymentSession = generateGeideaPaymentSession;
/**
 * Controller: Handle Geidea Webhook Notification
 * Endpoint: POST /api/payments/geidea/webhook
 */
const handleGeideaWebhook = async (req, res) => {
    try {
        const payload = req.body || {};
        const orderData = payload.order || payload.data || payload;
        const merchantOrderId = payload.merchantReferenceId || orderData.merchantReferenceId || payload.orderId;
        const gatewayOrderId = String(payload.orderId || orderData.id || orderData.orderId || payload.sessionId || "");
        const transactionId = String(orderData.transactionId || payload.transactionId || gatewayOrderId);
        const responseCode = String(payload.responseCode || orderData.responseCode || "");
        const status = String(payload.status || orderData.status || "").toUpperCase();
        const detailedStatus = String(payload.detailedStatus || orderData.detailedStatus || "").toUpperCase();
        const isPending = status === "PENDING" ||
            status === "IN_PROGRESS" ||
            detailedStatus === "AWAITINGPAYMENT" ||
            detailedStatus === "INITIATED" ||
            detailedStatus === "PENDING";
        // في جيديا لا يعتبر الدفع ناجحاً إلا إذا تم التحصيل الفعلي وليس مجرد إرسال طلب الدفع للمحفظة
        const isSuccess = !isPending &&
            (status === "SUCCESS" || status === "CAPTURED" || status === "PAID" || detailedStatus === "PAID" || detailedStatus === "CAPTURED") &&
            (responseCode === "000" || responseCode === "");
        const webhookAmount = payload.amount !== undefined ? Number(payload.amount) : (orderData.amount !== undefined ? Number(orderData.amount) : undefined);
        console.log("[Geidea Webhook Received]:", {
            merchantOrderId,
            gatewayOrderId,
            transactionId,
            responseCode,
            status,
            isSuccess,
            isPending,
        });
        if (!merchantOrderId && !gatewayOrderId) {
            throw new Errors_1.BadRequest("No matching order identifier found in Geidea webhook payload.");
        }
        // Find matched order
        const [matchedOrder] = await connection_1.db
            .select()
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.or)(merchantOrderId ? (0, drizzle_orm_1.eq)(schema_1.orders.id, String(merchantOrderId)) : undefined, gatewayOrderId ? (0, drizzle_orm_1.eq)(schema_1.orders.paymentOrderId, gatewayOrderId) : undefined))
            .limit(1);
        if (!matchedOrder) {
            console.warn(`[Geidea Webhook]: Order not found for gatewayOrderId: ${gatewayOrderId}, merchantOrderId: ${merchantOrderId}`);
            throw new Errors_1.NotFound("Order matching this Geidea transaction was not found.");
        }
        if (isSuccess) {
            if (webhookAmount !== undefined) {
                const expectedAmount = parseFloat(matchedOrder.totalAmount);
                if (Math.abs(expectedAmount - webhookAmount) > 0.01) {
                    console.error(`[Geidea Webhook] Amount mismatch for order ${matchedOrder.id}. Expected ${expectedAmount}, got ${webhookAmount}.`);
                    throw new Errors_1.BadRequest("Paid amount does not match the order total.");
                }
            }
            await (0, orderPaymentConfirmation_1.confirmOrderPayment)({
                orderId: matchedOrder.id,
                gateway: "geidea",
                transactionId: transactionId || undefined,
                gatewayOrderId: gatewayOrderId || undefined,
                rawPayload: payload,
            });
            console.log(`[Geidea Webhook] Order ${matchedOrder.orderNumber} confirmed as paid & accepted.`);
        }
        else if (!isPending) {
            const failureReason = payload.detailedResponseMessage ||
                payload.responseMessage ||
                payload.responseDescription ||
                orderData.detailedResponseMessage ||
                `Transaction failed with status ${status || responseCode}`;
            await (0, orderPaymentConfirmation_1.recordFailedPayment)({
                orderId: matchedOrder.id,
                gateway: "geidea",
                transactionId: transactionId || undefined,
                gatewayOrderId: gatewayOrderId || undefined,
                failureReason,
                rawPayload: payload,
            });
            console.log(`[Geidea Webhook] Order ${matchedOrder.orderNumber} recorded as payment_failed.`);
        }
        return res.status(200).json({ success: true, message: "Geidea webhook processed successfully" });
    }
    catch (error) {
        console.error("[Geidea Webhook Error]:", error);
        return res.status(error.statusCode || 400).json({
            success: false,
            message: error.message || "Failed to process Geidea webhook",
        });
    }
};
exports.handleGeideaWebhook = handleGeideaWebhook;
/**
 * Controller: Handle Geidea Browser Return Redirect
 * Endpoint: GET /api/payments/geidea/callback
 */
const handleGeideaRedirect = async (req, res) => {
    try {
        const query = req.query;
        const sessionId = (query.sessionId || query.orderId || query.paymentOrderId);
        const merchantReferenceId = (query.merchantReferenceId || query.orderId || query.merchant_order_id);
        const rawOrderId = (req.query.merchant_order_id ||
            req.query.order_id ||
            req.query.order ||
            merchantReferenceId);
        let callbackSlug = req.query.callbackSlug;
        const frontendBaseUrl = (process.env.APP_BASE_URL || process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
        // Find the matched order
        const [matchedOrder] = await connection_1.db
            .select({
            id: schema_1.orders.id,
            restaurantId: schema_1.orders.restaurantId,
            orderNumber: schema_1.orders.orderNumber,
            paymentStatus: schema_1.orders.paymentStatus,
            paymentOrderId: schema_1.orders.paymentOrderId,
            totalAmount: schema_1.orders.totalAmount,
            slug: schema_1.restaurants.slug,
        })
            .from(schema_1.orders)
            .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
            .where((0, drizzle_orm_1.or)(rawOrderId ? (0, drizzle_orm_1.eq)(schema_1.orders.id, rawOrderId) : undefined, sessionId ? (0, drizzle_orm_1.eq)(schema_1.orders.paymentOrderId, sessionId) : undefined))
            .limit(1);
        if (matchedOrder?.slug) {
            callbackSlug = matchedOrder.slug;
        }
        let isActuallyPaid = false;
        // 1. إذا كان الأوردر مؤكداً كمدفوع مسبقاً (عبر الـ Webhook مثلاً)
        if (matchedOrder?.paymentStatus === "paid") {
            isActuallyPaid = true;
        }
        else if (matchedOrder && (sessionId || matchedOrder.paymentOrderId)) {
            // 2. التحقق مباشرة من سيرفر جيديا (Server-to-Server) للتأكد من حالة الخصم الفعلي
            try {
                let geideaCreds = null;
                const activeGateway = await (0, getActiveCustomGateway_1.getActiveCustomGateway)(matchedOrder.restaurantId);
                if (activeGateway && activeGateway.provider === "GEIDEA") {
                    geideaCreds = activeGateway.record.credentials;
                }
                else {
                    const platformGateway = await (0, getActivePlatformGateway_1.getActivePlatformGateway)();
                    if (platformGateway && platformGateway.provider === "GEIDEA") {
                        geideaCreds = platformGateway.credentials;
                    }
                }
                if (geideaCreds) {
                    const sessionDetails = await geidea_service_1.GeideaService.getSessionDetails(geideaCreds, sessionId || matchedOrder.paymentOrderId);
                    const orderDetails = sessionDetails?.order || sessionDetails?.data || sessionDetails;
                    const detailedStatus = String(orderDetails?.detailedStatus || sessionDetails?.detailedStatus || "").toUpperCase();
                    const status = String(orderDetails?.status || sessionDetails?.status || "").toUpperCase();
                    const responseCode = String(orderDetails?.responseCode || sessionDetails?.responseCode || "");
                    // في جيديا الخصم الفعلي المؤكد يكون عند detailedStatus = PAID أو CAPTURED
                    if ((detailedStatus === "PAID" || detailedStatus === "CAPTURED" || status === "PAID" || status === "CAPTURED") &&
                        (responseCode === "000" || responseCode === "")) {
                        isActuallyPaid = true;
                        const txnId = String(orderDetails?.transactionId || sessionDetails?.transactionId || sessionId);
                        await (0, orderPaymentConfirmation_1.confirmOrderPayment)({
                            orderId: matchedOrder.id,
                            gateway: "geidea",
                            transactionId: txnId,
                            gatewayOrderId: sessionId || matchedOrder.paymentOrderId || undefined,
                            rawPayload: sessionDetails,
                        });
                        console.log(`[Geidea Redirect]: Order ${matchedOrder.orderNumber} confirmed as paid via verified session details.`);
                    }
                    else if (detailedStatus === "EXPIRED" ||
                        detailedStatus === "FAILED" ||
                        detailedStatus === "CANCELLED" ||
                        status === "FAILED" ||
                        status === "EXPIRED") {
                        const failureReason = orderDetails?.detailedResponseMessage ||
                            sessionDetails?.detailedResponseMessage ||
                            sessionDetails?.responseMessage ||
                            `Transaction ${detailedStatus || status}`;
                        await (0, orderPaymentConfirmation_1.recordFailedPayment)({
                            orderId: matchedOrder.id,
                            gateway: "geidea",
                            transactionId: sessionId,
                            gatewayOrderId: sessionId || matchedOrder.paymentOrderId || undefined,
                            failureReason,
                            rawPayload: sessionDetails,
                        });
                        console.log(`[Geidea Redirect]: Order ${matchedOrder.orderNumber} recorded as payment_failed (${failureReason}).`);
                    }
                    else {
                        console.log(`[Geidea Redirect]: Order ${matchedOrder.orderNumber} is still pending/unpaid (detailedStatus: ${detailedStatus || "N/A"}, status: ${status || "N/A"}).`);
                    }
                }
            }
            catch (err) {
                console.error("[Geidea Redirect]: Error querying session details from Geidea:", err);
            }
        }
        const redirectUrl = isActuallyPaid
            ? (callbackSlug
                ? `${frontendBaseUrl}/profile?callbackSlug=${encodeURIComponent(callbackSlug)}&success=true&orderId=${encodeURIComponent(String(rawOrderId || matchedOrder?.id || ""))}&gateway=geidea`
                : `${frontendBaseUrl}/payment/result?success=true&orderId=${encodeURIComponent(String(rawOrderId || matchedOrder?.id || ""))}&gateway=geidea`)
            : (callbackSlug
                ? `${frontendBaseUrl}/home/restaurants/${encodeURIComponent(callbackSlug)}/order?success=false&orderId=${encodeURIComponent(String(rawOrderId || matchedOrder?.id || ""))}&gateway=geidea`
                : `${frontendBaseUrl}/payment/result?success=false&orderId=${encodeURIComponent(String(rawOrderId || matchedOrder?.id || ""))}&gateway=geidea`);
        return res.redirect(redirectUrl);
    }
    catch (error) {
        console.error("[Geidea Redirect Error]:", error);
        const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
        return res.redirect(`${appBaseUrl}/payment/result?status=failed`);
    }
};
exports.handleGeideaRedirect = handleGeideaRedirect;
