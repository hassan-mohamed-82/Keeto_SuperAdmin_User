import axios from "axios";
import crypto from "crypto";

const PAYMOB_BASE_URL = "https://accept.paymob.com/api";
const DEFAULT_CURRENCY = process.env.PAYMOB_CURRENCY || "EGP";
const DEFAULT_EXPIRATION_SECONDS = 60 * 60;
const DEFAULT_CALLBACK_URL = `${(process.env.APP_URL || process.env.PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/payment/paymob/callback`;

interface PaymobStudentProfile {
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  phone: string | null;
}

interface CreatePaymobCheckoutSessionParams {
  amountCents: number;
  merchantOrderId: string;
  student: PaymobStudentProfile;
  currency?: string;
}

const getRequiredEnv = (name: string) => {
  const value = process.env[name]?.replace(/^"|"$/g, "").trim();

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
};

const sanitizePhoneNumber = (phone: string | null) => {
  if (!phone) {
    return "NA";
  }

  return phone.replace(/\s+/g, "");
};

const buildBillingData = (student: PaymobStudentProfile) => ({
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

export const getPaymobCallbackUrl = () => DEFAULT_CALLBACK_URL;

export const createPaymobCheckoutSession = async ({
  amountCents,
  merchantOrderId,
  student,
  currency = DEFAULT_CURRENCY,
}: CreatePaymobCheckoutSessionParams) => {
  const apiKey = getRequiredEnv("PAYMOB_API_KEY");
  const integrationId = Number(getRequiredEnv("PAYMOB_INTEGRATION_ID"));
  const iframeId = getRequiredEnv("PAYMOB_IFRAME_ID");

  const authResponse = await axios.post(`${PAYMOB_BASE_URL}/auth/tokens`, {
    api_key: apiKey,
  });

  const authToken = authResponse.data?.token;

  if (!authToken) {
    throw new Error("Paymob authentication failed");
  }

  const orderResponse = await axios.post(`${PAYMOB_BASE_URL}/ecommerce/orders`, {
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

  const paymentKeyResponse = await axios.post(`${PAYMOB_BASE_URL}/acceptance/payment_keys`, {
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
    callbackUrl: getPaymobCallbackUrl(),
  };
};

type AnyRecord = Record<string, any>;

const getNestedValue = (payload: AnyRecord, path: string) =>
  path.split(".").reduce<any>((current, key) => (current == null ? undefined : current[key]), payload);

const stringifyValue = (value: unknown) => {
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
] as const;

export const extractPaymobCallbackPayload = (input: AnyRecord) => {
  if (input.obj && typeof input.obj === "object") {
    return input.obj as AnyRecord;
  }

  return input;
};

export const verifyPaymobHmac = (payload: AnyRecord, receivedHmac?: string | null) => {
  const hmacSecret = process.env.PAYMOB_HMAC?.replace(/^"|"$/g, "").trim();

  if (!hmacSecret) {
    return true;
  }

  if (!receivedHmac) {
    return false;
  }

  const payloadString = PAYMOB_HMAC_FIELDS.map((field) => stringifyValue(getNestedValue(payload, field))).join("");
  const calculatedHmac = crypto.createHmac("sha512", hmacSecret).update(payloadString).digest("hex");

  return calculatedHmac.toLowerCase() === receivedHmac.toLowerCase();
};
