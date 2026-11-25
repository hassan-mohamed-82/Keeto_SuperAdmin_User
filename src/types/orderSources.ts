/**
 * Order sources / platform types — every source is its own channel.
 *
 *   online_order_web     → online order website
 *   online_order_app     → online order app
 *   food_aggregator      → food aggregator app
 *   food_aggregator_web  → food aggregator website
 *   mykeeto (my_keeto)   → My Keeto app
 *   mykeeto_web          → My Keeto website
 *   pos                  → POS cashier
 */

/**
 * Values stored in `orders.order_source`.
 * ⚠️ Keep the original order and only APPEND new values at the end:
 * MySQL stores enums by position, appending is an instant change with no table rebuild.
 */
export const ORDER_SOURCES = [
    "online_order_web",
    "online_order_app",
    "food_aggregator",
    "my_keeto",
    "pos",
    "food_aggregator_web",
    "mykeeto_web",
] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

/** Values accepted from the client at checkout ("mykeeto" is stored as "my_keeto"). */
export const CHECKOUT_ORDER_SOURCES = [
    "online_order_web",
    "online_order_app",
    "food_aggregator",
    "food_aggregator_web",
    "mykeeto",
    "mykeeto_web",
    "pos",
] as const;
export type CheckoutOrderSource = (typeof CHECKOUT_ORDER_SOURCES)[number];

/**
 * Values stored in `restaurant_business_plans.platform_type`.
 * ⚠️ Keep the original order and only APPEND new values at the end (same reason as above).
 */
export const PLATFORM_TYPES = [
    "online_order_app",
    "online_order_web",
    "food_aggregator",
    "mykeeto",
    "pos",
    "food_aggregator_web",
    "mykeeto_web",
] as const;
export type PlatformType = (typeof PLATFORM_TYPES)[number];

/** Platform types a business plan can be created for from the admin form (POS is created separately). */
export const PLAN_PLATFORM_TYPES = PLATFORM_TYPES.filter((p) => p !== "pos") as unknown as readonly [
    Exclude<PlatformType, "pos">,
    ...Exclude<PlatformType, "pos">[],
];

/** Client value → value stored on the order. */
export const toStoredOrderSource = (source: string): OrderSource =>
    (source === "mykeeto" ? "my_keeto" : source) as OrderSource;

/** Any order source → its business plan platform type. Unknown values fall back to "pos". */
export const toPlatformType = (orderSource: string): PlatformType => {
    const s = String(orderSource ?? "").trim().toLowerCase();
    if (s === "my_keeto" || s === "mykeeto") return "mykeeto";
    if (s === "my_keeto_web" || s === "mykeeto_web") return "mykeeto_web";
    return ((PLATFORM_TYPES as readonly string[]).includes(s) ? s : "pos") as PlatformType;
};

/** Channel used by discounts: web for every "*_web" source, app for the other online sources. */
export const toSalesChannel = (orderSource?: string | null): "pos" | "web" | "app" | null => {
    const s = String(orderSource ?? "").trim().toLowerCase();
    if (!s) return null;
    if (s === "pos") return "pos";
    if (s.endsWith("_web")) return "web";
    return "app";
};

/** Labels for reports / notifications. */
export const ORDER_SOURCE_LABELS: Record<OrderSource, { en: string; ar: string }> = {
    online_order_web: { en: "Website", ar: "الموقع الإلكتروني" },
    online_order_app: { en: "Mobile App", ar: "تطبيق الموبايل" },
    food_aggregator: { en: "Aggregator App", ar: "تطبيق توصيل" },
    food_aggregator_web: { en: "Aggregator Web", ar: "تطبيق توصيل ويب" },
    my_keeto: { en: "My Keeto", ar: "ماي كيتو" },
    mykeeto_web: { en: "My Keeto Web", ar: "ماي كيتو ويب" },
    pos: { en: "POS Cashier", ar: "كاشير" },
};
