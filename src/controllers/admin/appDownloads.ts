import { Request, Response } from "express";
import dayjs from "dayjs";
import { and, eq, gte, lte, sql, SQL } from "drizzle-orm";
import { db } from "../../models/connection";
import { restaurantAppDownloads, restaurants } from "../../models/schema";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { syncAppDownloads } from "../../services/appDownloads/syncAppDownloads";
import { resolveAndroidPackageName, resolveAppleAppId } from "../../utils/appStoreIdentifiers";
import {
    getAppDownloadsQuerySchema,
    restaurantAppDownloadsParamsSchema,
    restaurantAppDownloadsQuerySchema,
    syncAppDownloadsSchema,
} from "../../validation/admin/appDownloads";

const MAX_SYNC_DAYS = 366;

// ==========================================
// POST /admin/app-downloads/sync
// Pulls download counts from Google Play / App Store Connect and saves them.
// Default range: yesterday only.
// ==========================================
export const syncAppDownloadsHandler = async (req: Request, res: Response) => {
    const body = syncAppDownloadsSchema.parse(req.body ?? {});

    const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
    const to = body.to && body.to < yesterday ? body.to : yesterday; // stores have no data for today
    const from = body.from ?? to;
    if (from > to) throw new BadRequest("from must be before yesterday (stores publish data with a 1 day delay)");

    const days = dayjs(to).diff(dayjs(from), "day") + 1;
    if (days > MAX_SYNC_DAYS) {
        throw new BadRequest(`Sync at most ${MAX_SYNC_DAYS} days per request (requested ${days}). Split the range.`);
    }

    if (body.restaurantId) {
        const [exists] = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, body.restaurantId)).limit(1);
        if (!exists) throw new NotFound("Restaurant not found");
    }

    const result = await syncAppDownloads({ platform: body.platform, from, to, restaurantId: body.restaurantId });
    SuccessResponse(res, { message: "App downloads synced", ...result });
};

