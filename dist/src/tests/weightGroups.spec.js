"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const weightPricing_helper_1 = require("../helpers/weightPricing.helper");
const kgFood = (allow_custom_weight) => ({ sold_by: "weight", weight_unit: "kg", allow_custom_weight });
const weightOpt = (weightValue) => ({ isWeightGroup: true, weightValue });
const normalOpt = { isWeightGroup: false, weightValue: null };
(0, vitest_1.describe)("validateWeightInput: weight-group options", () => {
    (0, vitest_1.it)("a selected weight option: the weight must equal its weight_value (exact decimals)", () => {
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightInput)(kgFood(), 0.5, [weightOpt("0.500")])).toBe(0.5);
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightInput)(kgFood(), "0.50", [weightOpt("0.500"), normalOpt])).toBe(0.5);
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightInput)(kgFood(false), 1, [weightOpt("1.000")])).toBe(1);
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(kgFood(), 0.501, [weightOpt("0.500")])).toThrow(/must equal the selected weight option/);
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(kgFood(), 0.499, [weightOpt("0.500")])).toThrow(/must equal/);
        // float sums that are "almost" equal are compared exactly in thousandths
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightInput)(kgFood(), 0.1 + 0.2, [weightOpt("0.300")])).toBe(0.3);
    });
    (0, vitest_1.it)("custom weight (no weight option) is allowed only when allow_custom_weight is true", () => {
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightInput)(kgFood(true), 0.75, [normalOpt])).toBe(0.75);
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightInput)(kgFood(undefined), 0.75, [])).toBe(0.75); // column default true
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(kgFood(false), 0.75, [normalOpt])).toThrow(/choose one of the available weight options/);
    });
    (0, vitest_1.it)("only one weight option can be selected", () => {
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(kgFood(), 0.5, [weightOpt("0.5"), weightOpt("1")])).toThrow(/Only one weight option/);
    });
    (0, vitest_1.it)("the existing numeric rules still apply", () => {
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(kgFood(), 0.0004, [])).toThrow();
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(kgFood(), 1.2345, [])).toThrow(/3 decimal/);
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightInput)(kgFood(), 100.001, [])).toThrow(/maximum/);
    });
    (0, vitest_1.it)("restaurant final weight: no options and no allow_custom_weight → numeric rules only", () => {
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightInput)({ sold_by: "weight", weight_unit: "kg" }, 0.48)).toBe(0.48);
    });
});
(0, vitest_1.describe)("validateWeightGroupConfig (admin / import)", () => {
    const group = (options, extra = {}) => ({
        name: "Weight", isWeightGroup: true, options: options.map((w, i) => ({ optionName: `o${i}`, weightValue: w })), ...extra,
    });
    const normal = (options = [{ optionName: "Grilled", weightValue: null }]) => ({ name: "Cooking", isWeightGroup: false, options });
    (0, vitest_1.it)("a valid weight food with a weight group", () => {
        const r = (0, weightPricing_helper_1.validateWeightGroupConfig)({ soldBy: "weight", weightUnit: "kg", allowCustomWeight: false, variations: [group(["0.25", 0.5, "1"]), normal()] });
        (0, vitest_1.expect)(r.allowCustomWeight).toBe(false);
        (0, vitest_1.expect)(r.weightGroups.get(0)).toEqual({ isRequired: true, selectionType: "single" });
        (0, vitest_1.expect)(r.weightValues.get("0:1")).toBe("0.500");
        (0, vitest_1.expect)(r.weightValues.get("1:0")).toBeNull();
        // custom weight allowed → the group is optional
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightGroupConfig)({ soldBy: "weight", weightUnit: "kg", allowCustomWeight: true, variations: [group(["0.5"])] })
            .weightGroups.get(0)?.isRequired).toBe(false);
    });
    (0, vitest_1.it)("weight group on a unit food is rejected", () => {
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightGroupConfig)({ soldBy: "unit", weightUnit: null, allowCustomWeight: true, variations: [group(["1"])] }))
            .toThrow(/only allowed on products sold by weight/);
    });
    (0, vitest_1.it)("duplicate weight_value inside the group is rejected (exact decimals: 0.5 = 0.500)", () => {
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightGroupConfig)({ soldBy: "weight", weightUnit: "kg", allowCustomWeight: true, variations: [group(["0.5", "0.500"])] }))
            .toThrow(/same weight_value/);
    });
    (0, vitest_1.it)("no weight group with allow_custom_weight = false is rejected", () => {
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightGroupConfig)({ soldBy: "weight", weightUnit: "kg", allowCustomWeight: false, variations: [normal()] }))
            .toThrow(/must have a weight group/);
    });
    (0, vitest_1.it)("other weight-group rules", () => {
        const base = { soldBy: "weight", weightUnit: "kg", allowCustomWeight: true };
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightGroupConfig)({ ...base, variations: [group(["0.5"]), group(["1"])] })).toThrow(/at most one weight group/);
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightGroupConfig)({ ...base, variations: [group(["0.5"], { selectionType: "multiple" })] })).toThrow(/single-select/);
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightGroupConfig)({ ...base, variations: [group([null])] })).toThrow(/weight_value greater than 0/);
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightGroupConfig)({ ...base, variations: [group(["0"])] })).toThrow(/greater than 0/);
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightGroupConfig)({ ...base, variations: [group(["0.0005"])] })).toThrow(/at most 3 decimals/);
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightGroupConfig)({ ...base, variations: [group(["150"])] })).toThrow(/maximum/);
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightGroupConfig)({ ...base, variations: [normal([{ optionName: "Big", weightValue: "1" }])] }))
            .toThrow(/cannot have a weight_value/);
        (0, vitest_1.expect)(() => (0, weightPricing_helper_1.validateWeightGroupConfig)({ soldBy: "unit", weightUnit: null, allowCustomWeight: false, variations: [] }))
            .toThrow(/only be turned off for products sold by weight/);
        // unit foods always store allow_custom_weight = true
        (0, vitest_1.expect)((0, weightPricing_helper_1.validateWeightGroupConfig)({ soldBy: "unit", weightUnit: null, allowCustomWeight: undefined, variations: [normal()] }).allowCustomWeight).toBe(true);
    });
});
(0, vitest_1.describe)("line totals with extras (weight × unit price + extras)", () => {
    (0, vitest_1.it)("0.5 kg × 300 + grilled 60/kg + wrap 10 = 190.00; after weighing 0.45 kg = 172.00", () => {
        const extras = [{ price: 60, priceMode: "per_weight" }, { price: 10, priceMode: "fixed" }];
        (0, vitest_1.expect)((0, weightPricing_helper_1.computeWeightedLineTotal)(0.5, 300, extras)).toBe("190.00");
        (0, vitest_1.expect)((0, weightPricing_helper_1.computeWeightedLineTotal)(0.45, 300, extras)).toBe("172.00");
    });
    (0, vitest_1.it)("a weight option's price is an optional extra fee on top of weight × price", () => {
        // 0.5 kg × 300 + weight-option fee 25 (fixed) + wrap 10 (fixed) = 185.00
        (0, vitest_1.expect)((0, weightPricing_helper_1.computeWeightedLineTotal)(0.5, 300, [{ price: 25, priceMode: "fixed" }, { price: 10, priceMode: "fixed" }])).toBe("185.00");
        // option fee 0 (the normal case): just weight × price + other extras
        (0, vitest_1.expect)((0, weightPricing_helper_1.computeWeightedLineTotal)(0.5, 300, [{ price: 0, priceMode: "fixed" }, { price: 10, priceMode: "fixed" }])).toBe("160.00");
    });
});
(0, vitest_1.describe)("fixed-amount discount on per-gram foods", () => {
    (0, vitest_1.it)("rejected for gm foods, allowed as a percentage and on kg foods", () => {
        (0, vitest_1.expect)((0, weightPricing_helper_1.isFixedDiscountOnGramFood)({ soldBy: "weight", weightUnit: "gm", discountType: "amount", discountValue: 5 })).toBe(true);
        (0, vitest_1.expect)((0, weightPricing_helper_1.isFixedDiscountOnGramFood)({ soldBy: "weight", weightUnit: "gm", discountType: "percentage", discountValue: 10 })).toBe(false);
        (0, vitest_1.expect)((0, weightPricing_helper_1.isFixedDiscountOnGramFood)({ soldBy: "weight", weightUnit: "kg", discountType: "amount", discountValue: 20 })).toBe(false);
        (0, vitest_1.expect)((0, weightPricing_helper_1.isFixedDiscountOnGramFood)({ soldBy: "unit", weightUnit: null, discountType: "amount", discountValue: 20 })).toBe(false);
        // no discount value → nothing to reject
        (0, vitest_1.expect)((0, weightPricing_helper_1.isFixedDiscountOnGramFood)({ soldBy: "weight", weightUnit: "gm", discountType: "amount", discountValue: null })).toBe(false);
    });
});
(0, vitest_1.describe)("weight-group options with quantity > 1 (e.g. 4 quarters of fish)", () => {
    (0, vitest_1.it)("computes line total multiplied by quantity", () => {
        // 4 portions of 0.250 kg @ 200/kg = 4 * 50 = 200.00
        (0, vitest_1.expect)((0, weightPricing_helper_1.computeWeightedLineTotal)(0.250, 200, [], 4)).toBe("200.00");
        // with fixed extra 10 EGP per portion: 4 * (50 + 10) = 240.00
        (0, vitest_1.expect)((0, weightPricing_helper_1.computeWeightedLineTotal)(0.250, 200, [{ price: 10, priceMode: "fixed" }], 4)).toBe("240.00");
    });
    (0, vitest_1.it)("priceCartLine scales weighted originalTotal and finalTotal by quantity", () => {
        const line = (0, weightPricing_helper_1.priceCartLine)({
            isWeighted: true,
            effectiveWeight: 0.250,
            quantity: 4,
            basePrice: 200,
            discountedBasePrice: 180,
            extras: [{ price: 10, priceMode: "fixed" }],
        });
        // 1 portion: original = 0.25*200 + 10 = 60; final = 0.25*180 + 10 = 55
        // 4 portions: original = 240, final = 220, discount = 20
        (0, vitest_1.expect)(line.originalTotal).toBe(240);
        (0, vitest_1.expect)(line.finalTotal).toBe(220);
        (0, vitest_1.expect)(line.discountTotal).toBe(20);
    });
    (0, vitest_1.it)("splitWeightedLineTotal correctly splits line across base, variations, and addons with quantity", () => {
        const split = (0, weightPricing_helper_1.splitWeightedLineTotal)(0.250, 200, [{ price: 10, priceMode: "fixed" }], [{ price: 5, priceMode: "fixed" }], 4);
        // Base: 4 * (0.25 * 200) = 200.00
        // Variations: 4 * 10 = 40.00
        // Addons: 4 * 5 = 20.00
        // Total: 260.00
        (0, vitest_1.expect)(split.basePortion).toBe("200.00");
        (0, vitest_1.expect)(split.variationsPortion).toBe("40.00");
        (0, vitest_1.expect)(split.addonsPortion).toBe("20.00");
        (0, vitest_1.expect)(split.total).toBe("260.00");
    });
});
(0, vitest_1.describe)("small helpers", () => {
    (0, vitest_1.it)("toThousandths is exact", () => {
        (0, vitest_1.expect)((0, weightPricing_helper_1.toThousandths)("0.500")).toBe(500);
        (0, vitest_1.expect)((0, weightPricing_helper_1.toThousandths)("0.5")).toBe(500);
        (0, vitest_1.expect)((0, weightPricing_helper_1.toThousandths)(0.3)).toBe(300);
        (0, vitest_1.expect)((0, weightPricing_helper_1.toThousandths)("1.2345")).toBeNull();
        (0, vitest_1.expect)((0, weightPricing_helper_1.toThousandths)("-1")).toBeNull();
        (0, vitest_1.expect)((0, weightPricing_helper_1.toThousandths)("abc")).toBeNull();
    });
    (0, vitest_1.it)("parseBooleanInput", () => {
        (0, vitest_1.expect)((0, weightPricing_helper_1.parseBooleanInput)("false")).toBe(false);
        (0, vitest_1.expect)((0, weightPricing_helper_1.parseBooleanInput)("yes")).toBe(true);
        (0, vitest_1.expect)((0, weightPricing_helper_1.parseBooleanInput)(undefined)).toBeUndefined();
    });
});
