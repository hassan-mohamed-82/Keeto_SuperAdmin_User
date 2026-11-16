import { Request, Response } from "express";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";
import { GeideaService } from "../../services/payments/geidea/geidea.service";
import { db } from "../../models/connection";
import { orders, users, restaurantPaymentCredentials, restaurantSettings, restaurants } from "../../models/schema";
import { eq, or, and } from "drizzle-orm";
import { safeDecrypt } from "../../utils/Safedecrypt";
import { getActiveCustomGateway } from "../../utils/getActiveCustomGateway";
import { getActivePlatformGateway } from "../../utils/getActivePlatformGateway";
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
        const detailedStatus = String(payload.detailedStatus || orderData.detailedStatus || "").toUpperCase();

        const isPending =
            status === "PENDING" ||
            status === "IN_PROGRESS" ||
            detailedStatus === "AWAITINGPAYMENT" ||
            detailedStatus === "INITIATED" ||
            detailedStatus === "PENDING";

        // في جيديا لا يعتبر الدفع ناجحاً إلا إذا تم التحصيل الفعلي وليس مجرد إرسال طلب الدفع للمحفظة
        const isSuccess =
            !isPending &&
            (status === "SUCCESS" || status === "CAPTURED" || status === "PAID" || detailedStatus === "PAID" || detailedStatus === "CAPTURED") &&
            (responseCode === "000" || responseCode === "");

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
        const sessionId = (query.sessionId || query.orderId || query.paymentOrderId) as string | undefined;
        const merchantReferenceId = (query.merchantReferenceId || query.orderId || query.merchant_order_id) as string | undefined;

        const rawOrderId = (
            req.query.merchant_order_id ||
            req.query.order_id ||
            req.query.order ||
            merchantReferenceId
        ) as string | undefined;

        let callbackSlug = req.query.callbackSlug as string | undefined;
        const frontendBaseUrl = (process.env.APP_BASE_URL || process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

        // Find the matched order
        const [matchedOrder] = await db
            .select({
                id: orders.id,
                restaurantId: orders.restaurantId,
                orderNumber: orders.orderNumber,
                paymentStatus: orders.paymentStatus,
                paymentOrderId: orders.paymentOrderId,
                totalAmount: orders.totalAmount,
                slug: restaurants.slug,
            })
            .from(orders)
            .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
            .where(
                or(
                    rawOrderId ? eq(orders.id, rawOrderId) : undefined,
                    sessionId ? eq(orders.paymentOrderId, sessionId) : undefined
                )
            )
            .limit(1);

        if (matchedOrder?.slug) {
            callbackSlug = matchedOrder.slug;
        }

        let isActuallyPaid = false;

        // 1. إذا كان الأوردر مؤكداً كمدفوع مسبقاً (عبر الـ Webhook مثلاً)
        if (matchedOrder?.paymentStatus === "paid") {
            isActuallyPaid = true;
        } else if (matchedOrder && (sessionId || matchedOrder.paymentOrderId)) {
            // 2. التحقق مباشرة من سيرفر جيديا (Server-to-Server) للتأكد من حالة الخصم الفعلي
            try {
                let geideaCreds: any = null;
                const activeGateway = await getActiveCustomGateway(matchedOrder.restaurantId);
                if (activeGateway && activeGateway.provider === "GEIDEA") {
                    geideaCreds = activeGateway.record.credentials;
                } else {
                    const platformGateway = await getActivePlatformGateway();
                    if (platformGateway && platformGateway.provider === "GEIDEA") {
                        geideaCreds = platformGateway.credentials;
                    }
                }

                if (geideaCreds) {
                    const sessionDetails = await GeideaService.getSessionDetails(
                        geideaCreds,
                        sessionId || matchedOrder.paymentOrderId!
                    );

                    const orderDetails = sessionDetails?.order || sessionDetails?.data || sessionDetails;
                    const detailedStatus = String(orderDetails?.detailedStatus || sessionDetails?.detailedStatus || "").toUpperCase();
                    const status = String(orderDetails?.status || sessionDetails?.status || "").toUpperCase();
                    const responseCode = String(orderDetails?.responseCode || sessionDetails?.responseCode || "");

                    // في جيديا الخصم الفعلي المؤكد يكون عند detailedStatus = PAID أو CAPTURED
                    if (
                        (detailedStatus === "PAID" || detailedStatus === "CAPTURED" || status === "PAID" || status === "CAPTURED") &&
                        (responseCode === "000" || responseCode === "")
                    ) {
                        isActuallyPaid = true;
                        const txnId = String(orderDetails?.transactionId || sessionDetails?.transactionId || sessionId);
                        await confirmOrderPayment({
                            orderId: matchedOrder.id,
                            gateway: "geidea",
                            transactionId: txnId,
                            gatewayOrderId: sessionId || matchedOrder.paymentOrderId || undefined,
                            rawPayload: sessionDetails,
                        });
                        console.log(`[Geidea Redirect]: Order ${matchedOrder.orderNumber} confirmed as paid via verified session details.`);
                    } else if (
                        detailedStatus === "EXPIRED" ||
                        detailedStatus === "FAILED" ||
                        detailedStatus === "CANCELLED" ||
                        status === "FAILED" ||
                        status === "EXPIRED"
                    ) {
                        const failureReason =
                            orderDetails?.detailedResponseMessage ||
                            sessionDetails?.detailedResponseMessage ||
                            sessionDetails?.responseMessage ||
                            `Transaction ${detailedStatus || status}`;

                        await recordFailedPayment({
                            orderId: matchedOrder.id,
                            gateway: "geidea",
                            transactionId: sessionId,
                            gatewayOrderId: sessionId || matchedOrder.paymentOrderId || undefined,
                            failureReason,
                            rawPayload: sessionDetails,
                        });
                        console.log(`[Geidea Redirect]: Order ${matchedOrder.orderNumber} recorded as payment_failed (${failureReason}).`);
                    } else {
                        console.log(`[Geidea Redirect]: Order ${matchedOrder.orderNumber} is still pending/unpaid (detailedStatus: ${detailedStatus || "N/A"}, status: ${status || "N/A"}).`);
                    }
                }
            } catch (err) {
                console.error("[Geidea Redirect]: Error querying session details from Geidea:", err);
            }
        }

        const redirectUrl = isActuallyPaid
            ? (callbackSlug
                ? `${frontendBaseUrl}/profile?callbackSlug=${encodeURIComponent(callbackSlug)}&success=true&orderId=${encodeURIComponent(String(rawOrderId || matchedOrder?.id || ""))}&gateway=geidea`
                : `${frontendBaseUrl}/payment/result?success=true&orderId=${encodeURIComponent(String(rawOrderId || matchedOrder?.id || ""))}&gateway=geidea`)
            : (callbackSlug
                ? `${frontendBaseUrl}/home/restaurants/${encodeURIComponent(callbackSlug)}/order?success=false&orderId=${encodeURIComponent(String(rawOrderId || matchedOrder?.id || ""))}&gateway=geidea`
                : `${frontendBaseUrl}/payment/result?success=false&orderId=${encodeURIComponent(String(rawOrderId || matchedOrder?.id || ""))}&gateway=geidea`);

        return res.redirect(redirectUrl);
    } catch (error: any) {
        console.error("[Geidea Redirect Error]:", error);
        const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
        return res.redirect(`${appBaseUrl}/payment/result?status=failed`);
    }
};
