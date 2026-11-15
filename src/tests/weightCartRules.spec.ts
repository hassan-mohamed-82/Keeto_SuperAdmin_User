import { describe, expect, it, vi } from "vitest";

// The helpers import the DB module; nothing here touches the database.
vi.mock("../models/connection", () => ({ db: {} }));

import {
    assertCartWriteAllowed,
    canCheckoutWeightedCart,
    evaluateWeightedCheckout,
    hasUnitPriceChanged,
    isWeightBoundRow,
    snapshotPricing,
    weightedLineTotal,
    WeightCartChangedError,
    WeightRequestActiveError,
    WEIGHT_CART_CHANGED,
    WEIGHT_REQUEST_ACTIVE,
} from "../helpers/weightCart.helper";
import {
    computeWeightedLineTotal,
    splitWeightedLineTotal,
    validateWeightInput,
} from "../helpers/weightPricing.helper";
import { errorHandler } from "../middlewares/errorHandler";
import { BadRequest } from "../Errors/BadRequest";

const future = () => new Date(Date.now() + 10 * 60 * 1000);
const past = () => new Date(Date.now() - 1000);

const weighing = { id: "req-1", status: "awaiting_weighing", expiresAt: future() };
const approval = { id: "req-1", status: "awaiting_customer_approval", expiresAt: future() };

const kgFood = { sold_by: "weight", weight_unit: "kg" };
const gmFood = { sold_by: "weight", weight_unit: "gm" };
const unitFood = { sold_by: "unit", weight_unit: null };

const expect409 = (fn: () => void, requestId: string) => {
    try {
        fn();
    } catch (e: any) {
        expect(e).toBeInstanceOf(WeightRequestActiveError);
        expect(e.statusCode).toBe(409);
        expect(e.code).toBe(WEIGHT_REQUEST_ACTIVE);
        expect(e.extra.requestId).toBe(requestId);
        return;
    }
    throw new Error("expected WEIGHT_REQUEST_ACTIVE");
};

describe("Cart rules while a weight request is active", () => {
    it.each([weighing, approval])("normal items can be added, changed and removed (%s.status)", (req) => {
        for (const kind of ["add", "update", "remove"] as const) {
            expect(() => assertCartWriteAllowed({ kind, activeRequest: req, targetIsWeightBound: false })).not.toThrow();
        }
    });

    it.each([weighing, approval])("adding a weighted food is rejected with 409 WEIGHT_REQUEST_ACTIVE", (req) => {
        expect409(() => assertCartWriteAllowed({ kind: "add", activeRequest: req, targetIsWeightBound: true }), "req-1");
    });

    it("changing or deleting a locked weighted row is rejected", () => {
        for (const kind of ["update", "remove"] as const) {
            expect409(() => assertCartWriteAllowed({
                kind, activeRequest: approval, targetIsWeightBound: true, rowWeightRequestId: "req-1",
            }), "req-1");
        }
    });

    it("changing an UNTAGGED weighted row during an active request is rejected too", () => {
        expect409(() => assertCartWriteAllowed({ kind: "update", activeRequest: weighing, targetIsWeightBound: true }), "req-1");
    });

    it("restaurant-added rows are weight-bound", () => {
        expect(isWeightBoundRow({ addedBy: "restaurant", weight: null }, "unit")).toBe(true);
        expect(isWeightBoundRow({ addedBy: "customer", weight: null }, "unit")).toBe(false);
        expect(isWeightBoundRow({ addedBy: "customer", weight: "0.500" }, null)).toBe(true);
    });

    it("clearCart is rejected while locked rows exist", () => {
        expect409(() => assertCartWriteAllowed({
            kind: "clear", activeRequest: null, targetIsWeightBound: false, lockedRowRequestId: "req-9",
        }), "req-9");
        expect409(() => assertCartWriteAllowed({ kind: "clear", activeRequest: approval, targetIsWeightBound: false }), "req-1");
        expect(() => assertCartWriteAllowed({ kind: "clear", activeRequest: null, targetIsWeightBound: false })).not.toThrow();
    });

    it("cancel -> edit -> new request: once cancelled (no active request, rows unlocked) weighted edits are allowed", () => {
        expect409(() => assertCartWriteAllowed({ kind: "update", activeRequest: approval, targetIsWeightBound: true, rowWeightRequestId: "req-1" }), "req-1");
        // after cancel: request cancelled (not active) and rows untagged
        expect(() => assertCartWriteAllowed({ kind: "update", activeRequest: null, targetIsWeightBound: true, rowWeightRequestId: null })).not.toThrow();
        expect(() => assertCartWriteAllowed({ kind: "add", activeRequest: null, targetIsWeightBound: true })).not.toThrow();
    });

    it("409 body is { success:false, code, requestId, message }", () => {
        const json = vi.fn();
        const res: any = { status: vi.fn(() => ({ json })) };
        errorHandler(new WeightRequestActiveError("req-1", "msg"), {} as any, res, vi.fn());
        expect(res.status).toHaveBeenCalledWith(409);
        expect(json).toHaveBeenCalledWith({ success: false, requestId: "req-1", code: "WEIGHT_REQUEST_ACTIVE", message: "msg" });
    });
});

