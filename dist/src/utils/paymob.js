"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyPaymobHmac = exports.extractPaymobCallbackPayload = exports.createPaymobCheckoutSession = exports.getPaymobCallbackUrl = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const PAYMOB_BASE_URL = "https://accept.paymob.com/api";
const DEFAULT_CURRENCY = process.env.PAYMOB_CURRENCY || "EGP";
const DEFAULT_EXPIRATION_SECONDS = 60 * 60;
const DEFAULT_CALLBACK_URL = `${(process.env.APP_URL || process.env.PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/payment/paymob/callback`;
const getRequiredEnv = (name) => {
    const value = process.env[name]?.replace(/^"|"$/g, "").trim();
    if (!value) {
        throw new Error(`${name} is not configured`);
    }
    return value;
};
const sanitizePhoneNumber = (phone) => {
    if (!phone) {
        return "NA";
    }
    return phone.replace(/\s+/g, "");
};
const buildBillingData = (student) => ({
    apartment: "NA",
    email: student.email || "student@mathhouse.app",
    floor: "NA",
    first_name: student.firstname || "Student",
    street: "NA",
    building: "NA",
    phone_number: sanitizePhoneNumber(student.phone),
    shipping_method: "NA",
    postal_code: "NA",
    city: "Cairo",
    country: "EG",
    last_name: student.lastname || "User",
    state: "Cairo",
});
const getPaymobCallbackUrl = () => DEFAULT_CALLBACK_URL;
exports.getPaymobCallbackUrl = getPaymobCallbackUrl;
const createPaymobCheckoutSession = async ({ amountCents, merchantOrderId, student, currency = DEFAULT_CURRENCY, }) => {
    const apiKey = getRequiredEnv("PAYMOB_API_KEY");
    const integrationId = Number(getRequiredEnv("PAYMOB_INTEGRATION_ID"));
    const iframeId = getRequiredEnv("PAYMOB_IFRAME_ID");
    const authResponse = await axios_1.default.post(`${PAYMOB_BASE_URL}/auth/tokens`, {
        api_key: apiKey,
    });
    const authToken = authResponse.data?.token;
    if (!authToken) {
        throw new Error("Paymob authentication failed");
    }
    const orderResponse = await axios_1.default.post(`${PAYMOB_BASE_URL}/ecommerce/orders`, {
        auth_token: authToken,
        delivery_needed: false,
        amount_cents: amountCents,
        currency,
        merchant_order_id: merchantOrderId,
        items: [],
    });
    const paymobOrderId = orderResponse.data?.id;
    if (!paymobOrderId) {
        throw new Error("Paymob order creation failed");
    }
    const paymentKeyResponse = await axios_1.default.post(`${PAYMOB_BASE_URL}/acceptance/payment_keys`, {
        auth_token: authToken,
        amount_cents: amountCents,
        expiration: DEFAULT_EXPIRATION_SECONDS,
        order_id: paymobOrderId,
        billing_data: buildBillingData(student),
        currency,
        integration_id: integrationId,
        lock_order_when_paid: true,
    });
    const paymentToken = paymentKeyResponse.data?.token;
    if (!paymentToken) {
        throw new Error("Paymob payment key creation failed");
    }
    return {
        authToken,
        paymobOrderId,
        paymentToken,
        iframeUrl: `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${paymentToken}`,
        checkoutUrl: `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${paymentToken}`,
        callbackUrl: (0, exports.getPaymobCallbackUrl)(),
    };
};
exports.createPaymobCheckoutSession = createPaymobCheckoutSession;
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
const extractPaymobCallbackPayload = (input) => {
    if (input.obj && typeof input.obj === "object") {
        return input.obj;
    }
    return input;
};
exports.extractPaymobCallbackPayload = extractPaymobCallbackPayload;
const verifyPaymobHmac = (payload, receivedHmac) => {
    const hmacSecret = process.env.PAYMOB_HMAC?.replace(/^"|"$/g, "").trim();
    if (!hmacSecret) {
        return true;
    }
    if (!receivedHmac) {
        return false;
    }
    const payloadString = PAYMOB_HMAC_FIELDS.map((field) => stringifyValue(getNestedValue(payload, field))).join("");
    const calculatedHmac = crypto_1.default.createHmac("sha512", hmacSecret).update(payloadString).digest("hex");
    return calculatedHmac.toLowerCase() === receivedHmac.toLowerCase();
};
exports.verifyPaymobHmac = verifyPaymobHmac;
