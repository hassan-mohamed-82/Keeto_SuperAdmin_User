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
const encryption_1 = require("../../utils/encryption");
/**
 * Controller: Create Kashier Payment Session
 * Endpoint: POST /api/payments/kashier/session
 *
 * Calls Kashier POST /v3/payment/sessions and returns { sessionId, sessionUrl, expireAt, gateway }.
 * The client should redirect (web) or open a WebView (mobile) to sessionUrl.
 * Kashier handles all card input, 3DS verification, and redirects back via merchantRedirect.
 *
 * Note: The service itself now persists the sessionId + paymentGateway to the order row
 * immediately upon session creation, so no extra DB update is needed here.
 */
const generatePaymentSession = async (req, res) => {
    let { orderId, amount, currency = "EGP", customerEmail } = req.body;
    // Fetch order from database to get amount and customer details if not supplied
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
    return (0, response_1.SuccessResponse)(res, {
        gateway: "KASHIER",
        sessionId: session.sessionId,
        sessionUrl: session.sessionUrl,
        status: session.status,
        expireAt: session.expireAt,
    });
};
exports.generatePaymentSession = generatePaymentSession;
/**
 * Controller: Handle Kashier Webhooks
 * Endpoint: POST /api/payments/kashier/webhook
 *
 * Kashier sends a JSON body with:
 *   - data: { orderId, transactionId, status, amount, currency, kashierSignature, signatureKeys, ... }
 *   - or the flat payload directly at the root level
 *
 * Signature verification uses KASHIER_API_KEY + data.signatureKeys (fixed algorithm).
 */
const handleKashierWebhook = async (req, res) => {
    // Kashier can send the payload nested under "data" or flat
    const webhookData = req.body?.data || req.body;
    // Signature can come from:
    //   1. webhookData.kashierSignature  (preferred — inside the payload)
    //   2. x-kashier-signature header
    //   3. top-level req.body.signature (older Kashier versions)
    const headerSignature = req.headers["x-kashier-signature"] ||
        req.headers["signature"] ||
        req.body?.signature;
    const orderId = webhookData?.orderId || webhookData?.merchantOrderId;
    const transactionId = webhookData?.transactionId || webhookData?.kashierTransactionId;
    const paymentStatus = (webhookData?.status || "").toUpperCase();
    const webhookAmount = webhookData?.amount !== undefined ? Number(webhookData.amount) : undefined;
    console.log("[Kashier Webhook Received]:", {
        event: req.body?.event || "PAYMENT_STATUS",
        orderId,
        transactionId,
        paymentStatus,
        hasKashierSig: Boolean(webhookData?.kashierSignature),
        hasHeaderSig: Boolean(headerSignature),
    });
    // ─── Signature Verification ───────────────────────────────────────────────
    // verifyKashierWebhookSignature uses data.kashierSignature OR the passed header sig.
    // If neither is present, we still reject to avoid unsigned webhook abuse.
    const hasSomeSignature = Boolean(webhookData?.kashierSignature || headerSignature);
    if (!hasSomeSignature) {
        console.error("⚠️ Kashier webhook has no signature — rejecting.");
        throw new Errors_1.BadRequest("Webhook signature is required.");
    }
    // Look up restaurant to check if CUSTOM gateway credentials should be used
    let customApiKey = undefined;
    if (orderId) {
        const [matchedOrder] = await connection_1.db
            .select({ id: schema_1.orders.id, restaurantId: schema_1.orders.restaurantId })
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, String(orderId)))
            .limit(1);
        if (matchedOrder?.restaurantId) {
            const [settings] = await connection_1.db
                .select({ paymentGatewayType: schema_1.restaurantSettings.paymentGatewayType })
                .from(schema_1.restaurantSettings)
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, matchedOrder.restaurantId))
                .limit(1);
            if (settings?.paymentGatewayType === "CUSTOM") {
                const [customCred] = await connection_1.db
                    .select()
                    .from(schema_1.restaurantPaymentCredentials)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, matchedOrder.restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.provider, "KASHIER"), (0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.isActive, true)))
                    .limit(1);
                if (customCred?.credentials && customCred.credentials.apiKey) {
                    customApiKey = (0, encryption_1.decryptSecret)(customCred.credentials.apiKey);
                }
            }
        }
    }
    let isValid = (0, kashier_1.verifyKashierWebhookSignature)(webhookData, headerSignature, customApiKey);
    if (!isValid && customApiKey) {
        // Fallback to platform key in case transaction was processed through platform
        isValid = (0, kashier_1.verifyKashierWebhookSignature)(webhookData, headerSignature);
    }
    if (!isValid) {
        console.error("⚠️ Invalid Kashier webhook signature received.");
        throw new Errors_1.BadRequest("Invalid webhook signature.");
    }
    // ─── Process payment result ───────────────────────────────────────────────
    if (orderId && (paymentStatus === "SUCCESS" || paymentStatus === "CAPTURED" || paymentStatus === "PAID")) {
        // FIX #2: Verify the webhook amount matches the order total before
        // marking as paid, so a forged/mismatched amount in an otherwise
        // validly-signed payload can't silently short-change the restaurant.
        if (webhookAmount !== undefined) {
            const [orderForAmountCheck] = await connection_1.db
                .select({ totalAmount: schema_1.orders.totalAmount })
                .from(schema_1.orders)
                .where((0, drizzle_orm_1.eq)(schema_1.orders.id, String(orderId)))
                .limit(1);
            if (orderForAmountCheck) {
                const expectedAmount = parseFloat(orderForAmountCheck.totalAmount);
                // Compare with a small epsilon to tolerate floating point formatting differences
                if (Math.abs(expectedAmount - webhookAmount) > 0.01) {
                    console.error(`[Kashier Webhook] Amount mismatch for order ${orderId}. Expected ${expectedAmount}, got ${webhookAmount}.`);
                    throw new Errors_1.BadRequest("Paid amount does not match the order total.");
                }
            }
        }
        await kashier_service_1.KashierService.markOrderAsPaid(String(orderId), transactionId);
        console.log(`[Kashier Webhook] Order ${orderId} marked as paid. Tx: ${transactionId}`);
    }
    else if (orderId && (paymentStatus === "FAILED" || paymentStatus === "DECLINED" || paymentStatus === "REJECTED")) {
        // Mark payment failed
        try {
            await connection_1.db
                .update(schema_1.orders)
                .set({
                paymentStatus: "payment_failed",
                paymentGateway: "kashier",
                paymentTransactionId: transactionId || null,
            })
                .where((0, drizzle_orm_1.eq)(schema_1.orders.id, String(orderId)));
            console.log(`[Kashier Webhook] Order ${orderId} payment failed. Tx: ${transactionId}`);
        }
        catch (dbErr) {
            console.error(`[Kashier Webhook] Failed to mark order ${orderId} as payment_failed:`, dbErr);
        }
    }
    else {
        console.log(`[Kashier Webhook] Unhandled status "${paymentStatus}" for order ${orderId} — no DB change.`);
    }
    return (0, response_1.SuccessResponse)(res, {
        received: true,
        message: "Webhook processed successfully",
    });
};
exports.handleKashierWebhook = handleKashierWebhook;
