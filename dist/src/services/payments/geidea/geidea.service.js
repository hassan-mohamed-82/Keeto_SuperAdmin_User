"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeideaService = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const BadRequest_1 = require("../../../Errors/BadRequest");
class GeideaService {
    /**
     * Resolve Geidea API base URL based on credentials or environment
     */
    static getBaseUrl(environment) {
        return this.DEFAULT_BASE_URL;
    }
    /**
     * Create Geidea Hosted Payment Session
     * POST /payment-intent/api/v1/direct/ecom/create-session
     */
    static async createPaymentSession(input) {
        const { credentials, orderId, orderNumber, amount, currency = "EGP", customer, language = "ar" } = input;
        if (!credentials.publicKey) {
            throw new BadRequest_1.BadRequest("Geidea publicKey is missing from credentials.");
        }
        if (!credentials.apiPassword) {
            throw new BadRequest_1.BadRequest("Geidea apiPassword is missing from credentials.");
        }
        const baseUrl = this.getBaseUrl(credentials.environment);
        const endpoint = `${baseUrl}/payment-intent/api/v1/direct/ecom/create-session`;
        const authString = `${credentials.publicKey}:${credentials.apiPassword}`;
        const basicAuth = Buffer.from(authString).toString("base64");
        const payload = {
            amount: Number(amount.toFixed(2)),
            currency: currency.toUpperCase(),
            merchantReferenceId: orderId,
            callbackUrl: input.callbackUrl || credentials.callbackUrl,
            returnUrl: input.returnUrl || credentials.returnUrl,
            customer: {
                name: customer.name || "Customer",
                email: customer.email || "customer@example.com",
                phone: (customer.phone || "+201000000000").replace(/\s+/g, ""),
            },
            language: language,
        };
        try {
            const response = await axios_1.default.post(endpoint, payload, {
                headers: {
                    Authorization: `Basic ${basicAuth}`,
                    "Content-Type": "application/json",
                },
                timeout: 15000,
            });
            const data = response.data;
            const sessionId = data?.session?.id || data?.sessionId || data?.id;
            if (!sessionId) {
                console.error("[Geidea Create Session Response Error]:", JSON.stringify(data));
                throw new BadRequest_1.BadRequest(data?.responseMessage ||
                    data?.detailedResponseMessage ||
                    "Geidea API did not return a valid session ID.");
            }
            const sessionUrl = `${this.DEFAULT_HPP_URL}?sessionId=${encodeURIComponent(sessionId)}`;
            return {
                sessionId,
                sessionUrl,
                orderId,
                status: data?.responseCode === "000" || data?.responseDescription === "Success" ? "CREATED" : (data?.status || "CREATED"),
                rawResponse: data,
            };
        }
        catch (error) {
            if (error instanceof BadRequest_1.BadRequest)
                throw error;
            console.error("[Geidea Create Session Error]:", error.response?.status, JSON.stringify(error.response?.data));
            const msg = error.response?.data?.detailedResponseMessage ||
                error.response?.data?.responseMessage ||
                error.response?.data?.message ||
                error.message ||
                "Failed to create Geidea payment session";
            throw new BadRequest_1.BadRequest(`Geidea session creation failed: ${msg}`);
        }
    }
    /**
     * Verify Geidea Webhook / Callback Signature (if provided by Geidea)
     */
    static verifySignature(publicKey, apiPassword, orderId, status, amount, receivedSignature) {
        if (!receivedSignature)
            return true; // if no signature provided, rely on direct verification or Basic Auth
        try {
            const dataToSign = `${publicKey}${orderId}${status}${amount}${apiPassword}`;
            const computedHash = crypto_1.default.createHash("sha256").update(dataToSign).digest("hex");
            return computedHash.toLowerCase() === receivedSignature.toLowerCase();
        }
        catch (err) {
            console.error("[Geidea verifySignature Error]:", err);
            return false;
        }
    }
}
exports.GeideaService = GeideaService;
GeideaService.DEFAULT_BASE_URL = "https://api.merchant.geidea.net";
GeideaService.DEFAULT_HPP_URL = "https://www.merchant.geidea.net/hpp/checkout/";
