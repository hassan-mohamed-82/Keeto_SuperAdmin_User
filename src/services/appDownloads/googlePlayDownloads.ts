// Reads install counts from Google Play Console "bulk reports" (Cloud Storage).
//
// Files: gs://<bucket>/stats/installs/installs_<package>_<YYYYMM>_overview.csv  (UTF-16LE CSV)
//
// Env:
//   GOOGLE_PLAY_SERVICE_ACCOUNT_PATH  path to the service account JSON key
//   (or GOOGLE_PLAY_SERVICE_ACCOUNT_JSON  the JSON itself, one line)
//   GOOGLE_PLAY_BUCKETS  comma separated buckets, one per Play Console account
//                        e.g. pubsite_prod_rev_0123456789,pubsite_prod_rev_9876543210
import { Storage } from "@google-cloud/storage";
import { AppError } from "../../Errors/appError";

// First column found wins. Google renamed some columns over time.
const INSTALL_COLUMNS = ["Daily User Installs", "Install events", "Daily Device Installs"];

let storage: Storage | null = null;
const bucketByPackage = new Map<string, string>();

export function isGooglePlayConfigured() {
    return getBuckets().length > 0 &&
        Boolean(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
}

function getBuckets(): string[] {
    return (process.env.GOOGLE_PLAY_BUCKETS || "")
        .split(",")
        .map((b) => b.trim().replace(/^gs:\/\//, "").split("/")[0])
        .filter(Boolean);
}

function getStorage(): Storage {
    if (storage) return storage;
    if (!isGooglePlayConfigured()) {
        throw new AppError(
            "Google Play reports are not configured (GOOGLE_PLAY_SERVICE_ACCOUNT_PATH and GOOGLE_PLAY_BUCKETS)",
            500
        );
    }
    const json = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
    storage = json
        ? new Storage({ credentials: JSON.parse(json) })
        : new Storage({ keyFilename: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PATH });
    return storage;
}

// Minimal CSV line parser (handles quoted values with commas)
function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cur += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ",") { out.push(cur); cur = ""; }
        else cur += ch;
    }
    out.push(cur);
    return out.map((v) => v.trim());
}

function decodeReport(buf: Buffer): string {
    // Play reports are UTF-16LE with BOM; fall back to UTF-8 just in case.
    const isUtf16 = (buf[0] === 0xff && buf[1] === 0xfe) || (buf.length > 1 && buf[1] === 0x00);
    return (isUtf16 ? buf.toString("utf16le") : buf.toString("utf8")).replace(/^﻿/, "");
}

/**
 * Downloads one month of installs for a package.
 * Returns Map<YYYY-MM-DD, installs>, or null when no report exists in any bucket.
 */
export async function fetchPlayMonthlyInstalls(packageName: string, yyyymm: string): Promise<Map<string, number> | null> {
    const gcs = getStorage();
    const path = `stats/installs/installs_${packageName}_${yyyymm}_overview.csv`;

    const known = bucketByPackage.get(packageName);
    const buckets = known ? [known, ...getBuckets().filter((b) => b !== known)] : getBuckets();

    for (const bucket of buckets) {
        const file = gcs.bucket(bucket).file(path);
        const [exists] = await file.exists();
        if (!exists) continue;

        bucketByPackage.set(packageName, bucket);
        const [buf] = await file.download();
        const lines = decodeReport(buf).split(/\r?\n/).filter((l) => l.trim() !== "");
        if (lines.length < 2) return new Map();

        const header = parseCsvLine(lines[0]);
        const dateIdx = header.indexOf("Date");
        const installsIdx = INSTALL_COLUMNS.map((c) => header.indexOf(c)).find((i) => i >= 0) ?? -1;
        if (dateIdx < 0 || installsIdx < 0) {
            throw new AppError(`Unexpected Google Play report format in ${bucket}/${path}`, 502);
        }

        const result = new Map<string, number>();
        for (const line of lines.slice(1)) {
            const cols = parseCsvLine(line);
            const date = cols[dateIdx];
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
            result.set(date, (result.get(date) ?? 0) + (parseInt(cols[installsIdx], 10) || 0));
        }
        return result;
    }
    return null;
}
