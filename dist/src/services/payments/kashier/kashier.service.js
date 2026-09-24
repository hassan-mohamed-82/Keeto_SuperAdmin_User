"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KashierService = void 0;
const axios_1 = __importDefault(require("axios"));
const connection_1 = require("../../../models/connection");
const schema_1 = require("../../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const Errors_1 = require("../../../Errors");
const kashier_1 = require("./kashier");
class KashierService {
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
    static async createPaymentSession(input) {
        const sysConfig = (0, kashier_1.getKashierConfig)();
        const mid = input.credentials?.mid || sysConfig.mid;
        const apiKey = input.credentials?.apiKey || sysConfig.apiKey;
        const secretKey = input.credentials?.secretKey || sysConfig.secretKey;
        const baseUrl = input.credentials?.baseUrl || sysConfig.baseUrl;
        const currency = (input.currency || "EGP").toUpperCase();
        const amount = input.amount.toFixed(2);
        if (!mid || !apiKey) {
            throw new Errors_1.BadRequest("Kashier credentials (KASHIER_MID or KASHIER_API_KEY) are missing or incomplete.");
        }
        // Session expires in 24 hours from now
        const expireAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        // Redirect URL after Kashier hosted checkout completes
        const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
        const merchantRedirect = `${appBaseUrl}/payment/result`;
        const body = {
            merchantId: mid,
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
            // Kashier requires customer field on every session
            customer: {
                email: input.customerEmail || "customer@example.com",
                reference: `CUST-${input.orderId}`,
            },
        };
        console.log(`[Kashier Session] Creating session for order ${input.orderId}, amount: ${amount} ${currency}`);
        const requestHeaders = {
            "Content-Type": "application/json",
            "api-key": apiKey,
        };
        if (secretKey) {
            requestHeaders["Authorization"] = secretKey;
        }
        try {
            const response = await axios_1.default.post(`${baseUrl}/v3/payment/sessions`, body, {
                headers: requestHeaders,
                timeout: 15000,
            });
            const data = response.data;
            if (!data?.sessionUrl) {
                throw new Errors_1.BadRequest("Kashier did not return a session URL. Check your merchant credentials and environment.");
            }
            const sessionId = data._id || data.sessionId || "";
            console.log(`[Kashier Session] Created: ${sessionId}, expires: ${data.expireAt}`);
            // 🔒 Persist Kashier sessionId to the order row immediately so it is
            //    never lost regardless of what the client does next.
            if (input.orderId && sessionId) {
                try {
                    await connection_1.db
                        .update(schema_1.orders)
                        .set({
                        paymentGateway: "kashier",
                        paymentOrderId: sessionId, // Kashier session ID acts as the "order" reference
                        paymentStatus: "pending_payment",
                    })
                        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, input.orderId));
                    console.log(`[Kashier Session] Saved sessionId "${sessionId}" to order ${input.orderId}.`);
                }
                catch (dbErr) {
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
        }
        catch (error) {
            if (error instanceof Errors_1.BadRequest)
                throw error;
            const axiosErr = error;
            const errMsg = axiosErr.response?.data?.message ||
                axiosErr.response?.data?.error ||
                axiosErr.message ||
                "Failed to create Kashier payment session.";
            console.error(`[Kashier Session Error] Order ${input.orderId}:`, errMsg);
            throw new Errors_1.BadRequest(`Payment session creation failed: ${errMsg}`);
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
    static async markOrderAsPaid(orderId, transactionId) {
        try {
            // Idempotency: skip if already paid
            const [existingOrder] = await connection_1.db
                .select({ id: schema_1.orders.id, paymentStatus: schema_1.orders.paymentStatus })
                .from(schema_1.orders)
                .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId))
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
            const [digitalMethod] = await connection_1.db
                .select()
                .from(schema_1.paymentMethods)
                .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%kashier%"), (0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%visa%"), (0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%card%"), (0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%digital%")))
                .limit(1);
            const updateData = {
                // ✅ FIX #1: Update paymentStatus to "paid"
                paymentStatus: "paid",
                // ✅ FIX #2: Mark which gateway processed the payment
                paymentGateway: "kashier",
                // Automatically accept order once online payment succeeds
                status: "accepted",
            };
            // ✅ FIX #2: Save the Kashier transactionId (was only console.log'd before)
            if (transactionId) {
                updateData.paymentTransactionId = transactionId;
            }
            if (digitalMethod) {
                updateData.paymentMethod = digitalMethod.id;
            }
            await connection_1.db
                .update(schema_1.orders)
                .set(updateData)
                .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
            console.log(`[Kashier Order Updated] Order ${orderId} → paymentStatus: paid, status: accepted, gateway: kashier. Tx: ${transactionId || "N/A"}`);
        }
        catch (dbErr) {
            console.error(`[Kashier Order Update Error] Failed to update order ${orderId}:`, dbErr);
        }
    }
}
exports.KashierService = KashierService;
