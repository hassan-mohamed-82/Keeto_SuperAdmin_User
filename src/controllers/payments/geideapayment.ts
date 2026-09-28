import { Request, Response } from "express";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";
import { GeideaService } from "../../services/payments/geidea/geidea.service";
import { db } from "../../models/connection";
import { orders, users, restaurantPaymentCredentials, restaurantSettings } from "../../models/schema";
import { eq, or, and } from "drizzle-orm";
import { safeDecrypt } from "../../utils/Safedecrypt";
import { getActiveCustomGateway } from "../../utils/getActiveCustomGateway";
import { confirmOrderPayment, recordFailedPayment } from "../../helpers/orderPaymentConfirmation";

/**
 * Controller: Create Geidea Payment Session
 * Endpoint: POST /api/payments/geidea/session
 */
export const generateGeideaPaymentSession = async (req: Request, res: Response) => {
    let { orderId, amount, currency = "EGP", customerEmail } = req.body;

    if (!orderId) {
        throw new BadRequest("orderId is required to create a Geidea session.");
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

    let customerName = "Customer";
    let customerPhone = "+201000000000";

    if (existingOrder.userId) {
        const [customer] = await db
            .select({
                email: users.email,
                name: users.name,
                phone: users.phone,
            })
            .from(users)
            .where(eq(users.id, existingOrder.userId))
            .limit(1);

        if (customer) {
            if (!customerEmail && customer.email) customerEmail = customer.email;
            if (customer.name) customerName = customer.name;
            if (customer.phone) customerPhone = customer.phone;
        }
    }

    if (!amount || isNaN(Number(amount))) {
        throw new BadRequest("Order amount is required or order does not exist.");
    }

    const [settings] = await db
        .select({ paymentGatewayType: restaurantSettings.paymentGatewayType })
        .from(restaurantSettings)
        .where(eq(restaurantSettings.restaurantId, existingOrder.restaurantId))
        .limit(1);

    if (settings?.paymentGatewayType !== "CUSTOM") {
        throw new BadRequest("This restaurant is not configured for a custom Geidea payment gateway.");
    }

    const activeGateway = await getActiveCustomGateway(existingOrder.restaurantId);

    if (!activeGateway) {
        throw new BadRequest("Restaurant is configured for custom gateway, but no active payment credentials were found.");
    }

    if (activeGateway.provider !== "GEIDEA") {
        throw new BadRequest(`This restaurant's active payment provider is ${activeGateway.provider}, not Geidea.`);
    }

    const rawCreds = activeGateway.record.credentials as any;
    const decryptedCredentials = {
        ...rawCreds,
        publicKey: rawCreds.publicKey,
        apiPassword: rawCreds.apiPassword ? safeDecrypt(rawCreds.apiPassword) : "",
        environment: rawCreds.environment,
    };

    const backendBaseUrl = (process.env.Back_BASE_URL || "").replace(/\/$/, "");
    const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

    const session = await GeideaService.createPaymentSession({
        credentials: decryptedCredentials,
        orderId: String(orderId),
        orderNumber: existingOrder.orderNumber || String(orderId),
        amount: typeof amount === "string" ? parseFloat(amount) : amount,
        currency,
        customer: {
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
        },
        callbackUrl: decryptedCredentials.callbackUrl || `${backendBaseUrl}/api/payments/geidea/webhook`,
        returnUrl: `${backendBaseUrl}/api/payments/geidea/callback`,
    });

    // Save session ID into order
    await db
        .update(orders)
        .set({
            paymentOrderId: String(session.sessionId),
            paymentGateway: "geidea",
            paymentStatus: "pending_payment",
        })
        .where(eq(orders.id, existingOrder.id));

    return SuccessResponse(res, {
        gateway: "GEIDEA",
        sessionId: session.sessionId,
        sessionUrl: session.sessionUrl,
        status: session.status,
    });
};

/**
 * Controller: Handle Geidea Webhook Notification
 * Endpoint: POST /api/payments/geidea/webhook
 */
export const handleGeideaWebhook = async (req: Request, res: Response) => {
    try {
        const payload = req.body || {};
        const orderData = payload.order || payload.data || payload;

        const merchantOrderId = payload.merchantReferenceId || orderData.merchantReferenceId || payload.orderId;
        const gatewayOrderId = String(payload.orderId || orderData.id || orderData.orderId || payload.sessionId || "");
        const transactionId = String(orderData.transactionId || payload.transactionId || gatewayOrderId);

        const responseCode = String(payload.responseCode || orderData.responseCode || "");
        const status = String(payload.status || orderData.status || "").toUpperCase();

        const isSuccess =
            responseCode === "000" ||
            status === "SUCCESS" ||
            status === "CAPTURED" ||
            status === "PAID";

        const isPending =
            status === "PENDING" ||
            status === "IN_PROGRESS";

        const webhookAmount = payload.amount !== undefined ? Number(payload.amount) : (orderData.amount !== undefined ? Number(orderData.amount) : undefined);

        console.log("[Geidea Webhook Received]:", {
            merchantOrderId,
            gatewayOrderId,
            transactionId,
            responseCode,
            status,
            isSuccess,
            isPending,
        });

        if (!merchantOrderId && !gatewayOrderId) {
            throw new BadRequest("No matching order identifier found in Geidea webhook payload.");
        }

        // Find matched order
        const [matchedOrder] = await db
            .select()
            .from(orders)
            .where(
                or(
                    merchantOrderId ? eq(orders.id, String(merchantOrderId)) : undefined,
                    gatewayOrderId ? eq(orders.paymentOrderId, gatewayOrderId) : undefined
                )
            )
            .limit(1);

        if (!matchedOrder) {
            console.warn(`[Geidea Webhook]: Order not found for gatewayOrderId: ${gatewayOrderId}, merchantOrderId: ${merchantOrderId}`);
            throw new NotFound("Order matching this Geidea transaction was not found.");
        }

        if (isSuccess) {
            if (webhookAmount !== undefined) {
                const expectedAmount = parseFloat(matchedOrder.totalAmount as string);
                if (Math.abs(expectedAmount - webhookAmount) > 0.01) {
                    console.error(
                        `[Geidea Webhook] Amount mismatch for order ${matchedOrder.id}. Expected ${expectedAmount}, got ${webhookAmount}.`
                    );
                    throw new BadRequest("Paid amount does not match the order total.");
                }
            }

            await confirmOrderPayment({
                orderId: matchedOrder.id,
                gateway: "geidea",
                transactionId: transactionId || undefined,
                gatewayOrderId: gatewayOrderId || undefined,
                rawPayload: payload,
            });

            console.log(`[Geidea Webhook] Order ${matchedOrder.orderNumber} confirmed as paid & accepted.`);
        } else if (!isPending) {
            const failureReason =
                payload.detailedResponseMessage ||
                payload.responseMessage ||
                payload.responseDescription ||
                orderData.detailedResponseMessage ||
                `Transaction failed with status ${status || responseCode}`;

            await recordFailedPayment({
                orderId: matchedOrder.id,
                gateway: "geidea",
                transactionId: transactionId || undefined,
                gatewayOrderId: gatewayOrderId || undefined,
                failureReason,
                rawPayload: payload,
            });

            console.log(`[Geidea Webhook] Order ${matchedOrder.orderNumber} recorded as payment_failed.`);
        }

        return res.status(200).json({ success: true, message: "Geidea webhook processed successfully" });
    } catch (error: any) {
        console.error("[Geidea Webhook Error]:", error);
        return res.status(error.statusCode || 400).json({
            success: false,
            message: error.message || "Failed to process Geidea webhook",
        });
    }
};

/**
 * Controller: Handle Geidea Browser Return Redirect
 * Endpoint: GET /api/payments/geidea/callback
 */
export const handleGeideaRedirect = async (req: Request, res: Response) => {
    try {
        const query = req.query as Record<string, string>;
        const responseCode = query.responseCode || query.ResponseCode;
        const merchantReferenceId = query.merchantReferenceId || query.orderId;
        const sessionId = query.sessionId || query.orderId;
        const callbackSlug = query.callbackSlug;

        console.log("[Geidea Redirect Callback]:", query);

        const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

        const isSuccess = responseCode === "000" || query.status === "Success" || query.status === "SUCCESS";

        let redirectUrl: string;
        if (callbackSlug) {
            redirectUrl = `${appBaseUrl}/profile?callbackSlug=${encodeURIComponent(callbackSlug)}&payment_status=${isSuccess ? "success" : "failed"}`;
        } else {
            redirectUrl = `${appBaseUrl}/payment/result?status=${isSuccess ? "success" : "failed"}&orderId=${encodeURIComponent(merchantReferenceId || "")}`;
        }

        if (merchantReferenceId && isSuccess) {
            // Confirm payment if not already confirmed by webhook
            try {
                await confirmOrderPayment({
                    orderId: String(merchantReferenceId),
                    gateway: "geidea",
                    transactionId: query.transactionId || sessionId,
                    gatewayOrderId: sessionId,
                    rawPayload: query,
                });
            } catch (confirmErr) {
                console.warn("[Geidea Redirect]: confirmOrderPayment background notice:", confirmErr);
            }
        }

        return res.redirect(redirectUrl);
    } catch (error: any) {
        console.error("[Geidea Redirect Error]:", error);
        const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
        return res.redirect(`${appBaseUrl}/payment/result?status=failed`);
    }
};
