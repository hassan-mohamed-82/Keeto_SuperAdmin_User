import axios from "axios";
import crypto from "crypto";
import { BadRequest } from "../../../Errors/BadRequest";
import { GeideaCredentials } from "../../../models/schema/admin/restaurantPaymentCredentials";
import { safeDecrypt } from "../../../utils/Safedecrypt";

export interface CreateGeideaSessionInput {
    credentials: GeideaCredentials;
    orderId: string;
    orderNumber: string;
    amount: number;
    currency?: string;
    customer: {
        name?: string;
        email?: string;
        phone?: string;
    };
    callbackUrl?: string;
    returnUrl?: string;
    language?: string;
}

export interface GeideaSessionResponse {
    sessionId: string;
    sessionUrl: string;
    orderId: string;
    status: string;
    rawResponse?: any;
}

export class GeideaService {
    private static readonly DEFAULT_BASE_URL = "https://api.merchant.geidea.net";
    private static readonly DEFAULT_HPP_URL = "https://www.merchant.geidea.net/hpp/checkout/";

    /**
     * Resolve Geidea API base URL based on credentials or environment
     */
    private static getBaseUrl(environment?: string): string {
        return this.DEFAULT_BASE_URL;
    }

    /**
     * Create Geidea Hosted Payment Session
     * POST /payment-intent/api/v1/direct/session
     */
    static async createPaymentSession(input: CreateGeideaSessionInput): Promise<GeideaSessionResponse> {
        const { credentials, orderId, orderNumber, amount, currency = "EGP", customer, language = "ar" } = input;

        if (!credentials.publicKey) {
            throw new BadRequest("Geidea publicKey is missing from credentials.");
        }
        if (!credentials.apiPassword) {
            throw new BadRequest("Geidea apiPassword is missing from credentials.");
        }

        // Decrypt apiPassword stored in database
        const plainApiPassword = safeDecrypt(credentials.apiPassword);

        const baseUrl = this.getBaseUrl(credentials.environment);
        const endpoint = `${baseUrl}/payment-intent/api/v1/direct/session`;

        const authString = `${credentials.publicKey}:${plainApiPassword}`;
        const basicAuth = Buffer.from(authString).toString("base64");
        const normalizedCurrency = currency.toUpperCase();

        const payload = {
            amount: Number(amount.toFixed(2)),
            currency: normalizedCurrency,
            merchantReferenceId: orderId,
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
            const response = await axios.post(endpoint, payload, {
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
                throw new BadRequest(
                    data?.responseMessage ||
                    data?.detailedResponseMessage ||
                    "Geidea API did not return a valid session ID."
                );
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
        } catch (error: any) {
            if (error instanceof BadRequest) throw error;
            console.error("[Geidea Create Session Error]:", error.response?.status, JSON.stringify(error.response?.data));
            const msg =
                error.response?.data?.detailedResponseMessage ||
                error.response?.data?.responseMessage ||
                error.response?.data?.message ||
                error.message ||
                "Failed to create Geidea payment session";
            throw new BadRequest(`Geidea session creation failed: ${msg}`);
        }
    }

    /**
     * Fetch session details from Geidea API (Backend GET request)
     * GET /payment-intent/api/v1/direct/session/{sessionId}
     */
    static async getSessionDetails(credentials: GeideaCredentials, sessionId: string) {
        const plainApiPassword = safeDecrypt(credentials.apiPassword);
        const baseUrl = this.getBaseUrl(credentials.environment);
        const endpoint = `${baseUrl}/payment-intent/api/v1/direct/session/${sessionId}`;

        const authString = `${credentials.publicKey}:${plainApiPassword}`;
        const basicAuth = Buffer.from(authString).toString("base64");

        const response = await axios.get(endpoint, {
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
    static verifySignature(
        publicKey: string,
        apiPassword: string,
        orderId: string,
        status: string,
        amount: number | string,
        receivedSignature?: string
    ): boolean {
        if (!receivedSignature) return true;

        try {
            const plainApiPassword = safeDecrypt(apiPassword);
            const dataToSign = `${publicKey}${orderId}${status}${amount}${plainApiPassword}`;
            const computedHash = crypto.createHash("sha256").update(dataToSign).digest("hex");
            return computedHash.toLowerCase() === receivedSignature.toLowerCase();
        } catch (err) {
            console.error("[Geidea verifySignature Error]:", err);
            return false;
        }
    }
}