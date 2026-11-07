"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerKashierSync = exports.handleKashierRedirect = exports.handleKashierWebhook = exports.generatePaymentSession = void 0;
const kashierSyncCron_1 = require("../../services/kashierSyncCron");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const kashier_1 = require("../../services/payments/kashier/kashier");
const kashier_service_1 = require("../../services/payments/kashier/kashier.service");
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const encryption_1 = require("../../utils/encryption");
const getActiveCustomGateway_1 = require("../../utils/getActiveCustomGateway");
const getActivePlatformGateway_1 = require("../../utils/getActivePlatformGateway");
const orderPaymentConfirmation_1 = require("../../helpers/orderPaymentConfirmation");
/**
 * Controller: Create Kashier Payment Session
 * Endpoint: POST /api/payments/kashier/session
 */
const generatePaymentSession = async (req, res) => {
    let { orderId, amount, currency = "EGP", customerEmail } = req.body;
    if (!orderId) {
        throw new Errors_1.BadRequest("orderId is required to create a Kashier session.");
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
    if (!amount || isNaN(Number(amount))) {
        throw new Errors_1.BadRequest("Order amount is required or order does not exist.");
    }
    let kashierCredentials;
    const [settings] = await connection_1.db
        .select({ paymentGatewayType: schema_1.restaurantSettings.paymentGatewayType })
        .from(schema_1.restaurantSettings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, existingOrder.restaurantId))
        .limit(1);
    if (settings?.paymentGatewayType === "CUSTOM") {
        // ── CUSTOM: use the restaurant's own gateway credentials ──────────────
        const activeGateway = await (0, getActiveCustomGateway_1.getActiveCustomGateway)(existingOrder.restaurantId);
        if (!activeGateway) {
            throw new Errors_1.BadRequest("Restaurant is configured for custom gateway, but no active payment credentials were found.");
        }
        if (activeGateway.provider !== "KASHIER") {
            throw new Errors_1.BadRequest("This restaurant's active payment provider is Paymob, not Kashier. Use the Paymob session flow instead.");
        }
        const rawCreds = activeGateway.record.credentials;
        kashierCredentials = {
            mid: rawCreds.mid,
            apiKey: (0, encryption_1.decryptSecret)(rawCreds.apiKey),
            secretKey: rawCreds.secretKey ? (0, encryption_1.decryptSecret)(rawCreds.secretKey) : undefined,
            baseUrl: rawCreds.baseUrl,
        };
    }
    else {
        // ── SYSTEM: use the platform-level gateway stored in the DB ───────────
        const platformGateway = await (0, getActivePlatformGateway_1.getActivePlatformGateway)();
        if (!platformGateway) {
            throw new Errors_1.BadRequest("No active platform payment gateway found. Please configure a system gateway in the Super Admin dashboard.");
        }
        if (platformGateway.provider !== "KASHIER") {
            throw new Errors_1.BadRequest(`Active platform gateway is ${platformGateway.provider}, not KASHIER. Use the correct session endpoint.`);
        }
        const creds = platformGateway.credentials;
        kashierCredentials = {
            mid: creds.mid,
            apiKey: creds.apiKey, // already decrypted by getActivePlatformGateway
            secretKey: creds.secretKey,
            baseUrl: creds.baseUrl,
        };
    }
    const session = await kashier_service_1.KashierService.createPaymentSession({
        orderId: String(orderId),
        amount: typeof amount === "string" ? parseFloat(amount) : amount,
        currency,
        customerEmail,
        credentials: kashierCredentials,
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
 * FIXED to match Kashier's real webhook format:
 *   - The signature lives in the `x-kashier-signature` HEADER, never in a
 *     body field. There is no `data.kashierSignature` in real payloads.
 *   - `signatureKeys` must be sorted alphabetically before signing (handled
 *     inside verifyKashierWebhookSignature now).
 *   - The payload can arrive as { event, data: {...} } — `data` holds
 *     signatureKeys, orderId, status, etc.
 */
const handleKashierWebhook = async (req, res) => {
    // ⚠️ TEMP DEBUG — keep this until we've confirmed one successful Test
    // Webhook end-to-end, then remove it.
    console.log("RAW HEADERS:", JSON.stringify(req.headers));
    console.log("RAW BODY:", JSON.stringify(req.body));
    // Kashier sends the payload nested under "data"
    const webhookData = req.body?.data || req.body;
    // FIX: the signature ONLY comes from the header now. The old
    // `webhookData.kashierSignature` body-field fallback is removed because
    // that field does not exist in Kashier's actual webhook payloads and was
    // silently masking the real signature source.
    const headerSignature = req.headers["x-kashier-signature"] ||
        req.headers["Kashier-Signature"];
    // Field mapping confirmed from Kashier dashboard:
    //   webhookData.merchantOrderId  ->  OUR orders.id (UUID we sent at session creation)
    //   webhookData.orderId          ->  Kashier's internal order ID (store in paymentOrderId)
    //   webhookData.transactionId    ->  Kashier's transaction ID
    const ourOrderId = webhookData?.merchantOrderId || // primary: Kashier echoes our UUID here
        webhookData?.merchantOrder || // fallback alias
        webhookData?.order; // last-resort fallback
    // Kashier's own order reference - stored in paymentOrderId for traceability
    const gatewayOrderId = webhookData?.orderId || // Kashier's internal order ID
        webhookData?.orderReference ||
        webhookData?.kashierOrderId ||
        webhookData?.reference;
    const transactionId = webhookData?.transactionId ||
        webhookData?.kashierTransactionId;
    const paymentStatus = (webhookData?.status || "").toUpperCase();
    const webhookAmount = webhookData?.amount !== undefined ? Number(webhookData.amount) : undefined;
    console.log("[Kashier Webhook Received]:", {
        event: req.body?.event || "PAYMENT_STATUS",
        ourOrderId,
        gatewayOrderId,
        transactionId,
        paymentStatus,
        hasHeaderSig: Boolean(headerSignature),
        signatureKeys: webhookData?.signatureKeys,
    });
    // ─── Look up order in DB ──────────────────────────────────────────────────
    let matchedOrder = undefined;
    if (ourOrderId) {
        const [found] = await connection_1.db
            .select()
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.orders.id, String(ourOrderId)), (0, drizzle_orm_1.eq)(schema_1.orders.orderNumber, String(ourOrderId)), (0, drizzle_orm_1.eq)(schema_1.orders.paymentOrderId, String(ourOrderId))))
            .limit(1);
        matchedOrder = found;
    }
    // ─── Signature Verification ───────────────────────────────────────────────
    if (!headerSignature) {
        console.error("⚠️ Kashier webhook has no x-kashier-signature header — rejecting.");
        throw new Errors_1.BadRequest("Webhook signature is required.");
    }
    // Look up restaurant / platform gateway credentials for signature verification.
    let customApiKey = undefined;
    if (matchedOrder?.restaurantId) {
        const [settings] = await connection_1.db
            .select({ paymentGatewayType: schema_1.restaurantSettings.paymentGatewayType })
            .from(schema_1.restaurantSettings)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, matchedOrder.restaurantId))
            .limit(1);
        if (settings?.paymentGatewayType === "CUSTOM") {
            const activeGateway = await (0, getActiveCustomGateway_1.getActiveCustomGateway)(matchedOrder.restaurantId);
            if (activeGateway?.provider === "KASHIER") {
                const rawCreds = activeGateway.record.credentials;
                if (rawCreds?.apiKey) {
                    customApiKey = (0, encryption_1.decryptSecret)(rawCreds.apiKey);
                }
            }
        }
        else {
            // SYSTEM gateway: look up platform DB credentials (replaces .env lookup)
            const platformGateway = await (0, getActivePlatformGateway_1.getActivePlatformGateway)();
            if (platformGateway?.provider === "KASHIER" && platformGateway.credentials?.apiKey) {
                customApiKey = platformGateway.credentials.apiKey;
            }
        }
    }
    else {
        // Fallback: check platform DB credentials if matchedOrder is not found yet
        const platformGateway = await (0, getActivePlatformGateway_1.getActivePlatformGateway)();
        if (platformGateway?.provider === "KASHIER" && platformGateway.credentials?.apiKey) {
            customApiKey = platformGateway.credentials.apiKey;
        }
    }
    let isValid = (0, kashier_1.verifyKashierWebhookSignature)(webhookData, headerSignature, customApiKey);
    if (!isValid && customApiKey) {
        // Fallback: try without custom key (uses .env KASHIER_API_KEY internally)
        isValid = (0, kashier_1.verifyKashierWebhookSignature)(webhookData, headerSignature);
    }
    if (!isValid) {
        console.error("⚠️ Invalid Kashier webhook signature received.");
        console.error("[Kashier Webhook] signatureKeys used:", webhookData?.signatureKeys);
        console.error("[Kashier Webhook] header signature received:", headerSignature);
        throw new Errors_1.BadRequest("Invalid webhook signature.");
    }
    // ─── Process payment result ───────────────────────────────────────────────
    if (matchedOrder && (paymentStatus === "SUCCESS" || paymentStatus === "CAPTURED" || paymentStatus === "PAID")) {
        if (webhookAmount !== undefined) {
            const expectedAmount = parseFloat(matchedOrder.totalAmount);
            if (Math.abs(expectedAmount - webhookAmount) > 0.01) {
                console.error(`[Kashier Webhook] Amount mismatch for order ${matchedOrder.id}. Expected ${expectedAmount}, got ${webhookAmount}.`);
                throw new Errors_1.BadRequest("Paid amount does not match the order total.");
            }
        }
        await (0, orderPaymentConfirmation_1.confirmOrderPayment)({
            orderId: matchedOrder.id,
            gateway: "kashier",
            transactionId: transactionId || undefined,
            gatewayOrderId: gatewayOrderId || undefined,
            rawPayload: webhookData,
        });
        console.log(`[Kashier Webhook] Order ${matchedOrder.orderNumber} (${matchedOrder.id}) confirmed as paid & accepted. Tx: ${transactionId}`);
    }
    else if (matchedOrder && (paymentStatus === "FAILED" || paymentStatus === "DECLINED" || paymentStatus === "REJECTED")) {
        try {
            const failureReason = webhookData?.statusReason ||
                webhookData?.failureReason ||
                webhookData?.responseDescription ||
                webhookData?.message ||
                `Transaction ${paymentStatus}`;
            await (0, orderPaymentConfirmation_1.recordFailedPayment)({
                orderId: matchedOrder.id,
                gateway: "kashier",
                transactionId: transactionId || undefined,
                gatewayOrderId: gatewayOrderId || undefined,
                failureReason,
                rawPayload: webhookData,
            });
            console.log(`[Kashier Webhook] Order ${matchedOrder.orderNumber} (${matchedOrder.id}) payment failed recorded. Reason: ${failureReason}. Tx: ${transactionId}`);
        }
        catch (dbErr) {
            console.error(`[Kashier Webhook] Failed to record order ${matchedOrder.id} failure:`, dbErr);
        }
    }
    else {
        console.log(`[Kashier Webhook] Unhandled status "${paymentStatus}" for order ${ourOrderId} — no DB change.`);
    }
    return (0, response_1.SuccessResponse)(res, {
        received: true,
        message: "Webhook processed successfully",
    });
};
exports.handleKashierWebhook = handleKashierWebhook;
/**
 * Controller: Handle browser redirection after user completes Kashier payment
 * Endpoint: GET /payments/kashier/callback
 * This route is ONLY a user browser redirect, NOT for confirming payments!
 * Payment confirmation is handled exclusively via the server-to-server webhook.
 */
