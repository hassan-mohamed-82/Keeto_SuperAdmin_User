/**
 * verify-kashier-signature-debug.ts
 *
 * Paste a REAL webhook payload that Kashier sent your server (headers + raw
 * body) into the CAPTURED block below, and this script tells you:
 *   - what the CURRENT code computes (body field data.kashierSignature,
 *     unsorted keys, raw concatenation) — matches verifyKashierWebhookSignature
 *     as it exists in the repo today.
 *   - what the CORRECT method computes per Kashier's official docs
 *     (header x-kashier-signature, keys sorted alphabetically, query-string
 *     encoded key=value&key=value payload).
 *   - which one (if any) actually matches what Kashier sent.
 *
 * How to capture a real payload:
 *   Temporarily add this at the very top of handleKashierWebhook:
 *     console.log("RAW HEADERS:", JSON.stringify(req.headers));
 *     console.log("RAW BODY:", JSON.stringify(req.body));
 *   Trigger a real test webhook (pay with the test card, or use Kashier
 *   dashboard's "Test Webhook" button), copy both lines from your server
 *   console/logs, and paste them into CAPTURED below. Remove the temporary
 *   logs afterwards.
 */

import crypto from "crypto";
import * as querystring from "querystring";

// ─────────────────────── PASTE YOUR CAPTURE HERE ───────────────────────
// FIX: explicit type so `CAPTURED.body` isn't inferred as `{}` (which has no
// properties at all, hence "Property 'data' does not exist on type '{}'").
const CAPTURED: { headers: Record<string, string>; body: any } = {
    headers: {
        "x-kashier-signature": "20941541b67214108d7d222f8c768940948e50c1684537da8b795eb89c2d408c",
        // paste any other headers you want to inspect, not required
    },
    body: {
        event: "pay",
        data: {
            orderId: "48914b06-2a3c-4cc8-b20e-68d4d5988018",
            // ⚠️ REPLACE the line below with your REAL transactionId value —
            // the one in your screenshot was covered by a red box.
            transactionId: "PASTE_REAL_TRANSACTION_ID_HERE",
            status: "SUCCESS",
            amount: "150.00",
            currency: "EGP",
            signatureKeys: ["orderId", "transactionId", "status", "amount", "currency"],
            // may or may not be present depending on version — leave as-is
            // if your real capture didn't include this field at all.
        },
    },
};

// Your Payment API Key (test mode), from the Kashier dashboard.
const PAYMENT_API_KEY = process.env.KASHIER_API_KEY || "PASTE_YOUR_PAYMENT_API_KEY_HERE";
// ─────────────────────────────────────────────────────────────────────

function oldMethod(data: any, apiKey: string) {
    // Mirrors verifyKashierWebhookSignature as it exists in the repo today:
    // raw concatenation of values, in signatureKeys' own order, no sorting,
    // no separators, signed with the Payment API Key.
    if (!Array.isArray(data?.signatureKeys) || data.signatureKeys.length === 0) {
        return { signature: null, note: "no signatureKeys array in body — old method can't run" };
    }
    const payload = data.signatureKeys.map((k: string) => String(data[k] ?? "")).join("");
    const signature = crypto.createHmac("sha256", apiKey).update(payload).digest("hex");
    return { signature, payload };
}

function correctMethod(data: any, apiKey: string) {
    // Per https://developers.kashier.io/docs/webhooks and the older
    // /payment/webhook/ guide: sort signatureKeys alphabetically, pick those
    // keys from data, build a query-string (key=value&key=value, URL-encoded),
    // HMAC-SHA256 with the Payment API Key. Verify against x-kashier-signature.
    if (!Array.isArray(data?.signatureKeys) || data.signatureKeys.length === 0) {
        return { signature: null, note: "no signatureKeys array in body — correct method can't run" };
    }
    const sortedKeys = [...data.signatureKeys].sort();
    const picked: Record<string, any> = {};
    for (const k of sortedKeys) picked[k] = data[k] ?? "";
    const payload = querystring.stringify(picked);
    const signature = crypto.createHmac("sha256", apiKey).update(payload).digest("hex");
    return { signature, payload };
}

function main() {
    const data = CAPTURED.body?.data || CAPTURED.body || {};
    const headerSig = CAPTURED.headers?.["x-kashier-signature"] || "";
    const bodySig = data?.kashierSignature;

    console.log("=== Kashier Signature Diagnostic ===\n");
    console.log("Received header x-kashier-signature:", headerSig || "(none captured)");
    console.log("Received body   data.kashierSignature:", bodySig || "(none in body)");
    console.log("");

    const old = oldMethod(data, PAYMENT_API_KEY);
    const correct = correctMethod(data, PAYMENT_API_KEY);

    console.log("--- OLD method (current code) ---");
    console.log("payload signed:", old.payload || old.note);
    console.log("computed sig:  ", old.signature || "(n/a)");
    console.log("matches body field?  ", old.signature && bodySig ? old.signature === bodySig : "n/a");
    console.log("matches header?      ", old.signature && headerSig ? old.signature === headerSig : "n/a");
    console.log("");

    console.log("--- CORRECT method (per Kashier docs) ---");
    console.log("payload signed:", correct.payload || correct.note);
    console.log("computed sig:  ", correct.signature || "(n/a)");
    console.log("matches header?      ", correct.signature && headerSig ? correct.signature === headerSig : "n/a");
    console.log("matches body field?  ", correct.signature && bodySig ? correct.signature === bodySig : "n/a");
    console.log("");

    if (correct.signature && headerSig && correct.signature === headerSig) {
        console.log("✅ CONFIRMED: the CORRECT (docs) method matches. verifyKashierWebhookSignature needs to be rewritten to use this method + the x-kashier-signature header.");
    } else if (old.signature && (old.signature === bodySig || old.signature === headerSig)) {
        console.log("ℹ️  The OLD method actually matches on this account — unusual, but possible. Keep monitoring.");
    } else {
        console.log("⚠️  Neither method matched. Double-check PAYMENT_API_KEY is the TEST key (not secret key, not live key), and that you pasted the FULL raw body/transactionId exactly as received.");
    }
}

main();