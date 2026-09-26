import axios, { AxiosError } from "axios";
import { db } from "../../../models/connection";
import { orders, paymentMethods } from "../../../models/schema";
import { eq, like, or } from "drizzle-orm";
import { BadRequest } from "../../../Errors";
import { getKashierConfig } from "./kashier";

// ──────────────────────────────────────────────────────
// Kashier Payment Sessions API types
// ──────────────────────────────────────────────────────

export interface CreateSessionInput {
    orderId: string;
    amount: number;
    currency?: string;
    customerEmail?: string;
    credentials?: {
        mid: string;
        apiKey: string;
        secretKey?: string;
        baseUrl?: string;
    };
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
     *
     * Also persists the Kashier sessionId to the order row immediately
     * so the session is never lost even if the client disconnects.
     */
    static async createPaymentSession(input: CreateSessionInput): Promise<PaymentSessionResponse> {
        const sysConfig = getKashierConfig();
        const mid = input.credentials?.mid || sysConfig.mid;
        const apiKey = input.credentials?.apiKey || sysConfig.apiKey;
        const secretKey = input.credentials?.secretKey || sysConfig.secretKey;
        const baseUrl = input.credentials?.baseUrl || sysConfig.baseUrl;

        const currency = (input.currency || "EGP").toUpperCase();
        const amount = input.amount.toFixed(2);

        if (!mid || !apiKey) {
            throw new BadRequest(
                "Kashier credentials (KASHIER_MID or KASHIER_API_KEY) are missing or incomplete."
            );
        }

        // Session expires in 24 hours from now
        const expireAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        // Redirect URL after Kashier hosted checkout completes
        const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
        const backendBaseUrl = (process.env.Back_BASE_URL || "").replace(/\/$/, "");

        const merchantRedirect = `${appBaseUrl}/payment/result`;
        const serverWebhook = backendBaseUrl ? `${backendBaseUrl}/api/payments/kashier/webhook` : undefined;

        const body: Record<string, unknown> = {
            merchantId: mid,
            order: input.orderId,
            amount,
            currency,
            expireAt,
            merchantRedirect,
            ...(serverWebhook ? { serverWebhook } : {}),
            paymentType: "one-time",
            type: "one-time",
            display: "en",
            maxFailureAttempts: 3,
            allowedMethods: "card,wallet",
            // Kashier requires customer field on every session
            customer: {
                email: input.customerEmail || "customer@example.com",
                reference: `CUST-${input.orderId}`,
            },
        };

        console.log(`[Kashier Session] Creating session for order ${input.orderId}, amount: ${amount} ${currency}, serverWebhook: ${serverWebhook || "NOT SET"}`);

        const requestHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            "api-key": apiKey,
        };
        if (secretKey) {
            requestHeaders["Authorization"] = secretKey;
        }

        try {
            const response = await axios.post(
                `${baseUrl}/v3/payment/sessions`,
                body,
                {
                    headers: requestHeaders,
                    timeout: 15000,
                }
            );

            const data = response.data;

            if (!data?.sessionUrl) {
                throw new BadRequest(
                    "Kashier did not return a session URL. Check your merchant credentials and environment."
                );
            }

            const sessionId: string = data._id || data.sessionId || "";
            console.log(`[Kashier Session] Created: ${sessionId}, expires: ${data.expireAt}`);

            // 🔒 Persist Kashier sessionId to the order row immediately so it is
            //    never lost regardless of what the client does next.
            if (input.orderId && sessionId) {
                try {
                    await db
                        .update(orders)
                        .set({
                            paymentGateway: "kashier",
                            paymentOrderId: sessionId,   // Kashier session ID acts as the "order" reference
                            paymentStatus: "pending_payment",
                        })
                        .where(eq(orders.id, input.orderId));

                    console.log(`[Kashier Session] Saved sessionId "${sessionId}" to order ${input.orderId}.`);
                } catch (dbErr) {
                    // Log but do not fail — the session URL is still usable
                    console.error(`[Kashier Session] Failed to persist sessionId to order ${input.orderId}:`, dbErr);
                }
            }

            return {
                sessionId,
                sessionUrl: data.sessionUrl,
                status: data.status || "CREATED",
                orderId: input.orderId,
                amount,
                currency,
                expireAt: data.expireAt || expireAt,
            };
        } catch (error: unknown) {
            if (error instanceof BadRequest) throw error;

            const axiosErr = error as AxiosError<{ message?: string; error?: unknown }>;

            // FIX: axiosErr.response.data.error can be an OBJECT (Kashier
            const rawMessage = axiosErr.response?.data?.message;
            const rawError = axiosErr.response?.data?.error;
            let errMsg: string;
            if (typeof rawMessage === "string" && rawMessage) {
                errMsg = rawMessage;
            } else if (typeof rawError === "string" && rawError) {
                errMsg = rawError;
            } else if (rawError !== undefined) {
                errMsg = JSON.stringify(rawError);
            } else if (axiosErr.response?.data) {
                errMsg = JSON.stringify(axiosErr.response.data);
            } else {
                errMsg = axiosErr.message || "Failed to create Kashier payment session.";
            }

            console.error(
                `[Kashier Session Error] Order ${input.orderId}: status=${axiosErr.response?.status}`,
                JSON.stringify(axiosErr.response?.data)
            );
            throw new BadRequest(`Payment session creation failed: ${errMsg}`);
        }
    }

    /**
     * Updates order status in the database after a successful Kashier payment confirmation.
     *
     * Fixes applied:
     * - Sets `paymentStatus: "paid"` (was missing — only `status` was being set).
     * - Saves `paymentTransactionId` (the Kashier transactionId).
     * - Sets `paymentGateway: "kashier"` for traceability.
     * - Keeps idempotency: if already paid, skip silently.
     */
    static async markOrderAsPaid(orderId: string, transactionId?: string): Promise<void> {
        try {
            // Idempotency: skip if already paid
            const [existingOrder] = await db
                .select({ id: orders.id, paymentStatus: orders.paymentStatus })
                .from(orders)
                .where(eq(orders.id, orderId))
                .limit(1);

            if (!existingOrder) {
                console.warn(`[Kashier markOrderAsPaid] Order ${orderId} not found.`);
                return;
            }

            if (existingOrder.paymentStatus === "paid") {
                console.log(`[Kashier markOrderAsPaid] Order ${orderId} already paid — skipping.`);
                return;
            }

            // Find Kashier / digital payment method record
            const [digitalMethod] = await db
                .select()
                .from(paymentMethods)
                .where(
                    or(
                        like(paymentMethods.name, "%kashier%"),
                        like(paymentMethods.name, "%visa%"),
                        like(paymentMethods.name, "%card%"),
                        like(paymentMethods.name, "%digital%")
                    )
                )
                .limit(1);

            const updateData: Record<string, any> = {
                paymentStatus: "paid",
                paymentGateway: "kashier",
                status: "pending",
            };

            if (transactionId) {
                updateData.paymentTransactionId = transactionId;
            }

            if (digitalMethod) {
                updateData.paymentMethod = digitalMethod.id;
            }

            await db
                .update(orders)
                .set(updateData)
                .where(eq(orders.id, orderId));

            console.log(
                `[Kashier Order Updated] Order ${orderId} → paymentStatus: paid, status: accepted, gateway: kashier. Tx: ${transactionId || "N/A"}`
            );
        } catch (dbErr) {
            console.error(`[Kashier Order Update Error] Failed to update order ${orderId}:`, dbErr);
        }
    }
}