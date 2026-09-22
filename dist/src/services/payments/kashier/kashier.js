"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.maskCardNumber = exports.verifyKashierWebhookSignature = exports.generateKashierOrderHash = exports.getKashierConfig = void 0;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Get Kashier configuration securely from environment variables.
 */
const getKashierConfig = () => {
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
exports.getKashierConfig = getKashierConfig;
/**
 * Generates an HMAC-SHA256 order hash required by Kashier.
 * Formula:
 * path = "/?payment=" + MID + "." + orderId + "." + amount + "." + currency
 * Secret key: KASHIER_API_KEY
 */
const generateKashierOrderHash = ({ mid, orderId, amount, currency, }) => {
    const config = (0, exports.getKashierConfig)();
    const merchantId = mid || config.mid;
    // Format amount to fixed 2 decimal places if needed or clean string
    const formattedAmount = typeof amount === "number" ? amount.toFixed(2) : String(amount);
    const upperCurrency = (currency || "EGP").toUpperCase();
    const path = `/?payment=${merchantId}.${orderId}.${formattedAmount}.${upperCurrency}`;
    return crypto_1.default
        .createHmac("sha256", config.apiKey)
        .update(path)
        .digest("hex");
};
exports.generateKashierOrderHash = generateKashierOrderHash;
/**
 * Validates the incoming webhook signature from Kashier using KASHIER_SECRET_KEY.
 * Kashier typically sends a signature in headers or as part of the payload query/body.
 */
const verifyKashierWebhookSignature = (dataToSign, receivedSignature) => {
    const config = (0, exports.getKashierConfig)();
    if (!config.secretKey) {
        console.error("KASHIER_SECRET_KEY is required to verify webhook signatures.");
        return false;
    }
    try {
        let payloadString = "";
        if (typeof dataToSign === "string") {
            payloadString = dataToSign;
        }
        else if (typeof dataToSign === "object" && dataToSign !== null) {
            // Sort keys to maintain deterministic HMAC order if signing payload object
            const sortedKeys = Object.keys(dataToSign).sort();
            payloadString = sortedKeys
                .map((key) => `${key}=${dataToSign[key]}`)
                .join("&");
        }
        const expectedSignature = crypto_1.default
            .createHmac("sha256", config.secretKey)
            .update(payloadString)
            .digest("hex");
        const receivedBuf = Buffer.from(receivedSignature, "utf8");
        const expectedBuf = Buffer.from(expectedSignature, "utf8");
        if (receivedBuf.length !== expectedBuf.length) {
            return false;
        }
        return crypto_1.default.timingSafeEqual(receivedBuf, expectedBuf);
    }
    catch (err) {
        console.error("Error verifying Kashier webhook signature:", err);
        return false;
    }
};
exports.verifyKashierWebhookSignature = verifyKashierWebhookSignature;
/**
 * Safely masks a credit card number, leaving only the first 4 and last 4 digits visible.
 * E.g., '4111 2222 3333 4444' -> '4111 **** **** 4444'
 */
const maskCardNumber = (cardNumber) => {
    const cleaned = cardNumber.replace(/\D/g, "");
    if (cleaned.length < 8)
        return "****";
    const first4 = cleaned.slice(0, 4);
    const last4 = cleaned.slice(-4);
    return `${first4} **** **** ${last4}`;
};
exports.maskCardNumber = maskCardNumber;
