"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncSingleOrder = syncSingleOrder;
exports.syncOrderByOrderId = syncOrderByOrderId;
exports.runKashierOrderSync = runKashierOrderSync;
exports.initKashierSyncCron = initKashierSyncCron;
const node_cron_1 = __importDefault(require("node-cron"));
const axios_1 = __importDefault(require("axios"));
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const encryption_1 = require("../utils/encryption");
const getActiveCustomGateway_1 = require("../utils/getActiveCustomGateway");
const getActivePlatformGateway_1 = require("../utils/getActivePlatformGateway");
const orderPaymentConfirmation_1 = require("../helpers/orderPaymentConfirmation");
/**
 * Helper: Safely extract array of orders from Kashier response
 */
function extractOrders(data) {
    if (!data)
        return [];
    if (Array.isArray(data))
        return data;
    if (Array.isArray(data.data))
        return data.data;
    if (Array.isArray(data.data?.orders))
        return data.data.orders;
    if (Array.isArray(data.orders))
        return data.orders;
    return [];
}
/**
 * Helper: Retrieve Kashier credentials for a given restaurant strictly from DB
 */
async function getKashierCredentials(restaurantId) {
    try {
        const [settings] = await connection_1.db
            .select({ paymentGatewayType: schema_1.restaurantSettings.paymentGatewayType })
            .from(schema_1.restaurantSettings)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId))
            .limit(1);
        if (settings?.paymentGatewayType === "CUSTOM") {
            const activeGateway = await (0, getActiveCustomGateway_1.getActiveCustomGateway)(restaurantId);
            if (activeGateway?.provider === "KASHIER") {
                const rawCreds = activeGateway.record.credentials;
                if (rawCreds?.apiKey && rawCreds?.mid) {
                    return {
                        mid: rawCreds.mid,
                        apiKey: (0, encryption_1.decryptSecret)(rawCreds.apiKey),
                        secretKey: rawCreds.secretKey ? (0, encryption_1.decryptSecret)(rawCreds.secretKey) : undefined,
                        baseUrl: rawCreds.baseUrl || "https://api.kashier.io",
                        source: "custom",
                    };
                }
            }
        }
        // Platform / SYSTEM gateway fallback from DB
        const platformGateway = await (0, getActivePlatformGateway_1.getActivePlatformGateway)();
        if (platformGateway?.provider === "KASHIER" && platformGateway.credentials) {
            const creds = platformGateway.credentials;
            return {
                mid: creds.mid,
                apiKey: creds.apiKey,
                secretKey: creds.secretKey,
                baseUrl: creds.baseUrl || "https://api.kashier.io",
                source: "platform",
            };
        }
    }
    catch (err) {
        console.error(`[KashierSyncCron] Failed to resolve credentials for restaurant ${restaurantId}:`, err);
    }
    return null;
}
/**
 * Check a single pending order against Kashier's Order Lookup API
 */
