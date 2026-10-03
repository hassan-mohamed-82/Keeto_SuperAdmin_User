"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrderPaymentSession = createOrderPaymentSession;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const Errors_1 = require("../../Errors");
const getActiveCustomGateway_1 = require("../../utils/getActiveCustomGateway");
const encryption_1 = require("../../utils/encryption");
const Safedecrypt_1 = require("../../utils/Safedecrypt");
const kashier_service_1 = require("./kashier/kashier.service");
const paymob_service_1 = require("./paymob/paymob.service");
const geidea_service_1 = require("./geidea/geidea.service");
const restaurantWalletService_1 = require("../restaurantWalletService");
/**
 * Unified Payment Session Service
 * Resolves the appropriate payment gateway (SYSTEM Kashier or CUSTOM Kashier/Paymob/Geidea)
 * and generates the hosted payment session URL for the customer.
 */
async function createOrderPaymentSession(params) {
    const { orderId, orderNumber, restaurantId, totalAmount, userInfo, preferredGateway, restaurantSlug } = params;
    // Build frontend redirect URL with callbackSlug when a restaurant slug is available
    const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const frontendRedirectUrl = restaurantSlug
        ? `${appBaseUrl}/profile?callbackSlug=${encodeURIComponent(restaurantSlug)}`
        : `${appBaseUrl}/payment/result`;
    // 1. Just-In-Time check: هل حان موعد السويتش التلقائي لبوابة الفيزا (شرط التاريخ أو المبلغ)؟
    await (0, restaurantWalletService_1.checkAndApplyVisaSwitch)(restaurantId, 0);
    const [settings] = await connection_1.db
        .select({ paymentGatewayType: schema_1.restaurantSettings.paymentGatewayType })
        .from(schema_1.restaurantSettings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId))
        .limit(1);
    const gatewayType = settings?.paymentGatewayType || "SYSTEM";
    if (gatewayType === "CUSTOM") {
        const activeGateway = await (0, getActiveCustomGateway_1.getActiveCustomGateway)(restaurantId);
        if (!activeGateway) {
            throw new Errors_1.BadRequest("Restaurant is configured for custom gateway, but no active payment credentials (Paymob, Kashier, or Geidea) were found.");
        }
        if (preferredGateway && activeGateway.provider !== preferredGateway) {
            throw new Errors_1.BadRequest(`This restaurant's active custom provider is ${activeGateway.provider}, not ${preferredGateway}.`);
        }
        if (activeGateway.provider === "KASHIER") {
            const rawCreds = activeGateway.record.credentials;
            const decryptedCredentials = {
                mid: rawCreds.mid,
                apiKey: (0, encryption_1.decryptSecret)(rawCreds.apiKey),
                secretKey: rawCreds.secretKey ? (0, encryption_1.decryptSecret)(rawCreds.secretKey) : undefined,
                baseUrl: rawCreds.baseUrl,
            };
            const backendBaseUrl = (process.env.Back_BASE_URL || "").replace(/\/$/, "");
            const kashierCallbackUrl = restaurantSlug
                ? `${backendBaseUrl}/api/payments/kashier/callback?callbackSlug=${encodeURIComponent(restaurantSlug)}`
                : `${backendBaseUrl}/api/payments/kashier/callback`;
            const kashierSession = await kashier_service_1.KashierService.createPaymentSession({
                orderId,
                amount: totalAmount,
                currency: "EGP",
                customerEmail: userInfo?.email || undefined,
                credentials: decryptedCredentials,
                merchantRedirect: kashierCallbackUrl,
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
        else if (activeGateway.provider === "PAYMOB") {
            // PAYMOB
            const rawCreds = activeGateway.record.credentials;
            const decryptedCredentials = {
                ...rawCreds,
                apiKey: rawCreds.apiKey ? (0, encryption_1.decryptSecret)(rawCreds.apiKey) : "",
                secretKey: rawCreds.secretKey ? (0, encryption_1.decryptSecret)(rawCreds.secretKey) : "",
                publicKey: rawCreds.publicKey,
                iframeId: rawCreds.iframeId,
                hmac: (0, Safedecrypt_1.safeDecrypt)(rawCreds.hmac),
            };
            const nameParts = (userInfo?.name || "Customer User").trim().split(" ");
            const firstName = nameParts[0] || "Customer";
            const lastName = nameParts.slice(1).join(" ") || "User";
            const backendBaseUrl = (process.env.Back_BASE_URL || "").replace(/\/$/, "");
            // Paymob browser redirect goes through the backend callback handler which then
            // forwards to the frontend. We embed callbackSlug so it survives the relay.
            const paymobCallbackUrl = restaurantSlug
                ? `${backendBaseUrl}/api/payments/paymob/callback?callbackSlug=${encodeURIComponent(restaurantSlug)}`
                : `${backendBaseUrl}/api/payments/paymob/callback`;
            const paymobSession = await paymob_service_1.PaymobService.createPaymentSession({
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
                redirectionUrl: paymobCallbackUrl,
            });
            // Update order with Paymob gateway info
            await connection_1.db
                .update(schema_1.orders)
                .set({
                paymentOrderId: String(paymobSession.paymobOrderId || paymobSession.sessionId),
                paymentGateway: "paymob",
                paymentStatus: "pending_payment",
            })
                .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
            return {
                gateway: "PAYMOB",
                type: "redirect",
                sessionId: paymobSession.sessionId,
                sessionUrl: paymobSession.sessionUrl,
                status: "CREATED",
                paymobOrderId: String(paymobSession.paymobOrderId),
            };
        }
        else {
            // GEIDEA
            const rawCreds = activeGateway.record.credentials;
            const decryptedCredentials = {
                ...rawCreds,
                publicKey: rawCreds.publicKey,
                apiPassword: rawCreds.apiPassword ? (0, Safedecrypt_1.safeDecrypt)(rawCreds.apiPassword) : "",
                environment: rawCreds.environment,
            };
            const backendBaseUrl = (process.env.Back_BASE_URL || "").replace(/\/$/, "");
            const geideaCallbackUrl = restaurantSlug
                ? `${backendBaseUrl}/api/payments/geidea/callback?callbackSlug=${encodeURIComponent(restaurantSlug)}`
                : `${backendBaseUrl}/api/payments/geidea/callback`;
            const geideaSession = await geidea_service_1.GeideaService.createPaymentSession({
                credentials: decryptedCredentials,
                orderId,
                orderNumber: orderNumber || orderId,
                amount: totalAmount,
                currency: "EGP",
                customer: {
                    name: userInfo?.name || "Customer",
                    email: userInfo?.email || "customer@example.com",
                    phone: userInfo?.phone || "+201000000000",
                },
                callbackUrl: decryptedCredentials.callbackUrl || `${backendBaseUrl}/api/payments/geidea/webhook`,
                returnUrl: geideaCallbackUrl,
            });
            // Update order with Geidea gateway info
            await connection_1.db
                .update(schema_1.orders)
                .set({
                paymentOrderId: String(geideaSession.sessionId),
                paymentGateway: "geidea",
                paymentStatus: "pending_payment",
            })
                .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
            return {
                gateway: "GEIDEA",
                type: "redirect",
                sessionId: geideaSession.sessionId,
                sessionUrl: geideaSession.sessionUrl,
                status: geideaSession.status,
                geideaOrderId: geideaSession.sessionId,
            };
        }
    }
    else {
        // SYSTEM gateway -> Kashier (platform's own account)
        if (preferredGateway && preferredGateway !== "KASHIER") {
            throw new Errors_1.BadRequest("This restaurant uses the system platform payment gateway (Kashier). Paymob and Geidea are not enabled for this restaurant.");
        }
        const backendBaseUrl = (process.env.Back_BASE_URL || "").replace(/\/$/, "");
        const kashierCallbackUrl = restaurantSlug
            ? `${backendBaseUrl}/api/payments/kashier/callback?callbackSlug=${encodeURIComponent(restaurantSlug)}`
            : `${backendBaseUrl}/api/payments/kashier/callback`;
        const kashierSession = await kashier_service_1.KashierService.createPaymentSession({
            orderId,
            amount: totalAmount,
            currency: "EGP",
            customerEmail: userInfo?.email || undefined,
            merchantRedirect: kashierCallbackUrl,
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
