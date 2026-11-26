"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncAppDownloads = syncAppDownloads;
const dayjs_1 = __importDefault(require("dayjs"));
const drizzle_orm_1 = require("drizzle-orm");
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const appStoreIdentifiers_1 = require("../../utils/appStoreIdentifiers");
const googlePlayDownloads_1 = require("./googlePlayDownloads");
const appStoreDownloads_1 = require("./appStoreDownloads");
const APPLE_DAILY_WINDOW_DAYS = 365;
const DATE = "YYYY-MM-DD";
// Runs async work over items with limited parallelism.
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i]);
        }
    });
    await Promise.all(workers);
    return results;
}
function eachDay(from, to) {
    const days = [];
    for (let d = (0, dayjs_1.default)(from); !d.isAfter((0, dayjs_1.default)(to), "day"); d = d.add(1, "day"))
        days.push(d.format(DATE));
    return days;
}
function eachMonth(from, to) {
    const months = [];
    for (let m = (0, dayjs_1.default)(from).startOf("month"); !m.isAfter((0, dayjs_1.default)(to), "month"); m = m.add(1, "month")) {
        months.push(m.format("YYYY-MM"));
    }
    return months;
}
const emptySummary = () => ({
    restaurantsMatched: 0,
    restaurantsSkipped: [],
    rowsSaved: 0,
    totalDownloads: 0,
    errors: [],
});
// Replaces the saved rows of (restaurants, platform) inside the given dates with fresh ones.
async function replaceRows(platform, restaurantIds, dates, rows) {
    if (restaurantIds.length === 0)
        return;
    await connection_1.db.transaction(async (tx) => {
        for (const range of dates) {
            await tx
                .delete(schema_1.restaurantAppDownloads)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantAppDownloads.platform, platform), (0, drizzle_orm_1.inArray)(schema_1.restaurantAppDownloads.restaurantId, restaurantIds), (0, drizzle_orm_1.gte)(schema_1.restaurantAppDownloads.date, range.from), (0, drizzle_orm_1.lte)(schema_1.restaurantAppDownloads.date, range.to)));
        }
        for (let i = 0; i < rows.length; i += 500) {
            await tx.insert(schema_1.restaurantAppDownloads).values(rows.slice(i, i + 500));
        }
    });
}
// Merges consecutive days into ranges so the delete runs in few queries.
function toRanges(days) {
    const sorted = [...days].sort();
    const ranges = [];
    for (const d of sorted) {
        const last = ranges[ranges.length - 1];
        if (last && (0, dayjs_1.default)(last.to).add(1, "day").format(DATE) === d)
            last.to = d;
        else
            ranges.push({ from: d, to: d });
    }
    return ranges;
}
// ==========================================
// ANDROID (Google Play)
// ==========================================
async function syncAndroid(list, from, to) {
    const summary = emptySummary();
    if (!(0, googlePlayDownloads_1.isGooglePlayConfigured)()) {
        summary.errors.push("Google Play is not configured: set GOOGLE_PLAY_SERVICE_ACCOUNT_PATH and GOOGLE_PLAY_BUCKETS in .env");
        return summary;
    }
    const targets = [];
    for (const r of list) {
        const pkg = (0, appStoreIdentifiers_1.resolveAndroidPackageName)(r);
        if (pkg)
            targets.push({ id: r.id, name: r.name, pkg });
        else
            summary.restaurantsSkipped.push({ id: r.id, name: r.name, reason: "No android package name / Play Store link" });
    }
    summary.restaurantsMatched = targets.length;
    const months = eachMonth(from, to).map((m) => m.replace("-", ""));
    const okIds = [];
    const rows = [];
    await mapLimit(targets, 5, async (t) => {
        try {
            let foundAny = false;
            for (const yyyymm of months) {
                const daily = await (0, googlePlayDownloads_1.fetchPlayMonthlyInstalls)(t.pkg, yyyymm);
                if (!daily)
                    continue;
                foundAny = true;
                for (const [date, downloads] of daily) {
                    if (date < from || date > to || downloads <= 0)
                        continue;
                    rows.push({ restaurantId: t.id, platform: "android", date, granularity: "day", downloads });
                    summary.totalDownloads += downloads;
                }
            }
            if (!foundAny) {
                summary.restaurantsSkipped.push({
                    id: t.id,
                    name: t.name,
                    reason: `No Play report found for ${t.pkg} (check the package name, bucket access, or the app is new)`,
                });
            }
            okIds.push(t.id);
        }
        catch (err) {
            summary.errors.push(`${t.name} (${t.pkg}): ${err?.message || err}`);
        }
    });
    await replaceRows("android", okIds, [{ from, to }], rows);
    summary.rowsSaved = rows.length;
    return summary;
}
// ==========================================
// iOS (App Store Connect)
// ==========================================
async function syncIos(list, from, to) {
    const summary = emptySummary();
    if (!(0, appStoreDownloads_1.isAppStoreConfigured)()) {
        summary.errors.push("App Store Connect is not configured: set APPSTORE_CONNECT_ACCOUNTS (or APPSTORE_CONNECT_ISSUER_ID, APPSTORE_CONNECT_KEY_ID, APPSTORE_CONNECT_PRIVATE_KEY_PATH and APPSTORE_CONNECT_VENDOR_NUMBER) in .env");
        return summary;
    }
    const restaurantByAppId = new Map();
    for (const r of list) {
        const appId = (0, appStoreIdentifiers_1.resolveAppleAppId)(r);
        if (appId)
            restaurantByAppId.set(appId, r.id);
        else
            summary.restaurantsSkipped.push({ id: r.id, name: r.name, reason: "No Apple app id / App Store link" });
    }
    summary.restaurantsMatched = restaurantByAppId.size;
    if (restaurantByAppId.size === 0)
        return summary;
    const restaurantIds = [...restaurantByAppId.values()];
    // Apple keeps DAILY reports for 365 days only. Any month that has a requested day older
    // than that is synced from the MONTHLY report and saved as one row on the 1st of the month.
    const dailyCutoff = (0, dayjs_1.default)().subtract(APPLE_DAILY_WINDOW_DAYS, "day").format(DATE);
    const days = eachDay(from, to);
    const monthlyMonths = [...new Set(days.filter((d) => d < dailyCutoff).map((d) => d.slice(0, 7)))];
    const dailyDays = days.filter((d) => !monthlyMonths.includes(d.slice(0, 7)));
    const rows = [];
    const okDays = [];
    const okMonthRanges = [];
    const collect = (downloadsByApp, date, granularity) => {
        for (const [appId, downloads] of downloadsByApp) {
            const restaurantId = restaurantByAppId.get(appId);
            if (!restaurantId || downloads <= 0)
                continue;
            rows.push({ restaurantId, platform: "ios", date, granularity, downloads });
            summary.totalDownloads += downloads;
        }
    };
    await mapLimit(dailyDays, 4, async (day) => {
        try {
            collect(await (0, appStoreDownloads_1.fetchAppStoreDownloads)("DAILY", day), day, "day");
            okDays.push(day);
        }
        catch (err) {
            summary.errors.push(err?.message || String(err));
        }
    });
    await mapLimit(monthlyMonths, 4, async (month) => {
        try {
            const first = (0, dayjs_1.default)(`${month}-01`);
            collect(await (0, appStoreDownloads_1.fetchAppStoreDownloads)("MONTHLY", month), first.format(DATE), "month");
            okMonthRanges.push({ from: first.format(DATE), to: first.endOf("month").format(DATE) });
        }
        catch (err) {
            summary.errors.push(err?.message || String(err));
        }
    });
    await replaceRows("ios", restaurantIds, [...toRanges(okDays), ...okMonthRanges], rows);
    summary.rowsSaved = rows.length;
    return summary;
}
// ==========================================
// ENTRY POINT
// ==========================================
async function syncAppDownloads(opts) {
    const list = await connection_1.db
        .select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        androidPackageName: schema_1.restaurants.androidPackageName,
        androidApp: schema_1.restaurants.androidApp,
        appleAppId: schema_1.restaurants.appleAppId,
        iosApp: schema_1.restaurants.iosApp,
    })
        .from(schema_1.restaurants)
        .where(opts.restaurantId ? (0, drizzle_orm_1.eq)(schema_1.restaurants.id, opts.restaurantId) : undefined);
    const result = {
        from: opts.from,
        to: opts.to,
    };
    const [android, ios] = await Promise.all([
        opts.platform !== "ios" ? syncAndroid(list, opts.from, opts.to) : undefined,
        opts.platform !== "android" ? syncIos(list, opts.from, opts.to) : undefined,
    ]);
    if (android)
        result.android = android;
    if (ios)
        result.ios = ios;
    return result;
}