describe("Fix 1: checkout gate", () => {
    const weighted = (over: any = {}) => ({
        id: "w1", weight: "0.500", weightRequestId: "req-1", addedBy: "customer", isUnavailable: false, foodSoldBy: "weight", ...over,
    });
    const normal = (over: any = {}) => ({
        id: "n1", weight: null, weightRequestId: null, addedBy: "customer", isUnavailable: false, foodSoldBy: "unit", ...over,
    });

    it("a cart with no weighted rows passes through unchanged", () => {
        const rows = [normal(), normal({ id: "n2" })];
        const r = evaluateWeightedCheckout(rows, null);
        expect(r.hasWeightedItems).toBe(false);
        expect(r.checkoutRows).toBe(rows);
    });

    it("weighted cart without an approved request is rejected", () => {
        expect(() => evaluateWeightedCheckout([weighted()], null)).toThrow(BadRequest);
        expect(() => evaluateWeightedCheckout([weighted()], weighing)).toThrow(/awaiting weighing/);
        expect(() => evaluateWeightedCheckout([weighted()], { ...approval, expiresAt: past() })).toThrow(/expired/);
    });

    it("a weighted row inserted through a missed path (no weight_request_id) fails the checkout", () => {
        try {
            evaluateWeightedCheckout([weighted(), weighted({ id: "w2", weightRequestId: null })], approval);
            throw new Error("should have thrown");
        } catch (e: any) {
            expect(e).toBeInstanceOf(WeightCartChangedError);
            expect(e.code).toBe(WEIGHT_CART_CHANGED);
            expect(e.extra.cartItemIds).toEqual(["w2"]);
        }
    });

    it("an untagged restaurant row or a row tagged with another request fails the checkout", () => {
        expect(() => evaluateWeightedCheckout([weighted(), normal({ id: "r1", addedBy: "restaurant" })], approval))
            .toThrow(WeightCartChangedError);
        expect(() => evaluateWeightedCheckout([weighted(), weighted({ id: "w3", weightRequestId: "old" })], approval))
            .toThrow(WeightCartChangedError);
    });

    it("mixed cart: normal untagged rows included, unavailable rows excluded", () => {
        const rows = [weighted(), weighted({ id: "w2", isUnavailable: true }), normal()];
        const r = evaluateWeightedCheckout(rows, approval);
        expect(r.hasWeightedItems).toBe(true);
        expect(r.checkoutRows.map((x) => x.id)).toEqual(["w1", "n1"]);
    });

    it("canCheckout uses the same gate as checkout", () => {
        expect(canCheckoutWeightedCart([weighted(), normal()], approval)).toBe(true);
        expect(canCheckoutWeightedCart([weighted({ weightRequestId: null })], approval)).toBe(false);
        expect(canCheckoutWeightedCart([weighted()], weighing)).toBe(false);
    });
});

describe("Fix 6: validateWeightInput", () => {
    it("rejects 0.0004 (would be stored as 0.000) and more than 3 decimals", () => {
        expect(() => validateWeightInput(kgFood, 0.0004)).toThrow();
        expect(() => validateWeightInput(kgFood, 1.2345)).toThrow(/3 decimal/);
        expect(() => validateWeightInput(kgFood, 0)).toThrow();
        expect(() => validateWeightInput(kgFood, -1)).toThrow();
    });

    it("accepts valid weights and normalises them", () => {
        expect(validateWeightInput(kgFood, 0.45)).toBe(0.45);
        expect(validateWeightInput(kgFood, "0.450")).toBe(0.45);
        expect(validateWeightInput(kgFood, 0.001)).toBe(0.001);
        expect(validateWeightInput(kgFood, 0.1 + 0.2)).toBe(0.3);
    });

    it("applies the sane maximum per weight_unit (also to a deduped sum)", () => {
        expect(validateWeightInput(kgFood, 100)).toBe(100);
        expect(() => validateWeightInput(kgFood, 100.001)).toThrow(/maximum/);
        expect(validateWeightInput(gmFood, 100000)).toBe(100000);
        expect(() => validateWeightInput(gmFood, 100001)).toThrow(/maximum/);
        const summed = (Math.round(99.5 * 1000) + Math.round(0.6 * 1000)) / 1000;
        expect(() => validateWeightInput(kgFood, summed)).toThrow(/maximum/);
    });

    it("unit foods reject a weight, weighted foods require one", () => {
        expect(validateWeightInput(unitFood, undefined)).toBeNull();
        expect(() => validateWeightInput(unitFood, 1)).toThrow(/unit-sold/);
        expect(() => validateWeightInput(kgFood, undefined)).toThrow(/required/);
    });
});

