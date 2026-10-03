"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePaymobRedirect = exports.generatePaymobPaymentSession = exports.handlePaymobWebhook = void 0;
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const paymob_service_1 = require("../../services/payments/paymob/paymob.service");
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const Safedecrypt_1 = require("../../utils/Safedecrypt");
const getActiveCustomGateway_1 = require("../../utils/getActiveCustomGateway");
const paymentSession_service_1 = require("../../services/payments/paymentSession.service");
const orderPaymentConfirmation_1 = require("../../helpers/orderPaymentConfirmation");
/**
 * Controller: Handle Paymob Webhook POST Notification
 * Endpoint: POST /payments/paymob/webhook
 * Paymob sends webhook data with { type: "TRANSACTION", obj: { ... } }
 * and an HMAC in req.query.hmac or headers or req.body.hmac
 */
const handlePaymobWebhook = async (req, res) => {
    try {
        const payload = req.body || {};
        const transactionObj = payload.obj || payload;
        const receivedHmac = req.query.hmac ||
            req.headers["x-paymob-hmac"] ||
            payload.hmac ||
            transactionObj.hmac;
        const merchantOrderId = transactionObj.order?.merchant_order_id;
        const paymobOrderId = String(transactionObj.order?.id || transactionObj.order_id || "");
        const transactionId = String(transactionObj.id || "");
        const isSuccess = Boolean(transactionObj.success === true || transactionObj.success === "true");
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
        // Paymob field mapping:
        //   merchant_order_id → رقمنا (= orders.id)    → للبحث في DB
        //   order.id          → رقم البوابة             → يُحفظ في payment_order_id
        //   id (transaction)  → رقم العملية             → يُحفظ في payment_transaction_id
        const [matchedOrder] = await connection_1.db
            .select()
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.or)(paymobOrderId ? (0, drizzle_orm_1.eq)(schema_1.orders.paymentOrderId, paymobOrderId) : undefined, merchantOrderId ? (0, drizzle_orm_1.eq)(schema_1.orders.id, merchantOrderId) : undefined))
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
            let credsRecord;
            try {
                const activeGateway = await (0, getActiveCustomGateway_1.getActiveCustomGateway)(matchedOrder.restaurantId);
                if (activeGateway && activeGateway.provider === "PAYMOB") {
                    credsRecord = activeGateway.record;
                }
            }
            catch (gatewayErr) {
                console.warn("[Paymob Webhook]: getActiveCustomGateway threw an error:", gatewayErr);
            }
            if (!credsRecord) {
                const [directRecord] = await connection_1.db
                    .select()
                    .from(schema_1.restaurantPaymentCredentials)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, matchedOrder.restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.provider, "PAYMOB"), (0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.isActive, true)))
                    .limit(1);
                credsRecord = directRecord;
            }
            if (!credsRecord) {
                console.error(`[Paymob Webhook]: No active Paymob credentials found for restaurant ${matchedOrder.restaurantId}`);
                throw new Errors_1.BadRequest("Restaurant Paymob credentials missing or inactive in database.");
            }
            let rawCreds = credsRecord.credentials;
            // Handle stringified or multiple-encoded JSON
            let attempts = 0;
            while (typeof rawCreds === "string" && attempts < 3) {
                try {
                    rawCreds = JSON.parse(rawCreds);
                }
                catch {
                    break;
                }
                attempts++;
            }
            // Handle MySQL character-indexed object {"0": "{", "1": "\"", ...}
            if (rawCreds && typeof rawCreds === "object" && "0" in rawCreds && !("hmac" in rawCreds)) {
                try {
                    const reconstructed = Object.keys(rawCreds)
                        .sort((a, b) => Number(a) - Number(b))
                        .map((k) => rawCreds[k])
                        .join("");
                    rawCreds = JSON.parse(reconstructed);
                }
                catch { }
            }
            const rawHmac = rawCreds?.hmac || rawCreds?.hmacSecret || rawCreds?.hmac_secret || rawCreds?.HMAC;
            if (!rawHmac) {
                console.error(`[Paymob Webhook]: HMAC secret missing in Paymob credentials for restaurant ${matchedOrder.restaurantId}. Available keys:`, typeof rawCreds === "object" && rawCreds !== null ? Object.keys(rawCreds) : typeof rawCreds);
                throw new Errors_1.BadRequest("Restaurant Paymob credentials or HMAC secret missing in database.");
            }
            hmacSecret = (0, Safedecrypt_1.safeDecrypt)(rawHmac);
        }
        else {
            hmacSecret = process.env.PLATFORM_PAYMOB_HMAC || "";
        }
        // 3. 🛡️ Strict HMAC Verification: MANDATORY (runs before idempotency check)
        if (!hmacSecret) {
            console.error("⚠️ Paymob HMAC secret is not configured. Cannot verify webhook safely.");
            throw new Errors_1.BadRequest("Payment gateway webhook verification secret is not configured.");
        }
        if (!receivedHmac) {
            console.error("⚠️ Webhook request is missing HMAC signature.");
            throw new Errors_1.BadRequest("HMAC signature is required for Paymob webhook verification.");
        }
        let isValid = paymob_service_1.PaymobService.verifyHmac(transactionObj, hmacSecret, receivedHmac);
        if (!isValid && process.env.PLATFORM_PAYMOB_HMAC && hmacSecret !== process.env.PLATFORM_PAYMOB_HMAC) {
            console.warn("[Paymob Webhook]: Custom HMAC verification failed. Attempting platform HMAC verification fallback.");
            isValid = paymob_service_1.PaymobService.verifyHmac(transactionObj, process.env.PLATFORM_PAYMOB_HMAC, receivedHmac);
        }
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
        // 5. Verify the paid amount matches the order total before trusting the webhook.
        if (isSuccess && amountCentsFromWebhook !== undefined) {
            const expectedCents = Math.round(parseFloat(matchedOrder.totalAmount) * 100);
            if (amountCentsFromWebhook !== expectedCents) {
                console.error(`[Paymob Webhook]: Amount mismatch for order ${matchedOrder.orderNumber}. Expected ${expectedCents} cents, got ${amountCentsFromWebhook} cents.`);
                throw new Errors_1.BadRequest("Paid amount does not match the order total.");
            }
        }
        // 6. Process Order status based on transaction result
        if (isSuccess) {
            await (0, orderPaymentConfirmation_1.confirmOrderPayment)({
                orderId: matchedOrder.id,
                gateway: "paymob",
                transactionId: transactionId || undefined,
                gatewayOrderId: paymobOrderId || undefined,
                rawPayload: transactionObj,
            });
            console.log(`[Paymob Webhook]: Order ${matchedOrder.orderNumber} successfully confirmed as PAID & ACCEPTED. Tx: ${transactionId}`);
        }
        else if (isPending) {
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
            // Extract failure reason from Paymob payload
            const rawMessage = transactionObj.data?.message;
            const txnResponseCode = transactionObj.data?.txn_response_code || transactionObj.txn_response_code;
            const subResponseCode = transactionObj.data?.sub_response_code;
            const failureReason = (typeof rawMessage === "string" && rawMessage.trim() ? rawMessage : "") ||
                (txnResponseCode ? `Transaction declined (Code: ${txnResponseCode}${subResponseCode ? `, SubCode: ${subResponseCode}` : ""})` : "") ||
                "Payment was declined by card issuer or cancelled by user";
            await (0, orderPaymentConfirmation_1.recordFailedPayment)({
                orderId: matchedOrder.id,
                gateway: "paymob",
                transactionId: transactionId || undefined,
                gatewayOrderId: paymobOrderId || undefined,
                failureReason,
                rawPayload: transactionObj,
            });
            console.log(`[Paymob Webhook]: Order ${matchedOrder.orderNumber} payment FAILED. Reason: ${failureReason}. Tx: ${transactionId}`);
        }
        return (0, response_1.SuccessResponse)(res, {
            received: true,
            message: "Paymob webhook processed successfully",
        });
    }
    catch (err) {
        console.error("[Paymob Webhook] UNCAUGHT ERROR:", err);
        throw err;
    }
};
exports.handlePaymobWebhook = handlePaymobWebhook;
/**
 * Controller: Create or retry Paymob Payment Session
 * Endpoint: POST /payments/paymob/session
 */
