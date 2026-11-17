import { describe, expect, it } from "vitest";
import {
    computeWeightedLineTotal,
    isFixedDiscountOnGramFood,
    parseBooleanInput,
    priceCartLine,
    splitWeightedLineTotal,
    toThousandths,
    validateWeightGroupConfig,
    validateWeightInput,
} from "../helpers/weightPricing.helper";

const kgFood = (allow_custom_weight?: boolean) => ({ sold_by: "weight", weight_unit: "kg", allow_custom_weight });
const weightOpt = (weightValue: string | number) => ({ isWeightGroup: true, weightValue });
const normalOpt = { isWeightGroup: false, weightValue: null };

describe("validateWeightInput: weight-group options", () => {
    it("a selected weight option: the weight must equal its weight_value (exact decimals)", () => {
        expect(validateWeightInput(kgFood(), 0.5, [weightOpt("0.500")])).toBe(0.5);
        expect(validateWeightInput(kgFood(), "0.50", [weightOpt("0.500"), normalOpt])).toBe(0.5);
        expect(validateWeightInput(kgFood(false), 1, [weightOpt("1.000")])).toBe(1);
        expect(() => validateWeightInput(kgFood(), 0.501, [weightOpt("0.500")])).toThrow(/must equal the selected weight option/);
        expect(() => validateWeightInput(kgFood(), 0.499, [weightOpt("0.500")])).toThrow(/must equal/);
        // float sums that are "almost" equal are compared exactly in thousandths
        expect(validateWeightInput(kgFood(), 0.1 + 0.2, [weightOpt("0.300")])).toBe(0.3);
    });

    it("custom weight (no weight option) is allowed only when allow_custom_weight is true", () => {
        expect(validateWeightInput(kgFood(true), 0.75, [normalOpt])).toBe(0.75);
        expect(validateWeightInput(kgFood(undefined), 0.75, [])).toBe(0.75); // column default true
        expect(() => validateWeightInput(kgFood(false), 0.75, [normalOpt])).toThrow(/choose one of the available weight options/);
    });

    it("only one weight option can be selected", () => {
        expect(() => validateWeightInput(kgFood(), 0.5, [weightOpt("0.5"), weightOpt("1")])).toThrow(/Only one weight option/);
    });

    it("the existing numeric rules still apply", () => {
        expect(() => validateWeightInput(kgFood(), 0.0004, [])).toThrow();
        expect(() => validateWeightInput(kgFood(), 1.2345, [])).toThrow(/3 decimal/);
        expect(() => validateWeightInput(kgFood(), 100.001, [])).toThrow(/maximum/);
    });

    it("restaurant final weight: no options and no allow_custom_weight → numeric rules only", () => {
        expect(validateWeightInput({ sold_by: "weight", weight_unit: "kg" }, 0.48)).toBe(0.48);
    });
});

describe("validateWeightGroupConfig (admin / import)", () => {
    const group = (options: Array<string | number | null>, extra: any = {}) => ({
        name: "Weight", isWeightGroup: true, options: options.map((w, i) => ({ optionName: `o${i}`, weightValue: w })), ...extra,
    });
    const normal = (options: any[] = [{ optionName: "Grilled", weightValue: null }]) => ({ name: "Cooking", isWeightGroup: false, options });

    it("a valid weight food with a weight group", () => {
        const r = validateWeightGroupConfig({ soldBy: "weight", weightUnit: "kg", allowCustomWeight: false, variations: [group(["0.25", 0.5, "1"]), normal()] });
        expect(r.allowCustomWeight).toBe(false);
        expect(r.weightGroups.get(0)).toEqual({ isRequired: true, selectionType: "single" });
        expect(r.weightValues.get("0:1")).toBe("0.500");
        expect(r.weightValues.get("1:0")).toBeNull();
        // custom weight allowed → the group is optional
        expect(validateWeightGroupConfig({ soldBy: "weight", weightUnit: "kg", allowCustomWeight: true, variations: [group(["0.5"])] })
            .weightGroups.get(0)?.isRequired).toBe(false);
    });

    it("weight group on a unit food is rejected", () => {
        expect(() => validateWeightGroupConfig({ soldBy: "unit", weightUnit: null, allowCustomWeight: true, variations: [group(["1"])] }))
            .toThrow(/only allowed on products sold by weight/);
    });

    it("duplicate weight_value inside the group is rejected (exact decimals: 0.5 = 0.500)", () => {
        expect(() => validateWeightGroupConfig({ soldBy: "weight", weightUnit: "kg", allowCustomWeight: true, variations: [group(["0.5", "0.500"])] }))
            .toThrow(/same weight_value/);
    });

    it("no weight group with allow_custom_weight = false is rejected", () => {
        expect(() => validateWeightGroupConfig({ soldBy: "weight", weightUnit: "kg", allowCustomWeight: false, variations: [normal()] }))
            .toThrow(/must have a weight group/);
    });

    it("other weight-group rules", () => {
        const base = { soldBy: "weight", weightUnit: "kg", allowCustomWeight: true };
        expect(() => validateWeightGroupConfig({ ...base, variations: [group(["0.5"]), group(["1"])] })).toThrow(/at most one weight group/);
        expect(() => validateWeightGroupConfig({ ...base, variations: [group(["0.5"], { selectionType: "multiple" })] })).toThrow(/single-select/);
        expect(() => validateWeightGroupConfig({ ...base, variations: [group([null])] })).toThrow(/weight_value greater than 0/);
        expect(() => validateWeightGroupConfig({ ...base, variations: [group(["0"])] })).toThrow(/greater than 0/);
        expect(() => validateWeightGroupConfig({ ...base, variations: [group(["0.0005"])] })).toThrow(/at most 3 decimals/);
        expect(() => validateWeightGroupConfig({ ...base, variations: [group(["150"])] })).toThrow(/maximum/);
        expect(() => validateWeightGroupConfig({ ...base, variations: [normal([{ optionName: "Big", weightValue: "1" }])] }))
            .toThrow(/cannot have a weight_value/);
        expect(() => validateWeightGroupConfig({ soldBy: "unit", weightUnit: null, allowCustomWeight: false, variations: [] }))
            .toThrow(/only be turned off for products sold by weight/);
        // unit foods always store allow_custom_weight = true
        expect(validateWeightGroupConfig({ soldBy: "unit", weightUnit: null, allowCustomWeight: undefined, variations: [normal()] }).allowCustomWeight).toBe(true);
    });
});

