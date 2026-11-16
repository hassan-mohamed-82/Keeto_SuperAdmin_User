// Prices the rows of a weight request for the detail screens (customer and restaurant).
// IDENTICAL file in Keeto_SuperAdmin_User and Keeto_Restaurant_User: keep them in sync.
//
// Uses exactly what getCart uses for these rows: the price snapshot (snapshotLinePricing), the product
// discount (formatProductsWithDiscounts on the snapshot base) and the line formula (priceCartLine),
// so the screens show the same discounted totals the customer will pay at checkout.
// Cart-level discounts (first-order discount, coupons) are not product discounts and are not included.

import { formatProductsWithDiscounts } from "./discount.service";
import {
    priceCartLine,
    snapshotLinePricing,
    summarizeCartLines,
    type CartLinePrice,
} from "../helpers/weightPricing.helper";

export interface WeightRequestPricingRow {
    foodId: string | null;
    isWeighted: boolean;
    orderedWeight: string | number | null;
    finalWeight: string | number | null;
    quantity: number;
    unitPrice: string | number | null;
    variations: unknown;
    addons: unknown;
    isUnavailable: boolean | null;
    discountId: string | null;
    discountType: string | null;
    discountValue: string | number | null;
}

export interface PricedWeightRequestLine extends CartLinePrice {
    isUnavailable: boolean;
    appliedDiscount: { id: string | null; type: string; value: number; source: string } | null;
}

export async function priceWeightRequestRows(rows: WeightRequestPricingRow[], restaurantId: string): Promise<{
    lines: PricedWeightRequestLine[];
    totals: { originalSubtotal: number; discountTotal: number; subtotal: number };
}> {
    const snaps = rows.map((r) => snapshotLinePricing(r, r.isWeighted));
    const resolved = rows.length > 0
        ? await formatProductsWithDiscounts(
            rows.map((r, i) => ({
                id: r.foodId ?? undefined,
                price: snaps[i].basePrice,
                discountId: r.discountId,
                discountType: r.discountType,
                discountValue: r.discountValue,
            })),
            restaurantId,
        )
        : [];

    const lines: PricedWeightRequestLine[] = rows.map((r, i) => {
        const snap = snaps[i];
        const product = resolved[i];
        const line = priceCartLine({
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

    return { lines, totals: summarizeCartLines(lines) };
}
