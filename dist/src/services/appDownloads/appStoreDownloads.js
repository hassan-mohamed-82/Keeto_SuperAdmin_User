"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAppStoreConfigured = isAppStoreConfigured;
exports.fetchAppStoreDownloads = fetchAppStoreDownloads;
// Reads first-time downloads from App Store Connect "Sales and Trends" reports.
//
// One report covers every app in one Apple developer account, keyed by "Apple Identifier".
// With several accounts, each account's report is fetched and the results are merged.
// DAILY reports exist for the last 365 days, MONTHLY for the last 5 years.
//
// Env (either or both):
//   Several accounts — JSON array, one line:
//     APPSTORE_CONNECT_ACCOUNTS=[{"name":"main","issuerId":"...","keyId":"...","privateKeyPath":"./AuthKey_AAA.p8","vendorNumber":"111"}]
//     (use "privateKey" with the .p8 content, "\n" escaped, instead of "privateKeyPath" if you prefer)
//   Single account (still supported, added to the list above):
//     APPSTORE_CONNECT_ISSUER_ID, APPSTORE_CONNECT_KEY_ID,
//     APPSTORE_CONNECT_PRIVATE_KEY_PATH (or APPSTORE_CONNECT_PRIVATE_KEY), APPSTORE_CONNECT_VENDOR_NUMBER
const fs_1 = __importDefault(require("fs"));
const zlib_1 = __importDefault(require("zlib"));
const axios_1 = __importDefault(require("axios"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const appError_1 = require("../../Errors/appError");
const SALES_REPORTS_URL = "https://api.appstoreconnect.apple.com/v1/salesReports";
// Product Type Identifier values that mean a first-time app download (iPhone / universal / iPad).
// 3, 3F, 3T are re-downloads and 7, 7F, 7T are updates — not counted.
const FIRST_DOWNLOAD_TYPES = new Set(["1", "1F", "1T"]);
const tokenCache = new Map();
let accountsCache = null;
function loadAccounts() {
    if (accountsCache)
        return accountsCache;
    const accounts = [];
    const json = process.env.APPSTORE_CONNECT_ACCOUNTS?.trim();
    if (json) {
        let parsed;
        try {
            parsed = JSON.parse(json);
        }
        catch {
            throw new appError_1.AppError("APPSTORE_CONNECT_ACCOUNTS is not valid JSON (it must be a JSON array on one line)", 500);
        }
        if (!Array.isArray(parsed))
            throw new appError_1.AppError("APPSTORE_CONNECT_ACCOUNTS must be a JSON array", 500);
        parsed.forEach((a, i) => {
            const missing = ["issuerId", "keyId", "vendorNumber"].filter((k) => !a?.[k]);
            if (!a?.privateKey && !a?.privateKeyPath)
                missing.push("privateKeyPath");
            if (missing.length) {
                throw new appError_1.AppError(`APPSTORE_CONNECT_ACCOUNTS[${i}] is missing: ${missing.join(", ")}`, 500);
            }
            accounts.push({
                name: String(a.name || `account-${i + 1}`),
                issuerId: String(a.issuerId),
                keyId: String(a.keyId),
                vendorNumber: String(a.vendorNumber),
                privateKey: a.privateKey,
                privateKeyPath: a.privateKeyPath,
            });
        });
    }
    const env = process.env;
    if (env.APPSTORE_CONNECT_ISSUER_ID &&
        env.APPSTORE_CONNECT_KEY_ID &&
        env.APPSTORE_CONNECT_VENDOR_NUMBER &&
        (env.APPSTORE_CONNECT_PRIVATE_KEY_PATH || env.APPSTORE_CONNECT_PRIVATE_KEY)) {
        accounts.push({
            name: "default",
            issuerId: env.APPSTORE_CONNECT_ISSUER_ID,
            keyId: env.APPSTORE_CONNECT_KEY_ID,
            vendorNumber: env.APPSTORE_CONNECT_VENDOR_NUMBER,
            privateKey: env.APPSTORE_CONNECT_PRIVATE_KEY,
            privateKeyPath: env.APPSTORE_CONNECT_PRIVATE_KEY_PATH,
        });
    }
    // Same vendor listed twice would double count its downloads
    const seen = new Set();
    accountsCache = accounts.filter((a) => {
        if (seen.has(a.vendorNumber))
            return false;
        seen.add(a.vendorNumber);
        return true;
    });
    return accountsCache;
}
function isAppStoreConfigured() {
    return loadAccounts().length > 0;
}
function getToken(account) {
    const now = Math.floor(Date.now() / 1000);
    const cached = tokenCache.get(account.keyId);
    if (cached && cached.expiresAt - 60 > now)
        return cached.value;
    let privateKey;
    try {
        privateKey = account.privateKey
            ? account.privateKey.replace(/\\n/g, "\n")
            : fs_1.default.readFileSync(account.privateKeyPath, "utf8");
    }
    catch (err) {
        throw new appError_1.AppError(`App Store account "${account.name}": cannot read private key (${err?.message || err})`, 500);
    }
    const expiresAt = now + 15 * 60; // Apple allows at most 20 minutes
    const value = jsonwebtoken_1.default.sign({ iss: account.issuerId, iat: now, exp: expiresAt, aud: "appstoreconnect-v1" }, privateKey, { algorithm: "ES256", header: { alg: "ES256", kid: account.keyId, typ: "JWT" } });
    tokenCache.set(account.keyId, { value, expiresAt });
    return value;
}
function readAppleError(data) {
    try {
        const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        const parsed = JSON.parse(text);
        return parsed?.errors?.[0]?.detail || parsed?.errors?.[0]?.title || text;
    }
    catch {
        return "Unknown error";
    }
}
async function fetchAccountReport(account, frequency, reportDate, into) {
    const res = await axios_1.default.get(SALES_REPORTS_URL, {
        params: {
            "filter[frequency]": frequency,
            "filter[reportType]": "SALES",
            "filter[reportSubType]": "SUMMARY",
            "filter[vendorNumber]": account.vendorNumber,
            "filter[reportDate]": reportDate,
            "filter[version]": "1_0",
        },
        headers: { Authorization: `Bearer ${getToken(account)}`, Accept: "application/a-gzip" },
        responseType: "arraybuffer",
        validateStatus: () => true,
        timeout: 60000,
    });
    // 404 = no sales/downloads at all in that period (or report not ready yet)
    if (res.status === 404)
        return;
    if (res.status !== 200) {
        throw new appError_1.AppError(`App Store account "${account.name}" ${frequency} report ${reportDate} failed (${res.status}): ${readAppleError(res.data)}`, 502);
    }
    const raw = Buffer.from(res.data);
    const isGzip = raw[0] === 0x1f && raw[1] === 0x8b;
    const tsv = (isGzip ? zlib_1.default.gunzipSync(raw) : raw).toString("utf8");
    const lines = tsv.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2)
        return;
    const header = lines[0].split("\t").map((h) => h.trim());
    const idIdx = header.indexOf("Apple Identifier");
    const unitsIdx = header.indexOf("Units");
    const typeIdx = header.indexOf("Product Type Identifier");
    if (idIdx < 0 || unitsIdx < 0 || typeIdx < 0) {
        throw new appError_1.AppError(`App Store account "${account.name}": unexpected report format`, 502);
    }
    for (const line of lines.slice(1)) {
        const cols = line.split("\t");
        if (!FIRST_DOWNLOAD_TYPES.has(cols[typeIdx]?.trim()))
            continue;
        const appId = cols[idIdx]?.trim();
        if (!appId)
            continue;
        into.set(appId, (into.get(appId) ?? 0) + (parseInt(cols[unitsIdx], 10) || 0));
    }
}
/**
 * Fetches the report from every configured Apple account and merges them.
 * Throws if any account fails, so a period is never saved with partial data.
 *
 * @param frequency  "DAILY" (reportDate YYYY-MM-DD) or "MONTHLY" (reportDate YYYY-MM)
 * @returns Map<appleAppId, firstTimeDownloads>
 */
async function fetchAppStoreDownloads(frequency, reportDate) {
    const accounts = loadAccounts();
    if (accounts.length === 0) {
        throw new appError_1.AppError("App Store Connect reports are not configured", 500);
    }
    const result = new Map();
    await Promise.all(accounts.map((a) => fetchAccountReport(a, frequency, reportDate, result)));
    return result;
}