const generatePaymobPaymentSession = async (req, res) => {
    const { orderId } = req.body;
    const [existingOrder] = await connection_1.db
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, String(orderId)))
        .limit(1);
    if (!existingOrder) {
        throw new Errors_1.NotFound("Order does not exist.");
    }
    let customerEmail;
    let customerName;
    let customerPhone;
    if (existingOrder.userId) {
        const [customer] = await connection_1.db
            .select()
            .from(schema_1.users)
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, existingOrder.userId))
            .limit(1);
        if (customer) {
            customerEmail = customer.email || undefined;
            customerName = customer.name || undefined;
            customerPhone = customer.phone || undefined;
        }
    }
    const sessionData = await (0, paymentSession_service_1.createOrderPaymentSession)({
        orderId: existingOrder.id,
        orderNumber: existingOrder.orderNumber,
        restaurantId: existingOrder.restaurantId,
        totalAmount: req.body.amount ? Number(req.body.amount) : parseFloat(existingOrder.totalAmount),
        userInfo: {
            name: customerName,
            email: customerEmail || req.body.customerEmail,
            phone: customerPhone,
        },
        preferredGateway: "PAYMOB",
    });
    return (0, response_1.SuccessResponse)(res, sessionData);
};
exports.generatePaymobPaymentSession = generatePaymobPaymentSession;
/**
 * Controller: Handle browser redirection after user completes payment
 * Endpoint: GET /payments/paymob/callback
 * This route is ONLY a user browser redirect (like Kashier merchantRedirect), NOT for confirming payments!
 */