async function syncSingleOrder(order, diagnosticList) {
    const diag = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        restaurantId: order.restaurantId,
        credsFound: false,
    };
    const creds = await getKashierCredentials(order.restaurantId);
    if (!creds) {
        diag.error = "No Kashier credentials found in DB";
        if (diagnosticList && diagnosticList.length < 10)
            diagnosticList.push(diag);
        return false;
    }
    diag.credsFound = true;
    diag.credsSource = creds.source;
    diag.mid = creds.mid;
    const authHeader = creds.secretKey || creds.apiKey;
    const requestHeaders = {
        "Content-Type": "application/json",
        "api-key": creds.apiKey,
    };
    if (authHeader) {
        requestHeaders["Authorization"] = authHeader;
    }
    const requestUrl = `${creds.baseUrl}/v3/payment/orders`;
    diag.requestUrl = `${requestUrl}?search=${order.id}`;
    try {
        // Query Kashier by our order UUID (merchantOrderId)
        const response = await axios_1.default.get(requestUrl, {
            params: {
                search: order.id,
            },
            headers: requestHeaders,
            timeout: 10000,
        });
        diag.httpStatus = response.status;
        const data = response.data;
        let matchedOrders = extractOrders(data);
        diag.matchedOrdersCount = matchedOrders.length;
        diag.rawResponse = data;
        if (matchedOrders.length === 0 && order.orderNumber) {
            // Also try searching by orderNumber as fallback
            const retryResp = await axios_1.default.get(requestUrl, {
                params: {
                    search: order.orderNumber,
                },
                headers: requestHeaders,
                timeout: 10000,
            }).catch(() => null);
            if (retryResp?.data) {
                const retryOrders = extractOrders(retryResp.data);
                if (retryOrders.length > 0) {
                    matchedOrders = retryOrders;
                    diag.matchedOrdersCount = matchedOrders.length;
                    diag.rawResponse = retryResp.data;
                }
            }
        }
        if (matchedOrders.length === 0) {
            diag.error = "No orders matched in Kashier";
            if (diagnosticList && diagnosticList.length < 10)
                diagnosticList.push(diag);
            return false;
        }
        // Look for any order that is PAID/CAPTURED/SUCCESS
        const paidOrder = matchedOrders.find((ko) => {
            const s = (ko.status || "").toUpperCase();
            return s === "PAID" || s === "CAPTURED" || s === "SUCCESS";
        });
        if (paidOrder) {
            const rawStatus = (paidOrder.status || "").toUpperCase();
            diag.kashierStatus = rawStatus;
            const successfulTx = (paidOrder.transactions || []).find((tx) => {
                const txStatus = (tx.status || "").toUpperCase();
                return txStatus === "SUCCESS" || txStatus === "CAPTURED" || txStatus === "PAID";
            });
            const transactionId = successfulTx?.transactionId || paidOrder.transactionId;
            const gatewayOrderId = paidOrder.id || paidOrder.orderId || paidOrder.orderReference;
            console.log(`[KashierSyncCron] Found PAID order at Kashier: Order #${order.orderNumber} (${order.id}). Confirming payment...`);
            await (0, orderPaymentConfirmation_1.confirmOrderPayment)({
                orderId: order.id,
                gateway: "kashier",
                transactionId: transactionId || undefined,
                gatewayOrderId: gatewayOrderId || undefined,
                rawPayload: paidOrder,
            });
            console.log(`[KashierSyncCron] Successfully confirmed Order #${order.orderNumber} as PAID via Cron Sync.`);
            if (diagnosticList && diagnosticList.length < 10)
                diagnosticList.push(diag);
            return true;
        }
        // Check if latest order failed
        const firstOrder = matchedOrders[0];
        const rawStatus = (firstOrder.status || "").toUpperCase();
        diag.kashierStatus = rawStatus;
        if (rawStatus === "FAILED" || rawStatus === "FAILURE" || rawStatus === "DECLINED" || rawStatus === "CANCELLED") {
            const failedTx = (firstOrder.transactions || []).find((tx) => {
                const txStatus = (tx.status || "").toUpperCase();
                return txStatus === "FAILURE" || txStatus === "FAILED" || txStatus === "DECLINED";
            });
            const failureReason = failedTx?.transactionResponseMessage?.en ||
                failedTx?.transactionResponseMessage?.ar ||
                failedTx?.transactionResponseCode ||
                `Transaction ${rawStatus}`;
            const transactionId = failedTx?.transactionId || firstOrder.transactionId;
            const gatewayOrderId = firstOrder.id || firstOrder.orderId || firstOrder.orderReference;
            await (0, orderPaymentConfirmation_1.recordFailedPayment)({
                orderId: order.id,
                gateway: "kashier",
                transactionId: transactionId || undefined,
                gatewayOrderId: gatewayOrderId || undefined,
                failureReason,
                rawPayload: firstOrder,
            });
            diag.error = `Order marked as failed: ${failureReason}`;
            console.log(`[KashierSyncCron] Order #${order.orderNumber} marked as failed: ${failureReason}`);
        }
        else {
            diag.error = `Order status at Kashier is "${rawStatus}" (not PAID)`;
        }
    }
    catch (err) {
        diag.httpStatus = err?.response?.status;
        diag.rawResponse = err?.response?.data;
        diag.error = err?.message || String(err);
        console.error(`[KashierSyncCron] Error checking order ${order.orderNumber} (${order.id}):`, diag.error);
    }
    if (diagnosticList && diagnosticList.length < 10) {
        diagnosticList.push(diag);
    }
    return false;
}
/**
 * On-Demand Single Order Sync:
 * Queries Kashier immediately for a specific order and confirms it if PAID.
 * Used during the user return / callback redirect flow.
 */
