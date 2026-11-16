import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
    const state = { queue: [] as any[][] };
    const chain = (result: any) => {
        const c: any = {};
        for (const m of ["from", "where", "limit", "for", "leftJoin", "innerJoin"]) c[m] = () => c;
        c.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
        return c;
    };
    const fakeDb: any = { select: () => chain(state.queue.shift() ?? []) };
    return { state, fakeDb };
});

vi.mock("../models/connection", () => ({ db: h.fakeDb }));
vi.mock("../utils/notifications", () => ({ sendPushNotification: vi.fn(async () => undefined) }));

import { getWeightRequestById } from "../controllers/user/weightRequests";
import { priceCartLine, snapshotLinePricing } from "../helpers/weightPricing.helper";

const row = (over: any = {}) => ({
    cartItemId: "c1", foodId: "f1", name: "Kofta", nameAr: null, image: null, basePrice: "300.00",
    sold_by: "weight", foodWeightUnit: "kg", quantity: 1, orderedWeight: "0.500", finalWeight: "0.450",
    weightUnit: "kg", unitPrice: "300.00", totalPrice: "190.00",
    variations: JSON.stringify({ variations: [{ optionId: "o1", price: "60.00", priceMode: "per_weight" }] }),
    addons: JSON.stringify([{ addonId: "a1", price: "10.00" }]),
    note: null, isUnavailable: false, addedBy: "customer", addedByAdminId: null,
    discountId: null, discountType: "percentage", discountValue: "10",
    ...over,
});

describe("customer weight-request screen: discount totals", () => {
    it("shows original, discount and final per item and in total; equals the getCart formula", async () => {
        h.state.queue = [
            [{ id: "wr-1", userId: "u-1", restaurantId: "r-1", status: "awaiting_customer_approval", expiresAt: new Date(Date.now() + 600000) }],
            [
                row(),
                // a restaurant-added unit row: unit_price 75 = base 50 + option 15 + addon 10, qty 2, 5 off the base
                row({
                    cartItemId: "c2", foodId: "f2", sold_by: "unit", orderedWeight: null, finalWeight: null, quantity: 2,
                    unitPrice: "75.00", addedBy: "restaurant", discountType: "amount", discountValue: "5",
                    variations: JSON.stringify([{ optionId: "o2", price: "15.00", priceMode: "fixed" }]),
                    addons: JSON.stringify([{ addonId: "a2", price: "10.00" }]),
                }),
                row({ cartItemId: "c3", isUnavailable: true }),
            ],
        ];
        const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) };
        await getWeightRequestById({ params: { id: "wr-1" }, user: { id: "u-1" } }, res);
        const data = res.json.mock.calls[0][0].data.data;

        expect(data.items[0]).toMatchObject({
            originalUnitPrice: 300, discountedUnitPrice: 270,
            originalTotalPrice: "172.00", discountAmount: "13.50", totalPrice: "158.50",
        });
        expect(data.items[1]).toMatchObject({
            originalUnitPrice: 75, discountedUnitPrice: 70, originalTotalPrice: "150.00", discountAmount: "10.00", totalPrice: "140.00",
        });
        // the unavailable row is listed but not counted
        expect(data.totals).toMatchObject({ originalSubtotal: 322, discountTotal: 23.5, subtotal: 298.5 });

        // getCart prices the same locked rows with snapshotLinePricing + the product discount + priceCartLine
        const s1 = snapshotLinePricing(row(), true);
        const g1 = priceCartLine({ isWeighted: true, effectiveWeight: "0.450", quantity: 1, basePrice: s1.basePrice, discountedBasePrice: s1.basePrice * 0.9, extras: [...s1.variationExtras, ...s1.addonExtras] });
        const s2 = snapshotLinePricing({ unitPrice: "75.00", variations: data.items[1].variations, addons: data.items[1].addons }, false);
        const g2 = priceCartLine({ isWeighted: false, quantity: 2, basePrice: s2.basePrice, discountedBasePrice: s2.basePrice - 5, unitExtras: s2.varSum + s2.addonSum });
        expect(g1.finalTotal + g2.finalTotal).toBe(data.totals.subtotal);
    });
});
