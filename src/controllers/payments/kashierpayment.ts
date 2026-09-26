import { Request, Response } from "express";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors";
import { verifyKashierWebhookSignature } from "../../services/payments/kashier/kashier";
import { KashierService } from "../../services/payments/kashier/kashier.service";
import { db } from "../../models/connection";
import { orders, users, restaurantSettings } from "../../models/schema";
import { eq } from "drizzle-orm";
import { decryptSecret } from "../../utils/encryption";
import { getActiveCustomGateway } from "../../utils/getActiveCustomGateway";


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

    const orderId = webhookData?.orderId || webhookData?.merchantOrderId;
    const transactionId = webhookData?.transactionId || webhookData?.kashierTransactionId;
    const paymentStatus = (webhookData?.status || "").toUpperCase();
    const webhookAmount = webhookData?.amount !== undefined ? Number(webhookData.amount) : undefined;

    console.log("[Kashier Webhook Received]:", {
        event: req.body?.event || "PAYMENT_STATUS",
        orderId,
        transactionId,
        paymentStatus,
        hasHeaderSig: Boolean(headerSignature),
        signatureKeys: webhookData?.signatureKeys,
    });

    // ─── Signature Verification ───────────────────────────────────────────────
    if (!headerSignature) {
        console.error("⚠️ Kashier webhook has no x-kashier-signature header — rejecting.");
        throw new BadRequest("Webhook signature is required.");
    }

    // Look up restaurant to check if CUSTOM gateway credentials should be used.
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
                const activeGateway = await getActiveCustomGateway(matchedOrder.restaurantId);
                if (activeGateway?.provider === "KASHIER") {
                    const rawCreds = activeGateway.record.credentials as any;
                    if (rawCreds?.apiKey) {
                        customApiKey = decryptSecret(rawCreds.apiKey);
                    }
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
        // TEMP DEBUG: log what we computed vs what we got, to make the next
        // failure immediately diagnosable from the console without needing
        // to re-run the separate debug script.
        console.error("[Kashier Webhook] signatureKeys used:", webhookData?.signatureKeys);
        console.error("[Kashier Webhook] header signature received:", headerSignature);
        throw new BadRequest("Invalid webhook signature.");
    }

    // ─── Process payment result ───────────────────────────────────────────────
    if (orderId && (paymentStatus === "SUCCESS" || paymentStatus === "CAPTURED" || paymentStatus === "PAID")) {
        if (webhookAmount !== undefined) {
            const [orderForAmountCheck] = await db
                .select({ totalAmount: orders.totalAmount })
                .from(orders)
                .where(eq(orders.id, String(orderId)))
                .limit(1);

            if (orderForAmountCheck) {
                const expectedAmount = parseFloat(orderForAmountCheck.totalAmount as string);
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
        console.log(`[Kashier Webhook] Unhandled status "${paymentStatus}" for order ${orderId} — no DB change (this is expected/harmless for a "Test Webhook" click with no real order).`);
    }

    return SuccessResponse(res, {
        received: true,
        message: "Webhook processed successfully",
    });
};