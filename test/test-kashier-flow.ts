/**
 * test-kashier-flow.ts
 *
 * Full end-to-end console test for the Kashier flow. It:
 *   1. Calls YOUR backend's /kashier/session endpoint (real Kashier test API call).
 *   2. Prints the pay link + the official Kashier test card.
 *   3. Waits for you to actually pay (press Enter when done).
 *   4. Polls your backend for the order's current payment_status/paymentTransactionId
 *      every few seconds and logs every change, so you can watch in real time
 *      whether the webhook ever arrives and updates the order.
 *
 * Usage:
 *   npx ts-node test-kashier-flow.ts <restId> <orderId>
 *
 * IMPORTANT: if BASE_URL points at localhost, the webhook step (#4) will
 * likely stay stuck at "pending_payment" forever, because Kashier's server
 * cannot reach your machine — that's expected, not a bug. To actually see
 * the webhook fire while testing locally, run `ngrok http <port>` and set
 * that ngrok URL as the Webhook URL in the Kashier dashboard temporarily.
 */

import * as readline from "readline";

// ─────────────────────────── CONFIG ───────────────────────────
const CONFIG = {
    BASE_URL: process.env.BASE_URL || "http://localhost:3000",
    SESSION_ENDPOINT: process.env.SESSION_ENDPOINT || "/api/payments/kashier/session",
    // Adjust this to whatever route actually exists in your app that returns
    // order status as JSON, e.g. { paymentStatus, paymentGateway, paymentTransactionId }.
    STATUS_ENDPOINT_FN: (restId: string, orderId: string) => `/api/superadmin/${restId}/${orderId}/status`,
    POLL_INTERVAL_MS: 4000,
    POLL_TIMEOUT_MS: 5 * 60 * 1000, // stop polling after 5 minutes
};
// ─────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

function log(color: string, label: string, msg: string) {
    const time = new Date().toISOString().split("T")[1].replace("Z", "");
    console.log(`${DIM}[${time}]${RESET} ${color}${label}${RESET} ${msg}`);
}

function waitForEnter(promptText: string) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise<void>((resolve) => {
        rl.question(promptText, () => {
            rl.close();
            resolve();
        });
    });
}

async function createSession(orderId: string) {
    const url = `${CONFIG.BASE_URL}${CONFIG.SESSION_ENDPOINT}`;
    log(CYAN, "[1/4]", `Creating Kashier session -> POST ${url}`);

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
    });

    const body: any = await res.json().catch(() => null);

    if (!res.ok) {
        log(RED, "[1/4] FAILED", `Status ${res.status}: ${JSON.stringify(body)}`);
        process.exitCode = 1;
        throw new Error("Session creation failed");
    }

    log(GREEN, "[1/4] OK", "Session created:");
    console.log(JSON.stringify(body, null, 2));
    return body;
}

async function checkStatus(restId: string, orderId: string): Promise<any> {
    const url = `${CONFIG.BASE_URL}${CONFIG.STATUS_ENDPOINT_FN(restId, orderId)}`;
    try {
        const res = await fetch(url);
        if (!res.ok) return { error: `HTTP ${res.status}` };
        return await res.json();
    } catch (err: any) {
        return { error: err?.message };
    }
}

async function pollOrderStatus(restId: string, orderId: string) {
    log(CYAN, "[4/4]", `Polling order status every ${CONFIG.POLL_INTERVAL_MS / 1000}s (waiting for the webhook)...`);
    const start = Date.now();
    let lastStatusJson = "";

    while (Date.now() - start < CONFIG.POLL_TIMEOUT_MS) {
        const status = await checkStatus(restId, orderId);
        const statusJson = JSON.stringify(status);

        if (statusJson !== lastStatusJson) {
            if (status.error) {
                log(YELLOW, "[poll]", `Could not read status: ${status.error} (adjust STATUS_ENDPOINT_FN to a real route in your app)`);
            } else {
                log(GREEN, "[poll] CHANGED", JSON.stringify(status));
            }
            lastStatusJson = statusJson;
        } else {
            process.stdout.write(".");
        }

        if (status?.paymentStatus === "paid") {
            log(GREEN, "[SUCCESS]", "Order marked as paid! Webhook worked end-to-end. 🎉");
            return;
        }
        if (status?.paymentStatus === "payment_failed") {
            log(RED, "[FAILED]", "Order marked as payment_failed by the webhook.");
            return;
        }

        await new Promise((r) => setTimeout(r, CONFIG.POLL_INTERVAL_MS));
    }

    log(YELLOW, "[TIMEOUT]", "Gave up waiting. If status never changed from pending_payment, the webhook never arrived or failed signature verification — check your server logs for '[Kashier Webhook Received]' or 'Invalid webhook signature'.");
}

async function main() {
    const restId = process.argv[2];
    const orderId = process.argv[3];
    if (!orderId || !restId) {
        console.error("Usage: npx ts-node test-kashier-flow.ts <restId> <orderId>");
        process.exit(1);
    }

    log(CYAN, "[0/4]", `Target backend: ${CONFIG.BASE_URL}`);
    const session = await createSession(orderId);

    // FIX: your API wraps the payload as { success, data: { sessionUrl, ... } }
    const sessionUrl = session?.data?.sessionUrl || session?.sessionUrl || session?.payment?.sessionUrl;
    if (!sessionUrl) {
        log(RED, "[2/4] FAILED", "No sessionUrl in the response — check the payload above.");
        process.exitCode = 1;
        return;
    }

    log(CYAN, "[2/4]", "Open this link in your browser and pay:");
    console.log(`\n  ${sessionUrl}\n`);
    log(CYAN, "[3/4]", "Test card:");
    console.log("  Card:   5123450000000008 (Mastercard, 3-D Secure)");
    console.log("  Expiry: 06/25   <- this exact value returns APPROVED");
    console.log("  CVV:    100\n");

    await waitForEnter("Press Enter once you've completed the payment in the browser...\n");

    await pollOrderStatus(restId, orderId);
}

main()
    .catch((err) => {
        console.error("Unexpected error:", err);
        process.exitCode = 1;
    })
    .finally(() => {
        // Give any lingering fetch/keep-alive sockets a tick to close cleanly
        // before the process exits — avoids the Node 24 Windows libuv crash
        // ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)") that
        // happens when the event loop is torn down while sockets are open.
        setTimeout(() => process.exit(), 100);
    });