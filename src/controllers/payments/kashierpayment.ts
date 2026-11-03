import { Request, Response } from "express";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors";
import { verifyKashierWebhookSignature } from "../../services/payments/kashier/kashier";
import { KashierService } from "../../services/payments/kashier/kashier.service";
import { db } from "../../models/connection";
import { orders, users, restaurantSettings, restaurants } from "../../models/schema";
import { eq, or } from "drizzle-orm";
import { decryptSecret } from "../../utils/encryption";
import { getActiveCustomGateway } from "../../utils/getActiveCustomGateway";
import { getActivePlatformGateway } from "../../utils/getActivePlatformGateway";
import { confirmOrderPayment, recordFailedPayment } from "../../helpers/orderPaymentConfirmation";


/**
 * Controller: Create Kashier Payment Session
 * Endpoint: POST /api/payments/kashier/session
 */
export const generatePaymentSession = async (req: Request, res: Response) => {
    let { orderId, amount, currency = "EGP", customerEmail } = req.body;

    if (!orderId) {
        throw new BadRequest("orderId is required to create a Kashier session.");
    }

    const [existingOrder] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, String(orderId)))
        .limit(1);

    if (!existingOrder) {
        throw new BadRequest("Order does not exist.");
    }

    if (!amount) {
        amount = parseFloat(existingOrder.totalAmount as string);
    }
    if (!customerEmail && existingOrder.userId) {
        const [customer] = await db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, existingOrder.userId))
            .limit(1);
        if (customer?.email) {
            customerEmail = customer.email;
        }
    }

    if (!amount || isNaN(Number(amount))) {
        throw new BadRequest("Order amount is required or order does not exist.");
    }

    let kashierCredentials: { mid: string; apiKey: string; secretKey?: string; baseUrl?: string } | undefined;

    const [settings] = await db
        .select({ paymentGatewayType: restaurantSettings.paymentGatewayType })
        .from(restaurantSettings)
        .where(eq(restaurantSettings.restaurantId, existingOrder.restaurantId))
        .limit(1);

    if (settings?.paymentGatewayType === "CUSTOM") {
        // ── CUSTOM: use the restaurant's own gateway credentials ──────────────
        const activeGateway = await getActiveCustomGateway(existingOrder.restaurantId);

        if (!activeGateway) {
            throw new BadRequest(
                "Restaurant is configured for custom gateway, but no active payment credentials were found."
            );
        }

        if (activeGateway.provider !== "KASHIER") {
            throw new BadRequest(
                "This restaurant's active payment provider is Paymob, not Kashier. Use the Paymob session flow instead."
            );
        }

        const rawCreds = activeGateway.record.credentials as any;
        kashierCredentials = {
            mid: rawCreds.mid,
            apiKey: decryptSecret(rawCreds.apiKey),
            secretKey: rawCreds.secretKey ? decryptSecret(rawCreds.secretKey) : undefined,
            baseUrl: rawCreds.baseUrl,
        };
    } else {
        // ── SYSTEM: use the platform-level gateway stored in the DB ───────────
        const platformGateway = await getActivePlatformGateway();

        if (!platformGateway) {
            throw new BadRequest(
                "No active platform payment gateway found. Please configure a system gateway in the Super Admin dashboard."
            );
        }

        if (platformGateway.provider !== "KASHIER") {
            throw new BadRequest(
                `Active platform gateway is ${platformGateway.provider}, not KASHIER. Use the correct session endpoint.`
            );
        }

        const creds = platformGateway.credentials;
        kashierCredentials = {
            mid: creds.mid,
            apiKey: creds.apiKey,          // already decrypted by getActivePlatformGateway
            secretKey: creds.secretKey,
            baseUrl: creds.baseUrl,
        };
    }

    const session = await KashierService.createPaymentSession({
        orderId: String(orderId),
        amount: typeof amount === "string" ? parseFloat(amount) : amount,
        currency,
        customerEmail,
        credentials: kashierCredentials,
    });

    return SuccessResponse(res, {
        gateway: "KASHIER",
        sessionId: session.sessionId,
        sessionUrl: session.sessionUrl,
        status: session.status,
        expireAt: session.expireAt,
    });
};


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
export const handleKashierWebhook = async (req: Request, res: Response) => {
    // ⚠️ TEMP DEBUG — keep this until we've confirmed one successful Test
    // Webhook end-to-end, then remove it.
    console.log("RAW HEADERS:", JSON.stringify(req.headers));
    console.log("RAW BODY:", JSON.stringify(req.body));

    // Kashier sends the payload nested under "data"
    const webhookData: Record<string, any> = req.body?.data || req.body;

    // FIX: the signature ONLY comes from the header now. The old
    // `webhookData.kashierSignature` body-field fallback is removed because
    // that field does not exist in Kashier's actual webhook payloads and was
    // silently masking the real signature source.
    const headerSignature =
        (req.headers["x-kashier-signature"] as string) ||
        (req.headers["Kashier-Signature"] as string);

    // Field mapping confirmed from Kashier dashboard:
    //   webhookData.merchantOrderId  ->  OUR orders.id (UUID we sent at session creation)
    //   webhookData.orderId          ->  Kashier's internal order ID (store in paymentOrderId)
    //   webhookData.transactionId    ->  Kashier's transaction ID
    const ourOrderId: string | undefined =
        webhookData?.merchantOrderId ||   // primary: Kashier echoes our UUID here
        webhookData?.merchantOrder ||     // fallback alias
        webhookData?.order;               // last-resort fallback

    // Kashier's own order reference - stored in paymentOrderId for traceability
    const gatewayOrderId: string | undefined =
        webhookData?.orderId ||           // Kashier's internal order ID
        webhookData?.orderReference ||
        webhookData?.kashierOrderId ||
        webhookData?.reference;

    const transactionId: string | undefined =
        webhookData?.transactionId ||
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
    let matchedOrder: typeof orders.$inferSelect | undefined = undefined;
    if (ourOrderId) {
        const [found] = await db
            .select()
            .from(orders)
            .where(
                or(
                    eq(orders.id, String(ourOrderId)),
                    eq(orders.orderNumber, String(ourOrderId)),
                    eq(orders.paymentOrderId, String(ourOrderId))
                )
            )
            .limit(1);
        matchedOrder = found;
    }

    // ─── Signature Verification ───────────────────────────────────────────────
    if (!headerSignature) {
        console.error("⚠️ Kashier webhook has no x-kashier-signature header — rejecting.");
        throw new BadRequest("Webhook signature is required.");
    }

    // Look up restaurant / platform gateway credentials for signature verification.
    let customApiKey: string | undefined = undefined;
    if (matchedOrder?.restaurantId) {
        const [settings] = await db
            .select({ paymentGatewayType: restaurantSettings.paymentGatewayType })
            .from(restaurantSettings)
            .where(eq(restaurantSettings.restaurantId, matchedOrder.restaurantId))
            .limit(1);

        if (settings?.paymentGatewayType === "CUSTOM") {
            const activeGateway = await getActiveCustomGateway(matchedOrder.restaurantId);
            if (activeGateway?.provider === "KASHIER") {
                const rawCreds = activeGateway.record.credentials as any;
                if (rawCreds?.apiKey) {
                    customApiKey = decryptSecret(rawCreds.apiKey);
                }
            }
        } else {
            // SYSTEM gateway: look up platform DB credentials (replaces .env lookup)
            const platformGateway = await getActivePlatformGateway();
            if (platformGateway?.provider === "KASHIER" && platformGateway.credentials?.apiKey) {
                customApiKey = platformGateway.credentials.apiKey;
            }
        }
    } else {
        // Fallback: check platform DB credentials if matchedOrder is not found yet
        const platformGateway = await getActivePlatformGateway();
        if (platformGateway?.provider === "KASHIER" && platformGateway.credentials?.apiKey) {
            customApiKey = platformGateway.credentials.apiKey;
        }
    }

    let isValid = verifyKashierWebhookSignature(webhookData, headerSignature, customApiKey);
    if (!isValid && customApiKey) {
        // Fallback: try without custom key (uses .env KASHIER_API_KEY internally)
        isValid = verifyKashierWebhookSignature(webhookData, headerSignature);
    }

    if (!isValid) {
        console.error("⚠️ Invalid Kashier webhook signature received.");
        console.error("[Kashier Webhook] signatureKeys used:", webhookData?.signatureKeys);
        console.error("[Kashier Webhook] header signature received:", headerSignature);
        throw new BadRequest("Invalid webhook signature.");
    }

    // ─── Process payment result ───────────────────────────────────────────────
    if (matchedOrder && (paymentStatus === "SUCCESS" || paymentStatus === "CAPTURED" || paymentStatus === "PAID")) {
        if (webhookAmount !== undefined) {
            const expectedAmount = parseFloat(matchedOrder.totalAmount as string);
            if (Math.abs(expectedAmount - webhookAmount) > 0.01) {
                console.error(
                    `[Kashier Webhook] Amount mismatch for order ${matchedOrder.id}. Expected ${expectedAmount}, got ${webhookAmount}.`
                );
                throw new BadRequest("Paid amount does not match the order total.");
            }
        }

        await confirmOrderPayment({
            orderId: matchedOrder.id,
            gateway: "kashier",
            transactionId: transactionId || undefined,
            gatewayOrderId: gatewayOrderId || undefined,
            rawPayload: webhookData,
        });
        console.log(`[Kashier Webhook] Order ${matchedOrder.orderNumber} (${matchedOrder.id}) confirmed as paid & accepted. Tx: ${transactionId}`);
    } else if (matchedOrder && (paymentStatus === "FAILED" || paymentStatus === "DECLINED" || paymentStatus === "REJECTED")) {
        try {
            const failureReason =
                webhookData?.statusReason ||
                webhookData?.failureReason ||
                webhookData?.responseDescription ||
                webhookData?.message ||
                `Transaction ${paymentStatus}`;

            await recordFailedPayment({
                orderId: matchedOrder.id,
                gateway: "kashier",
                transactionId: transactionId || undefined,
                gatewayOrderId: gatewayOrderId || undefined,
                failureReason,
                rawPayload: webhookData,
            });

            console.log(`[Kashier Webhook] Order ${matchedOrder.orderNumber} (${matchedOrder.id}) payment failed recorded. Reason: ${failureReason}. Tx: ${transactionId}`);
        } catch (dbErr) {
            console.error(`[Kashier Webhook] Failed to record order ${matchedOrder.id} failure:`, dbErr);
        }
    } else {
        console.log(`[Kashier Webhook] Unhandled status "${paymentStatus}" for order ${ourOrderId} — no DB change.`);
    }
    return SuccessResponse(res, {
        received: true,
        message: "Webhook processed successfully",
    });
};

/**
 * Controller: Handle browser redirection after user completes Kashier payment
 * Endpoint: GET /payments/kashier/callback
 * This route is ONLY a user browser redirect, NOT for confirming payments!
 * Payment confirmation is handled exclusively via the server-to-server webhook.
 */
export const handleKashierRedirect = async (req: Request, res: Response) => {
    const success = req.query.success === "true";

    const rawOrderId = (
        req.query.order_id ||
        req.query.order
    ) as string | undefined;

    let callbackSlug = req.query.callbackSlug as string | undefined;
    const frontendBaseUrl = (process.env.APP_BASE_URL || process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

    if (!callbackSlug && rawOrderId) {
        try {
            const [result] = await db
                .select({ slug: restaurants.slug })
                .from(orders)
                .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
                .where(
                    or(
                        eq(orders.id, rawOrderId),
                        eq(orders.paymentOrderId, rawOrderId)
                    )
                )
                .limit(1);

            if (result?.slug) {
                callbackSlug = result.slug;
            }
        } catch (error) {
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