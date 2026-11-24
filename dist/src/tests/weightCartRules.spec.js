"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// The helpers import the DB module; nothing here touches the database.
vitest_1.vi.mock("../models/connection", () => ({ db: {} }));
const weightCart_helper_1 = require("../helpers/weightCart.helper");
const weightPricing_helper_1 = require("../helpers/weightPricing.helper");
const errorHandler_1 = require("../middlewares/errorHandler");
const BadRequest_1 = require("../Errors/BadRequest");
const future = () => new Date(Date.now() + 10 * 60 * 1000);
const past = () => new Date(Date.now() - 1000);
const weighing = { id: "req-1", status: "awaiting_weighing", expiresAt: future() };
const approval = { id: "req-1", status: "awaiting_customer_approval", expiresAt: future() };
const kgFood = { sold_by: "weight", weight_unit: "kg" };
const gmFood = { sold_by: "weight", weight_unit: "gm" };
const unitFood = { sold_by: "unit", weight_unit: null };
const expect409 = (fn, requestId) => {
    try {
        fn();
    }
    catch (e) {
        (0, vitest_1.expect)(e).toBeInstanceOf(weightCart_helper_1.WeightRequestActiveError);
        (0, vitest_1.expect)(e.statusCode).toBe(409);
        (0, vitest_1.expect)(e.code).toBe(weightCart_helper_1.WEIGHT_REQUEST_ACTIVE);
        (0, vitest_1.expect)(e.extra.requestId).toBe(requestId);
        return;
    }
    throw new Error("expected WEIGHT_REQUEST_ACTIVE");
};
(0, vitest_1.describe)("Cart rules while a weight request is active", () => {
    vitest_1.it.each([weighing, approval])("normal items can be added, changed and removed (%s.status)", (req) => {
        for (const kind of ["add", "update", "remove"]) {
            (0, vitest_1.expect)(() => (0, weightCart_helper_1.assertCartWriteAllowed)({ kind, activeRequest: req, targetIsWeightBound: false })).not.toThrow();
        }
    });
    vitest_1.it.each([weighing, approval])("adding a weighted food is rejected with 409 WEIGHT_REQUEST_ACTIVE", (req) => {
        expect409(() => (0, weightCart_helper_1.assertCartWriteAllowed)({ kind: "add", activeRequest: req, targetIsWeightBound: true }), "req-1");
    });
    (0, vitest_1.it)("changing or deleting a locked weighted row is rejected", () => {
        for (const kind of ["update", "remove"]) {
            expect409(() => (0, weightCart_helper_1.assertCartWriteAllowed)({
                kind, activeRequest: approval, targetIsWeightBound: true, rowWeightRequestId: "req-1",
            }), "req-1");
        }
    });
    (0, vitest_1.it)("changing an UNTAGGED weighted row during an active request is rejected too", () => {
        expect409(() => (0, weightCart_helper_1.assertCartWriteAllowed)({ kind: "update", activeRequest: weighing, targetIsWeightBound: true }), "req-1");
    });
    (0, vitest_1.it)("restaurant-added rows are weight-bound", () => {
        (0, vitest_1.expect)((0, weightCart_helper_1.isWeightBoundRow)({ addedBy: "restaurant", weight: null }, "unit")).toBe(true);
        (0, vitest_1.expect)((0, weightCart_helper_1.isWeightBoundRow)({ addedBy: "customer", weight: null }, "unit")).toBe(false);
        (0, vitest_1.expect)((0, weightCart_helper_1.isWeightBoundRow)({ addedBy: "customer", weight: "0.500" }, null)).toBe(true);
    });
    (0, vitest_1.it)("clearCart is rejected while locked rows exist", () => {
        expect409(() => (0, weightCart_helper_1.assertCartWriteAllowed)({
            kind: "clear", activeRequest: null, targetIsWeightBound: false, lockedRowRequestId: "req-9",
        }), "req-9");
        expect409(() => (0, weightCart_helper_1.assertCartWriteAllowed)({ kind: "clear", activeRequest: approval, targetIsWeightBound: false }), "req-1");
        (0, vitest_1.expect)(() => (0, weightCart_helper_1.assertCartWriteAllowed)({ kind: "clear", activeRequest: null, targetIsWeightBound: false })).not.toThrow();
    });
    (0, vitest_1.it)("cancel -> edit -> new request: once cancelled (no active request, rows unlocked) weighted edits are allowed", () => {
        expect409(() => (0, weightCart_helper_1.assertCartWriteAllowed)({ kind: "update", activeRequest: approval, targetIsWeightBound: true, rowWeightRequestId: "req-1" }), "req-1");
        // after cancel: request cancelled (not active) and rows untagged
        (0, vitest_1.expect)(() => (0, weightCart_helper_1.assertCartWriteAllowed)({ kind: "update", activeRequest: null, targetIsWeightBound: true, rowWeightRequestId: null })).not.toThrow();
        (0, vitest_1.expect)(() => (0, weightCart_helper_1.assertCartWriteAllowed)({ kind: "add", activeRequest: null, targetIsWeightBound: true })).not.toThrow();
    });
    (0, vitest_1.it)("409 body is { success:false, code, requestId, message }", () => {
        const json = vitest_1.vi.fn();
        const res = { status: vitest_1.vi.fn(() => ({ json })) };
        (0, errorHandler_1.errorHandler)(new weightCart_helper_1.WeightRequestActiveError("req-1", "msg"), {}, res, vitest_1.vi.fn());
        (0, vitest_1.expect)(res.status).toHaveBeenCalledWith(409);
        (0, vitest_1.expect)(json).toHaveBeenCalledWith({ success: false, requestId: "req-1", code: "WEIGHT_REQUEST_ACTIVE", message: "msg" });
    });
});
(0, vitest_1.describe)("Fix 1: checkout gate", () => {
    const weighted = (over = {}) => ({
        id: "w1", weight: "0.500", weightRequestId: "req-1", addedBy: "customer", isUnavailable: false, foodSoldBy: "weight", ...over,
    });
    const normal = (over = {}) => ({
        id: "n1", weight: null, weightRequestId: null, addedBy: "customer", isUnavailable: false, foodSoldBy: "unit", ...over,
    });
    (0, vitest_1.it)("a cart with no weighted rows passes through unchanged", () => {
        const rows = [normal(), normal({ id: "n2" })];
        const r = (0, weightCart_helper_1.evaluateWeightedCheckout)(rows, null);
        (0, vitest_1.expect)(r.hasWeightedItems).toBe(false);
        (0, vitest_1.expect)(r.checkoutRows).toBe(rows);
    });
    (0, vitest_1.it)("weighted cart without an approved request is rejected", () => {
        (0, vitest_1.expect)(() => (0, weightCart_helper_1.evaluateWeightedCheckout)([weighted()], null)).toThrow(BadRequest_1.BadRequest);
        (0, vitest_1.expect)(() => (0, weightCart_helper_1.evaluateWeightedCheckout)([weighted()], weighing)).toThrow(/awaiting weighing/);
        (0, vitest_1.expect)(() => (0, weightCart_helper_1.evaluateWeightedCheckout)([weighted()], { ...approval, expiresAt: past() })).toThrow(/expired/);
    });
    (0, vitest_1.it)("a weighted row inserted through a missed path (no weight_request_id) fails the checkout", () => {
        try {
            (0, weightCart_helper_1.evaluateWeightedCheckout)([weighted(), weighted({ id: "w2", weightRequestId: null })], approval);
            throw new Error("should have thrown");
        }
        catch (e) {
            (0, vitest_1.expect)(e).toBeInstanceOf(weightCart_helper_1.WeightCartChangedError);
            (0, vitest_1.expect)(e.code).toBe(weightCart_helper_1.WEIGHT_CART_CHANGED);
            (0, vitest_1.expect)(e.extra.cartItemIds).toEqual(["w2"]);
        }
    });
    (0, vitest_1.it)("an untagged restaurant row or a row tagged with another request fails the checkout", () => {
        (0, vitest_1.expect)(() => (0, weightCart_helper_1.evaluateWeightedCheckout)([weighted(), normal({ id: "r1", addedBy: "restaurant" })], approval))
            .toThrow(weightCart_helper_1.WeightCartChangedError);
        (0, vitest_1.expect)(() => (0, weightCart_helper_1.evaluateWeightedCheckout)([weighted(), weighted({ id: "w3", weightRequestId: "old" })], approval))
            .toThrow(weightCart_helper_1.WeightCartChangedError);
    });
    (0, vitest_1.it)("mixed cart: normal untagged rows included, unavailable rows excluded", () => {
        const rows = [weighted(), weighted({ id: "w2", isUnavailable: true }), normal()];
        const r = (0, weightCart_helper_1.evaluateWeightedCheckout)(rows, approval);
        (0, vitest_1.expect)(r.hasWeightedItems).toBe(true);
        (0, vitest_1.expect)(r.checkoutRows.map((x) => x.id)).toEqual(["w1", "n1"]);
    });
    (0, vitest_1.it)("canCheckout uses the same gate as checkout", () => {
        (0, vitest_1.expect)((0, weightCart_helper_1.canCheckoutWeightedCart)([weighted(), normal()], approval)).toBe(true);
        (0, vitest_1.expect)((0, weightCart_helper_1.canCheckoutWeightedCart)([weighted({ weightRequestId: null })], approval)).toBe(false);
        (0, vitest_1.expect)((0, weightCart_helper_1.canCheckoutWeightedCart)([weighted()], weighing)).toBe(false);
    });
});
(0, vitest_1.describe)("Fix 6: validateWeightInput", () => {
    (0, vitest_1.it)("rejects 0.0004 (would be stored as 0.000) and more than 3 decimals", () => {
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(kgFood, 0.0004)).toThrow();
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(kgFood, 1.2345)).toThrow(/3 decimal/);
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(kgFood, 0)).toThrow();
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(kgFood, -1)).toThrow();
    });
    (0, vitest_1.it)("accepts valid weights and normalises them", () => {
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightInput)(kgFood, 0.45)).toBe(0.45);
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightInput)(kgFood, "0.450")).toBe(0.45);
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightInput)(kgFood, 0.001)).toBe(0.001);
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightInput)(kgFood, 0.1 + 0.2)).toBe(0.3);
    });
    (0, vitest_1.it)("applies the sane maximum per weight_unit (also to a deduped sum)", () => {
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightInput)(kgFood, 100)).toBe(100);
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(kgFood, 100.001)).toThrow(/maximum/);
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightInput)(gmFood, 100000)).toBe(100000);
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(gmFood, 100001)).toThrow(/maximum/);
        const summed = (Math.round(99.5 * 1000) + Math.round(0.6 * 1000)) / 1000;
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(kgFood, summed)).toThrow(/maximum/);
    });
    (0, vitest_1.it)("unit foods reject a weight, weighted foods require one", () => {
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightInput)(unitFood, undefined)).toBeNull();
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(unitFood, 1)).toThrow(/unit-sold/);
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(kgFood, undefined)).toThrow(/required/);
    });
});
(0, vitest_1.describe)("Fixes 3, 4, 8: pricing of weighted rows", () => {
    const grilledPerKg = { price: 60, priceMode: "per_weight" };
    const wrapFixed = { price: 10, priceMode: "fixed" };
    (0, vitest_1.it)("Fix 3: a 0.5 kg item creates no fake product discount", () => {
        const itemTotal = parseFloat((0, weightPricing_helper_1.computeWeightedLineTotal)(0.5, 300, [grilledPerKg, wrapFixed]));
        const initialNew = parseFloat((0, weightPricing_helper_1.computeWeightedLineTotal)(0.5, 300, [grilledPerKg, wrapFixed]));
        const initialOld = (300 + 60 + 10) * 1; // old formula: (price + var + addon) * quantity
        (0, vitest_1.expect)(itemTotal).toBe(190);
        (0, vitest_1.expect)(Math.max(0, initialNew - itemTotal)).toBe(0);
        (0, vitest_1.expect)(Math.max(0, initialOld - itemTotal)).toBe(180); // the fake discount the old formula produced
    });
    (0, vitest_1.it)("Fix 4: priceChanged is false for an unchanged weighted item with variations and addons", () => {
        // stored unit_price = 300 (per kg); live base 300, live total unit = 300 + 60 + 10
        (0, vitest_1.expect)((0, weightCart_helper_1.hasUnitPriceChanged)({ isWeighted: true, liveBasePrice: 300, liveTotalUnitPrice: 370, storedUnitPrice: 300 })).toBe(false);
        (0, vitest_1.expect)((0, weightCart_helper_1.hasUnitPriceChanged)({ isWeighted: true, liveBasePrice: 320, liveTotalUnitPrice: 390, storedUnitPrice: 300 })).toBe(true);
        (0, vitest_1.expect)((0, weightCart_helper_1.hasUnitPriceChanged)({ isWeighted: false, liveBasePrice: 300, liveTotalUnitPrice: 370, storedUnitPrice: 370 })).toBe(false);
    });
    (0, vitest_1.it)("8c: snapshot pricing uses the stored per-unit price and stored option prices", () => {
        const row = {
            weight: "0.500",
            unitPrice: "300.00",
            variations: JSON.stringify({ variations: [{ optionId: "o1", price: "60.00", priceMode: "per_weight" }] }),
            addons: JSON.stringify([{ addonId: "a1", price: "10.00" }]),
        };
        const snap = (0, weightCart_helper_1.snapshotPricing)(row, true);
        (0, vitest_1.expect)(snap.basePrice).toBe(300);
        // after weighing 0.45 kg -> 172.00
        (0, vitest_1.expect)((0, weightCart_helper_1.weightedLineTotal)(0.45, snap.basePrice, snap.variationExtras, snap.addonExtras)).toBe(172);
        (0, vitest_1.expect)((0, weightCart_helper_1.weightedLineTotal)(0.5, snap.basePrice, snap.variationExtras, snap.addonExtras)).toBe(190);
    });
    (0, vitest_1.it)("8c: restaurant-added unit row snapshot: base = unit_price - variations - addons", () => {
        const snap = (0, weightCart_helper_1.snapshotPricing)({
            unitPrice: "75.00",
            variations: JSON.stringify([{ optionId: "o1", price: "15.00", priceMode: "fixed" }]),
            addons: JSON.stringify([{ addonId: "a1", price: "10.00" }]),
        }, false);
        (0, vitest_1.expect)(snap.basePrice).toBe(50);
        (0, vitest_1.expect)(snap.basePrice + snap.varSum + snap.addonSum).toBe(75);
    });
    (0, vitest_1.it)("8b: order item columns for weighted rows add up exactly to the line total", () => {
        const s = (0, weightPricing_helper_1.splitWeightedLineTotal)(0.45, 300, [grilledPerKg, wrapFixed], [{ price: 5, priceMode: "fixed" }]);
        (0, vitest_1.expect)(s.total).toBe("177.00");
        (0, vitest_1.expect)(s.basePortion).toBe("135.00");
        (0, vitest_1.expect)(s.variationsPortion).toBe("37.00");
        (0, vitest_1.expect)(s.addonsPortion).toBe("5.00");
        // rounding-heavy case still sums exactly
        const r = (0, weightPricing_helper_1.splitWeightedLineTotal)(0.333, 99.99, [{ price: 33.33, priceMode: "per_weight" }], []);
        const sum = Math.round((parseFloat(r.basePortion) + parseFloat(r.variationsPortion) + parseFloat(r.addonsPortion)) * 100);
        (0, vitest_1.expect)(sum).toBe(Math.round(parseFloat(r.total) * 100));
    });
    (0, vitest_1.it)("Fix 5: mixed cart total = order total with unavailable rows excluded", () => {
        const snap = (0, weightCart_helper_1.snapshotPricing)({ unitPrice: "300", variations: "[]", addons: "[]" }, true);
        const lines = [
            { total: (0, weightCart_helper_1.weightedLineTotal)(0.45, snap.basePrice, [], []), isUnavailable: false }, // 135
            { total: (0, weightCart_helper_1.weightedLineTotal)(1, snap.basePrice, [], []), isUnavailable: true }, // excluded
            { total: 2 * 40, isUnavailable: false }, // normal row
        ];
        const cartTotal = lines.filter((l) => !l.isUnavailable).reduce((s, l) => s + l.total, 0);
        (0, vitest_1.expect)(cartTotal).toBe(215);
    });
});
(0, vitest_1.describe)("confirm at the ordered weight → checkout total = cart total", () => {
    (0, vitest_1.it)("a row the restaurant confirmed as ordered (final_weight = weight) prices the same in the cart, at checkout and as stored", () => {
        // what POST /confirm stores for an unweighed row: final_weight = weight, total recomputed
        const row = {
            weight: "0.500",
            finalWeight: "0.500",
            unitPrice: "300.00",
            variations: JSON.stringify({ variations: [{ optionId: "o1", price: "60.00", priceMode: "per_weight" }] }),
            addons: JSON.stringify([{ addonId: "a1", price: "10.00" }]),
        };
        const storedByConfirm = (0, weightPricing_helper_1.computeWeightedLineTotal)(0.5, 300, [{ price: 60, priceMode: "per_weight" }, { price: 10, priceMode: "fixed" }]);
        // getCart and checkout both use snapshotPricing + weightedLineTotal on finalWeight ?? weight
        const snap = (0, weightCart_helper_1.snapshotPricing)(row, true);
        const effective = row.finalWeight ?? row.weight;
        const cartLine = (0, weightCart_helper_1.weightedLineTotal)(effective, snap.basePrice, snap.variationExtras, snap.addonExtras);
        const checkoutLine = parseFloat((0, weightPricing_helper_1.splitWeightedLineTotal)(effective, snap.basePrice, snap.variationExtras, snap.addonExtras).total);
        (0, vitest_1.expect)(storedByConfirm).toBe("190.00");
        (0, vitest_1.expect)(cartLine).toBe(190);
        (0, vitest_1.expect)(checkoutLine).toBe(cartLine);
        // with a product discount (10% on the per-kg base) cart and checkout still agree
        const discounted = snap.basePrice * 0.9;
        (0, vitest_1.expect)(parseFloat((0, weightPricing_helper_1.splitWeightedLineTotal)(effective, discounted, snap.variationExtras, snap.addonExtras).total))
            .toBe((0, weightCart_helper_1.weightedLineTotal)(effective, discounted, snap.variationExtras, snap.addonExtras));
    });
});
