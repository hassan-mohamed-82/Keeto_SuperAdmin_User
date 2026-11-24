"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const weightPricing_helper_1 = require("../helpers/weightPricing.helper");
const BadRequest_1 = require("../Errors/BadRequest");
(0, vitest_1.describe)("Weight-Based Pricing & Option Modes", () => {
    // Food 300 per kg
    const foodUnitPrice = 300;
    const optionGrilledPerWeight = { price: 60, priceMode: "per_weight" };
    const optionGiftWrapFixed = { price: 10, priceMode: "fixed" };
    (0, vitest_1.it)("0.5 kg -> 190.00 (0.5 * 300 + 0.5 * 60 + 10)", () => {
        const total = (0, weightPricing_helper_1.computeWeightedLineTotal)(0.5, foodUnitPrice, [
            optionGrilledPerWeight,
            optionGiftWrapFixed,
        ]);
        (0, vitest_1.expect)(total).toBe("190.00");
    });
    (0, vitest_1.it)("0.25 kg -> 90.00 (0.25 * (300 + 60))", () => {
        const total = (0, weightPricing_helper_1.computeWeightedLineTotal)(0.25, foodUnitPrice, [
            optionGrilledPerWeight,
        ]);
        (0, vitest_1.expect)(total).toBe("90.00");
    });
    (0, vitest_1.it)("1 kg -> 360.00 (1.0 * (300 + 60))", () => {
        const total = (0, weightPricing_helper_1.computeWeightedLineTotal)(1, foodUnitPrice, [
            optionGrilledPerWeight,
        ]);
        (0, vitest_1.expect)(total).toBe("360.00");
    });
    (0, vitest_1.it)("after weighing 0.45 kg -> 172.00 (0.45 * 300 + 0.45 * 60 + 10)", () => {
        const total = (0, weightPricing_helper_1.computeWeightedLineTotal)(0.45, foodUnitPrice, [
            optionGrilledPerWeight,
            optionGiftWrapFixed,
        ]);
        (0, vitest_1.expect)(total).toBe("172.00");
    });
    (0, vitest_1.it)("per_weight on a unit food (rejected)", () => {
        (0, vitest_1.expect)(() => {
            (0, weightPricing_helper_1.validateOptionPriceMode)("unit", "per_weight", 60);
        }).toThrow(BadRequest_1.BadRequest);
    });
    (0, vitest_1.it)("per_weight on a weight food with valid additional price is accepted", () => {
        (0, vitest_1.expect)(() => {
            (0, weightPricing_helper_1.validateOptionPriceMode)("weight", "per_weight", 60);
        }).not.toThrow();
    });
    (0, vitest_1.it)("negative additional price is rejected", () => {
        (0, vitest_1.expect)(() => {
            (0, weightPricing_helper_1.validateOptionPriceMode)("weight", "fixed", -5);
        }).toThrow(BadRequest_1.BadRequest);
    });
    (0, vitest_1.it)("existing fixed-only options unchanged", () => {
        // Without options, behaves as standard weight * unit_price
        (0, vitest_1.expect)((0, weightPricing_helper_1.computeWeightedLineTotal)(0.5, foodUnitPrice)).toBe("150.00");
        // With default fixed option (no explicit priceMode passed)
        (0, vitest_1.expect)((0, weightPricing_helper_1.computeWeightedLineTotal)(0.5, foodUnitPrice, [{ price: 10 }])).toBe("160.00");
    });
    (0, vitest_1.it)("weight limit validation works correctly", () => {
        // maxIncreasePercent = 10%
        // ordered = 0.5 kg -> max allowed = 0.55 kg
        (0, vitest_1.expect)((0, weightPricing_helper_1.calcMaxAllowedWeight)(0.5, 10)).toBe(0.55);
        (0, vitest_1.expect)((0, weightPricing_helper_1.isWeightWithinLimit)(0.5, 0.55, 10)).toBe(true);
        (0, vitest_1.expect)((0, weightPricing_helper_1.isWeightWithinLimit)(0.5, 0.45, 10)).toBe(true);
        (0, vitest_1.expect)((0, weightPricing_helper_1.isWeightWithinLimit)(0.5, 0.56, 10)).toBe(false);
    });
});
