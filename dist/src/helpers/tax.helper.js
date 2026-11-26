"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveOrderTaxes = exports.calculateTaxes = exports.getActiveTaxes = exports.taxesForRestaurantCondition = exports.resolveTaxChannel = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
/**
 * Tax flow
 * ─────────────────────────────────────────────────────────────
 *  `source` tells who created the tax:
 *  • source = "keeto"      (super admin)      → always "exclude".
 *                          restaurantIds [] = all restaurants, otherwise only the listed ones.
 *  • source = "restaurant" (restaurant admin) → "include" | "exclude", owned by restaurantId.
 *
 *  exclude → calculated and ADDED to the order total.
 *  include → food price already contains it. Returned for display only (never added).
 *
 *  Only taxes with status = "active" are returned / calculated.
 */
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const toArray = (v) => {
    if (Array.isArray(v))
        return v.map(String);
    if (typeof v === "string" && v.trim()) {
        try {
            const parsed = JSON.parse(v);
            return Array.isArray(parsed) ? parsed.map(String) : [];
        }
        catch {
            return [];
        }
    }
    return [];
};
/**
 * Maps an order source to the tax module (pos / online) and platform (web / app).
 *
 *   pos                                                → pos
 *   online_order_web | mykeeto_web | food_aggregator_web (any "*_web") → online + web
 *   online_order_app | mykeeto (my_keeto) | food_aggregator (any other) → online + app
 *   unknown / empty                                    → online, any platform
 */
const resolveTaxChannel = (orderSource) => {
    const s = String(orderSource ?? "").trim().toLowerCase();
    if (!s)
        return { module: "online", platform: null };
    if (s === "pos")
        return { module: "pos", platform: null };
    if (s.endsWith("_web"))
        return { module: "online", platform: "web" };
    return { module: "online", platform: "app" };
};
exports.resolveTaxChannel = resolveTaxChannel;
/**
 * SQL condition: taxes that belong to / apply to a restaurant
 * (its own restaurant taxes + Keeto taxes for all restaurants or that include it).
 */
const taxesForRestaurantCondition = (restaurantId) => (0, drizzle_orm_1.or)((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taxes.source, "restaurant"), (0, drizzle_orm_1.eq)(schema_1.taxes.restaurantId, restaurantId)), (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.taxes.source, "keeto"), (0, drizzle_orm_1.or)((0, drizzle_orm_1.sql) `JSON_LENGTH(${schema_1.taxes.restaurantIds}) = 0`, (0, drizzle_orm_1.sql) `JSON_CONTAINS(${schema_1.taxes.restaurantIds}, JSON_QUOTE(${restaurantId}))`)));
exports.taxesForRestaurantCondition = taxesForRestaurantCondition;
/**
 * Returns the ACTIVE taxes (platform + restaurant) that apply to the given restaurant / branch / channel.
 */
const getActiveTaxes = async (params) => {
    const { restaurantId, branchId, orderSource, executor = connection_1.db } = params;
    const channel = (0, exports.resolveTaxChannel)(orderSource);
    const conditions = [
        (0, drizzle_orm_1.eq)(schema_1.taxes.status, "active"),
        (0, exports.taxesForRestaurantCondition)(restaurantId),
        (0, drizzle_orm_1.inArray)(schema_1.taxes.modules, [channel.module, "all"]),
    ];
    if (channel.platform) {
        conditions.push((0, drizzle_orm_1.inArray)(schema_1.taxes.moduleType, [channel.platform, "all"]));
    }
    const rows = await executor.select().from(schema_1.taxes).where((0, drizzle_orm_1.and)(...conditions));
    return rows.filter((t) => {
        if (t.source === "keeto")
            return true; // Keeto taxes → all branches
        const branchIds = toArray(t.branchIds);
        if (branchIds.length === 0)
            return true;
        return Boolean(branchId) && branchIds.includes(String(branchId));
    });
};
exports.getActiveTaxes = getActiveTaxes;
/**
 * Calculates every tax against the cart / order items.
 *  - Taxes with empty foodIds apply to all items, otherwise only to those foods.
 */
const calculateTaxes = (activeTaxes, items) => {
    const lines = [];
    let taxAmount = 0;
    let includedTaxAmount = 0;
    for (const t of activeTaxes) {
        const isKeeto = t.source === "keeto";
        const foodIds = isKeeto ? [] : toArray(t.foodIds);
        const applicable = foodIds.length
            ? items.filter((i) => i.foodId && foodIds.includes(String(i.foodId)))
            : items;
        const baseAmount = round(applicable.reduce((s, i) => s + (Number(i.totalPrice) || 0), 0));
        if (baseAmount <= 0)
            continue;
        const rate = Number(t.amount) || 0;
        const taxType = isKeeto ? "exclude" : t.taxType;
        let value;
        if (t.amountType === "value") {
            value = rate;
        }
        else if (taxType === "include") {
            // price already contains the tax → extract it
            value = baseAmount - baseAmount / (1 + rate / 100);
        }
        else {
            value = (baseAmount * rate) / 100;
        }
        value = round(value);
        if (value <= 0)
            continue;
        if (taxType === "exclude")
            taxAmount += value;
        else
            includedTaxAmount += value;
        lines.push({
            id: t.id,
            name: t.name,
            nameAr: t.nameAr ?? null,
            nameFr: t.nameFr ?? null,
            source: isKeeto ? "keeto" : "restaurant",
            taxType,
            amountType: t.amountType,
            amount: rate,
            baseAmount,
            taxAmount: value,
        });
    }
    return {
        taxAmount: round(taxAmount),
        includedTaxAmount: round(includedTaxAmount),
        taxes: lines,
    };
};
exports.calculateTaxes = calculateTaxes;
/** Convenience: fetch active taxes and calculate them in one call. */
const resolveOrderTaxes = async (params) => {
    const active = await (0, exports.getActiveTaxes)(params);
    return (0, exports.calculateTaxes)(active, params.items);
};
exports.resolveOrderTaxes = resolveOrderTaxes;
