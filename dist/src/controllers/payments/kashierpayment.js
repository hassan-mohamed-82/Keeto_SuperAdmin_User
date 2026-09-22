"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleKashierWebhook = exports.generatePaymentSession = void 0;
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const kashier_1 = require("../../services/payments/kashier/kashier");
const kashier_service_1 = require("../../services/payments/kashier/kashier.service");
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
/**
 * Controller: Create Kashier Payment Session
 * Endpoint: POST /api/payments/kashier/session
 *
 * Calls Kashier POST /v3/payment/sessions and returns { sessionId, sessionUrl, expireAt }.
 * The client should redirect (web) or open a WebView (mobile) to sessionUrl.
 * Kashier handles all card input, 3DS verification, and redirects back via merchantRedirect.
 */
const generatePaymentSession = async (req, res) => {
    let { orderId, amount, currency = "EGP", customerEmail } = req.body;
    // Check order in database to fetch amount and customer details if not supplied
    if (orderId) {
        const [existingOrder] = await connection_1.db
            .select()
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, String(orderId)))
            .limit(1);
        if (existingOrder) {
            if (!amount) {
                amount = parseFloat(existingOrder.totalAmount);
            }
            if (!customerEmail && existingOrder.userId) {
                const [customer] = await connection_1.db
                    .select({ email: schema_1.users.email })
                    .from(schema_1.users)
                    .where((0, drizzle_orm_1.eq)(schema_1.users.id, existingOrder.userId))
                    .limit(1);
                if (customer?.email) {
                    customerEmail = customer.email;
                }
            }
        }
    }
    if (!amount || isNaN(Number(amount))) {
        throw new Errors_1.BadRequest("Order amount is required or order does not exist.");
    }
    const session = await kashier_service_1.KashierService.createPaymentSession({
        orderId: String(orderId),
        amount: typeof amount === "string" ? parseFloat(amount) : amount,
        currency,
        customerEmail,
    });
    return (0, response_1.SuccessResponse)(res, session);
};
exports.generatePaymentSession = generatePaymentSession;
/**
 * Controller: Handle Kashier Webhooks
 * Endpoint: POST /api/payments/kashier/webhook
 */
const handleKashierWebhook = async (req, res) => {
    const signature = req.headers["x-kashier-signature"] ||
        req.headers["signature"] ||
        req.body?.signature;
    const webhookData = req.body?.data || req.body;
    console.log("[Kashier Webhook Received]:", {
        event: req.body?.event || "PAYMENT_STATUS",
        orderId: webhookData?.orderId || webhookData?.merchantOrderId,
        status: webhookData?.status,
    });
    // Verify webhook signature if signature is provided
    if (signature) {
        const isValid = (0, kashier_1.verifyKashierWebhookSignature)(webhookData, signature);
        if (!isValid) {
            console.error("⚠️ Invalid Kashier webhook signature received.");
            throw new Errors_1.BadRequest("Invalid webhook signature.");
        }
    }
    const orderId = webhookData?.orderId || webhookData?.merchantOrderId;
    const paymentStatus = (webhookData?.status || "").toUpperCase();
    const transactionId = webhookData?.transactionId || webhookData?.kashierTransactionId;
    if (orderId && (paymentStatus === "SUCCESS" || paymentStatus === "CAPTURED")) {
        await kashier_service_1.KashierService.markOrderAsPaid(String(orderId), transactionId);
    }
    return (0, response_1.SuccessResponse)(res, {
        received: true,
        message: "Webhook processed successfully",
    });
};
exports.handleKashierWebhook = handleKashierWebhook;
