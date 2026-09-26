import { Request, Response } from "express";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";
import { PaymobService } from "../../services/payments/paymob/paymob.service";
import { db } from "../../models/connection";
import { orders, restaurantPaymentCredentials, restaurantSettings, paymentMethods } from "../../models/schema";
import { eq, or, like, and } from "drizzle-orm";
import { safeDecrypt } from "../../utils/Safedecrypt";

import { getActiveCustomGateway } from "../../utils/getActiveCustomGateway";

/**
 * Controller: Handle Paymob Webhook POST Notification
 * Endpoint: POST /payments/paymob/webhook
 * Paymob sends webhook data with { type: "TRANSACTION", obj: { ... } }
 * and an HMAC in req.query.hmac or headers or req.body.hmac
 */
export const handlePaymobWebhook = async (req: Request, res: Response) => {
    try {
        const payload = req.body || {};
        const transactionObj = payload.obj || payload;

        const receivedHmac =
            (req.query.hmac as string) ||
            (req.headers["x-paymob-hmac"] as string) ||
            payload.hmac ||
            transactionObj.hmac;

        const merchantOrderId = transactionObj.order?.merchant_order_id;
        const paymobOrderId = String(transactionObj.order?.id || transactionObj.order_id || "");
        const transactionId = String(transactionObj.id || "");
        const isSuccess = Boolean(transactionObj.success === true || transactionObj.success === "true");
        const isPending = Boolean(transactionObj.pending === true || transactionObj.pending === "true");
        const amountCentsFromWebhook =
            transactionObj.amount_cents !== undefined ? Number(transactionObj.amount_cents) : undefined;

        console.log("[Paymob Webhook Received]:", {
            merchantOrderId,
            paymobOrderId,
            transactionId,
            isSuccess,
            pending: isPending,
        });

        if (!paymobOrderId && !merchantOrderId) {
            throw new BadRequest("No matching order identifier found in Paymob webhook payload.");
        }

        // 1. Locate the order in DB
        const [matchedOrder] = await db
            .select()
            .from(orders)
            .where(
                or(
                    paymobOrderId ? eq(orders.paymentOrderId, paymobOrderId) : undefined,
                    merchantOrderId ? eq(orders.id, merchantOrderId) : undefined,
                    merchantOrderId ? eq(orders.orderNumber, merchantOrderId) : undefined
                )
            )
            .limit(1);

        if (!matchedOrder) {
            console.warn(`[Paymob Webhook]: Order not found for paymobOrderId: ${paymobOrderId}, merchantOrderId: ${merchantOrderId}`);
            throw new NotFound("Order matching this Paymob transaction was not found.");
        }

        // 2. Fetch Restaurant Settings to determine gateway & HMAC secret
        let hmacSecret = "";

        const [settings] = await db
            .select()
            .from(restaurantSettings)
            .where(eq(restaurantSettings.restaurantId, matchedOrder.restaurantId))
            .limit(1);

        if (settings?.paymentGatewayType === "CUSTOM") {
            let credsRecord: typeof restaurantPaymentCredentials.$inferSelect | undefined;

            try {
                const activeGateway = await getActiveCustomGateway(matchedOrder.restaurantId);
                if (activeGateway && activeGateway.provider === "PAYMOB") {
                    credsRecord = activeGateway.record;
                }
            } catch (gatewayErr) {
                console.warn("[Paymob Webhook]: getActiveCustomGateway threw an error:", gatewayErr);
            }

            if (!credsRecord) {
                const [directRecord] = await db
                    .select()
                    .from(restaurantPaymentCredentials)
                    .where(
                        and(
                            eq(restaurantPaymentCredentials.restaurantId, matchedOrder.restaurantId),
                            eq(restaurantPaymentCredentials.provider, "PAYMOB"),
                            eq(restaurantPaymentCredentials.isActive, true)
                        )
                    )
                    .limit(1);
                credsRecord = directRecord;
            }

            if (!credsRecord) {
                console.error(`[Paymob Webhook]: No active Paymob credentials found for restaurant ${matchedOrder.restaurantId}`);
                throw new BadRequest("Restaurant Paymob credentials missing or inactive in database.");
            }

            let rawCreds: any = credsRecord.credentials;

            // Handle stringified or multiple-encoded JSON
            let attempts = 0;
            while (typeof rawCreds === "string" && attempts < 3) {
                try {
                    rawCreds = JSON.parse(rawCreds);
                } catch {
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
                } catch {}
            }

            const rawHmac = rawCreds?.hmac || rawCreds?.hmacSecret || rawCreds?.hmac_secret || rawCreds?.HMAC;
            if (!rawHmac) {
                console.error(
                    `[Paymob Webhook]: HMAC secret missing in Paymob credentials for restaurant ${matchedOrder.restaurantId}. Available keys:`,
                    typeof rawCreds === "object" && rawCreds !== null ? Object.keys(rawCreds) : typeof rawCreds
                );
                throw new BadRequest("Restaurant Paymob credentials or HMAC secret missing in database.");
            }

            hmacSecret = safeDecrypt(rawHmac);
        } else {
            hmacSecret = process.env.PLATFORM_PAYMOB_HMAC || "";
        }

        // 3. 🛡️ Strict HMAC Verification: MANDATORY (runs before idempotency check)
        if (!hmacSecret) {
            console.error("⚠️ Paymob HMAC secret is not configured. Cannot verify webhook safely.");
            throw new BadRequest("Payment gateway webhook verification secret is not configured.");
        }

        if (!receivedHmac) {
            console.error("⚠️ Webhook request is missing HMAC signature.");
            throw new BadRequest("HMAC signature is required for Paymob webhook verification.");
        }

        let isValid = PaymobService.verifyHmac(transactionObj, hmacSecret, receivedHmac);
        if (!isValid && process.env.PLATFORM_PAYMOB_HMAC && hmacSecret !== process.env.PLATFORM_PAYMOB_HMAC) {
            console.warn("[Paymob Webhook]: Custom HMAC verification failed. Attempting platform HMAC verification fallback.");
            isValid = PaymobService.verifyHmac(transactionObj, process.env.PLATFORM_PAYMOB_HMAC, receivedHmac);
        }

        if (!isValid) {
            console.error("⚠️ Invalid Paymob Webhook HMAC signature.");
            throw new BadRequest("Invalid HMAC signature.");
        }

        // 4. 🛡️ Idempotency check: If order is already marked as paid, return early to prevent duplicates
        if (matchedOrder.paymentStatus === "paid") {
            console.log(`[Paymob Webhook]: Order ${matchedOrder.orderNumber} is already marked as paid. Skipping duplicate processing.`);
            return SuccessResponse(res, {
                received: true,
                alreadyProcessed: true,
                message: "Order has already been processed and marked as paid.",
            });
        }

        // 5. Verify the paid amount matches the order total before trusting the webhook.
        if (isSuccess && amountCentsFromWebhook !== undefined) {
            const expectedCents = Math.round(parseFloat(matchedOrder.totalAmount as string) * 100);
            if (amountCentsFromWebhook !== expectedCents) {
                console.error(
                    `[Paymob Webhook]: Amount mismatch for order ${matchedOrder.orderNumber}. Expected ${expectedCents} cents, got ${amountCentsFromWebhook} cents.`
                );
                throw new BadRequest("Paid amount does not match the order total.");
            }
        }

        // 6. Update Order status based on transaction result
        if (isSuccess) {
            const [digitalMethod] = await db
                .select()
                .from(paymentMethods)
                .where(
                    or(
                        like(paymentMethods.name, "%visa%"),
                        like(paymentMethods.name, "%card%"),
                        like(paymentMethods.name, "%paymob%"),
                        like(paymentMethods.name, "%digital%")
                    )
                )
                .limit(1);

            const updateData: Record<string, any> = {
                paymentStatus: "paid",
                paymentGateway: "paymob",
                status: "accepted", // Order automatically accepted once payment confirmed
                paymentTransactionId: transactionId,
            };

            if (digitalMethod) {
                updateData.paymentMethod = digitalMethod.id;
            }

            await db
                .update(orders)
                .set(updateData)
                .where(eq(orders.id, matchedOrder.id));

            console.log(`[Paymob Webhook]: Order ${matchedOrder.orderNumber} successfully marked as PAID & ACCEPTED. Tx: ${transactionId}`);
        } else if (isPending) {
            await db
                .update(orders)
                .set({
                    paymentStatus: "pending_payment",
                    paymentGateway: "paymob",
                    paymentTransactionId: transactionId || null,
                })
                .where(eq(orders.id, matchedOrder.id));

            console.log(`[Paymob Webhook]: Order ${matchedOrder.orderNumber} payment PENDING. Tx: ${transactionId}`);
        } else {
            await db
                .update(orders)
                .set({
                    paymentStatus: "payment_failed",
                    paymentGateway: "paymob",
                    paymentTransactionId: transactionId || null,
                })
                .where(eq(orders.id, matchedOrder.id));

            console.log(`[Paymob Webhook]: Order ${matchedOrder.orderNumber} payment FAILED. Tx: ${transactionId}`);
        }

        return SuccessResponse(res, {
            received: true,
            message: "Paymob webhook processed successfully",
        });
    } catch (err) {
        console.error("[Paymob Webhook] UNCAUGHT ERROR:", err);
        throw err;
    }
};

/**
 * Controller: Handle browser redirection after user completes payment
 * Endpoint: GET /payments/paymob/callback
 * This route is ONLY a user browser redirect (like Kashier merchantRedirect), NOT for confirming payments!
 */
export const handlePaymobRedirect = (req: Request, res: Response) => {
    const success = req.query.success === "true";
    const orderId = req.query.merchant_order_id || req.query.order_id || "";
    const frontendBaseUrl = (process.env.APP_BASE_URL || process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

    const redirectUrl = `${frontendBaseUrl}/payment/result?success=${success}&orderId=${encodeURIComponent(String(orderId))}`;
    return res.redirect(redirectUrl);
};