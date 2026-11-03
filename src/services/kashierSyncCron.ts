import cron from "node-cron";
import axios from "axios";
import { db } from "../models/connection";
import { orders, restaurantSettings } from "../models/schema";
import { and, eq, ne, gte, lte, or } from "drizzle-orm";
import { decryptSecret } from "../utils/encryption";
import { getActiveCustomGateway } from "../utils/getActiveCustomGateway";
import { getActivePlatformGateway } from "../utils/getActivePlatformGateway";
import { confirmOrderPayment } from "../helpers/orderPaymentConfirmation";

/**
 * Helper: Retrieve Kashier credentials for a given restaurant
 */
async function getKashierCredentials(restaurantId: string): Promise<{
    mid: string;
    apiKey: string;
    secretKey?: string;
    baseUrl: string;
} | null> {
    try {
        const [settings] = await db
            .select({ paymentGatewayType: restaurantSettings.paymentGatewayType })
            .from(restaurantSettings)
            .where(eq(restaurantSettings.restaurantId, restaurantId))
            .limit(1);

        if (settings?.paymentGatewayType === "CUSTOM") {
            const activeGateway = await getActiveCustomGateway(restaurantId);
            if (activeGateway?.provider === "KASHIER") {
                const rawCreds = activeGateway.record.credentials as any;
                if (rawCreds?.apiKey && rawCreds?.mid) {
                    return {
                        mid: rawCreds.mid,
                        apiKey: decryptSecret(rawCreds.apiKey),
                        secretKey: rawCreds.secretKey ? decryptSecret(rawCreds.secretKey) : undefined,
                        baseUrl: rawCreds.baseUrl || "https://api.kashier.io",
                    };
                }
            }
        }

        // Platform / SYSTEM gateway fallback
        const platformGateway = await getActivePlatformGateway();
        if (platformGateway?.provider === "KASHIER" && platformGateway.credentials) {
            const creds = platformGateway.credentials;
            return {
                mid: creds.mid,
                apiKey: creds.apiKey,
                secretKey: creds.secretKey,
                baseUrl: creds.baseUrl || "https://api.kashier.io",
            };
        }
    } catch (err) {
        console.error(`[KashierSyncCron] Failed to resolve credentials for restaurant ${restaurantId}:`, err);
    }

    return null;
}

/**
 * Check a single pending order against Kashier's Order Lookup API
 */
async function syncSingleOrder(order: typeof orders.$inferSelect): Promise<boolean> {
    const creds = await getKashierCredentials(order.restaurantId);
    if (!creds) {
        console.warn(`[KashierSyncCron] No Kashier credentials found for restaurant ${order.restaurantId}. Skipping order ${order.orderNumber}.`);
        return false;
    }

    const authHeader = creds.secretKey || creds.apiKey;
    const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "api-key": creds.apiKey,
    };
    if (authHeader) {
        requestHeaders["Authorization"] = authHeader;
    }

    try {
        // Query Kashier by our order UUID (merchantOrderId)
        const response = await axios.get(`${creds.baseUrl}/v3/payment/orders`, {
            params: {
                search: order.id,
            },
            headers: requestHeaders,
            timeout: 10000,
        });

        const data = response.data;
        const matchedOrders: any[] = data?.data?.orders || data?.orders || [];

        if (matchedOrders.length === 0) {
            // Also try searching by orderNumber or paymentOrderId as fallback if available
            if (order.orderNumber) {
                const retryResp = await axios.get(`${creds.baseUrl}/v3/payment/orders`, {
                    params: {
                        search: order.orderNumber,
                    },
                    headers: requestHeaders,
                    timeout: 10000,
                }).catch(() => null);

                const retryOrders: any[] = retryResp?.data?.data?.orders || retryResp?.data?.orders || [];
                if (retryOrders.length > 0) {
                    matchedOrders.push(...retryOrders);
                }
            }
        }

        if (matchedOrders.length === 0) {
            return false;
        }

        // Find the order record
        const kashierOrder = matchedOrders[0];
        const rawStatus = (kashierOrder.status || "").toUpperCase();

        if (rawStatus === "PAID" || rawStatus === "CAPTURED" || rawStatus === "SUCCESS") {
            const successfulTx = (kashierOrder.transactions || []).find((tx: any) => {
                const txStatus = (tx.status || "").toUpperCase();
                return txStatus === "SUCCESS" || txStatus === "CAPTURED" || txStatus === "PAID";
            });

            const transactionId = successfulTx?.transactionId || kashierOrder.transactionId;
            const gatewayOrderId = kashierOrder.id || kashierOrder.orderReference;

            console.log(`[KashierSyncCron] Found PAID order at Kashier: Order #${order.orderNumber} (${order.id}). Confirming payment...`);

            await confirmOrderPayment({
                orderId: order.id,
                gateway: "kashier",
                transactionId: transactionId || undefined,
                gatewayOrderId: gatewayOrderId || undefined,
                rawPayload: kashierOrder,
            });

            console.log(`[KashierSyncCron] Successfully confirmed Order #${order.orderNumber} as PAID via Cron Sync.`);
            return true;
        }
    } catch (err: any) {
        // Log at debug level to avoid spamming console
        console.error(`[KashierSyncCron] Error checking order ${order.orderNumber} (${order.id}):`, err?.message || err);
    }

    return false;
}

/**
 * Main Sync Runner:
 * Queries pending Kashier orders between 5 minutes and 48 hours old and checks their status.
 */
export async function runKashierOrderSync(): Promise<{ checked: number; confirmed: number }> {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    let confirmedCount = 0;

    try {
        const pendingOrders = await db
            .select()
            .from(orders)
            .where(
                and(
                    eq(orders.paymentGateway, "kashier"),
                    ne(orders.paymentStatus, "paid"),
                    or(
                        eq(orders.paymentStatus, "pending_payment"),
                        eq(orders.status, "pending")
                    ),
                    gte(orders.createdAt, fortyEightHoursAgo),
                    lte(orders.createdAt, fiveMinutesAgo)
                )
            );

        if (pendingOrders.length === 0) {
            return { checked: 0, confirmed: 0 };
        }

        console.log(`[KashierSyncCron] Checking ${pendingOrders.length} pending Kashier order(s)...`);

        for (const order of pendingOrders) {
            const confirmed = await syncSingleOrder(order);
            if (confirmed) {
                confirmedCount++;
            }
        }

        return { checked: pendingOrders.length, confirmed: confirmedCount };
    } catch (err) {
        console.error("[KashierSyncCron] Error in runKashierOrderSync:", err);
        return { checked: 0, confirmed: 0 };
    }
}

/**
 * Initialize the Kashier Reconciliation Cron Job.
 * Runs every 3 minutes.
 */
export function initKashierSyncCron() {
    // Run every 3 minutes: */3 * * * *
    cron.schedule("*/3 * * * *", async () => {
        try {
            await runKashierOrderSync();
        } catch (err) {
            console.error("[KashierSyncCron] Scheduled job failed:", err);
        }
    });

    console.log("🕒 Kashier Order Sync Cron initialized (runs every 3 minutes).");
}

