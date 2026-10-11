"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeideaService = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const BadRequest_1 = require("../../../Errors/BadRequest");
const Safedecrypt_1 = require("../../../utils/Safedecrypt");
class GeideaService {
    /**
     * Resolve Geidea API base URL based on credentials or environment
     */
    static getBaseUrl(environment) {
        return this.DEFAULT_BASE_URL;
    }
    /**
     * Create Geidea Hosted Payment Session
     * POST /payment-intent/api/v2/direct/session
     */
    static async createPaymentSession(input) {
        const { credentials, orderId, orderNumber, amount, currency = "EGP", customer, language = "ar" } = input;
        if (!credentials.publicKey) {
            throw new BadRequest_1.BadRequest("Geidea publicKey is missing from credentials.");
        }
        if (!credentials.apiPassword) {
            throw new BadRequest_1.BadRequest("Geidea apiPassword is missing from credentials.");
        }
        // Decrypt apiPassword stored in database
        const plainApiPassword = (0, Safedecrypt_1.safeDecrypt)(credentials.apiPassword);
        const baseUrl = this.getBaseUrl(credentials.environment);
        const endpoint = `${baseUrl}/payment-intent/api/v2/direct/session`;
        const authString = `${credentials.publicKey}:${plainApiPassword}`;
        const basicAuth = Buffer.from(authString).toString("base64");
        const normalizedCurrency = currency.toUpperCase();
        const formattedAmount = Number(amount.toFixed(2)).toFixed(2);
        const timestamp = new Date().toISOString();
        const signaturePayload = `${credentials.publicKey}${formattedAmount}${normalizedCurrency}${orderId}${timestamp}`;
        const signature = crypto_1.default
            .createHmac("sha256", plainApiPassword)
            .update(signaturePayload)
            .digest("base64");
        const payload = {
            amount: Number(formattedAmount),
            currency: normalizedCurrency,
            timestamp,
            merchantReferenceId: orderId,
            signature,
            callbackUrl: input.callbackUrl || credentials.callbackUrl,
            returnUrl: input.returnUrl || credentials.returnUrl,
            customer: {
                firstName: customer.name || "Customer",
                email: customer.email || "customer@example.com",
                phoneNumber: (customer.phone || "+201000000000").replace(/\s+/g, ""),
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
            // 1. Prefer returning the sessionUrl directly provided by Geidea API if present
            let sessionUrl = data?.sessionUrl || data?.session?.url || data?.hppUrl;
            // 2. Correct HPP format: https://www.merchant.geidea.net/hpp/checkout/?{sessionId}
            if (!sessionUrl) {
                sessionUrl = `${this.DEFAULT_HPP_URL}?${sessionId}`;
            }
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
     * Fetch session details from Geidea API (Backend GET request)
     * GET /payment-intent/api/v2/direct/session/{sessionId}
     */
    static async getSessionDetails(credentials, sessionId) {
        const plainApiPassword = (0, Safedecrypt_1.safeDecrypt)(credentials.apiPassword);
        const baseUrl = this.getBaseUrl(credentials.environment);
        const endpoint = `${baseUrl}/payment-intent/api/v2/direct/session/${sessionId}`;
        const authString = `${credentials.publicKey}:${plainApiPassword}`;
        const basicAuth = Buffer.from(authString).toString("base64");
        const response = await axios_1.default.get(endpoint, {
            headers: {
                Authorization: `Basic ${basicAuth}`,
            },
            timeout: 15000,
        });
        return response.data;
    }
    /**
     * Verify Geidea Webhook / Callback Signature
     */
    static verifySignature(publicKey, apiPassword, orderId, status, amount, receivedSignature) {
        if (!receivedSignature)
            return true;
        try {
            const plainApiPassword = (0, Safedecrypt_1.safeDecrypt)(apiPassword);
            const dataToSign = `${publicKey}${orderId}${status}${amount}${plainApiPassword}`;
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
