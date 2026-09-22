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
     */
    static async createPaymentSession(input) {
        const config = (0, kashier_1.getKashierConfig)();
        const currency = (input.currency || "EGP").toUpperCase();
        const amount = input.amount.toFixed(2);
        if (!config.mid || !config.apiKey || !config.secretKey) {
            throw new Errors_1.BadRequest("Kashier credentials (KASHIER_MID, KASHIER_API_KEY, or KASHIER_SECRET_KEY) are missing in environment variables.");
        }
        // Session expires in 24 hours from now
        const expireAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        // Redirect URL after Kashier hosted checkout completes
        const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
        const merchantRedirect = `${appBaseUrl}/payment/result`;
        const body = {
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
            // Kashier requires customer field on every session
            customer: {
                email: input.customerEmail || "customer@example.com",
                reference: `CUST-${input.orderId}`,
            },
        };
        console.log(`[Kashier Session] Creating session for order ${input.orderId}, amount: ${amount} ${currency}`);
        try {
            const response = await axios_1.default.post(`${config.baseUrl}/v3/payment/sessions`, body, {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: config.secretKey, // Raw secretKey without "Bearer " prefix
                    "api-key": config.apiKey, // Separate required header
                },
                timeout: 15000,
            });
            const data = response.data;
            if (!data?.sessionUrl) {
                throw new Errors_1.BadRequest("Kashier did not return a session URL. Check your merchant credentials and environment.");
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
     * Executes a server-to-server Direct Charge request to Kashier.
     */
    static async executeDirectCharge(input) {
        const config = (0, kashier_1.getKashierConfig)();
        const currency = (input.currency || "EGP").toUpperCase();
        const amount = typeof input.amount === "number" ? input.amount.toFixed(2) : String(input.amount);
        const orderIdStr = String(input.orderId);
        // Security check: Verify order exists in DB
        const [existingOrder] = await connection_1.db
            .select()
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderIdStr))
            .limit(1);
        if (!existingOrder) {
            throw new Errors_1.NotFound(`Order with ID ${orderIdStr} was not found.`);
        }
        // 1. Generate Order Hash
        const hash = (0, kashier_1.generateKashierOrderHash)({
            mid: config.mid,
            orderId: orderIdStr,
            amount: amount,
            currency: currency,
        });
        // 2. Safe log (never logs CVV or full card number)
        console.log(`[Kashier Direct Charge] Order: ${orderIdStr}, Card: ${(0, kashier_1.maskCardNumber)(input.cardNumber)}, Amount: ${amount} ${currency}`);
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
            const response = await axios_1.default.post(targetUrl, payload, {
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
            if (paymentStatus === "3DS_REQUIRED" ||
                paymentStatus === "REDIRECT" ||
                resData.redirectUrl ||
                resData.response?.redirectUrl) {
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
                const transactionId = resData.transactionId ||
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
            throw new Errors_1.BadRequest(errMsg);
        }
        catch (error) {
            if (error instanceof Errors_1.BadRequest || error instanceof Errors_1.NotFound) {
                throw error;
            }
            const axiosErr = error;
            const errorMsg = axiosErr.response?.data?.message ||
                axiosErr.response?.data?.response?.message ||
                axiosErr.message ||
                "Failed to communicate with Kashier payment gateway.";
            console.error(`[Kashier Charge Error] Order: ${orderIdStr}:`, errorMsg);
            throw new Errors_1.BadRequest(`Payment failed: ${errorMsg}`);
        }
    }
    /**
     * Updates order status in the database after successful payment confirmation.
     */
    static async markOrderAsPaid(orderId, transactionId) {
        try {
            // Find or link payment method for Visa/Digital
            const [digitalMethod] = await connection_1.db
                .select()
                .from(schema_1.paymentMethods)
                .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%visa%"), (0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%card%"), (0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%digital%")))
                .limit(1);
            const updateData = {
                status: "accepted", // Automatically accept order once online payment succeeds
            };
            if (digitalMethod) {
                updateData.paymentMethod = digitalMethod.id;
            }
            await connection_1.db
                .update(schema_1.orders)
                .set(updateData)
                .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
            console.log(`[Kashier Order Updated] Order ${orderId} marked as accepted. Tx: ${transactionId || "N/A"}`);
        }
        catch (dbErr) {
            console.error(`[Kashier Order Update Error] Failed to update order ${orderId}:`, dbErr);
        }
    }
}
exports.KashierService = KashierService;
