"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePaymobRedirect = exports.handlePaymobWebhook = void 0;
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const paymob_service_1 = require("../../services/payments/paymob/paymob.service");
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const encryption_1 = require("../../utils/encryption");
/**
 * Controller: Handle Paymob Webhook POST Notification
 * Endpoint: POST /payments/paymob/webhook
 * Paymob sends webhook data with { type: "TRANSACTION", obj: { ... } }
 * and an HMAC in req.query.hmac or headers or req.body.hmac
 */
const handlePaymobWebhook = async (req, res) => {
    const payload = req.body || {};
    const transactionObj = payload.obj || payload;
    const receivedHmac = req.query.hmac ||
        req.headers["x-paymob-hmac"] ||
        payload.hmac;
    const merchantOrderId = transactionObj.order?.merchant_order_id;
    const paymobOrderId = String(transactionObj.order?.id || transactionObj.order_id || "");
    const transactionId = String(transactionObj.id || "");
    const isSuccess = Boolean(transactionObj.success === true || transactionObj.success === "true");
    console.log("[Paymob Webhook Received]:", {
        merchantOrderId,
        paymobOrderId,
        transactionId,
        isSuccess,
        pending: transactionObj.pending,
    });
    if (!paymobOrderId && !merchantOrderId) {
        throw new Errors_1.BadRequest("No matching order identifier found in Paymob webhook payload.");
    }
    // 1. Locate the order in DB
    const [matchedOrder] = await connection_1.db
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.or)(paymobOrderId ? (0, drizzle_orm_1.eq)(schema_1.orders.paymobOrderId, paymobOrderId) : undefined, merchantOrderId ? (0, drizzle_orm_1.eq)(schema_1.orders.id, merchantOrderId) : undefined, merchantOrderId ? (0, drizzle_orm_1.eq)(schema_1.orders.orderNumber, merchantOrderId) : undefined))
        .limit(1);
    if (!matchedOrder) {
        console.warn(`[Paymob Webhook]: Order not found for paymobOrderId: ${paymobOrderId}, merchantOrderId: ${merchantOrderId}`);
        throw new Errors_1.NotFound("Order matching this Paymob transaction was not found.");
    }
    // 2. 🛡️ Idempotency check: If order is already marked as paid, return early to prevent duplicates
    if (matchedOrder.paymentStatus === "paid") {
        console.log(`[Paymob Webhook]: Order ${matchedOrder.orderNumber} is already marked as paid. Skipping duplicate processing.`);
        return (0, response_1.SuccessResponse)(res, {
            received: true,
            alreadyProcessed: true,
            message: "Order has already been processed and marked as paid.",
        });
    }
    // 3. Fetch Restaurant Settings to determine gateway & HMAC secret
    let hmacSecret = "";
    const [settings] = await connection_1.db
        .select()
        .from(schema_1.restaurantSettings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, matchedOrder.restaurantId))
        .limit(1);
    if (settings?.paymentGatewayType === "CUSTOM") {
        const [credsRecord] = await connection_1.db
            .select()
            .from(schema_1.restaurantPaymentCredentials)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, matchedOrder.restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.provider, "PAYMOB")))
            .limit(1);
        if (!credsRecord || !credsRecord.credentials?.hmac) {
            throw new Errors_1.BadRequest("Restaurant Paymob credentials or HMAC secret missing in database.");
        }
        hmacSecret = (0, encryption_1.decryptSecret)(credsRecord.credentials.hmac);
    }
    else {
        hmacSecret = process.env.PLATFORM_PAYMOB_HMAC || "";
    }
    // 4. 🛡️ Strict HMAC Verification: MANDATORY
    if (!hmacSecret) {
        console.error("⚠️ Paymob HMAC secret is not configured. Cannot verify webhook safely.");
        throw new Errors_1.BadRequest("Payment gateway webhook verification secret is not configured.");
    }
    if (!receivedHmac) {
        console.error("⚠️ Webhook request is missing HMAC signature.");
        throw new Errors_1.BadRequest("HMAC signature is required for Paymob webhook verification.");
    }
    const isValid = paymob_service_1.PaymobService.verifyHmac(transactionObj, hmacSecret, receivedHmac);
    if (!isValid) {
        console.error("⚠️ Invalid Paymob Webhook HMAC signature.");
        throw new Errors_1.BadRequest("Invalid HMAC signature.");
    }
    // 5. Update Order status based on transaction result
    if (isSuccess) {
        const [digitalMethod] = await connection_1.db
            .select()
            .from(schema_1.paymentMethods)
            .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%visa%"), (0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%card%"), (0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%paymob%"), (0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%digital%")))
            .limit(1);
        const updateData = {
            paymentStatus: "paid",
            status: "accepted", // Order automatically accepted once payment confirmed
            paymobTransactionId: transactionId,
        };
        if (digitalMethod) {
            updateData.paymentMethod = digitalMethod.id;
        }
        await connection_1.db
            .update(schema_1.orders)
            .set(updateData)
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, matchedOrder.id));
        console.log(`[Paymob Webhook]: Order ${matchedOrder.orderNumber} successfully marked as PAID & ACCEPTED. Tx: ${transactionId}`);
    }
    else {
        await connection_1.db
            .update(schema_1.orders)
            .set({
            paymentStatus: "payment_failed",
            paymobTransactionId: transactionId || null,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, matchedOrder.id));
        console.log(`[Paymob Webhook]: Order ${matchedOrder.orderNumber} payment FAILED. Tx: ${transactionId}`);
    }
    return (0, response_1.SuccessResponse)(res, {
        received: true,
        message: "Paymob webhook processed successfully",
    });
};
exports.handlePaymobWebhook = handlePaymobWebhook;
/**
 * Controller: Handle browser redirection after user completes payment
 * Endpoint: GET /payments/paymob/callback
 * This route is ONLY a user browser redirect (like Kashier merchantRedirect), NOT for confirming payments!
 */
const handlePaymobRedirect = (req, res) => {
    const success = req.query.success === "true";
    const orderId = req.query.merchant_order_id || req.query.order_id || "";
    const frontendBaseUrl = (process.env.APP_BASE_URL || process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
    const redirectUrl = `${frontendBaseUrl}/payment/result?success=${success}&orderId=${encodeURIComponent(String(orderId))}`;
    return res.redirect(redirectUrl);
};
exports.handlePaymobRedirect = handlePaymobRedirect;
