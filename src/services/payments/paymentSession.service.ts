import { db } from "../../models/connection";
import { orders, restaurantSettings } from "../../models/schema";
import { eq } from "drizzle-orm";
import { BadRequest } from "../../Errors";
import { getActiveCustomGateway } from "../../utils/getActiveCustomGateway";
import { decryptSecret } from "../../utils/encryption";
import { safeDecrypt } from "../../utils/Safedecrypt";
import { KashierService } from "./kashier/kashier.service";
import { PaymobService } from "./paymob/paymob.service";

export interface CreateOrderPaymentSessionParams {
    orderId: string;
    orderNumber?: string;
    restaurantId: string;
    totalAmount: number;
    userInfo?: {
        name?: string | null;
        email?: string | null;
        phone?: string | null;
    };
    preferredGateway?: "KASHIER" | "PAYMOB";
}

export interface PaymentSessionResult {
    gateway: "KASHIER" | "PAYMOB" | "CUSTOM";
    type: "redirect";
    sessionId: string;
    sessionUrl: string;
    status: string;
    expireAt?: string;
    paymobOrderId?: string;
    error?: string;
}

/**
 * Unified Payment Session Service
 * Resolves the appropriate payment gateway (SYSTEM Kashier or CUSTOM Kashier/Paymob)
 * and generates the hosted payment session URL for the customer.
 */
export async function createOrderPaymentSession(
    params: CreateOrderPaymentSessionParams
): Promise<PaymentSessionResult> {
    const { orderId, orderNumber, restaurantId, totalAmount, userInfo, preferredGateway } = params;

    const [settings] = await db
        .select({ paymentGatewayType: restaurantSettings.paymentGatewayType })
        .from(restaurantSettings)
        .where(eq(restaurantSettings.restaurantId, restaurantId))
        .limit(1);

    const gatewayType = settings?.paymentGatewayType || "SYSTEM";

    if (gatewayType === "CUSTOM") {
        const activeGateway = await getActiveCustomGateway(restaurantId);

        if (!activeGateway) {
            throw new BadRequest(
                "Restaurant is configured for custom gateway, but no active payment credentials (Paymob or Kashier) were found."
            );
        }

        if (preferredGateway && activeGateway.provider !== preferredGateway) {
            throw new BadRequest(
                `This restaurant's active custom provider is ${activeGateway.provider}, not ${preferredGateway}.`
            );
        }

        if (activeGateway.provider === "KASHIER") {
            const rawCreds = activeGateway.record.credentials as any;
            const decryptedCredentials = {
                mid: rawCreds.mid,
                apiKey: decryptSecret(rawCreds.apiKey),
                secretKey: rawCreds.secretKey ? decryptSecret(rawCreds.secretKey) : undefined,
                baseUrl: rawCreds.baseUrl,
            };

            const kashierSession = await KashierService.createPaymentSession({
                orderId,
                amount: totalAmount,
                currency: "EGP",
                customerEmail: userInfo?.email || undefined,
                credentials: decryptedCredentials,
            });

            return {
                gateway: "KASHIER",
                type: "redirect",
                sessionId: kashierSession.sessionId,
                sessionUrl: kashierSession.sessionUrl,
                status: kashierSession.status,
                expireAt: kashierSession.expireAt,
            };
        } else {
            // PAYMOB
            const rawCreds = activeGateway.record.credentials as any;
            const decryptedCredentials = {
                ...rawCreds,
                secretKey: rawCreds.secretKey ? decryptSecret(rawCreds.secretKey) : "",
                publicKey: rawCreds.publicKey,
                hmac: safeDecrypt(rawCreds.hmac),
            };

            const nameParts = (userInfo?.name || "Customer User").trim().split(" ");
            const firstName = nameParts[0] || "Customer";
            const lastName = nameParts.slice(1).join(" ") || "User";

            const backendBaseUrl = (process.env.Back_BASE_URL || "").replace(/\/$/, "");

            const paymobSession = await PaymobService.createPaymentSession({
                credentials: decryptedCredentials,
                orderId,
                orderNumber: orderNumber || orderId,
                amountCents: Math.round(totalAmount * 100),
                currency: "EGP",
                customer: {
                    firstName,
                    lastName,
                    email: userInfo?.email || "customer@example.com",
                    phone: userInfo?.phone || "+201000000000",
                },
                notificationUrl: decryptedCredentials.callbackUrl || `${backendBaseUrl}/api/payments/paymob/webhook`,
                redirectionUrl: `${backendBaseUrl}/api/payments/paymob/callback`,
            });

            // Update order with Paymob gateway info
            await db
                .update(orders)
                .set({
                    paymentOrderId: String(paymobSession.paymobOrderId || paymobSession.sessionId),
                    paymentGateway: "paymob",
                    paymentStatus: "pending_payment",
                })
                .where(eq(orders.id, orderId));

            return {
                gateway: "PAYMOB",
                type: "redirect",
                sessionId: paymobSession.sessionId,
                sessionUrl: paymobSession.sessionUrl,
                status: "CREATED",
                paymobOrderId: String(paymobSession.paymobOrderId),
            };
        }
    } else {
        // SYSTEM gateway -> Kashier (platform's own account)
        if (preferredGateway && preferredGateway !== "KASHIER") {
            throw new BadRequest(
                "This restaurant uses the system platform payment gateway (Kashier). Paymob is not enabled for this restaurant."
            );
        }

        const kashierSession = await KashierService.createPaymentSession({
            orderId,
            amount: totalAmount,
            currency: "EGP",
            customerEmail: userInfo?.email || undefined,
        });

        return {
            gateway: "KASHIER",
            type: "redirect",
            sessionId: kashierSession.sessionId,
            sessionUrl: kashierSession.sessionUrl,
            status: kashierSession.status,
            expireAt: kashierSession.expireAt,
        };
    }
}
