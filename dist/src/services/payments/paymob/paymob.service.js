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
    /**
     * Step 1: Authenticate with Paymob using apiKey to obtain an auth_token
     */
    static async getAuthToken(apiKey) {
        try {
            const response = await axios_1.default.post(`${this.BASE_URL}/auth/tokens`, { api_key: apiKey }, {
                headers: { "Content-Type": "application/json" },
                timeout: 15000,
            });
            const token = response.data?.token;
            if (!token) {
                throw new BadRequest_1.BadRequest("Failed to obtain Paymob authentication token.");
            }
            return token;
        }
        catch (error) {
            if (error instanceof BadRequest_1.BadRequest)
                throw error;
            const msg = error.response?.data?.detail || error.message || "Paymob authentication failed";
            console.error("[Paymob Auth Error]:", msg);
            throw new BadRequest_1.BadRequest(`Paymob auth failed: ${msg}`);
        }
    }
    /**
     * Step 2: Register Order on Paymob
     */
    static async createOrder(authToken, merchantOrderId, amountCents, currency = "EGP") {
        try {
            const response = await axios_1.default.post(`${this.BASE_URL}/ecommerce/orders`, {
                auth_token: authToken,
                delivery_needed: false,
                amount_cents: String(Math.round(amountCents)),
                currency: currency.toUpperCase(),
                merchant_order_id: merchantOrderId,
                items: [],
            }, {
                headers: { "Content-Type": "application/json" },
                timeout: 15000,
            });
            const paymobOrderId = response.data?.id;
            if (!paymobOrderId) {
                throw new BadRequest_1.BadRequest("Failed to register order on Paymob.");
            }
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
    /**
     * Step 3: Generate Payment Key Token
     */
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
            }, {
                headers: { "Content-Type": "application/json" },
                timeout: 15000,
            });
            const paymentKey = response.data?.token;
            if (!paymentKey) {
                throw new BadRequest_1.BadRequest("Failed to obtain Paymob payment key.");
            }
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
    /**
     * Helper to build hosted iframe URL
     */
    static buildIframeUrl(iframeId, paymentToken) {
        return `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${paymentToken}`;
    }
    /**
     * Complete Session Flow: Auth -> Create Order -> Payment Key -> Return hosted sessionUrl
     */
    static async createPaymentSession(input) {
        const { credentials, orderId, orderNumber, amountCents, currency = "EGP", customer } = input;
        const firstName = customer.firstName || "Customer";
        const lastName = customer.lastName || "User";
        const email = customer.email || "customer@example.com";
        const phone = (customer.phone || "+201000000000").replace(/\s+/g, "");
        const billingData = {
            apartment: "NA",
            email: email,
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
        const authToken = await this.getAuthToken(credentials.apiKey);
        const paymobOrderId = await this.createOrder(authToken, orderNumber || orderId, amountCents, currency);
        const paymentKey = await this.getPaymentKey(authToken, paymobOrderId, credentials.integrationId, amountCents, billingData, currency);
        const sessionUrl = this.buildIframeUrl(credentials.iframeId, paymentKey);
        return {
            sessionId: String(paymobOrderId),
            sessionUrl,
            paymobOrderId,
            paymentKey,
            iframeId: credentials.iframeId,
        };
    }
    /**
     * Verify Paymob Webhook HMAC signature according to official specification
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
