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
    // FIX #1: Paymob can send success=false while pending=true — that means the
    // transaction is still being processed, NOT that it failed. We must not mark
    // the order as "payment_failed" in that case.
    const isPending = Boolean(transactionObj.pending === true || transactionObj.pending === "true");
    const amountCentsFromWebhook = transactionObj.amount_cents !== undefined ? Number(transactionObj.amount_cents) : undefined;
    console.log("[Paymob Webhook Received]:", {
        merchantOrderId,
        paymobOrderId,
        transactionId,
        isSuccess,
        pending: isPending,
    });
    if (!paymobOrderId && !merchantOrderId) {
        throw new Errors_1.BadRequest("No matching order identifier found in Paymob webhook payload.");
    }
    // 1. Locate the order in DB
    const [matchedOrder] = await connection_1.db
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.or)(paymobOrderId ? (0, drizzle_orm_1.eq)(schema_1.orders.paymentOrderId, paymobOrderId) : undefined, merchantOrderId ? (0, drizzle_orm_1.eq)(schema_1.orders.id, merchantOrderId) : undefined, merchantOrderId ? (0, drizzle_orm_1.eq)(schema_1.orders.orderNumber, merchantOrderId) : undefined))
        .limit(1);
    if (!matchedOrder) {
        console.warn(`[Paymob Webhook]: Order not found for paymobOrderId: ${paymobOrderId}, merchantOrderId: ${merchantOrderId}`);
        throw new Errors_1.NotFound("Order matching this Paymob transaction was not found.");
    }
    // 2. Fetch Restaurant Settings to determine gateway & HMAC secret
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
        const rawCreds = credsRecord?.credentials;
        if (!credsRecord || !rawCreds?.hmac) {
            throw new Errors_1.BadRequest("Restaurant Paymob credentials or HMAC secret missing in database.");
        }
        hmacSecret = (0, encryption_1.decryptSecret)(rawCreds.hmac);
    }
    else {
        hmacSecret = process.env.PLATFORM_PAYMOB_HMAC || "";
    }
    // 3. 🛡️ Strict HMAC Verification: MANDATORY
    // FIX #4: This now runs BEFORE the idempotency short-circuit below, so an
    // unauthenticated request can never even learn the current payment status
    // of an order (previously the "already paid" branch returned success
    // before the signature was checked at all).
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
    // 4. 🛡️ Idempotency check: If order is already marked as paid, return early to prevent duplicates
    if (matchedOrder.paymentStatus === "paid") {
        console.log(`[Paymob Webhook]: Order ${matchedOrder.orderNumber} is already marked as paid. Skipping duplicate processing.`);
        return (0, response_1.SuccessResponse)(res, {
            received: true,
            alreadyProcessed: true,
            message: "Order has already been processed and marked as paid.",
        });
    }
    // 5. FIX #2: Verify the paid amount matches the order total before trusting
    // the webhook. This protects against a mismatched/forged amount even in
    // scenarios where the HMAC secret itself has been compromised or reused.
    if (isSuccess && amountCentsFromWebhook !== undefined) {
        const expectedCents = Math.round(parseFloat(matchedOrder.totalAmount) * 100);
        if (amountCentsFromWebhook !== expectedCents) {
            console.error(`[Paymob Webhook]: Amount mismatch for order ${matchedOrder.orderNumber}. Expected ${expectedCents} cents, got ${amountCentsFromWebhook} cents.`);
            throw new Errors_1.BadRequest("Paid amount does not match the order total.");
        }
    }
    // 6. Update Order status based on transaction result
    if (isSuccess) {
        const [digitalMethod] = await connection_1.db
            .select()
            .from(schema_1.paymentMethods)
            .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%visa%"), (0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%card%"), (0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%paymob%"), (0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%digital%")))
            .limit(1);
        const updateData = {
            paymentStatus: "paid",
            paymentGateway: "paymob",
            status: "accepted", // Order automatically accepted once payment confirmed
            paymentTransactionId: transactionId,
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
    else if (isPending) {
        // FIX #1 (cont'd): Do NOT mark as failed. Leave the order in a pending
        // state so a later webhook call (success or failure) can still resolve it.
        await connection_1.db
            .update(schema_1.orders)
            .set({
            paymentStatus: "pending_payment",
            paymentGateway: "paymob",
            paymentTransactionId: transactionId || null,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, matchedOrder.id));
        console.log(`[Paymob Webhook]: Order ${matchedOrder.orderNumber} payment PENDING. Tx: ${transactionId}`);
    }
    else {
        await connection_1.db
            .update(schema_1.orders)
            .set({
            paymentStatus: "payment_failed",
            paymentGateway: "paymob",
            paymentTransactionId: transactionId || null,
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
