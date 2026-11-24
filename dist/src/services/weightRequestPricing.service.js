"use strict";
// Prices the rows of a weight request for the detail screens (customer and restaurant).
// IDENTICAL file in Keeto_SuperAdmin_User and Keeto_Restaurant_User: keep them in sync.
//
// Uses exactly what getCart uses for these rows: the price snapshot (snapshotLinePricing), the product
// discount (formatProductsWithDiscounts on the snapshot base) and the line formula (priceCartLine),
// so the screens show the same discounted totals the customer will pay at checkout.
// Cart-level discounts (first-order discount, coupons) are not product discounts and are not included.
Object.defineProperty(exports, "__esModule", { value: true });
exports.priceWeightRequestRows = priceWeightRequestRows;
const discount_service_1 = require("./discount.service");
const weightPricing_helper_1 = require("../helpers/weightPricing.helper");
async function priceWeightRequestRows(rows, restaurantId) {
    const snaps = rows.map((r) => (0, weightPricing_helper_1.snapshotLinePricing)(r, r.isWeighted));
    const resolved = rows.length > 0
        ? await (0, discount_service_1.formatProductsWithDiscounts)(rows.map((r, i) => ({
            id: r.foodId ?? undefined,
            price: snaps[i].basePrice,
            discountId: r.discountId,
            discountType: r.discountType,
            discountValue: r.discountValue,
        })), restaurantId)
        : [];
    const lines = rows.map((r, i) => {
        const snap = snaps[i];
        const product = resolved[i];
        const line = (0, weightPricing_helper_1.priceCartLine)({
            isWeighted: r.isWeighted,
            effectiveWeight: r.finalWeight ?? r.orderedWeight,
            quantity: r.quantity,
            basePrice: snap.basePrice,
            discountedBasePrice: product?.finalPrice ?? snap.basePrice,
            extras: [...snap.variationExtras, ...snap.addonExtras],
            unitExtras: snap.varSum + snap.addonSum,
        });
        return {
            ...line,
            isUnavailable: Boolean(r.isUnavailable),
            appliedDiscount: product?.discountDetails
                ? {
                    id: product.discountDetails.id,
                    type: product.discountDetails.type,
                    value: product.discountDetails.value,
                    source: product.discountDetails.source,
                }
                : null,
        };
    });
    return { lines, totals: (0, weightPricing_helper_1.summarizeCartLines)(lines) };
}