describe("line totals with extras (weight × unit price + extras)", () => {
    it("0.5 kg × 300 + grilled 60/kg + wrap 10 = 190.00; after weighing 0.45 kg = 172.00", () => {
        const extras = [{ price: 60, priceMode: "per_weight" as const }, { price: 10, priceMode: "fixed" as const }];
        expect(computeWeightedLineTotal(0.5, 300, extras)).toBe("190.00");
        expect(computeWeightedLineTotal(0.45, 300, extras)).toBe("172.00");
    });

    it("a weight option's price is an optional extra fee on top of weight × price", () => {
        // 0.5 kg × 300 + weight-option fee 25 (fixed) + wrap 10 (fixed) = 185.00
        expect(computeWeightedLineTotal(0.5, 300, [{ price: 25, priceMode: "fixed" }, { price: 10, priceMode: "fixed" }])).toBe("185.00");
        // option fee 0 (the normal case): just weight × price + other extras
        expect(computeWeightedLineTotal(0.5, 300, [{ price: 0, priceMode: "fixed" }, { price: 10, priceMode: "fixed" }])).toBe("160.00");
    });
});

describe("fixed-amount discount on per-gram foods", () => {
    it("rejected for gm foods, allowed as a percentage and on kg foods", () => {
        expect(isFixedDiscountOnGramFood({ soldBy: "weight", weightUnit: "gm", discountType: "amount", discountValue: 5 })).toBe(true);
        expect(isFixedDiscountOnGramFood({ soldBy: "weight", weightUnit: "gm", discountType: "percentage", discountValue: 10 })).toBe(false);
        expect(isFixedDiscountOnGramFood({ soldBy: "weight", weightUnit: "kg", discountType: "amount", discountValue: 20 })).toBe(false);
        expect(isFixedDiscountOnGramFood({ soldBy: "unit", weightUnit: null, discountType: "amount", discountValue: 20 })).toBe(false);
        // no discount value → nothing to reject
        expect(isFixedDiscountOnGramFood({ soldBy: "weight", weightUnit: "gm", discountType: "amount", discountValue: null })).toBe(false);
    });
});

describe("weight-group options with quantity > 1 (e.g. 4 quarters of fish)", () => {
    it("computes line total multiplied by quantity", () => {
        // 4 portions of 0.250 kg @ 200/kg = 4 * 50 = 200.00
        expect(computeWeightedLineTotal(0.250, 200, [], 4)).toBe("200.00");
        // with fixed extra 10 EGP per portion: 4 * (50 + 10) = 240.00
        expect(computeWeightedLineTotal(0.250, 200, [{ price: 10, priceMode: "fixed" }], 4)).toBe("240.00");
    });

    it("priceCartLine scales weighted originalTotal and finalTotal by quantity", () => {
        const line = priceCartLine({
            isWeighted: true,
            effectiveWeight: 0.250,
            quantity: 4,
            basePrice: 200,
            discountedBasePrice: 180,
            extras: [{ price: 10, priceMode: "fixed" }],
        });
        // 1 portion: original = 0.25*200 + 10 = 60; final = 0.25*180 + 10 = 55
        // 4 portions: original = 240, final = 220, discount = 20
        expect(line.originalTotal).toBe(240);
        expect(line.finalTotal).toBe(220);
        expect(line.discountTotal).toBe(20);
    });

    it("splitWeightedLineTotal correctly splits line across base, variations, and addons with quantity", () => {
        const split = splitWeightedLineTotal(
            0.250,
            200,
            [{ price: 10, priceMode: "fixed" }],
            [{ price: 5, priceMode: "fixed" }],
            4
        );
        // Base: 4 * (0.25 * 200) = 200.00
        // Variations: 4 * 10 = 40.00
        // Addons: 4 * 5 = 20.00
        // Total: 260.00
        expect(split.basePortion).toBe("200.00");
        expect(split.variationsPortion).toBe("40.00");
        expect(split.addonsPortion).toBe("20.00");
        expect(split.total).toBe("260.00");
    });
});

describe("small helpers", () => {
    it("toThousandths is exact", () => {
        expect(toThousandths("0.500")).toBe(500);
        expect(toThousandths("0.5")).toBe(500);
        expect(toThousandths(0.3)).toBe(300);
        expect(toThousandths("1.2345")).toBeNull();
        expect(toThousandths("-1")).toBeNull();
        expect(toThousandths("abc")).toBeNull();
    });

    it("parseBooleanInput", () => {
        expect(parseBooleanInput("false")).toBe(false);
        expect(parseBooleanInput("yes")).toBe(true);
        expect(parseBooleanInput(undefined)).toBeUndefined();
    });
});
