"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRestaurantAppDownloads = exports.getAppDownloads = exports.syncAppDownloadsHandler = void 0;
const dayjs_1 = __importDefault(require("dayjs"));
const drizzle_orm_1 = require("drizzle-orm");
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const syncAppDownloads_1 = require("../../services/appDownloads/syncAppDownloads");
const appStoreIdentifiers_1 = require("../../utils/appStoreIdentifiers");
const appDownloads_1 = require("../../validation/admin/appDownloads");
const MAX_SYNC_DAYS = 366;
// ==========================================
// POST /admin/app-downloads/sync
// Pulls download counts from Google Play / App Store Connect and saves them.
// Default range: yesterday only.
// ==========================================
const syncAppDownloadsHandler = async (req, res) => {
    const body = appDownloads_1.syncAppDownloadsSchema.parse(req.body ?? {});
    const yesterday = (0, dayjs_1.default)().subtract(1, "day").format("YYYY-MM-DD");
    const to = body.to && body.to < yesterday ? body.to : yesterday; // stores have no data for today
    const from = body.from ?? to;
    if (from > to)
        throw new BadRequest_1.BadRequest("from must be before yesterday (stores publish data with a 1 day delay)");
    const days = (0, dayjs_1.default)(to).diff((0, dayjs_1.default)(from), "day") + 1;
    if (days > MAX_SYNC_DAYS) {
        throw new BadRequest_1.BadRequest(`Sync at most ${MAX_SYNC_DAYS} days per request (requested ${days}). Split the range.`);
    }
    if (body.restaurantId) {
        const [exists] = await connection_1.db.select({ id: schema_1.restaurants.id }).from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, body.restaurantId)).limit(1);
        if (!exists)
            throw new NotFound_1.NotFound("Restaurant not found");
    }
    const result = await (0, syncAppDownloads_1.syncAppDownloads)({ platform: body.platform, from, to, restaurantId: body.restaurantId });
    (0, response_1.SuccessResponse)(res, { message: "App downloads synced", ...result });
};
exports.syncAppDownloadsHandler = syncAppDownloadsHandler;
// ==========================================
// GET /admin/app-downloads
// Total downloads per restaurant (android / ios / total) for a date range (default: all time).
// ==========================================
const getAppDownloads = async (req, res) => {
    const { from, to, search, restaurantId, platform, page, limit } = appDownloads_1.getAppDownloadsQuerySchema.parse(req.query);
    // Conditions on the downloads join
    const joinConditions = [(0, drizzle_orm_1.eq)(schema_1.restaurantAppDownloads.restaurantId, schema_1.restaurants.id)];
    if (from)
        joinConditions.push((0, drizzle_orm_1.gte)(schema_1.restaurantAppDownloads.date, from));
    if (to)
        joinConditions.push((0, drizzle_orm_1.lte)(schema_1.restaurantAppDownloads.date, to));
    if (platform !== "all")
        joinConditions.push((0, drizzle_orm_1.eq)(schema_1.restaurantAppDownloads.platform, platform));
    // Only restaurants that have at least one app
    const where = [
        (0, drizzle_orm_1.sql) `(
            COALESCE(${schema_1.restaurants.androidApp}, '') <> '' OR COALESCE(${schema_1.restaurants.iosApp}, '') <> ''
            OR ${schema_1.restaurants.androidPackageName} IS NOT NULL OR ${schema_1.restaurants.appleAppId} IS NOT NULL
        )`,
    ];
    if (restaurantId)
        where.push((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId));
    if (search) {
        const like = `%${search}%`;
        where.push((0, drizzle_orm_1.sql) `(${schema_1.restaurants.name} LIKE ${like} OR ${schema_1.restaurants.nameAr} LIKE ${like})`);
    }
    const androidSum = (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${schema_1.restaurantAppDownloads.platform} = 'android' THEN ${schema_1.restaurantAppDownloads.downloads} ELSE 0 END), 0)`;
    const iosSum = (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${schema_1.restaurantAppDownloads.platform} = 'ios' THEN ${schema_1.restaurantAppDownloads.downloads} ELSE 0 END), 0)`;
    const totalSum = (0, drizzle_orm_1.sql) `COALESCE(SUM(${schema_1.restaurantAppDownloads.downloads}), 0)`;
    const rows = await connection_1.db
        .select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        nameAr: schema_1.restaurants.nameAr,
        logo: schema_1.restaurants.logo,
        iosApp: schema_1.restaurants.iosApp,
        androidApp: schema_1.restaurants.androidApp,
        appBundleId: schema_1.restaurants.appBundleId,
        androidPackageName: schema_1.restaurants.androidPackageName,
        appleAppId: schema_1.restaurants.appleAppId,
        android: androidSum,
        ios: iosSum,
        total: totalSum,
        lastDataDate: (0, drizzle_orm_1.sql) `MAX(${schema_1.restaurantAppDownloads.date})`,
    })
        .from(schema_1.restaurants)
        .leftJoin(schema_1.restaurantAppDownloads, (0, drizzle_orm_1.and)(...joinConditions))
        .where((0, drizzle_orm_1.and)(...where))
        .groupBy(schema_1.restaurants.id)
        .orderBy((0, drizzle_orm_1.sql) `${totalSum} DESC`, schema_1.restaurants.name)
        .limit(limit)
        .offset((page - 1) * limit);
    const [countRow] = await connection_1.db
        .select({ count: (0, drizzle_orm_1.sql) `COUNT(*)` })
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.and)(...where));
    const [totalsRow] = await connection_1.db
        .select({ android: androidSum, ios: iosSum, total: totalSum })
        .from(schema_1.restaurants)
        .innerJoin(schema_1.restaurantAppDownloads, (0, drizzle_orm_1.and)(...joinConditions))
        .where((0, drizzle_orm_1.and)(...where));
    const total = Number(countRow?.count ?? 0);
    (0, response_1.SuccessResponse)(res, {
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
            androidPackageName: (0, appStoreIdentifiers_1.resolveAndroidPackageName)(r),
            appleAppId: (0, appStoreIdentifiers_1.resolveAppleAppId)(r),
            downloads: { android: Number(r.android), ios: Number(r.ios), total: Number(r.total) },
            lastDataDate: r.lastDataDate ? (0, dayjs_1.default)(r.lastDataDate).format("YYYY-MM-DD") : null,
        })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
};
exports.getAppDownloads = getAppDownloads;
// ==========================================
// GET /admin/app-downloads/:restaurantId
// Downloads over time for one restaurant (grouped by day / month / year).
// ==========================================
const getRestaurantAppDownloads = async (req, res) => {
    const { restaurantId } = appDownloads_1.restaurantAppDownloadsParamsSchema.parse(req.params);
    const { from, to, groupBy } = appDownloads_1.restaurantAppDownloadsQuerySchema.parse(req.query);
    const [restaurant] = await connection_1.db
        .select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        nameAr: schema_1.restaurants.nameAr,
        logo: schema_1.restaurants.logo,
        iosApp: schema_1.restaurants.iosApp,
        androidApp: schema_1.restaurants.androidApp,
        appBundleId: schema_1.restaurants.appBundleId,
        androidPackageName: schema_1.restaurants.androidPackageName,
        appleAppId: schema_1.restaurants.appleAppId,
    })
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId))
        .limit(1);
    if (!restaurant)
        throw new NotFound_1.NotFound("Restaurant not found");
    const conditions = [(0, drizzle_orm_1.eq)(schema_1.restaurantAppDownloads.restaurantId, restaurantId)];
    if (from)
        conditions.push((0, drizzle_orm_1.gte)(schema_1.restaurantAppDownloads.date, from));
    if (to)
        conditions.push((0, drizzle_orm_1.lte)(schema_1.restaurantAppDownloads.date, to));
    const format = groupBy === "day" ? "%Y-%m-%d" : groupBy === "month" ? "%Y-%m" : "%Y";
    const period = (0, drizzle_orm_1.sql) `DATE_FORMAT(${schema_1.restaurantAppDownloads.date}, ${format})`;
    const series = await connection_1.db
        .select({
        period,
        android: (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${schema_1.restaurantAppDownloads.platform} = 'android' THEN ${schema_1.restaurantAppDownloads.downloads} ELSE 0 END), 0)`,
        ios: (0, drizzle_orm_1.sql) `COALESCE(SUM(CASE WHEN ${schema_1.restaurantAppDownloads.platform} = 'ios' THEN ${schema_1.restaurantAppDownloads.downloads} ELSE 0 END), 0)`,
        hasMonthlyRows: (0, drizzle_orm_1.sql) `MAX(${schema_1.restaurantAppDownloads.granularity} = 'month')`,
    })
        .from(schema_1.restaurantAppDownloads)
        .where((0, drizzle_orm_1.and)(...conditions))
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
    const totals = points.reduce((acc, p) => ({ android: acc.android + p.android, ios: acc.ios + p.ios, total: acc.total + p.total }), { android: 0, ios: 0, total: 0 });
    (0, response_1.SuccessResponse)(res, {
        restaurant: {
            ...restaurant,
            androidPackageName: (0, appStoreIdentifiers_1.resolveAndroidPackageName)(restaurant),
            appleAppId: (0, appStoreIdentifiers_1.resolveAppleAppId)(restaurant),
        },
        range: { from: from ?? null, to: to ?? null },
        groupBy,
        totals,
        series: points,
    });
};
exports.getRestaurantAppDownloads = getRestaurantAppDownloads;