const handleKashierRedirect = async (req, res) => {
    let success = req.query.success === "true" || req.query.paymentStatus?.toUpperCase() === "SUCCESS";
    const rawOrderId = (req.query.order_id ||
        req.query.merchantOrderId ||
        req.query.order);
    // ⚡ Instant Payment Verification:
    // When the customer returns from Kashier, immediately verify and confirm payment
    // for this specific order without waiting for any cron or webhook.
    if (rawOrderId) {
        try {
            const isConfirmedPaid = await (0, kashierSyncCron_1.syncOrderByOrderId)(rawOrderId);
            if (isConfirmedPaid) {
                success = true;
            }
        }
        catch (syncErr) {
            console.error("[handleKashierRedirect] Immediate sync check error:", syncErr);
        }
    }
    let callbackSlug = req.query.callbackSlug;
    const frontendBaseUrl = (process.env.APP_BASE_URL || process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
    if (!callbackSlug && rawOrderId) {
        try {
            const [result] = await connection_1.db
                .select({ slug: schema_1.restaurants.slug })
                .from(schema_1.orders)
                .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
                .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.orders.id, rawOrderId), (0, drizzle_orm_1.eq)(schema_1.orders.paymentOrderId, rawOrderId)))
                .limit(1);
            if (result?.slug) {
                callbackSlug = result.slug;
            }
        }
        catch (error) {
            console.error("Error fetching restaurant slug for Kashier redirect:", error);
        }
    }
    const redirectUrl = success
        ? (callbackSlug
            ? `${frontendBaseUrl}/profile?callbackSlug=${encodeURIComponent(callbackSlug)}&success=true&orderId=${encodeURIComponent(String(rawOrderId || ""))}&gateway=KASHIER`
            : `${frontendBaseUrl}/payment/result?success=true&orderId=${encodeURIComponent(String(rawOrderId || ""))}&gateway=KASHIER`)
        : (callbackSlug
            ? `${frontendBaseUrl}/home/restaurants/${encodeURIComponent(callbackSlug)}/order?success=false&orderId=${encodeURIComponent(String(rawOrderId || ""))}&gateway=KASHIER`
            : `${frontendBaseUrl}/payment/result?success=false&orderId=${encodeURIComponent(String(rawOrderId || ""))}&gateway=KASHIER`);
    return res.redirect(redirectUrl);
};
exports.handleKashierRedirect = handleKashierRedirect;
/**
 * Controller: Manually trigger Kashier Orders Reconciliation / Sync
 * Endpoint: POST /api/payments/kashier/sync
 */
const triggerKashierSync = async (req, res) => {
    const result = await (0, kashierSyncCron_1.runKashierOrderSync)();
    return (0, response_1.SuccessResponse)(res, {
        message: "Kashier order sync completed",
        ...result,
    });
};
exports.triggerKashierSync = triggerKashierSync;
