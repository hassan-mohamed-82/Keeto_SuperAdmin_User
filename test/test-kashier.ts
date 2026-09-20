// test-kashier.ts
//
// STANDALONE test script — does NOT import your app's db connection, routes,
// or the real checkout flow. Safe to run locally without touching real
// orders or payment_methods rows. Only talks to Kashier's API directly.
//
// WHAT IT TESTS:
//   1. Your KASHIER_MID / KASHIER_API_KEY / KASHIER_SECRET_KEY env vars are
//      actually loaded and non-empty.
//   2. Whether creating a hosted payment session succeeds — this is exactly
//      what failed with "Invalid token" in your real checkout.
//   3. (Optional) the HMAC hash generation used for direct charge, so you
//      can eyeball it's producing a hex string without needing a DB order.
//
// HOW TO RUN:
//   1. Put this file anywhere in your project (e.g. scripts/test-kashier.ts)
//   2. Make sure your .env file (with KASHIER_* vars) is in the project root
//   3. Run with ts-node:
//        npx ts-node scripts/test-kashier.ts
//      or compile + run with node:
//        npx tsc scripts/test-kashier.ts --outDir dist-test && node dist-test/test-kashier.js
//   4. Read the console output — it tells you exactly which step failed.

import * as dotenv from "dotenv";
dotenv.config();

import axios, { AxiosError } from "axios";
import crypto from "crypto";

// ─────────────────────────────────────────────
// Config (mirrors src/utils/kashier.ts — duplicated here so this script
// has zero dependency on the rest of your app)
// ─────────────────────────────────────────────
interface KashierConfig {
    mid: string;
    apiKey: string;
    secretKey: string;
    baseUrl: string;
    mode: "test" | "live";
}

function getKashierConfig(): KashierConfig {
    const mid = process.env.KASHIER_MID || "";
    const apiKey = process.env.KASHIER_API_KEY || "";
    const secretKey = process.env.KASHIER_SECRET_KEY || "";
    const mode = (process.env.KASHIER_MODE || "test").toLowerCase() === "live" ? "live" : "test";

    const defaultBaseUrl = mode === "live"
        ? "https://api.kashier.io"
        : "https://test-api.kashier.io";

    const baseUrl = process.env.KASHIER_BASE_URL || defaultBaseUrl;

    return { mid, apiKey, secretKey, baseUrl, mode };
}

function generateKashierOrderHash(params: {
    mid?: string;
    orderId: string | number;
    amount: string | number;
    currency: string;
}): string {
    const config = getKashierConfig();
    const merchantId = params.mid || config.mid;
    const formattedAmount = typeof params.amount === "number" ? params.amount.toFixed(2) : String(params.amount);
    const upperCurrency = (params.currency || "EGP").toUpperCase();

    const path = `/?payment=${merchantId}.${params.orderId}.${formattedAmount}.${upperCurrency}`;

    return crypto.createHmac("sha256", config.apiKey).update(path).digest("hex");
}

// ─────────────────────────────────────────────
// Helpers for readable console output
// ─────────────────────────────────────────────
const line = () => console.log("─".repeat(60));
const ok = (msg: string) => console.log(`✅ ${msg}`);
const fail = (msg: string) => console.log(`❌ ${msg}`);
const info = (msg: string) => console.log(`ℹ️  ${msg}`);

function maskSecret(val: string): string {
    if (!val) return "(empty)";
    if (val.length <= 8) return "*".repeat(val.length);
    return `${val.slice(0, 4)}${"*".repeat(val.length - 8)}${val.slice(-4)}`;
}

// ─────────────────────────────────────────────
// STEP 1: Verify env vars are loaded
// ─────────────────────────────────────────────
function step1_checkConfig(): KashierConfig {
    line();
    console.log("STEP 1: Checking Kashier environment configuration");
    line();

    const config = getKashierConfig();

    console.log(`  KASHIER_MODE     : ${config.mode}`);
    console.log(`  KASHIER_BASE_URL : ${config.baseUrl}`);
    console.log(`  KASHIER_MID      : ${config.mid || "(empty)"}`);
    console.log(`  KASHIER_API_KEY  : ${maskSecret(config.apiKey)}`);
    console.log(`  KASHIER_SECRET_KEY: ${maskSecret(config.secretKey)}`);

    if (!config.mid) fail("KASHIER_MID is missing — set it in .env");
    else ok("KASHIER_MID is set");

    if (!config.apiKey) fail("KASHIER_API_KEY is missing — set it in .env");
    else ok("KASHIER_API_KEY is set");

    if (!config.secretKey) fail("KASHIER_SECRET_KEY is missing (only needed for webhook verification, not session creation)");
    else ok("KASHIER_SECRET_KEY is set");

    if (!config.mid || !config.apiKey) {
        console.log("");
        fail("Cannot proceed to Step 2 — required env vars are missing. Fix your .env and re-run.");
        process.exit(1);
    }

    return config;
}

