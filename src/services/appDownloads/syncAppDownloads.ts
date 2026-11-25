import dayjs from "dayjs";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../../models/connection";
import { restaurantAppDownloads, restaurants } from "../../models/schema";
import { resolveAndroidPackageName, resolveAppleAppId } from "../../utils/appStoreIdentifiers";
import { fetchPlayMonthlyInstalls, isGooglePlayConfigured } from "./googlePlayDownloads";
import { fetchAppStoreDownloads, isAppStoreConfigured } from "./appStoreDownloads";

export type SyncPlatform = "all" | "android" | "ios";

type Row = typeof restaurantAppDownloads.$inferInsert;

type PlatformSummary = {
    restaurantsMatched: number;
    restaurantsSkipped: { id: string; name: string; reason: string }[];
    rowsSaved: number;
    totalDownloads: number;
    errors: string[];
};

const APPLE_DAILY_WINDOW_DAYS = 365;
const DATE = "YYYY-MM-DD";

// Runs async work over items with limited parallelism.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
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

function eachDay(from: string, to: string): string[] {
    const days: string[] = [];
    for (let d = dayjs(from); !d.isAfter(dayjs(to), "day"); d = d.add(1, "day")) days.push(d.format(DATE));
    return days;
}

function eachMonth(from: string, to: string): string[] {
    const months: string[] = [];
    for (let m = dayjs(from).startOf("month"); !m.isAfter(dayjs(to), "month"); m = m.add(1, "month")) {
        months.push(m.format("YYYY-MM"));
    }
    return months;
}

const emptySummary = (): PlatformSummary => ({
    restaurantsMatched: 0,
    restaurantsSkipped: [],
    rowsSaved: 0,
    totalDownloads: 0,
    errors: [],
});

// Replaces the saved rows of (restaurants, platform) inside the given dates with fresh ones.
async function replaceRows(
    platform: "android" | "ios",
    restaurantIds: string[],
    dates: { from: string; to: string }[],
    rows: Row[]
) {
    if (restaurantIds.length === 0) return;
    await db.transaction(async (tx) => {
        for (const range of dates) {
            await tx
                .delete(restaurantAppDownloads)
                .where(
                    and(
                        eq(restaurantAppDownloads.platform, platform),
                        inArray(restaurantAppDownloads.restaurantId, restaurantIds),
                        gte(restaurantAppDownloads.date, range.from),
                        lte(restaurantAppDownloads.date, range.to)
                    )
                );
        }
        for (let i = 0; i < rows.length; i += 500) {
            await tx.insert(restaurantAppDownloads).values(rows.slice(i, i + 500));
        }
    });
}

// Merges consecutive days into ranges so the delete runs in few queries.
function toRanges(days: string[]): { from: string; to: string }[] {
    const sorted = [...days].sort();
    const ranges: { from: string; to: string }[] = [];
    for (const d of sorted) {
        const last = ranges[ranges.length - 1];
        if (last && dayjs(last.to).add(1, "day").format(DATE) === d) last.to = d;
        else ranges.push({ from: d, to: d });
    }
    return ranges;
}

type RestaurantRow = {
    id: string;
    name: string;
    androidPackageName: string | null;
    androidApp: string | null;
    appleAppId: string | null;
    iosApp: string | null;
};