async function syncOrderByOrderId(orderId) {
    try {
        const [order] = await connection_1.db
            .select()
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId), (0, drizzle_orm_1.eq)(schema_1.orders.orderNumber, orderId), (0, drizzle_orm_1.eq)(schema_1.orders.paymentOrderId, orderId)))
            .limit(1);
        if (!order)
            return false;
        if (order.paymentStatus === "paid")
            return true;
        return await syncSingleOrder(order);
    }
    catch (err) {
        console.error(`[syncOrderByOrderId] Error syncing order ${orderId}:`, err);
        return false;
    }
}
/**
 * Lightweight Cron Sync Runner:
 * Queries ONLY recent pending Kashier orders (created within the last 30 minutes, max 10 orders).
 * This keeps server load virtually 0 while serving as a reliable fallback.
 */
async function runKashierOrderSync() {
    const now = new Date();
    const thirtySecondsAgo = new Date(now.getTime() - 30 * 1000);
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
    let confirmedCount = 0;
    const diagnostics = [];
    try {
        const pendingOrders = await connection_1.db
            .select()
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.paymentGateway, "kashier"), (0, drizzle_orm_1.ne)(schema_1.orders.paymentStatus, "paid"), (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.orders.paymentStatus, "pending_payment"), (0, drizzle_orm_1.eq)(schema_1.orders.status, "pending")), (0, drizzle_orm_1.gte)(schema_1.orders.createdAt, thirtyMinutesAgo), (0, drizzle_orm_1.lte)(schema_1.orders.createdAt, thirtySecondsAgo)))
            .limit(10); // Limit to 10 orders per run to prevent server/network spikes
        if (pendingOrders.length === 0) {
            return { checked: 0, confirmed: 0, diagnostics: [] };
        }
        console.log(`[KashierSyncCron] Checking ${pendingOrders.length} recent pending Kashier order(s)...`);
        for (const order of pendingOrders) {
            const confirmed = await syncSingleOrder(order, diagnostics);
            if (confirmed) {
                confirmedCount++;
            }
        }
        return { checked: pendingOrders.length, confirmed: confirmedCount, diagnostics };
    }
    catch (err) {
        console.error("[KashierSyncCron] Error in runKashierOrderSync:", err);
        return { checked: 0, confirmed: 0, diagnostics: [{ orderId: "", orderNumber: "", restaurantId: "", credsFound: false, error: err?.message }] };
    }
}
/**
 * Initialize the Kashier Reconciliation Cron Job.
 * Runs every 5 minutes as a lightweight safety net.
 */
function initKashierSyncCron() {
    // Run every 5 minutes: */5 * * * *
    node_cron_1.default.schedule("*/5 * * * *", async () => {
        try {
            await runKashierOrderSync();
        }
        catch (err) {
            console.error("[KashierSyncCron] Scheduled job failed:", err);
        }
    });
    console.log("🕒 Kashier Order Sync Cron initialized (lightweight, runs every 5 minutes).");
}
