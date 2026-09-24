import { Request, Response } from "express";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors";
import { verifyKashierWebhookSignature } from "../../services/payments/kashier/kashier";
import { KashierService } from "../../services/payments/kashier/kashier.service";
import { db } from "../../models/connection";
import { orders, users, restaurantSettings, restaurantPaymentCredentials } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { decryptSecret } from "../../utils/encryption";


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
export const generatePaymentSession = async (req: Request, res: Response) => {
    let { orderId, amount, currency = "EGP", customerEmail } = req.body;

    // Fetch order from database to get amount and customer details if not supplied
    if (orderId) {
        const [existingOrder] = await db
            .select()
            .from(orders)
            .where(eq(orders.id, String(orderId)))
            .limit(1);

        if (existingOrder) {
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
        }
    }

    if (!amount || isNaN(Number(amount))) {
        throw new BadRequest("Order amount is required or order does not exist.");
    }

    const session = await KashierService.createPaymentSession({
        orderId: String(orderId),
        amount: typeof amount === "string" ? parseFloat(amount) : amount,
        currency,
        customerEmail,
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
 * Kashier sends a JSON body with:
 *   - data: { orderId, transactionId, status, amount, currency, kashierSignature, signatureKeys, ... }
 *   - or the flat payload directly at the root level
 *
 * Signature verification uses KASHIER_API_KEY + data.signatureKeys (fixed algorithm).
 */
export const handleKashierWebhook = async (req: Request, res: Response) => {
    // Kashier can send the payload nested under "data" or flat
    const webhookData: Record<string, any> = req.body?.data || req.body;

    // Signature can come from:
    //   1. webhookData.kashierSignature  (preferred — inside the payload)
    //   2. x-kashier-signature header
    //   3. top-level req.body.signature (older Kashier versions)
    const headerSignature =
        (req.headers["x-kashier-signature"] as string) ||
        (req.headers["signature"] as string) ||
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
        throw new BadRequest("Webhook signature is required.");
    }

    // Look up restaurant to check if CUSTOM gateway credentials should be used
    let customApiKey: string | undefined = undefined;
    if (orderId) {
        const [matchedOrder] = await db
            .select({ id: orders.id, restaurantId: orders.restaurantId })
            .from(orders)
            .where(eq(orders.id, String(orderId)))
            .limit(1);

        if (matchedOrder?.restaurantId) {
            const [settings] = await db
                .select({ paymentGatewayType: restaurantSettings.paymentGatewayType })
                .from(restaurantSettings)
                .where(eq(restaurantSettings.restaurantId, matchedOrder.restaurantId))
                .limit(1);

            if (settings?.paymentGatewayType === "CUSTOM") {
                const [customCred] = await db
                    .select()
                    .from(restaurantPaymentCredentials)
                    .where(
                        and(
                            eq(restaurantPaymentCredentials.restaurantId, matchedOrder.restaurantId),
                            eq(restaurantPaymentCredentials.provider, "KASHIER"),
                            eq(restaurantPaymentCredentials.isActive, true)
                        )
                    )
                    .limit(1);

                if (customCred?.credentials && (customCred.credentials as any).apiKey) {
                    customApiKey = decryptSecret((customCred.credentials as any).apiKey);
                }
            }
        }
    }

    let isValid = verifyKashierWebhookSignature(webhookData, headerSignature, customApiKey);
    if (!isValid && customApiKey) {
        // Fallback to platform key in case transaction was processed through platform
        isValid = verifyKashierWebhookSignature(webhookData, headerSignature);
    }

    if (!isValid) {
        console.error("⚠️ Invalid Kashier webhook signature received.");
        throw new BadRequest("Invalid webhook signature.");
    }

    // ─── Process payment result ───────────────────────────────────────────────
    if (orderId && (paymentStatus === "SUCCESS" || paymentStatus === "CAPTURED" || paymentStatus === "PAID")) {
        // FIX #2: Verify the webhook amount matches the order total before
        // marking as paid, so a forged/mismatched amount in an otherwise
        // validly-signed payload can't silently short-change the restaurant.
        if (webhookAmount !== undefined) {
            const [orderForAmountCheck] = await db
                .select({ totalAmount: orders.totalAmount })
                .from(orders)
                .where(eq(orders.id, String(orderId)))
                .limit(1);

            if (orderForAmountCheck) {
                const expectedAmount = parseFloat(orderForAmountCheck.totalAmount as string);
                // Compare with a small epsilon to tolerate floating point formatting differences
                if (Math.abs(expectedAmount - webhookAmount) > 0.01) {
                    console.error(
                        `[Kashier Webhook] Amount mismatch for order ${orderId}. Expected ${expectedAmount}, got ${webhookAmount}.`
                    );
                    throw new BadRequest("Paid amount does not match the order total.");
                }
            }
        }

        await KashierService.markOrderAsPaid(String(orderId), transactionId);
        console.log(`[Kashier Webhook] Order ${orderId} marked as paid. Tx: ${transactionId}`);
    } else if (orderId && (paymentStatus === "FAILED" || paymentStatus === "DECLINED" || paymentStatus === "REJECTED")) {
        // Mark payment failed
        try {
            await db
                .update(orders)
                .set({
                    paymentStatus: "payment_failed",
                    paymentGateway: "kashier",
                    paymentTransactionId: transactionId || null,
                } as any)
                .where(eq(orders.id, String(orderId)));

            console.log(`[Kashier Webhook] Order ${orderId} payment failed. Tx: ${transactionId}`);
        } catch (dbErr) {
            console.error(`[Kashier Webhook] Failed to mark order ${orderId} as payment_failed:`, dbErr);
        }
    } else {
        console.log(`[Kashier Webhook] Unhandled status "${paymentStatus}" for order ${orderId} — no DB change.`);
    }

    return SuccessResponse(res, {
        received: true,
        message: "Webhook processed successfully",
    });
};