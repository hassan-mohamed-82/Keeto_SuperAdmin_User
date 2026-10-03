"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymobService = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const BadRequest_1 = require("../../../Errors/BadRequest");
class PaymobService {
    static buildBillingData(input) {
        const { customer } = input;
        const firstName = customer.firstName || "Customer";
        const lastName = customer.lastName || "User";
        const email = customer.email || "customer@example.com";
        const phone = (customer.phone || "+201000000000").replace(/\s+/g, "");
        return {
            apartment: "NA",
            email,
            floor: "NA",
            first_name: firstName,
            street: "NA",
            building: "NA",
            phone_number: phone,
            shipping_method: "NA",
            postal_code: "NA",
            city: "Cairo",
            country: "EG",
            last_name: lastName,
            state: "Cairo",
            ...(input.billingData || {}),
        };
    }
    // =====================================================================
    // الطريقة الحديثة: Intention API — خطوة واحدة بـ secretKey في الهيدر
    // =====================================================================
    static async createIntention(input) {
        const { credentials, orderId, amountCents, currency = "EGP", customer } = input;
        const firstName = customer.firstName || "Customer";
        const lastName = customer.lastName || "User";
        const email = customer.email || "customer@example.com";
        const billingData = this.buildBillingData(input);
        try {
            const response = await axios_1.default.post(this.INTENTION_URL, {
                amount: Math.round(amountCents),
                currency: currency.toUpperCase(),
                payment_methods: [Number(credentials.integrationId)],
                items: [],
                billing_data: billingData,
                customer: {
                    first_name: firstName,
                    last_name: lastName,
                    email,
                },
                special_reference: orderId,
                notification_url: input.notificationUrl || credentials.callbackUrl,
                redirection_url: input.redirectionUrl,
            }, {
                headers: {
                    Authorization: `Token ${credentials.secretKey}`,
                    "Content-Type": "application/json",
                },
                timeout: 15000,
            });
            const data = response.data;
            const clientSecret = data?.client_secret;
            const intentionId = data?.id;
            const paymobOrderId = data?.intention_order_id ?? data?.order?.id;
            if (!clientSecret || !intentionId) {
                throw new BadRequest_1.BadRequest("Paymob Intention API did not return a client_secret/id.");
            }
            return { intentionId, clientSecret, paymobOrderId };
        }
        catch (error) {
            if (error instanceof BadRequest_1.BadRequest)
                throw error;
            console.error("[Paymob Intention Error] status:", error.response?.status);
            console.error("[Paymob Intention Error] response body:", JSON.stringify(error.response?.data));
            const msg = error.response?.data?.detail ||
                JSON.stringify(error.response?.data) ||
                error.message ||
                "Paymob intention creation failed";
            throw new BadRequest_1.BadRequest(`Paymob intention failed: ${msg}`);
        }
    }
    static buildUnifiedCheckoutUrl(publicKey, clientSecret) {
        return `${this.UNIFIED_CHECKOUT_BASE}?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(clientSecret)}`;
    }
    // =====================================================================
    // الطريقة القديمة: auth/tokens -> ecommerce/orders -> acceptance/payment_keys
    // (apiKey + iframeId). fallback للحسابات اللي auth/tokens شغالة معاها بالـ
    // apiKey العادي، ومفيهاش secretKey/publicKey أصلًا.
    // =====================================================================
    static async getAuthToken(apiKey) {
        try {
            const response = await axios_1.default.post(`${this.BASE_URL}/auth/tokens`, { api_key: apiKey }, { headers: { "Content-Type": "application/json" }, timeout: 15000 });
            const token = response.data?.token;
            if (!token)
                throw new BadRequest_1.BadRequest("Failed to obtain Paymob authentication token.");
            return token;
        }
        catch (error) {
            if (error instanceof BadRequest_1.BadRequest)
                throw error;
            console.error("[Paymob Auth Error] status:", error.response?.status);
            console.error("[Paymob Auth Error] response body:", JSON.stringify(error.response?.data));
            const msg = error.response?.data?.detail ||
                JSON.stringify(error.response?.data) ||
                error.message ||
                "Paymob authentication failed";
            throw new BadRequest_1.BadRequest(`Paymob auth failed: ${msg}`);
        }
    }
    static async createOrder(authToken, merchantOrderId, amountCents, currency = "EGP") {
        try {
            const response = await axios_1.default.post(`${this.BASE_URL}/ecommerce/orders`, {
                auth_token: authToken,
                delivery_needed: false,
                amount_cents: String(Math.round(amountCents)),
                currency: currency.toUpperCase(),
                merchant_order_id: merchantOrderId,
                items: [],
            }, { headers: { "Content-Type": "application/json" }, timeout: 15000 });
            const paymobOrderId = response.data?.id;
            if (!paymobOrderId)
                throw new BadRequest_1.BadRequest("Failed to register order on Paymob.");
            return paymobOrderId;
        }
        catch (error) {
            if (error instanceof BadRequest_1.BadRequest)
                throw error;
            const msg = error.response?.data?.message || error.message || "Paymob order registration failed";
            console.error("[Paymob Order Error]:", msg);
            throw new BadRequest_1.BadRequest(`Paymob order creation failed: ${msg}`);
        }
    }
    static async getPaymentKey(authToken, paymobOrderId, integrationId, amountCents, billingData, currency = "EGP") {
        try {
            const response = await axios_1.default.post(`${this.BASE_URL}/acceptance/payment_keys`, {
                auth_token: authToken,
                amount_cents: String(Math.round(amountCents)),
                expiration: 3600,
                order_id: paymobOrderId,
                billing_data: billingData,
                currency: currency.toUpperCase(),
                integration_id: Number(integrationId),
                lock_order_when_paid: true,
            }, { headers: { "Content-Type": "application/json" }, timeout: 15000 });
            const paymentKey = response.data?.token;
            if (!paymentKey)
                throw new BadRequest_1.BadRequest("Failed to obtain Paymob payment key.");
            return paymentKey;
        }
        catch (error) {
            if (error instanceof BadRequest_1.BadRequest)
                throw error;
            const msg = error.response?.data?.message || error.message || "Paymob payment key generation failed";
            console.error("[Paymob Payment Key Error]:", msg);
            throw new BadRequest_1.BadRequest(`Paymob payment key failed: ${msg}`);
        }
    }
    static buildIframeUrl(iframeId, paymentToken) {
        return `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${paymentToken}`;
    }
    static async createLegacySession(input) {
        const { credentials, orderId, orderNumber, amountCents, currency = "EGP" } = input;
        const billingData = this.buildBillingData(input);
        const authToken = await this.getAuthToken(credentials.apiKey);
        // Always use the UUID (orderId) as merchant_order_id so Paymob echoes back
        // the real UUID in the callback — NOT the orderNumber (ORD-xxx).
        // This ensures the redirect handler can find the order by orders.id only.
        const paymobOrderId = await this.createOrder(authToken, orderId, amountCents, currency);
        const paymentKey = await this.getPaymentKey(authToken, paymobOrderId, credentials.integrationId, amountCents, billingData, currency);
        const sessionUrl = this.buildIframeUrl(credentials.iframeId, paymentKey);
        return {
            sessionId: String(paymobOrderId),
            sessionUrl,
            paymobOrderId,
        };
    }
    // =====================================================================
    // نقطة الدخول الموحدة: بتختار الطريقة المناسبة حسب المفاتيح المتاحة فعليًا.
    // متستخدمش secretKey/publicKey أبدًا لو مش موجودين — بترجع للطريقة القديمة.
    // =====================================================================
    static async createPaymentSession(input) {
        const { credentials } = input;
        if (!credentials.integrationId) {
            throw new BadRequest_1.BadRequest("Paymob integrationId is missing from credentials.");
        }
        const hasIntentionCreds = Boolean(credentials.secretKey && credentials.publicKey);
        const hasLegacyCreds = Boolean(credentials.apiKey && credentials.iframeId);
        if (hasIntentionCreds) {
            const { intentionId, clientSecret, paymobOrderId } = await this.createIntention(input);
            return {
                sessionId: intentionId,
                sessionUrl: this.buildUnifiedCheckoutUrl(credentials.publicKey, clientSecret),
                paymobOrderId,
                intentionId,
                clientSecret,
            };
        }
        if (hasLegacyCreds) {
            return await this.createLegacySession(input);
        }
        throw new BadRequest_1.BadRequest("Paymob credentials are incomplete. Provide either (secretKey + publicKey) for the modern flow, " +
            "or (apiKey + iframeId) for the legacy flow.");
    }
    /**
     * Verify Paymob Webhook HMAC signature according to official specification.
     * نفس المنطق بغض النظر عن الطريقة اللي اتعملت بيها الجلسة (Intention أو Legacy)،
     * لأن شكل الـ transaction callback واحد في الحالتين.
     */
    static verifyHmac(transactionObj, hmacSecret, receivedHmac) {
        if (!hmacSecret || !receivedHmac) {
            return false;
        }
        const PAYMOB_HMAC_FIELDS = [
            "amount_cents",
            "created_at",
            "currency",
            "error_occured",
            "has_parent_transaction",
            "id",
            "integration_id",
            "is_3d_secure",
            "is_auth",
            "is_capture",
            "is_refunded",
            "is_standalone_payment",
            "is_voided",
            "order.id",
            "owner",
            "pending",
            "source_data.pan",
            "source_data.sub_type",
            "source_data.type",
            "success",
        ];
        const getNestedValue = (payload, path) => path.split(".").reduce((current, key) => (current == null ? undefined : current[key]), payload);
        const stringifyValue = (value) => {
            if (value === null || value === undefined) {
                return "";
            }
            if (typeof value === "boolean") {
                return value ? "true" : "false";
            }
            return String(value);
        };
        const payloadString = PAYMOB_HMAC_FIELDS.map((field) => stringifyValue(getNestedValue(transactionObj, field))).join("");
        const calculatedHmac = crypto_1.default
            .createHmac("sha512", hmacSecret)
            .update(payloadString)
            .digest("hex");
        try {
            const calculatedBuf = Buffer.from(calculatedHmac.toLowerCase(), "utf8");
            const receivedBuf = Buffer.from(receivedHmac.toLowerCase(), "utf8");
            if (calculatedBuf.length !== receivedBuf.length) {
                return false;
            }
            return crypto_1.default.timingSafeEqual(calculatedBuf, receivedBuf);
        }
        catch {
            return false;
        }
    }
}
exports.PaymobService = PaymobService;
PaymobService.BASE_URL = "https://accept.paymob.com/api";
PaymobService.INTENTION_URL = "https://accept.paymob.com/v1/intention/";
PaymobService.UNIFIED_CHECKOUT_BASE = "https://accept.paymob.com/unifiedcheckout/";
// import axios from "axios";
// import crypto from "crypto";
// import { BadRequest } from "../../../Errors/BadRequest";
// import { PaymobCredentials } from "../../../models/schema/admin/restaurantPaymentCredentials";
// export interface CreatePaymobSessionInput {
//     credentials: PaymobCredentials;
//     orderId: string;
//     orderNumber: string;
//     amountCents: number;
//     currency?: string;
//     customer: {
//         firstName?: string;
//         lastName?: string;
//         email?: string;
//         phone?: string;
//     };
//     billingData?: Record<string, any>;
//     notificationUrl?: string;
//     redirectionUrl?: string;
// }
// export interface PaymobSessionResponse {
//     sessionId: string;       // = intention id, نفس المفهوم القديم بتاع sessionId
//     sessionUrl: string;      // رابط Unified Checkout الجاهز للـ redirect
//     paymobOrderId: number;   // Paymob order id (بييجي في transaction callback)
//     intentionId: string;
//     clientSecret: string;
// }
// export class PaymobService {
//     // FIX: الـ base URL بتاع الـ Intention API (v1)، مختلف عن /api القديم
//     private static readonly INTENTION_URL = "https://accept.paymob.com/v1/intention/";
//     private static readonly UNIFIED_CHECKOUT_BASE = "https://accept.paymob.com/unifiedcheckout/";
//     /**
//      * Create Intention API — خطوة واحدة بس بدل التلات خطوات القديمة
//      * (auth/tokens -> ecommerce/orders -> acceptance/payment_keys).
//      * الـ auth هنا بيتم بالـ secret_key مباشرة في الهيدر، مفيش auth_token منفصل.
//      */
//     static async createIntention(input: CreatePaymobSessionInput): Promise<{
//         intentionId: string;
//         clientSecret: string;
//         paymobOrderId: number;
//     }> {
//         const { credentials,orderId, amountCents, currency = "EGP", customer } = input;
//         if (!credentials.secretKey) {
//             throw new BadRequest(
//                 "Paymob secretKey is missing. Add secretKey (sk_test_... / sk_live_...) to this restaurant's Paymob credentials."
//             );
//         }
//         if (!credentials.integrationId) {
//             throw new BadRequest("Paymob integrationId is missing from credentials.");
//         }
//         const firstName = customer.firstName || "Customer";
//         const lastName = customer.lastName || "User";
//         const email = customer.email || "customer@example.com";
//         const phone = (customer.phone || "+201000000000").replace(/\s+/g, "");
//         const billingData = {
//             apartment: "NA",
//             email,
//             floor: "NA",
//             first_name: firstName,
//             street: "NA",
//             building: "NA",
//             phone_number: phone,
//             shipping_method: "NA",
//             postal_code: "NA",
//             city: "Cairo",
//             country: "EG",
//             last_name: lastName,
//             state: "Cairo",
//             ...(input.billingData || {}),
//         };
//         try {
//             const response = await axios.post(
//                 this.INTENTION_URL,
//                 {
//                     amount: Math.round(amountCents), // بالقروش/السنتات، زي القديم
//                     currency: currency.toUpperCase(),
//                     payment_methods: [Number(credentials.integrationId)],
//                     items: [],
//                     billing_data: billingData,
//                     customer: {
//                         first_name: firstName,
//                         last_name: lastName,
//                         email,
//                     },
//                     special_reference: orderId,
//                     notification_url: input.notificationUrl || credentials.callbackUrl,
//                     redirection_url: input.redirectionUrl,
//                 },
//                 {
//                     headers: {
//                         Authorization: `Token ${credentials.secretKey}`,
//                         "Content-Type": "application/json",
//                     },
//                     timeout: 15000,
//                 }
//             );
//             const data = response.data;
//             const clientSecret = data?.client_secret;
//             const intentionId = data?.id;
//             const paymobOrderId = data?.intention_order_id ?? data?.order?.id;
//             if (!clientSecret || !intentionId) {
//                 throw new BadRequest("Paymob Intention API did not return a client_secret/id.");
//             }
//             return { intentionId, clientSecret, paymobOrderId };
//         } catch (error: any) {
//             if (error instanceof BadRequest) throw error;
//             // FIX: زي التشخيص اللي عملناه قبل كده — نطبع الـ response body الكامل
//             // عشان أي خطأ يبان سببه الحقيقي (مش نص عام بيخفي التفاصيل).
//             console.error("[Paymob Intention Error] status:", error.response?.status);
//             console.error("[Paymob Intention Error] response body:", JSON.stringify(error.response?.data));
//             const msg =
//                 error.response?.data?.detail ||
//                 JSON.stringify(error.response?.data) ||
//                 error.message ||
//                 "Paymob intention creation failed";
//             throw new BadRequest(`Paymob intention failed: ${msg}`);
//         }
//     }
//     /**
//      * Unified Checkout URL — الصفحة اللي المستخدم هيتوجه لها يدفع فيها
//      */
//     static buildUnifiedCheckoutUrl(publicKey: string, clientSecret: string): string {
//         return `${this.UNIFIED_CHECKOUT_BASE}?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(clientSecret)}`;
//     }
//     /**
//      * Complete Session Flow (الاسم اتسيب زي ما هو عشان الـ caller في checkout
//      * controller مايتغيّرش كتير، بس المحتوى بقى Intention API مش الـ 3 خطوات)
//      */
//     static async createPaymentSession(input: CreatePaymobSessionInput): Promise<PaymobSessionResponse> {
//         if (!input.credentials.publicKey) {
//             throw new BadRequest(
//                 "Paymob publicKey is missing. Add publicKey (pk_test_... / pk_live_...) to this restaurant's Paymob credentials."
//             );
//         }
//         const { intentionId, clientSecret, paymobOrderId } = await this.createIntention(input);
//         const sessionUrl = this.buildUnifiedCheckoutUrl(input.credentials.publicKey, clientSecret);
//         return {
//             sessionId: intentionId,
//             sessionUrl,
//             paymobOrderId,
//             intentionId,
//             clientSecret,
//         };
//     }
//     /**
//      * Verify Paymob Webhook HMAC signature according to official specification.
//      * ملحوظة: ده بيفضل شغال زي ما هو — الـ transaction callback (notification_url)
//      * بيرجع بنفس الشكل القديم بالظبط سواء الجلسة اتعملت بالـ Intention API
//      * أو الـ flow القديم، فمفيش تغيير مطلوب هنا.
//      */
//     static verifyHmac(transactionObj: Record<string, any>, hmacSecret: string, receivedHmac: string): boolean {
//         if (!hmacSecret || !receivedHmac) {
//             return false;
//         }
//         const PAYMOB_HMAC_FIELDS = [
//             "amount_cents",
//             "created_at",
//             "currency",
//             "error_occured",
//             "has_parent_transaction",
//             "id",
//             "integration_id",
//             "is_3d_secure",
//             "is_auth",
//             "is_capture",
//             "is_refunded",
//             "is_standalone_payment",
//             "is_voided",
//             "order.id",
//             "owner",
//             "pending",
//             "source_data.pan",
//             "source_data.sub_type",
//             "source_data.type",
//             "success",
//         ] as const;
//         const getNestedValue = (payload: Record<string, any>, path: string): any =>
//             path.split(".").reduce<any>((current, key) => (current == null ? undefined : current[key]), payload);
//         const stringifyValue = (value: unknown): string => {
//             if (value === null || value === undefined) {
//                 return "";
//             }
//             if (typeof value === "boolean") {
//                 return value ? "true" : "false";
//             }
//             return String(value);
//         };
//         const payloadString = PAYMOB_HMAC_FIELDS.map((field) =>
//             stringifyValue(getNestedValue(transactionObj, field))
//         ).join("");
//         const calculatedHmac = crypto
//             .createHmac("sha512", hmacSecret)
//             .update(payloadString)
//             .digest("hex");
//         try {
//             const calculatedBuf = Buffer.from(calculatedHmac.toLowerCase(), "utf8");
//             const receivedBuf = Buffer.from(receivedHmac.toLowerCase(), "utf8");
//             if (calculatedBuf.length !== receivedBuf.length) {
//                 return false;
//             }
//             return crypto.timingSafeEqual(calculatedBuf, receivedBuf);
//         } catch {
//             return false;
//         }
//     }
// }
