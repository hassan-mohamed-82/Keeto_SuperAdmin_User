"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORDER_SOURCE_LABELS = exports.toSalesChannel = exports.toPlatformType = exports.toStoredOrderSource = exports.PLAN_PLATFORM_TYPES = exports.PLATFORM_TYPES = exports.CHECKOUT_ORDER_SOURCES = exports.ORDER_SOURCES = void 0;
/**
 * Values stored in `orders.order_source`.
 * ⚠️ Keep the original order and only APPEND new values at the end:
 * MySQL stores enums by position, appending is an instant change with no table rebuild.
 */
exports.ORDER_SOURCES = [
    "online_order_web",
    "online_order_app",
    "food_aggregator",
    "my_keeto",
    "pos",
    "food_aggregator_web",
    "mykeeto_web",
];
/** Values accepted from the client at checkout ("mykeeto" is stored as "my_keeto"). */
exports.CHECKOUT_ORDER_SOURCES = [
    "online_order_web",
    "online_order_app",
    "food_aggregator",
    "food_aggregator_web",
    "mykeeto",
    "mykeeto_web",
    "pos",
];
/**
 * Values stored in `restaurant_business_plans.platform_type`.
 * ⚠️ Keep the original order and only APPEND new values at the end (same reason as above).
 */
exports.PLATFORM_TYPES = [
    "online_order_app",
    "online_order_web",
    "food_aggregator",
    "mykeeto",
    "pos",
    "food_aggregator_web",
    "mykeeto_web",
];
/** Platform types a business plan can be created for from the admin form (POS is created separately). */
exports.PLAN_PLATFORM_TYPES = exports.PLATFORM_TYPES.filter((p) => p !== "pos");
/** Client value → value stored on the order. */
const toStoredOrderSource = (source) => (source === "mykeeto" ? "my_keeto" : source);
exports.toStoredOrderSource = toStoredOrderSource;
/** Any order source → its business plan platform type. Unknown values fall back to "pos". */
const toPlatformType = (orderSource) => {
    const s = String(orderSource ?? "").trim().toLowerCase();
    if (s === "my_keeto" || s === "mykeeto")
        return "mykeeto";
    if (s === "my_keeto_web" || s === "mykeeto_web")
        return "mykeeto_web";
    return (exports.PLATFORM_TYPES.includes(s) ? s : "pos");
};
exports.toPlatformType = toPlatformType;
/** Channel used by discounts: web for every "*_web" source, app for the other online sources. */
const toSalesChannel = (orderSource) => {
    const s = String(orderSource ?? "").trim().toLowerCase();
    if (!s)
        return null;
    if (s === "pos")
        return "pos";
    if (s.endsWith("_web"))
        return "web";
    return "app";
};
exports.toSalesChannel = toSalesChannel;
/** Labels for reports / notifications. */
exports.ORDER_SOURCE_LABELS = {
    online_order_web: { en: "Website", ar: "الموقع الإلكتروني" },
    online_order_app: { en: "Mobile App", ar: "تطبيق الموبايل" },
    food_aggregator: { en: "Aggregator App", ar: "تطبيق توصيل" },
    food_aggregator_web: { en: "Aggregator Web", ar: "تطبيق توصيل ويب" },
    my_keeto: { en: "My Keeto", ar: "ماي كيتو" },
    mykeeto_web: { en: "My Keeto Web", ar: "ماي كيتو ويب" },
    pos: { en: "POS Cashier", ar: "كاشير" },
};