// ==========================================
// ANDROID (Google Play)
// ==========================================
async function syncAndroid(list: RestaurantRow[], from: string, to: string): Promise<PlatformSummary> {
    const summary = emptySummary();
    if (!isGooglePlayConfigured()) {
        summary.errors.push("Google Play is not configured: set GOOGLE_PLAY_SERVICE_ACCOUNT_PATH and GOOGLE_PLAY_BUCKETS in .env");
        return summary;
    }
    const targets: { id: string; name: string; pkg: string }[] = [];
    for (const r of list) {
        const pkg = resolveAndroidPackageName(r);
        if (pkg) targets.push({ id: r.id, name: r.name, pkg });
        else summary.restaurantsSkipped.push({ id: r.id, name: r.name, reason: "No android package name / Play Store link" });
    }
    summary.restaurantsMatched = targets.length;

    const months = eachMonth(from, to).map((m) => m.replace("-", ""));
    const okIds: string[] = [];
    const rows: Row[] = [];

    await mapLimit(targets, 5, async (t) => {
        try {
            let foundAny = false;
            for (const yyyymm of months) {
                const daily = await fetchPlayMonthlyInstalls(t.pkg, yyyymm);
                if (!daily) continue;
                foundAny = true;
                for (const [date, downloads] of daily) {
                    if (date < from || date > to || downloads <= 0) continue;
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
        } catch (err: any) {
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
async function syncIos(list: RestaurantRow[], from: string, to: string): Promise<PlatformSummary> {
    const summary = emptySummary();
    if (!isAppStoreConfigured()) {
        summary.errors.push("App Store Connect is not configured: set APPSTORE_CONNECT_ACCOUNTS (or APPSTORE_CONNECT_ISSUER_ID, APPSTORE_CONNECT_KEY_ID, APPSTORE_CONNECT_PRIVATE_KEY_PATH and APPSTORE_CONNECT_VENDOR_NUMBER) in .env");
        return summary;
    }
    const restaurantByAppId = new Map<string, string>();
    for (const r of list) {
        const appId = resolveAppleAppId(r);
        if (appId) restaurantByAppId.set(appId, r.id);
        else summary.restaurantsSkipped.push({ id: r.id, name: r.name, reason: "No Apple app id / App Store link" });
    }
    summary.restaurantsMatched = restaurantByAppId.size;
    if (restaurantByAppId.size === 0) return summary;
    const restaurantIds = [...restaurantByAppId.values()];

    // Apple keeps DAILY reports for 365 days only. Any month that has a requested day older
    // than that is synced from the MONTHLY report and saved as one row on the 1st of the month.
    const dailyCutoff = dayjs().subtract(APPLE_DAILY_WINDOW_DAYS, "day").format(DATE);
    const days = eachDay(from, to);
    const monthlyMonths = [...new Set(days.filter((d) => d < dailyCutoff).map((d) => d.slice(0, 7)))];
    const dailyDays = days.filter((d) => !monthlyMonths.includes(d.slice(0, 7)));

    const rows: Row[] = [];
    const okDays: string[] = [];
    const okMonthRanges: { from: string; to: string }[] = [];

    const collect = (downloadsByApp: Map<string, number>, date: string, granularity: "day" | "month") => {
        for (const [appId, downloads] of downloadsByApp) {
            const restaurantId = restaurantByAppId.get(appId);
            if (!restaurantId || downloads <= 0) continue;
            rows.push({ restaurantId, platform: "ios", date, granularity, downloads });
            summary.totalDownloads += downloads;
        }
    };

    await mapLimit(dailyDays, 4, async (day) => {
        try {
            collect(await fetchAppStoreDownloads("DAILY", day), day, "day");
            okDays.push(day);
        } catch (err: any) {
            summary.errors.push(err?.message || String(err));
        }
    });

    await mapLimit(monthlyMonths, 4, async (month) => {
        try {
            const first = dayjs(`${month}-01`);
            collect(await fetchAppStoreDownloads("MONTHLY", month), first.format(DATE), "month");
            okMonthRanges.push({ from: first.format(DATE), to: first.endOf("month").format(DATE) });
        } catch (err: any) {
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
export async function syncAppDownloads(opts: {
    platform: SyncPlatform;
    from: string;
    to: string;
    restaurantId?: string;
}) {
    const list = await db
        .select({
            id: restaurants.id,
            name: restaurants.name,
            androidPackageName: restaurants.androidPackageName,
            androidApp: restaurants.androidApp,
            appleAppId: restaurants.appleAppId,
            iosApp: restaurants.iosApp,
        })
        .from(restaurants)
        .where(opts.restaurantId ? eq(restaurants.id, opts.restaurantId) : undefined);

    const result: { from: string; to: string; android?: PlatformSummary; ios?: PlatformSummary } = {
        from: opts.from,
        to: opts.to,
    };

    const [android, ios] = await Promise.all([
        opts.platform !== "ios" ? syncAndroid(list, opts.from, opts.to) : undefined,
        opts.platform !== "android" ? syncIos(list, opts.from, opts.to) : undefined,
    ]);
    if (android) result.android = android;
    if (ios) result.ios = ios;
    return result;
}
