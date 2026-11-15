import { describe, expect, it } from "vitest";
import {
    computeWeightedLineTotal,
    validateOptionPriceMode,
    isWeightWithinLimit,
    calcMaxAllowedWeight,
} from "../helpers/weightPricing.helper";
import { BadRequest } from "../Errors/BadRequest";

describe("Weight-Based Pricing & Option Modes", () => {
    // Food 300 per kg
    const foodUnitPrice = 300;
    const optionGrilledPerWeight = { price: 60, priceMode: "per_weight" as const };
    const optionGiftWrapFixed = { price: 10, priceMode: "fixed" as const };

    it("0.5 kg -> 190.00 (0.5 * 300 + 0.5 * 60 + 10)", () => {
        const total = computeWeightedLineTotal(0.5, foodUnitPrice, [
            optionGrilledPerWeight,
            optionGiftWrapFixed,
        ]);
        expect(total).toBe("190.00");
    });

    it("0.25 kg -> 90.00 (0.25 * (300 + 60))", () => {
        const total = computeWeightedLineTotal(0.25, foodUnitPrice, [
            optionGrilledPerWeight,
        ]);
        expect(total).toBe("90.00");
    });

    it("1 kg -> 360.00 (1.0 * (300 + 60))", () => {
        const total = computeWeightedLineTotal(1, foodUnitPrice, [
            optionGrilledPerWeight,
        ]);
        expect(total).toBe("360.00");
    });

    it("after weighing 0.45 kg -> 172.00 (0.45 * 300 + 0.45 * 60 + 10)", () => {
        const total = computeWeightedLineTotal(0.45, foodUnitPrice, [
            optionGrilledPerWeight,
            optionGiftWrapFixed,
        ]);
        expect(total).toBe("172.00");
    });

    it("per_weight on a unit food (rejected)", () => {
        expect(() => {
            validateOptionPriceMode("unit", "per_weight", 60);
        }).toThrow(BadRequest);
    });

    it("per_weight on a weight food with valid additional price is accepted", () => {
        expect(() => {
            validateOptionPriceMode("weight", "per_weight", 60);
        }).not.toThrow();
    });

    it("negative additional price is rejected", () => {
        expect(() => {
            validateOptionPriceMode("weight", "fixed", -5);
        }).toThrow(BadRequest);
    });

    it("existing fixed-only options unchanged", () => {
        // Without options, behaves as standard weight * unit_price
        expect(computeWeightedLineTotal(0.5, foodUnitPrice)).toBe("150.00");
        // With default fixed option (no explicit priceMode passed)
        expect(computeWeightedLineTotal(0.5, foodUnitPrice, [{ price: 10 }])).toBe("160.00");
    });

    it("weight limit validation works correctly", () => {
        // maxIncreasePercent = 10%
        // ordered = 0.5 kg -> max allowed = 0.55 kg
        expect(calcMaxAllowedWeight(0.5, 10)).toBe(0.55);
        expect(isWeightWithinLimit(0.5, 0.55, 10)).toBe(true);
        expect(isWeightWithinLimit(0.5, 0.45, 10)).toBe(true);
        expect(isWeightWithinLimit(0.5, 0.56, 10)).toBe(false);
    });
});
