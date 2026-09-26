import axios from "axios";
import crypto from "crypto";
import { BadRequest } from "../../../Errors/BadRequest";
import { PaymobCredentials } from "../../../models/schema/admin/restaurantPaymentCredentials";

export interface CreatePaymobSessionInput {
    credentials: PaymobCredentials;
    orderId: string;
    orderNumber: string;
    amountCents: number;
    currency?: string;
    customer: {
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
    };
    billingData?: Record<string, any>;
    notificationUrl?: string;
    redirectionUrl?: string;
}

export interface PaymobSessionResponse {
    sessionId: string;       // = intention id, نفس المفهوم القديم بتاع sessionId
    sessionUrl: string;      // رابط Unified Checkout الجاهز للـ redirect
    paymobOrderId: number;   // Paymob order id (بييجي في transaction callback)
    intentionId: string;
    clientSecret: string;
}

export class PaymobService {
    // FIX: الـ base URL بتاع الـ Intention API (v1)، مختلف عن /api القديم
    private static readonly INTENTION_URL = "https://accept.paymob.com/v1/intention/";
    private static readonly UNIFIED_CHECKOUT_BASE = "https://accept.paymob.com/unifiedcheckout/";

    /**
     * Create Intention API — خطوة واحدة بس بدل التلات خطوات القديمة
     * (auth/tokens -> ecommerce/orders -> acceptance/payment_keys).
     * الـ auth هنا بيتم بالـ secret_key مباشرة في الهيدر، مفيش auth_token منفصل.
     */
    static async createIntention(input: CreatePaymobSessionInput): Promise<{
        intentionId: string;
        clientSecret: string;
        paymobOrderId: number;
    }> {
        const { credentials, orderNumber, orderId, amountCents, currency = "EGP", customer } = input;

        if (!credentials.secretKey) {
            throw new BadRequest(
                "Paymob secretKey is missing. Add secretKey (sk_test_... / sk_live_...) to this restaurant's Paymob credentials."
            );
        }
        if (!credentials.integrationId) {
            throw new BadRequest("Paymob integrationId is missing from credentials.");
        }

        const firstName = customer.firstName || "Customer";
        const lastName = customer.lastName || "User";
        const email = customer.email || "customer@example.com";
        const phone = (customer.phone || "+201000000000").replace(/\s+/g, "");

        const billingData = {
            apartment: "NA",
            email,
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

        try {
            const response = await axios.post(
                this.INTENTION_URL,
                {
                    amount: Math.round(amountCents), // بالقروش/السنتات، زي القديم
                    currency: currency.toUpperCase(),
                    payment_methods: [Number(credentials.integrationId)],
                    items: [],
                    billing_data: billingData,
                    customer: {
                        first_name: firstName,
                        last_name: lastName,
                        email,
                    },
                    special_reference: orderNumber || orderId,
                    notification_url: input.notificationUrl || credentials.callbackUrl,
                    redirection_url: input.redirectionUrl,
                },
                {
                    headers: {
                        Authorization: `Token ${credentials.secretKey}`,
                        "Content-Type": "application/json",
                    },
                    timeout: 15000,
                }
            );

            const data = response.data;
            const clientSecret = data?.client_secret;
            const intentionId = data?.id;
            const paymobOrderId = data?.intention_order_id ?? data?.order?.id;

            if (!clientSecret || !intentionId) {
                throw new BadRequest("Paymob Intention API did not return a client_secret/id.");
            }

            return { intentionId, clientSecret, paymobOrderId };
        } catch (error: any) {
            if (error instanceof BadRequest) throw error;
            // FIX: زي التشخيص اللي عملناه قبل كده — نطبع الـ response body الكامل
            // عشان أي خطأ يبان سببه الحقيقي (مش نص عام بيخفي التفاصيل).
            console.error("[Paymob Intention Error] status:", error.response?.status);
            console.error("[Paymob Intention Error] response body:", JSON.stringify(error.response?.data));
            const msg =
                error.response?.data?.detail ||
                JSON.stringify(error.response?.data) ||
                error.message ||
                "Paymob intention creation failed";
            throw new BadRequest(`Paymob intention failed: ${msg}`);
        }
    }

    /**
     * Unified Checkout URL — الصفحة اللي المستخدم هيتوجه لها يدفع فيها
     */
    static buildUnifiedCheckoutUrl(publicKey: string, clientSecret: string): string {
        return `${this.UNIFIED_CHECKOUT_BASE}?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(clientSecret)}`;
    }

    /**
     * Complete Session Flow (الاسم اتسيب زي ما هو عشان الـ caller في checkout
     * controller مايتغيّرش كتير، بس المحتوى بقى Intention API مش الـ 3 خطوات)
     */
    static async createPaymentSession(input: CreatePaymobSessionInput): Promise<PaymobSessionResponse> {
        if (!input.credentials.publicKey) {
            throw new BadRequest(
                "Paymob publicKey is missing. Add publicKey (pk_test_... / pk_live_...) to this restaurant's Paymob credentials."
            );
        }

        const { intentionId, clientSecret, paymobOrderId } = await this.createIntention(input);
        const sessionUrl = this.buildUnifiedCheckoutUrl(input.credentials.publicKey, clientSecret);

        return {
            sessionId: intentionId,
            sessionUrl,
            paymobOrderId,
            intentionId,
            clientSecret,
        };
    }

    /**
     * Verify Paymob Webhook HMAC signature according to official specification.
     * ملحوظة: ده بيفضل شغال زي ما هو — الـ transaction callback (notification_url)
     * بيرجع بنفس الشكل القديم بالظبط سواء الجلسة اتعملت بالـ Intention API
     * أو الـ flow القديم، فمفيش تغيير مطلوب هنا.
     */
    static verifyHmac(transactionObj: Record<string, any>, hmacSecret: string, receivedHmac: string): boolean {
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
        ] as const;

        const getNestedValue = (payload: Record<string, any>, path: string): any =>
            path.split(".").reduce<any>((current, key) => (current == null ? undefined : current[key]), payload);

        const stringifyValue = (value: unknown): string => {
            if (value === null || value === undefined) {
                return "";
            }
            if (typeof value === "boolean") {
                return value ? "true" : "false";
            }
            return String(value);
        };

        const payloadString = PAYMOB_HMAC_FIELDS.map((field) =>
            stringifyValue(getNestedValue(transactionObj, field))
        ).join("");

        const calculatedHmac = crypto
            .createHmac("sha512", hmacSecret)
            .update(payloadString)
            .digest("hex");

        try {
            const calculatedBuf = Buffer.from(calculatedHmac.toLowerCase(), "utf8");
            const receivedBuf = Buffer.from(receivedHmac.toLowerCase(), "utf8");

            if (calculatedBuf.length !== receivedBuf.length) {
                return false;
            }

            return crypto.timingSafeEqual(calculatedBuf, receivedBuf);
        } catch {
            return false;
        }
    }
}