// ==========================================
// GET /admin/app-downloads
// Total downloads per restaurant (android / ios / total) for a date range (default: all time).
// ==========================================
export const getAppDownloads = async (req: Request, res: Response) => {
    const { from, to, search, restaurantId, platform, page, limit } = getAppDownloadsQuerySchema.parse(req.query);

    // Conditions on the downloads join
    const joinConditions: SQL[] = [eq(restaurantAppDownloads.restaurantId, restaurants.id)];
    if (from) joinConditions.push(gte(restaurantAppDownloads.date, from));
    if (to) joinConditions.push(lte(restaurantAppDownloads.date, to));
    if (platform !== "all") joinConditions.push(eq(restaurantAppDownloads.platform, platform));

    // Only restaurants that have at least one app
    const where: SQL[] = [
        sql`(
            COALESCE(${restaurants.androidApp}, '') <> '' OR COALESCE(${restaurants.iosApp}, '') <> ''
            OR ${restaurants.androidPackageName} IS NOT NULL OR ${restaurants.appleAppId} IS NOT NULL
        )`,
    ];
    if (restaurantId) where.push(eq(restaurants.id, restaurantId));
    if (search) {
        const like = `%${search}%`;
        where.push(sql`(${restaurants.name} LIKE ${like} OR ${restaurants.nameAr} LIKE ${like})`);
    }

    const androidSum = sql<number>`COALESCE(SUM(CASE WHEN ${restaurantAppDownloads.platform} = 'android' THEN ${restaurantAppDownloads.downloads} ELSE 0 END), 0)`;
    const iosSum = sql<number>`COALESCE(SUM(CASE WHEN ${restaurantAppDownloads.platform} = 'ios' THEN ${restaurantAppDownloads.downloads} ELSE 0 END), 0)`;
    const totalSum = sql<number>`COALESCE(SUM(${restaurantAppDownloads.downloads}), 0)`;

    const rows = await db
        .select({
            id: restaurants.id,
            name: restaurants.name,
            nameAr: restaurants.nameAr,
            logo: restaurants.logo,
            iosApp: restaurants.iosApp,
            androidApp: restaurants.androidApp,
            appBundleId: restaurants.appBundleId,
            androidPackageName: restaurants.androidPackageName,
            appleAppId: restaurants.appleAppId,
            android: androidSum,
            ios: iosSum,
            total: totalSum,
            lastDataDate: sql<string | null>`MAX(${restaurantAppDownloads.date})`,
        })
        .from(restaurants)
        .leftJoin(restaurantAppDownloads, and(...joinConditions))
        .where(and(...where))
        .groupBy(restaurants.id)
        .orderBy(sql`${totalSum} DESC`, restaurants.name)
        .limit(limit)
        .offset((page - 1) * limit);

    const [countRow] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(restaurants)
        .where(and(...where));

    const [totalsRow] = await db
        .select({ android: androidSum, ios: iosSum, total: totalSum })
        .from(restaurants)
        .innerJoin(restaurantAppDownloads, and(...joinConditions))
        .where(and(...where));

    const total = Number(countRow?.count ?? 0);

    SuccessResponse(res, {
        range: { from: from ?? null, to: to ?? null },
        totals: {
            android: Number(totalsRow?.android ?? 0),
            ios: Number(totalsRow?.ios ?? 0),
            total: Number(totalsRow?.total ?? 0),
        },
        restaurants: rows.map((r) => ({
            id: r.id,
            name: r.name,
            nameAr: r.nameAr,
            logo: r.logo,
            iosApp: r.iosApp || null,
            androidApp: r.androidApp || null,
            appBundleId: r.appBundleId,
            androidPackageName: resolveAndroidPackageName(r),
            appleAppId: resolveAppleAppId(r),
            downloads: { android: Number(r.android), ios: Number(r.ios), total: Number(r.total) },
            lastDataDate: r.lastDataDate ? dayjs(r.lastDataDate).format("YYYY-MM-DD") : null,
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
};

// ==========================================
// GET /admin/app-downloads/:restaurantId
// Downloads over time for one restaurant (grouped by day / month / year).
// ==========================================
export const getRestaurantAppDownloads = async (req: Request, res: Response) => {
    const { restaurantId } = restaurantAppDownloadsParamsSchema.parse(req.params);
    const { from, to, groupBy } = restaurantAppDownloadsQuerySchema.parse(req.query);

    const [restaurant] = await db
        .select({
            id: restaurants.id,
            name: restaurants.name,
            nameAr: restaurants.nameAr,
            logo: restaurants.logo,
            iosApp: restaurants.iosApp,
            androidApp: restaurants.androidApp,
            appBundleId: restaurants.appBundleId,
            androidPackageName: restaurants.androidPackageName,
            appleAppId: restaurants.appleAppId,
        })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);
    if (!restaurant) throw new NotFound("Restaurant not found");

    const conditions: SQL[] = [eq(restaurantAppDownloads.restaurantId, restaurantId)];
    if (from) conditions.push(gte(restaurantAppDownloads.date, from));
    if (to) conditions.push(lte(restaurantAppDownloads.date, to));

    const format = groupBy === "day" ? "%Y-%m-%d" : groupBy === "month" ? "%Y-%m" : "%Y";
    const period = sql<string>`DATE_FORMAT(${restaurantAppDownloads.date}, ${format})`;

    const series = await db
        .select({
            period,
            android: sql<number>`COALESCE(SUM(CASE WHEN ${restaurantAppDownloads.platform} = 'android' THEN ${restaurantAppDownloads.downloads} ELSE 0 END), 0)`,
            ios: sql<number>`COALESCE(SUM(CASE WHEN ${restaurantAppDownloads.platform} = 'ios' THEN ${restaurantAppDownloads.downloads} ELSE 0 END), 0)`,
            hasMonthlyRows: sql<number>`MAX(${restaurantAppDownloads.granularity} = 'month')`,
        })
        .from(restaurantAppDownloads)
        .where(and(...conditions))
        .groupBy(period)
        .orderBy(period);

    const points = series.map((s) => ({
        period: s.period,
        android: Number(s.android),
        ios: Number(s.ios),
        total: Number(s.android) + Number(s.ios),
        // true = iOS count for this period is a whole-month total (data older than 365 days)
        monthlyOnly: Number(s.hasMonthlyRows) === 1,
    }));

    const totals = points.reduce(
        (acc, p) => ({ android: acc.android + p.android, ios: acc.ios + p.ios, total: acc.total + p.total }),
        { android: 0, ios: 0, total: 0 }
    );

    SuccessResponse(res, {
        restaurant: {
            ...restaurant,
            androidPackageName: resolveAndroidPackageName(restaurant),
            appleAppId: resolveAppleAppId(restaurant),
        },
        range: { from: from ?? null, to: to ?? null },
        groupBy,
        totals,
        series: points,
    });
};
