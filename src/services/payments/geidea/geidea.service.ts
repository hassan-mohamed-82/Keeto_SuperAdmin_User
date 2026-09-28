import axios from "axios";
import crypto from "crypto";
import { BadRequest } from "../../../Errors/BadRequest";
import { GeideaCredentials } from "../../../models/schema/admin/restaurantPaymentCredentials";

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
     * POST /payment-intent/api/v1/direct/ecom/create-session
     */
    static async createPaymentSession(input: CreateGeideaSessionInput): Promise<GeideaSessionResponse> {
        const { credentials, orderId, orderNumber, amount, currency = "EGP", customer, language = "ar" } = input;

        if (!credentials.publicKey) {
            throw new BadRequest("Geidea publicKey is missing from credentials.");
        }
        if (!credentials.apiPassword) {
            throw new BadRequest("Geidea apiPassword is missing from credentials.");
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

            const sessionUrl = `${this.DEFAULT_HPP_URL}?sessionId=${encodeURIComponent(sessionId)}`;

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
     * Verify Geidea Webhook / Callback Signature (if provided by Geidea)
     */
    static verifySignature(
        publicKey: string,
        apiPassword: string,
        orderId: string,
        status: string,
        amount: number | string,
        receivedSignature?: string
    ): boolean {
        if (!receivedSignature) return true; // if no signature provided, rely on direct verification or Basic Auth

        try {
            const dataToSign = `${publicKey}${orderId}${status}${amount}${apiPassword}`;
            const computedHash = crypto.createHash("sha256").update(dataToSign).digest("hex");
            return computedHash.toLowerCase() === receivedSignature.toLowerCase();
        } catch (err) {
            console.error("[Geidea verifySignature Error]:", err);
            return false;
        }
    }
}
