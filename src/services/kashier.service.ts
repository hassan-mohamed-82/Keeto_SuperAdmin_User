import axios, { AxiosError } from "axios";
import { db } from "../models/connection";
import { orders, paymentMethods } from "../models/schema";
import { eq, like, or } from "drizzle-orm";
import { BadRequest, NotFound } from "../Errors";
import {
    getKashierConfig,
    generateKashierOrderHash,
    maskCardNumber,
} from "../utils/kashier";

export interface DirectChargeInput {
    orderId: string | number;
    amount: string | number;
    currency?: string;
    cardNumber: string;
    expiryMonth: string;
    expiryYear: string;
    cvv: string;
    cardHolderName: string;
    saveCard?: boolean;
}

export interface ChargeResponse {
    status: "SUCCESS" | "3DS_REQUIRED" | "FAILED";
    transactionId?: string;
    orderId: string | number;
    redirectUrl?: string;
    message?: string;
    data?: any;
}

// ──────────────────────────────────────────────────────
// Kashier Payment Sessions API types
// ──────────────────────────────────────────────────────

export interface CreateSessionInput {
    orderId: string;
    amount: number;
    currency?: string;
    customerEmail?: string;
}

export interface PaymentSessionResponse {
    sessionId: string;
    sessionUrl: string;
    status: string;
    orderId: string;
    amount: string;
    currency: string;
    expireAt: string;
}