describe("Fixes 3, 4, 8: pricing of weighted rows", () => {
    const grilledPerKg = { price: 60, priceMode: "per_weight" as const };
    const wrapFixed = { price: 10, priceMode: "fixed" as const };

    it("Fix 3: a 0.5 kg item creates no fake product discount", () => {
        const itemTotal = parseFloat(computeWeightedLineTotal(0.5, 300, [grilledPerKg, wrapFixed]));
        const initialNew = parseFloat(computeWeightedLineTotal(0.5, 300, [grilledPerKg, wrapFixed]));
        const initialOld = (300 + 60 + 10) * 1; // old formula: (price + var + addon) * quantity
        expect(itemTotal).toBe(190);
        expect(Math.max(0, initialNew - itemTotal)).toBe(0);
        expect(Math.max(0, initialOld - itemTotal)).toBe(180); // the fake discount the old formula produced
    });

    it("Fix 4: priceChanged is false for an unchanged weighted item with variations and addons", () => {
        // stored unit_price = 300 (per kg); live base 300, live total unit = 300 + 60 + 10
        expect(hasUnitPriceChanged({ isWeighted: true, liveBasePrice: 300, liveTotalUnitPrice: 370, storedUnitPrice: 300 })).toBe(false);
        expect(hasUnitPriceChanged({ isWeighted: true, liveBasePrice: 320, liveTotalUnitPrice: 390, storedUnitPrice: 300 })).toBe(true);
        expect(hasUnitPriceChanged({ isWeighted: false, liveBasePrice: 300, liveTotalUnitPrice: 370, storedUnitPrice: 370 })).toBe(false);
    });

    it("8c: snapshot pricing uses the stored per-unit price and stored option prices", () => {
        const row = {
            weight: "0.500",
            unitPrice: "300.00",
            variations: JSON.stringify({ variations: [{ optionId: "o1", price: "60.00", priceMode: "per_weight" }] }),
            addons: JSON.stringify([{ addonId: "a1", price: "10.00" }]),
        };
        const snap = snapshotPricing(row, true);
        expect(snap.basePrice).toBe(300);
        // after weighing 0.45 kg -> 172.00
        expect(weightedLineTotal(0.45, snap.basePrice, snap.variationExtras, snap.addonExtras)).toBe(172);
        expect(weightedLineTotal(0.5, snap.basePrice, snap.variationExtras, snap.addonExtras)).toBe(190);
    });

    it("8c: restaurant-added unit row snapshot: base = unit_price - variations - addons", () => {
        const snap = snapshotPricing({
            unitPrice: "75.00",
            variations: JSON.stringify([{ optionId: "o1", price: "15.00", priceMode: "fixed" }]),
            addons: JSON.stringify([{ addonId: "a1", price: "10.00" }]),
        }, false);
        expect(snap.basePrice).toBe(50);
        expect(snap.basePrice + snap.varSum + snap.addonSum).toBe(75);
    });

    it("8b: order item columns for weighted rows add up exactly to the line total", () => {
        const s = splitWeightedLineTotal(0.45, 300, [grilledPerKg, wrapFixed], [{ price: 5, priceMode: "fixed" }]);
        expect(s.total).toBe("177.00");
        expect(s.basePortion).toBe("135.00");
        expect(s.variationsPortion).toBe("37.00");
        expect(s.addonsPortion).toBe("5.00");
        // rounding-heavy case still sums exactly
        const r = splitWeightedLineTotal(0.333, 99.99, [{ price: 33.33, priceMode: "per_weight" }], []);
        const sum = Math.round((parseFloat(r.basePortion) + parseFloat(r.variationsPortion) + parseFloat(r.addonsPortion)) * 100);
        expect(sum).toBe(Math.round(parseFloat(r.total) * 100));
    });

    it("Fix 5: mixed cart total = order total with unavailable rows excluded", () => {
        const snap = snapshotPricing({ unitPrice: "300", variations: "[]", addons: "[]" }, true);
        const lines = [
            { total: weightedLineTotal(0.45, snap.basePrice, [], []), isUnavailable: false },   // 135
            { total: weightedLineTotal(1, snap.basePrice, [], []), isUnavailable: true },       // excluded
            { total: 2 * 40, isUnavailable: false },                                             // normal row
        ];
        const cartTotal = lines.filter((l) => !l.isUnavailable).reduce((s, l) => s + l.total, 0);
        expect(cartTotal).toBe(215);
    });
});