const handlePaymobRedirect = async (req, res) => {
    const success = req.query.success === "true";
    // Paymob echoes back merchant_order_id (our UUID since we now always send orderId,
    // not orderNumber, to Paymob) or order_id (Paymob's internal order ID = paymentOrderId).
    const rawOrderId = (req.query.merchant_order_id ||
        req.query.order_id ||
        req.query.order);
    let callbackSlug = req.query.callbackSlug;
    const frontendBaseUrl = (process.env.APP_BASE_URL || process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
    // Resolve the real orders.id (UUID) from DB. Since we now always send the UUID
    // as merchant_order_id to Paymob, we only need to search by orders.id and
    // orders.paymentOrderId — orderNumber is no longer needed.
    let resolvedOrderId = rawOrderId;
    if (rawOrderId) {
        try {
            const [result] = await connection_1.db
                .select({ id: schema_1.orders.id, slug: schema_1.restaurants.slug })
                .from(schema_1.orders)
                .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
                .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.orders.id, rawOrderId), // UUID — الحالة المعتادة
            (0, drizzle_orm_1.eq)(schema_1.orders.paymentOrderId, rawOrderId) // Paymob internal order_id
            ))
                .limit(1);
            if (result) {
                resolvedOrderId = result.id; // ← UUID الحقيقي دايمًا
                if (!callbackSlug && result.slug) {
                    callbackSlug = result.slug;
                }
            }
            else {
                console.warn(`[Paymob Redirect]: Could not resolve order for raw value "${rawOrderId}" — falling back to raw value in redirect URL.`);
            }
        }
        catch (error) {
            console.error("Error fetching order/restaurant slug for Paymob redirect:", error);
        }
    }
    const redirectUrl = success
        ? (callbackSlug
            ? `${frontendBaseUrl}/profile?callbackSlug=${encodeURIComponent(callbackSlug)}&success=true&orderId=${encodeURIComponent(String(resolvedOrderId || ""))}&gateway=PAYMOB`
            : `${frontendBaseUrl}/payment/result?success=true&orderId=${encodeURIComponent(String(resolvedOrderId || ""))}&gateway=PAYMOB`)
        : (callbackSlug
            ? `${frontendBaseUrl}/home/restaurants/${encodeURIComponent(callbackSlug)}/order?success=false&orderId=${encodeURIComponent(String(resolvedOrderId || ""))}&gateway=PAYMOB`
            : `${frontendBaseUrl}/payment/result?success=false&orderId=${encodeURIComponent(String(resolvedOrderId || ""))}&gateway=PAYMOB`);
    return res.redirect(redirectUrl);
};
exports.handlePaymobRedirect = handlePaymobRedirect;