export class KashierService {
    /**
     * Creates a hosted payment session via Kashier Payment Sessions API.
     * POST {baseUrl}/v3/payment/sessions
     *
     * Returns a `sessionUrl` that the client should redirect to (web)
     * or open in a WebView (mobile). Kashier handles all card input & 3DS.
     */
    static async createPaymentSession(input: CreateSessionInput): Promise<PaymentSessionResponse> {
        const config = getKashierConfig();
        const currency = (input.currency || "EGP").toUpperCase();
        const amount = input.amount.toFixed(2);

        if (!config.mid || !config.secretKey) {
            throw new BadRequest(
                "Kashier KASHIER_MID or KASHIER_SECRET_KEY is missing in environment variables."
            );
        }

        // Session expires in 24 hours from now
        const expireAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        // Redirect URL after Kashier hosted checkout completes
        const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
        const merchantRedirect = `${appBaseUrl}/payment/result`;

        const body: Record<string, unknown> = {
            merchantId: config.mid,
            order: input.orderId,
            amount,
            currency,
            expireAt,
            merchantRedirect,
            paymentType: "one-time",
            type: "one-time",
            display: "en",
            maxFailureAttempts: 3,
            allowedMethods: "card,wallet",
        };

        if (input.customerEmail) {
            body.customer = { email: input.customerEmail };
        }

        console.log(`[Kashier Session] Creating session for order ${input.orderId}, amount: ${amount} ${currency}`);

        try {
            const response = await axios.post(
                `${config.baseUrl}/v3/payment/sessions`,
                body,
                {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${config.secretKey}`,
                    },
                    timeout: 15000,
                }
            );

            const data = response.data;

            if (!data?.sessionUrl) {
                throw new BadRequest(
                    "Kashier did not return a session URL. Check your merchant credentials and environment."
                );
            }

            console.log(`[Kashier Session] Created: ${data._id}, expires: ${data.expireAt}`);

            return {
                sessionId: data._id,
                sessionUrl: data.sessionUrl,
                status: data.status || "CREATED",
                orderId: input.orderId,
                amount,
                currency,
                expireAt: data.expireAt || expireAt,
            };
        } catch (error: unknown) {
            if (error instanceof BadRequest) throw error;

            const axiosErr = error as AxiosError<{ message?: string; error?: string }>;
            const errMsg =
                axiosErr.response?.data?.message ||
                axiosErr.response?.data?.error ||
                axiosErr.message ||
                "Failed to create Kashier payment session.";

            console.error(`[Kashier Session Error] Order ${input.orderId}:`, errMsg);
            throw new BadRequest(`Payment session creation failed: ${errMsg}`);
        }
    }

    /**
     * Executes a server-to-server Direct Charge request to Kashier.

     */
    static async executeDirectCharge(input: DirectChargeInput): Promise<ChargeResponse> {
        const config = getKashierConfig();
        const currency = (input.currency || "EGP").toUpperCase();
        const amount = typeof input.amount === "number" ? input.amount.toFixed(2) : String(input.amount);
        const orderIdStr = String(input.orderId);

        // Security check: Verify order exists in DB
        const [existingOrder] = await db
            .select()
            .from(orders)
            .where(eq(orders.id, orderIdStr))
            .limit(1);

        if (!existingOrder) {
            throw new NotFound(`Order with ID ${orderIdStr} was not found.`);
        }

        // 1. Generate Order Hash
        const hash = generateKashierOrderHash({
            mid: config.mid,
            orderId: orderIdStr,
            amount: amount,
            currency: currency,
        });

        // 2. Safe log (never logs CVV or full card number)
        console.log(
            `[Kashier Direct Charge] Order: ${orderIdStr}, Card: ${maskCardNumber(input.cardNumber)}, Amount: ${amount} ${currency}`
        );

        // 3. Prepare payload for Kashier API
        const payload = {
            payment: {
                mid: config.mid,
                amount: amount,
                currency: currency,
                orderId: orderIdStr,
                hash: hash,
            },
            card: {
                number: input.cardNumber.replace(/\s+/g, ""),
                expiryMonth: input.expiryMonth,
                expiryYear: input.expiryYear,
                cvv: input.cvv,
                cardHolderName: input.cardHolderName,
            },
            saveCard: !!input.saveCard,
        };

        const targetUrl = `${config.baseUrl}/checkout`;

        try {
            const response = await axios.post(targetUrl, payload, {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: config.apiKey,
                    "api-key": config.apiKey,
                },
                timeout: 30000,
            });

            const resData = response.data || {};
            const paymentStatus = (resData.status || resData.response?.status || "").toUpperCase();

            // 4. Handle 3DS Redirection
            if (
                paymentStatus === "3DS_REQUIRED" ||
                paymentStatus === "REDIRECT" ||
                resData.redirectUrl ||
                resData.response?.redirectUrl
            ) {
                const redirectUrl = resData.redirectUrl || resData.response?.redirectUrl;
                return {
                    status: "3DS_REQUIRED",
                    orderId: orderIdStr,
                    redirectUrl: redirectUrl,
                    message: "3D Secure OTP verification required.",
                    data: resData,
                };
            }

            // 5. Handle Direct Success
            if (paymentStatus === "SUCCESS" || resData.success === true) {
                const transactionId =
                    resData.transactionId ||
                    resData.response?.transactionId ||
                    resData.response?.cardTransactionId ||
                    `KSH-${Date.now()}`;

                await this.markOrderAsPaid(orderIdStr, transactionId);

                return {
                    status: "SUCCESS",
                    orderId: orderIdStr,
                    transactionId: transactionId,
                    message: "Payment processed and order confirmed successfully.",
                    data: resData,
                };
            }

            // Otherwise failure
            const errMsg = resData.message || resData.response?.message || "Payment transaction was declined.";
            throw new BadRequest(errMsg);
        } catch (error: any) {
            if (error instanceof BadRequest || error instanceof NotFound) {
                throw error;
            }

            const axiosErr = error as AxiosError<any>;
            const errorMsg =
                axiosErr.response?.data?.message ||
                axiosErr.response?.data?.response?.message ||
                axiosErr.message ||
                "Failed to communicate with Kashier payment gateway.";

            console.error(`[Kashier Charge Error] Order: ${orderIdStr}:`, errorMsg);
            throw new BadRequest(`Payment failed: ${errorMsg}`);
        }
    }

    /**
     * Updates order status in the database after successful payment confirmation.
     */
    static async markOrderAsPaid(orderId: string, transactionId?: string): Promise<void> {
        try {
            // Find or link payment method for Visa/Digital
            const [digitalMethod] = await db
                .select()
                .from(paymentMethods)
                .where(or(like(paymentMethods.name, "%visa%"), like(paymentMethods.name, "%card%"), like(paymentMethods.name, "%digital%")))
                .limit(1);

            const updateData: Record<string, any> = {
                status: "accepted", // Automatically accept order once online payment succeeds
            };

            if (digitalMethod) {
                updateData.paymentMethod = digitalMethod.id;
            }

            await db
                .update(orders)
                .set(updateData)
                .where(eq(orders.id, orderId));

            console.log(`[Kashier Order Updated] Order ${orderId} marked as accepted. Tx: ${transactionId || "N/A"}`);
        } catch (dbErr) {
            console.error(`[Kashier Order Update Error] Failed to update order ${orderId}:`, dbErr);
        }
    }
}
