import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../models/connection";
import { taxes, type Tax } from "../models/schema";

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

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const toArray = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string" && v.trim()) {
        try {
            const parsed = JSON.parse(v);
            return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
            return [];
        }
    }
    return [];
};

export type TaxChannel = {
    module: "pos" | "online";
    platform: "web" | "app" | null;
};

/**
 * Maps an order source to the tax module (pos / online) and platform (web / app).
 *
 *   pos                                                → pos
 *   online_order_web | mykeeto_web | food_aggregator_web (any "*_web") → online + web
 *   online_order_app | mykeeto (my_keeto) | food_aggregator (any other) → online + app
 *   unknown / empty                                    → online, any platform
 */
export const resolveTaxChannel = (orderSource?: string | null): TaxChannel => {
    const s = String(orderSource ?? "").trim().toLowerCase();
    if (!s) return { module: "online", platform: null };
    if (s === "pos") return { module: "pos", platform: null };
    if (s.endsWith("_web")) return { module: "online", platform: "web" };
    return { module: "online", platform: "app" };
};

/**
 * SQL condition: taxes that belong to / apply to a restaurant
 * (its own restaurant taxes + Keeto taxes for all restaurants or that include it).
 */
export const taxesForRestaurantCondition = (restaurantId: string) =>
    or(
        and(eq(taxes.source, "restaurant"), eq(taxes.restaurantId, restaurantId)),
        and(
            eq(taxes.source, "keeto"),
            or(
                sql`JSON_LENGTH(${taxes.restaurantIds}) = 0`,
                sql`JSON_CONTAINS(${taxes.restaurantIds}, JSON_QUOTE(${restaurantId}))`
            )
        )
    )!;

/**
 * Returns the ACTIVE taxes (platform + restaurant) that apply to the given restaurant / branch / channel.
 */
export const getActiveTaxes = async (params: {
    restaurantId: string;
    branchId?: string | null;
    orderSource?: string | null;
    executor?: any;
}): Promise<Tax[]> => {
    const { restaurantId, branchId, orderSource, executor = db } = params;
    const channel = resolveTaxChannel(orderSource);

    const conditions: any[] = [
        eq(taxes.status, "active"),
        taxesForRestaurantCondition(restaurantId),
        inArray(taxes.modules, [channel.module, "all"]),
    ];
    if (channel.platform) {
        conditions.push(inArray(taxes.moduleType, [channel.platform, "all"]));
    }

    const rows: Tax[] = await executor.select().from(taxes).where(and(...conditions));

    return rows.filter((t) => {
        if (t.source === "keeto") return true; // Keeto taxes → all branches
        const branchIds = toArray(t.branchIds);
        if (branchIds.length === 0) return true;
        return Boolean(branchId) && branchIds.includes(String(branchId));
    });
};

export type TaxableItem = { foodId?: string | null; totalPrice: number | string };

export type TaxLine = {
    id: string;
    name: string;
    nameAr: string | null;
    nameFr: string | null;
    source: "keeto" | "restaurant";
    taxType: "include" | "exclude";
    amountType: "percentage" | "value";
    amount: number;
    baseAmount: number;
    taxAmount: number;
};

export type TaxCalculation = {
    /** Sum of "exclude" taxes → add this to the order total. */
    taxAmount: number;
    /** Sum of "include" taxes → already inside the prices, display only. */
    includedTaxAmount: number;
    taxes: TaxLine[];
};

/**
 * Calculates every tax against the cart / order items.
 *  - Taxes with empty foodIds apply to all items, otherwise only to those foods.
 */
export const calculateTaxes = (activeTaxes: Tax[], items: TaxableItem[]): TaxCalculation => {
    const lines: TaxLine[] = [];
    let taxAmount = 0;
    let includedTaxAmount = 0;

    for (const t of activeTaxes) {
        const isKeeto = t.source === "keeto";
        const foodIds = isKeeto ? [] : toArray(t.foodIds);
        const applicable = foodIds.length
            ? items.filter((i) => i.foodId && foodIds.includes(String(i.foodId)))
            : items;

        const baseAmount = round(applicable.reduce((s, i) => s + (Number(i.totalPrice) || 0), 0));
        if (baseAmount <= 0) continue;

        const rate = Number(t.amount) || 0;
        const taxType: "include" | "exclude" = isKeeto ? "exclude" : t.taxType;

        let value: number;
        if (t.amountType === "value") {
            value = rate;
        } else if (taxType === "include") {
            // price already contains the tax → extract it
            value = baseAmount - baseAmount / (1 + rate / 100);
        } else {
            value = (baseAmount * rate) / 100;
        }
        value = round(value);
        if (value <= 0) continue;

        if (taxType === "exclude") taxAmount += value;
        else includedTaxAmount += value;

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

/** Convenience: fetch active taxes and calculate them in one call. */
export const resolveOrderTaxes = async (params: {
    restaurantId: string;
    branchId?: string | null;
    orderSource?: string | null;
    items: TaxableItem[];
    executor?: any;
}): Promise<TaxCalculation> => {
    const active = await getActiveTaxes(params);
    return calculateTaxes(active, params.items);
};
