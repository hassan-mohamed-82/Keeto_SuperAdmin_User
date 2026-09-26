import crypto from "crypto";
import * as querystring from "querystring";

export interface KashierConfig {
    mid: string;
    apiKey: string;
    secretKey: string;
    baseUrl: string;
    mode: "test" | "live";
}

/**
 * Get Kashier configuration securely from environment variables.
 */
export const getKashierConfig = (): KashierConfig => {
    const mid = process.env.KASHIER_MID || "";
    const apiKey = process.env.KASHIER_API_KEY || "";
    const secretKey = process.env.KASHIER_SECRET_KEY || "";
    const mode = (process.env.KASHIER_MODE || "test").toLowerCase() === "live" ? "live" : "test";

    // Default base URLs: test sandbox vs live production
    const defaultBaseUrl = mode === "live"
        ? "https://api.kashier.io"
        : "https://test-api.kashier.io";

    const baseUrl = process.env.KASHIER_BASE_URL || defaultBaseUrl;

    if (!mid || !apiKey) {
        console.warn("⚠️ Warning: KASHIER_MID or KASHIER_API_KEY is not defined in environment variables.");
    }

    return {
        mid,
        apiKey,
        secretKey,
        baseUrl,
        mode,
    };
};

export interface GenerateHashParams {
    mid?: string;
    orderId: string | number;
    amount: string | number;
    currency: string;
}

/**
 * Generates an HMAC-SHA256 order hash required by Kashier.
 * Formula:
 * path = "/?payment=" + MID + "." + orderId + "." + amount + "." + currency
 * Secret key: KASHIER_API_KEY
 */
export const generateKashierOrderHash = ({
    mid,
    orderId,
    amount,
    currency,
}: GenerateHashParams): string => {
    const config = getKashierConfig();
    const merchantId = mid || config.mid;

    const formattedAmount = typeof amount === "number" ? amount.toFixed(2) : String(amount);
    const upperCurrency = (currency || "EGP").toUpperCase();

    const path = `/?payment=${merchantId}.${orderId}.${formattedAmount}.${upperCurrency}`;

    return crypto
        .createHmac("sha256", config.apiKey)
        .update(path)
        .digest("hex");
};

/**
 * Validates the incoming webhook signature from Kashier.
 *
 * FIXED per Kashier's official webhook docs
 * (https://developers.kashier.io/docs/webhooks):
 *   1. The signature is sent in the `x-kashier-signature` HEADER, not a
 *      field inside the JSON body. The old code looked for
 *      `data.kashierSignature` in the body — that field doesn't exist in
 *      the current webhook format at all, so verification always failed.
 *   2. `data.signatureKeys` must be SORTED ALPHABETICALLY before building
 *      the payload — the old code used the array's given order as-is.
 *   3. The payload is a URL-encoded query string of the picked
 *      key=value pairs (`querystring.stringify`), NOT a raw concatenation
 *      of values with no separators.
 *   4. HMAC-SHA256 with the Payment API Key (unchanged).
 *
 * `data` here should be the object that actually CONTAINS `signatureKeys`
 * (usually `payload.data`, but some events may put it elsewhere — callers
 * pass whatever object holds `signatureKeys`).
 */
export const verifyKashierWebhookSignature = (
    data: Record<string, any>,
    receivedSignature?: string,
    customApiKey?: string
): boolean => {
    const config = getKashierConfig();
    const apiKey = customApiKey || config.apiKey;
    if (!apiKey) {
        console.error("KASHIER_API_KEY is required to verify webhook signatures.");
        return false;
    }

    try {
        const signature = receivedSignature;
        if (!signature) {
            console.error("[Kashier Webhook] No signature found to verify (expected x-kashier-signature header).");
            return false;
        }

        if (!Array.isArray(data?.signatureKeys) || data.signatureKeys.length === 0) {
            console.error("[Kashier Webhook] Missing or invalid signatureKeys — rejecting webhook.");
            return false;
        }

        // FIX: sort alphabetically before picking values — Kashier signs the
        // SORTED key order, not the array's given order.
        const sortedKeys: string[] = [...data.signatureKeys].sort();

        const picked: Record<string, any> = {};
        for (const key of sortedKeys) {
            picked[key] = data[key] ?? "";
        }

        // FIX: build a URL-encoded query string (key=value&key=value), not a
        // raw concatenation of values.
        const payload = querystring.stringify(picked);

        const expectedSignature = crypto
            .createHmac("sha256", apiKey)
            .update(payload)
            .digest("hex");

        const receivedBuf = Buffer.from(signature.toLowerCase(), "utf8");
        const expectedBuf = Buffer.from(expectedSignature.toLowerCase(), "utf8");

        if (receivedBuf.length !== expectedBuf.length) {
            return false;
        }

        return crypto.timingSafeEqual(receivedBuf, expectedBuf);
    } catch (err) {
        console.error("Error verifying Kashier webhook signature:", err);
        return false;
    }
};

/**
 * Safely masks a credit card number, leaving only the first 4 and last 4 digits visible.
 * E.g., '4111 2222 3333 4444' -> '4111 **** **** 4444'
 */
export const maskCardNumber = (cardNumber: string): string => {
    const cleaned = cardNumber.replace(/\D/g, "");
    if (cleaned.length < 8) return "****";
    const first4 = cleaned.slice(0, 4);
    const last4 = cleaned.slice(-4);
    return `${first4} **** **** ${last4}`;
};