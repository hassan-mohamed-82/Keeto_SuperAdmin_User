import { Request, Response } from "express";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";
import { PaymobService } from "../../services/payments/paymob/paymob.service";
import { db } from "../../models/connection";
import { orders, restaurantPaymentCredentials, restaurantSettings, paymentMethods } from "../../models/schema";
import { eq, or, like, and } from "drizzle-orm";
import { decryptSecret } from "../../utils/encryption";

/**
 * Controller: Handle Paymob Webhook POST Notification
 * Endpoint: POST /payments/paymob/webhook
 * Paymob sends webhook data with { type: "TRANSACTION", obj: { ... } }
 * and an HMAC in req.query.hmac or headers or req.body.hmac
 */
export const handlePaymobWebhook = async (req: Request, res: Response) => {
    const payload = req.body || {};
    const transactionObj = payload.obj || payload;

    const receivedHmac =
        (req.query.hmac as string) ||
        (req.headers["x-paymob-hmac"] as string) ||
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
        throw new BadRequest("No matching order identifier found in Paymob webhook payload.");
    }

    // 1. Locate the order in DB
    const [matchedOrder] = await db
        .select()
        .from(orders)
        .where(
            or(
                paymobOrderId ? eq(orders.paymobOrderId, paymobOrderId) : undefined,
                merchantOrderId ? eq(orders.id, merchantOrderId) : undefined,
                merchantOrderId ? eq(orders.orderNumber, merchantOrderId) : undefined
            )
        )
        .limit(1);

    if (!matchedOrder) {
        console.warn(`[Paymob Webhook]: Order not found for paymobOrderId: ${paymobOrderId}, merchantOrderId: ${merchantOrderId}`);
        throw new NotFound("Order matching this Paymob transaction was not found.");
    }

    // 2. 🛡️ Idempotency check: If order is already marked as paid, return early to prevent duplicates
    if (matchedOrder.paymentStatus === "paid") {
        console.log(`[Paymob Webhook]: Order ${matchedOrder.orderNumber} is already marked as paid. Skipping duplicate processing.`);
        return SuccessResponse(res, {
            received: true,
            alreadyProcessed: true,
            message: "Order has already been processed and marked as paid.",
        });
    }

    // 3. Fetch Restaurant Settings to determine gateway & HMAC secret
    let hmacSecret = "";

    const [settings] = await db
        .select()
        .from(restaurantSettings)
        .where(eq(restaurantSettings.restaurantId, matchedOrder.restaurantId))
        .limit(1);

    if (settings?.paymentGatewayType === "CUSTOM") {
        const [credsRecord] = await db
            .select()
            .from(restaurantPaymentCredentials)
            .where(
                and(
                    eq(restaurantPaymentCredentials.restaurantId, matchedOrder.restaurantId),
                    eq(restaurantPaymentCredentials.provider, "PAYMOB")
                )
            )
            .limit(1);

        if (!credsRecord || !credsRecord.credentials?.hmac) {
            throw new BadRequest("Restaurant Paymob credentials or HMAC secret missing in database.");
        }

        hmacSecret = decryptSecret(credsRecord.credentials.hmac);
    } else {
        hmacSecret = process.env.PLATFORM_PAYMOB_HMAC || "";
    }

    // 4. 🛡️ Strict HMAC Verification: MANDATORY
    if (!hmacSecret) {
        console.error("⚠️ Paymob HMAC secret is not configured. Cannot verify webhook safely.");
        throw new BadRequest("Payment gateway webhook verification secret is not configured.");
    }

    if (!receivedHmac) {
        console.error("⚠️ Webhook request is missing HMAC signature.");
        throw new BadRequest("HMAC signature is required for Paymob webhook verification.");
    }

    const isValid = PaymobService.verifyHmac(transactionObj, hmacSecret, receivedHmac);
    if (!isValid) {
        console.error("⚠️ Invalid Paymob Webhook HMAC signature.");
        throw new BadRequest("Invalid HMAC signature.");
    }

    // 5. Update Order status based on transaction result
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
            status: "accepted", // Order automatically accepted once payment confirmed
            paymobTransactionId: transactionId,
        };

        if (digitalMethod) {
            updateData.paymentMethod = digitalMethod.id;
        }

        await db
            .update(orders)
            .set(updateData)
            .where(eq(orders.id, matchedOrder.id));

        console.log(`[Paymob Webhook]: Order ${matchedOrder.orderNumber} successfully marked as PAID & ACCEPTED. Tx: ${transactionId}`);
    } else {
        await db
            .update(orders)
            .set({
                paymentStatus: "payment_failed",
                paymobTransactionId: transactionId || null,
            })
            .where(eq(orders.id, matchedOrder.id));

        console.log(`[Paymob Webhook]: Order ${matchedOrder.orderNumber} payment FAILED. Tx: ${transactionId}`);
    }

    return SuccessResponse(res, {
        received: true,
        message: "Paymob webhook processed successfully",
    });
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