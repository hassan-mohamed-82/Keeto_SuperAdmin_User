import { Request, Response } from "express";
import { SuccessResponse } from "../utils/response";
import { BadRequest } from "../Errors";
import {
    getKashierConfig,
    generateKashierOrderHash,
    verifyKashierWebhookSignature,
} from "../utils/kashier";
import { KashierService } from "../services/kashier.service";
import { db } from "../models/connection";
import { orders, users } from "../models/schema";
import { eq } from "drizzle-orm";


/**
 * Controller: Generate Order Hash
 * Endpoint: POST /api/payments/kashier/hash
 */
export const generateOrderHash = async (req: Request, res: Response) => {
    const { orderId, amount, currency = "EGP" } = req.body;
    const config = getKashierConfig();

    if (!config.mid || !config.apiKey) {
        throw new BadRequest("Kashier merchant configuration is missing. Please check server environment.");
    }

    const hash = generateKashierOrderHash({
        mid: config.mid,
        orderId,
        amount,
        currency,
    });

    return SuccessResponse(res, {
        hash,
        mid: config.mid,
        orderId,
        amount: typeof amount === "number" ? amount.toFixed(2) : String(amount),
        currency: currency.toUpperCase(),
        mode: config.mode,
    });
};

/**
 * Controller: Create Kashier Payment Session
 * Endpoint: POST /api/payments/kashier/session
 *
 * Calls Kashier POST /v3/payment/sessions and returns { sessionId, sessionUrl, expireAt }.
 * The client should redirect (web) or open a WebView (mobile) to sessionUrl.
 * Kashier handles all card input, 3DS verification, and redirects back via merchantRedirect.
 */
export const generatePaymentSession = async (req: Request, res: Response) => {
    let { orderId, amount, currency = "EGP", customerEmail } = req.body;

    // Check order in database to fetch amount and customer details if not supplied
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

    return SuccessResponse(res, session);
};

/**
 * Controller: Process Direct Card Charge
 * Endpoint: POST /api/payments/kashier/charge
 */
export const processDirectCharge = async (req: Request, res: Response) => {
    const {
        orderId,
        amount,
        currency = "EGP",
        cardNumber,
        expiryMonth,
        expiryYear,
        cvv,
        cardHolderName,
        saveCard,
    } = req.body;

    const chargeResult = await KashierService.executeDirectCharge({
        orderId,
        amount,
        currency,
        cardNumber,
        expiryMonth,
        expiryYear,
        cvv,
        cardHolderName,
        saveCard,
    });

    return SuccessResponse(res, chargeResult);
};

/**
 * Controller: Handle Kashier Webhooks
 * Endpoint: POST /api/payments/kashier/webhook
 */
export const handleKashierWebhook = async (req: Request, res: Response) => {
    const signature =
        (req.headers["x-kashier-signature"] as string) ||
        (req.headers["signature"] as string) ||
        req.body?.signature;

    const webhookData = req.body?.data || req.body;

    console.log("[Kashier Webhook Received]:", {
        event: req.body?.event || "PAYMENT_STATUS",
        orderId: webhookData?.orderId || webhookData?.merchantOrderId,
        status: webhookData?.status,
    });

    // Verify webhook signature if signature is provided
    if (signature) {
        const isValid = verifyKashierWebhookSignature(webhookData, signature);
        if (!isValid) {
            console.error("⚠️ Invalid Kashier webhook signature received.");
            throw new BadRequest("Invalid webhook signature.");
        }
    }

    const orderId = webhookData?.orderId || webhookData?.merchantOrderId;
    const paymentStatus = (webhookData?.status || "").toUpperCase();
    const transactionId = webhookData?.transactionId || webhookData?.kashierTransactionId;

    if (orderId && (paymentStatus === "SUCCESS" || paymentStatus === "CAPTURED")) {
        await KashierService.markOrderAsPaid(String(orderId), transactionId);
    }

    return SuccessResponse(res, {
        received: true,
        message: "Webhook processed successfully",
    });
};
