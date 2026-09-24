import crypto from "crypto";

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
    
    // Format amount to fixed 2 decimal places if needed or clean string
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
 * Kashier algorithm:
 *   1. Use `data.signatureKeys` (array) to determine which fields to sign.
 *   2. Concatenate the VALUES of those fields from `data` in order.
 *   3. HMAC-SHA256 the result using KASHIER_API_KEY (NOT secretKey).
 *   4. Compare with the signature sent in `data.kashierSignature` (or a header).
 *
 * Reference: https://kashier.io/docs/webhooks
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
        // The actual received signature comes from data.kashierSignature if not passed separately
        const signature = receivedSignature || data?.kashierSignature;
        if (!signature) {
            console.error("[Kashier Webhook] No signature found to verify.");
            return false;
        }

        // FIX #3: `signatureKeys` MUST come from Kashier itself. Previously, when
        // it was missing we silently rebuilt the key list from every field in the
        // incoming body — which means an attacker could add/remove fields to
        // influence exactly what gets signed (signature malleability), or simply
        // send a payload shaped to make an unrelated field set "just happen" to
        // validate. There is no safe way to verify a Kashier signature without
        // Kashier's own signatureKeys, so we now reject outright instead of guessing.
        if (!Array.isArray(data?.signatureKeys) || data.signatureKeys.length === 0) {
            console.error("[Kashier Webhook] Missing or invalid signatureKeys — rejecting webhook.");
            return false;
        }
        const signatureKeys: string[] = data.signatureKeys;

        // Concatenate values in specified order
        const payload = signatureKeys
            .map((key) => {
                const val = data[key];
                return val === null || val === undefined ? "" : String(val);
            })
            .join("");

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