// ─────────────────────────────────────────────
// STEP 2: Try creating a hosted payment session
//
// ✅ FIXED per Kashier's official docs (developers.kashier.io/docs/accept-payments/payment-sessions):
//   curl --header 'Authorization: YOUR_TEST_SECRET_KEY' \
//        --header 'api-key: YOUR_TEST_API_KEY'
//
// Two things were wrong in the original kashierService.ts:
//   1. It sent only ONE header (Authorization), but Kashier requires TWO:
//      `Authorization` (secret key) AND a separate `api-key` header.
//   2. It prefixed the token with "Bearer " — Kashier does NOT use the
//      Bearer scheme here; the raw secret key goes directly as the value.
// ─────────────────────────────────────────────
async function step2_createSession(config: KashierConfig) {
    line();
    console.log("STEP 2: Attempting to create a Kashier hosted payment session");
    console.log('(using the correct header shape: "Authorization: <secretKey>" + "api-key: <apiKey>", no Bearer prefix)');
    line();

    const testOrderId = `TEST-${Date.now()}`;
    const testAmount = "10.00";
    const testCurrency = "EGP";
    const expireAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const appBaseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

    const body: Record<string, unknown> = {
        merchantId: config.mid,
        order: testOrderId,
        amount: testAmount,
        currency: testCurrency,
        expireAt,
        merchantRedirect: `${appBaseUrl}/payment/result`,
        paymentType: "one-time",
        type: "one-time",
        display: "en",
        maxFailureAttempts: 3,
        allowedMethods: "card,wallet",
        // ✅ FIXED: Kashier requires "customer" on every session, not just
        // when an email happens to be available. Real checkout.ts must
        // always send this — falling back to a placeholder when the user
        // has no email on file, instead of omitting the field entirely.
        customer: {
            email: "test-customer@example.com",
            reference: "test-customer-001",
        },
    };

    info(`Test order ID: ${testOrderId} (not a real order, not saved to any DB)`);
    info(`Amount: ${testAmount} ${testCurrency}`);
    info(`POST ${config.baseUrl}/v3/payment/sessions`);
    console.log(`  Authorization: ${maskSecret(config.secretKey)}`);
    console.log(`  api-key      : ${maskSecret(config.apiKey)}`);
    console.log("");

    try {
        const response = await axios.post(`${config.baseUrl}/v3/payment/sessions`, body, {
            headers: {
                "Content-Type": "application/json",
                "Authorization": config.secretKey, // no "Bearer " prefix
                "api-key": config.apiKey,           // separate required header
            },
            timeout: 15000,
        });

        const data = response.data;

        if (!data?.sessionUrl) {
            fail("Kashier responded but did not return a sessionUrl. Full response below:");
            console.log(JSON.stringify(data, null, 2));
            return false;
        }

        ok("Session created successfully!");
        console.log(`  sessionId : ${data._id}`);
        console.log(`  sessionUrl: ${data.sessionUrl}`);
        console.log(`  status    : ${data.status || "CREATED"}`);
        console.log(`  expireAt  : ${data.expireAt || expireAt}`);
        info("Open sessionUrl in a browser to see Kashier's hosted checkout page (test mode = no real charge).");
        return true;
    } catch (error: unknown) {
        const axiosErr = error as AxiosError<{ message?: string; error?: string }>;
        const status = axiosErr.response?.status;
        const errMsg =
            axiosErr.response?.data?.message ||
            axiosErr.response?.data?.error ||
            axiosErr.message ||
            "Unknown error";

        fail(`Session creation failed (HTTP ${status ?? "?"}): ${errMsg}`);

        if (String(errMsg).toLowerCase().includes("invalid token") || status === 401) {
            console.log("");
            info("Still 401 even with correct headers? Remaining likely causes, in order of likelihood:");
            console.log("  1. Your Kashier dashboard shows 'Your application is incomplete!' — some");
            console.log("     accounts block API access (even in test mode) until the application");
            console.log("     review step is finished. Go to your Kashier dashboard > complete the");
            console.log("     application, then re-run this test.");
            console.log("  2. KASHIER_MID doesn't match the account these keys were generated for.");
            console.log("  3. The keys were copied with extra whitespace/newline from the dashboard.");
            console.log("  4. The keys shown under 'Payment API Keys' in your dashboard are for the");
            console.log("     older hash-based Checkout API, not the v3 Payment Sessions API — check");
            console.log("     if there's a separate 'API Key' + 'Secret Key' pair specifically for");
            console.log("     Payment Sessions under Integrations, distinct from the hash-signing key.");
        }

        if (axiosErr.response?.data) {
            console.log("");
            info("Full error response from Kashier:");
            console.log(JSON.stringify(axiosErr.response.data, null, 2));
        }

        return false;
    }
}

// ─────────────────────────────────────────────
// STEP 3: Sanity-check the HMAC hash used for direct charge
// (no network call — just confirms the function produces a valid hash,
// useful if you also plan to test executeDirectCharge later)
// ─────────────────────────────────────────────
function step3_checkHashGeneration(config: KashierConfig) {
    line();
    console.log("STEP 3: Sanity-checking order hash generation (used by direct charge)");
    line();

    const hash = generateKashierOrderHash({
        mid: config.mid,
        orderId: "TEST-ORDER-ID",
        amount: "10.00",
        currency: "EGP",
    });

    if (/^[a-f0-9]{64}$/.test(hash)) {
        ok(`Hash generated correctly: ${hash}`);
    } else {
        fail(`Hash looks wrong (expected 64-char hex, got): ${hash}`);
    }
}

// ─────────────────────────────────────────────
// Run all steps
// ─────────────────────────────────────────────
(async () => {
    console.log("\n🧪 Kashier Integration Test (standalone — no DB, no real orders)\n");

    const config = step1_checkConfig();
    const sessionOk = await step2_createSession(config);
    step3_checkHashGeneration(config);

    line();
    console.log("SUMMARY");
    line();
    if (sessionOk) {
        ok("Kashier token/config is working. Session creation succeeds.");
        info("Once you're ready, flip payment_methods.is_active = 1 for visa and re-enable the isActive check in checkout.ts.");
    } else {
        fail("Kashier session creation is still failing — fix the token/config before enabling visa in production.");
    }
    console.log("");
})();