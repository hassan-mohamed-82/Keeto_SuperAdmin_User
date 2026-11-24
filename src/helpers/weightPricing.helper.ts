import { BadRequest } from "../Errors/BadRequest";

// ==========================================
// Weight Setting Hard Limits (Server-enforced)
// ==========================================
export const WEIGHT_SETTING_LIMITS = {
    maxIncreasePercent:   { min: 0, max: 20 },
    restaurantTimeoutMin: { min: 5, max: 60 },
    customerTimeoutMin:   { min: 5, max: 60 },
} as const;

/**
 * Validates restaurant weight settings against system-wide bounds.
 * Throws BadRequest if any value is out of range.
 */
export const validateWeightSettings = (settings: {
    weightMaxIncreasePercent?: number;
    weightRestaurantTimeoutMin?: number;
    weightCustomerTimeoutMin?: number;
}): void => {
    if (settings.weightMaxIncreasePercent !== undefined) {
        const { min, max } = WEIGHT_SETTING_LIMITS.maxIncreasePercent;
        if (settings.weightMaxIncreasePercent < min || settings.weightMaxIncreasePercent > max) {
            throw new BadRequest(`weight_max_increase_percent must be between ${min} and ${max}`);
        }
    }
    if (settings.weightRestaurantTimeoutMin !== undefined) {
        const { min, max } = WEIGHT_SETTING_LIMITS.restaurantTimeoutMin;
        if (settings.weightRestaurantTimeoutMin < min || settings.weightRestaurantTimeoutMin > max) {
            throw new BadRequest(`weight_restaurant_timeout_min must be between ${min} and ${max}`);
        }
    }
    if (settings.weightCustomerTimeoutMin !== undefined) {
        const { min, max } = WEIGHT_SETTING_LIMITS.customerTimeoutMin;
        if (settings.weightCustomerTimeoutMin < min || settings.weightCustomerTimeoutMin > max) {
            throw new BadRequest(`weight_customer_timeout_min must be between ${min} and ${max}`);
        }
    }
};

export interface WeightedOptionExtra {
    price: number | string;
    priceMode?: "fixed" | "per_weight" | string | null;
}

/**
 * Validates whether an option's priceMode and additionalPrice are valid for a given food's sold_by.
 * - Additional price must be >= 0.
 * - per_weight is only allowed for foods sold by weight.
 */
export const validateOptionPriceMode = (
    soldBy: "unit" | "weight" | string | null | undefined,
    priceMode?: "fixed" | "per_weight" | string | null,
    additionalPrice?: number | string | null
): void => {
    if (additionalPrice !== undefined && additionalPrice !== null) {
        const p = typeof additionalPrice === "number" ? additionalPrice : parseFloat(additionalPrice.toString());
        if (isNaN(p) || p < 0) {
            throw new BadRequest("Option additional price must be greater than or equal to 0");
        }
    }
    const mode = priceMode || "fixed";
    if (mode === "per_weight" && soldBy !== "weight") {
        throw new BadRequest("per_weight price_mode is only allowed on weight-based products");
    }
};

/**
 * Computes line total for a weighted item using exact integer arithmetic:
 * line_total = weight * food_unit_price + sum(fixed extras) + sum(weight * per_weight extras)
 *
 * Avoids IEEE-754 floating point drift by scaling weight to thousandths (milligrams/grams)
 * and unitPrice to hundredths (cents/piastres).
 *
 * @param weight customer or restaurant weight (in food's weight_unit)
 * @param foodUnitPrice price per weight_unit of the food
 * @param options optional array of option/addon extras with price and priceMode
 * @returns string formatted with 2 decimal places (e.g. "190.00")
 */
export const computeWeightedLineTotal = (
    weight: number | string,
    foodUnitPrice: number | string,
    options: WeightedOptionExtra[] = [],
    quantity: number = 1
): string => {
    const w = typeof weight === "number" ? weight : parseFloat(weight);
    const baseP = typeof foodUnitPrice === "number" ? foodUnitPrice : parseFloat(foodUnitPrice);

    if (isNaN(w) || isNaN(baseP) || w < 0 || baseP < 0) {
        throw new BadRequest("Invalid weight or unit price");
    }

    // w * 1000 to thousandths; baseP * 100 to hundredths
    const weightScaled = Math.round(w * 1000);
    let totalPerWeightCents = Math.round(baseP * 100);
    let fixedCents = 0;

    for (const opt of options) {
        const optPrice = typeof opt.price === "number" ? opt.price : parseFloat(opt.price || "0");
        if (isNaN(optPrice) || optPrice < 0) {
            throw new BadRequest("Option additional price must be >= 0");
        }
        const optCents = Math.round(optPrice * 100);
        if (opt.priceMode === "per_weight") {
            totalPerWeightCents += optCents;
        } else {
            fixedCents += optCents;
        }
    }

    // weightScaled * totalPerWeightCents has scale 100,000
    // To get cents (scale 100), divide by 1000 and round
    const perWeightCents = Math.round((weightScaled * totalPerWeightCents) / 1000);
    const finalCents = perWeightCents + fixedCents;

    const qty = Math.max(1, Math.round(Number(quantity) || 1));
    return ((finalCents * qty) / 100).toFixed(2);
};

/**
 * Calculates the maximum allowed weight for a restaurant submission.
 * final_weight <= ordered_weight * (1 + maxIncreasePercent / 100)
 */
export const calcMaxAllowedWeight = (
    orderedWeight: number | string,
    maxIncreasePercent: number
): number => {
    const ow = typeof orderedWeight === "number" ? orderedWeight : parseFloat(orderedWeight);
    if (isNaN(ow) || ow <= 0) {
        throw new BadRequest("Invalid ordered weight");
    }
    const owScaled = Math.round(ow * 1000);
    const maxScaled = Math.floor((owScaled * (100 + maxIncreasePercent)) / 100);
    return maxScaled / 1000;
};

/**
 * Validates whether finalWeight is valid given orderedWeight and maxIncreasePercent:
 * - Must be > 0
 * - Must be <= calcMaxAllowedWeight(orderedWeight, maxIncreasePercent)
 */
export const isWeightWithinLimit = (
    orderedWeight: number | string,
    finalWeight: number | string,
    maxIncreasePercent: number
): boolean => {
    const fw = typeof finalWeight === "number" ? finalWeight : parseFloat(finalWeight);
    if (isNaN(fw) || fw <= 0) return false;

    const maxAllowed = calcMaxAllowedWeight(orderedWeight, maxIncreasePercent);
    // 0.0001 epsilon for floating point comparison safety
    return fw <= maxAllowed + 0.0001;
};

export const SANE_MAX_WEIGHT = {
    kg: 100,
    gm: 100000,
} as const;

export const isSaneWeight = (weight: number, unit?: "kg" | "gm" | string | null): boolean => {
    if (weight <= 0) return false;
    const max = unit === "gm" ? SANE_MAX_WEIGHT.gm : SANE_MAX_WEIGHT.kg;
    return weight <= max;
};

export interface WeightInputFood {
    sold_by?: "unit" | "weight" | string | null;
    weight_unit?: "kg" | "gm" | string | null;
    /** food.allow_custom_weight (column default false). undefined / null = allowed: only false blocks a custom weight. */
    allow_custom_weight?: boolean | null;
}

/** A selected option, as far as the weight-group rules care. */
export interface SelectedWeightOption {
    /** food_variations.is_weight_group of the option's variation */
    isWeightGroup?: boolean | null;
    /** variation_options.weight_value (decimal, in the food's weight_unit) */
    weightValue?: string | number | null;
}

/**
 * Exact decimal → thousandths integer (no float equality anywhere).
 * Returns null when the value is not a positive number with at most 3 decimals.
 */
export const toThousandths = (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const text = typeof value === "number" ? String(value) : String(value).trim();
    if (!/^\d+(\.\d+)?$/.test(text)) {
        // numbers like 1e-7 or negative values
        const n = Number(text);
        if (!Number.isFinite(n) || n <= 0) return null;
        const scaled = n * 1000;
        return Math.abs(scaled - Math.round(scaled)) > 1e-6 ? null : Math.round(scaled);
    }
    const [intPart, rawFrac = ""] = text.split(".");
    const frac = rawFrac.replace(/0+$/, "");
    if (frac.length > 3) return null;
    return Number(intPart) * 1000 + Number(frac.padEnd(3, "0") || "0");
};

/**
 * Single source of truth for validating a weight entered by a customer or by
 * restaurant staff. Returns the normalised weight (3 decimals) for weight-sold
 * foods, or null for unit-sold foods (where a weight must not be sent).
 *
 * Rules:
 * - at most 3 decimal places; at least 0.001; at most the sane maximum for the weight_unit;
 * - weight groups: if a weight-group option is selected, the weight MUST equal its weight_value
 *   (exact thousandths comparison); if none is selected, a custom weight is allowed only when
 *   food.allow_custom_weight is not false.
 *
 * The restaurant's FINAL weight (PATCH after weighing) is a measured weight, not a choice, so that
 * caller passes no selected options and no allow_custom_weight: only the numeric rules apply.
 */
export const validateWeightInput = (
    food: WeightInputFood,
    weight: number | string | null | undefined,
    selectedOptions: SelectedWeightOption[] = []
): number | null => {
    const parsedNumericWeight = (weight !== undefined && weight !== null && weight !== "") ? Number(weight) : null;
    let hasWeight = parsedNumericWeight !== null && Number.isFinite(parsedNumericWeight) && parsedNumericWeight > 0;

    if (food.sold_by !== "weight") {
        if (hasWeight) throw new BadRequest("Weight cannot be specified for unit-sold products");
        return null;
    }

    // If no explicit weight is given but a weight-group option is selected, derive the
    // weight automatically from that option's weightValue so the caller doesn't have to
    // send a redundant field.
    if (!hasWeight && selectedOptions.length > 0) {
        const weightGroupOption = selectedOptions.find((o) => o && o.isWeightGroup && o.weightValue != null && Number(o.weightValue) > 0);
        if (weightGroupOption) {
            weight = weightGroupOption.weightValue as string | number;
            hasWeight = true;
        }
    }

    if (!hasWeight) {
        throw new BadRequest("Weight is required and must be greater than 0 for weight-based products");
    }

    const w = typeof weight === "number" ? weight : Number(String(weight).trim());
    if (!Number.isFinite(w) || w <= 0) {
        throw new BadRequest("Weight must be a number greater than 0");
    }

    const scaled = w * 1000;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
        throw new BadRequest("Weight can have at most 3 decimal places");
    }

    const thousandths = Math.round(scaled);
    if (thousandths < 1) {
        throw new BadRequest("Weight must be at least 0.001");
    }

    const normalised = thousandths / 1000;
    const unit = food.weight_unit === "gm" ? "gm" : "kg";
    if (!isSaneWeight(normalised, unit)) {
        throw new BadRequest(`Weight exceeds the maximum allowed (${SANE_MAX_WEIGHT[unit]} ${unit})`);
    }

    // Weight-group rules
    const weightOptions = (selectedOptions || []).filter((o) => o && o.isWeightGroup);
    if (weightOptions.length > 1) {
        throw new BadRequest("Only one weight option can be selected");
    }
    if (weightOptions.length === 1) {
        const expected = toThousandths(weightOptions[0].weightValue);
        if (expected === null) {
            throw new BadRequest("The selected weight option has no valid weight");
        }
        if (expected !== thousandths) {
            throw new BadRequest(
                `The weight must equal the selected weight option (${(expected / 1000).toFixed(3).replace(/\.?0+$/, "")} ${unit})`
            );
        }
    } else if (food.allow_custom_weight === false) {
        throw new BadRequest("Please choose one of the available weight options; a custom weight is not allowed for this product");
    }

    return normalised;
};

// ─────────────────────────────────────────────
// Weight groups on a food (admin create / update / bulk import)
// ─────────────────────────────────────────────

export interface WeightGroupOptionConfig {
    optionName?: string | null;
    weightValue?: string | number | null;
}

export interface WeightGroupVariationConfig {
    name?: string | null;
    isWeightGroup?: boolean | null;
    isRequired?: boolean | null;
    selectionType?: string | null;
    options?: WeightGroupOptionConfig[] | null;
}

/**
 * Validates the weight-group setup of a food and returns the values to store:
 * - a weight group is allowed only on foods sold by weight, at most ONE per food;
 * - it is single-select; it is required whenever a custom weight is not allowed
 *   (isRequired = !allow_custom_weight, so the menu tells the app the truth);
 * - every option of a weight group needs weight_value > 0 (max 3 decimals, within the sane maximum),
 *   unique inside the group; options of normal groups must have no weight_value;
 * - allow_custom_weight = false requires a weight group;
 * - unit foods always store allow_custom_weight = false (a value sent for them is ignored);
 * - weight foods default to false when it is not sent; with no weight group a custom
 *   weight is the only way to order, so they then default to true.
 * The option's price on a weight group is an OPTIONAL extra fee (fixed or per_weight), normally 0:
 * the weight itself is always priced as weight × unit price.
 * Throws BadRequest with a clear message, prefixed with the variation / option name.
 */
export const validateWeightGroupConfig = (input: {
    soldBy: string | null | undefined;
    weightUnit: string | null | undefined;
    allowCustomWeight: boolean | null | undefined;
    variations: WeightGroupVariationConfig[];
}): {
    allowCustomWeight: boolean;
    /** index → normalised group settings, only for weight groups */
    weightGroups: Map<number, { isRequired: boolean; selectionType: "single" }>;
    /** "variationIndex:optionIndex" → normalised weight_value string ("0.500") or null */
    weightValues: Map<string, string | null>;
} => {
    const isWeightFood = input.soldBy === "weight";
    const unit = input.weightUnit === "gm" ? "gm" : "kg";
    const variations = Array.isArray(input.variations) ? input.variations : [];
    const weightGroups = new Map<number, { isRequired: boolean; selectionType: "single" }>();
    const weightValues = new Map<string, string | null>();

    const groupIndexes = variations
        .map((v, i) => (v && v.isWeightGroup ? i : -1))
        .filter((i) => i >= 0);

    if (groupIndexes.length > 0 && !isWeightFood) {
        throw new BadRequest("A weight group is only allowed on products sold by weight");
    }
    if (groupIndexes.length > 1) {
        throw new BadRequest("A product can have at most one weight group");
    }
    // Not sent → false (the default), unless the weight food has no weight group to pick from.
    const allowCustomWeight = !isWeightFood
        ? false
        : (input.allowCustomWeight === true || input.allowCustomWeight === false)
            ? input.allowCustomWeight
            : groupIndexes.length === 0;
    if (isWeightFood && !allowCustomWeight && groupIndexes.length === 0) {
        throw new BadRequest("When a custom weight is not allowed, the product must have a weight group with weight options");
    }

    variations.forEach((variation, vi) => {
        const label = variation?.name ? `"${variation.name}"` : `#${vi + 1}`;
        const options = Array.isArray(variation?.options) ? variation!.options! : [];
        if (variation?.isWeightGroup) {
            if (variation.selectionType && variation.selectionType !== "single") {
                throw new BadRequest(`Weight group ${label} must be single-select`);
            }
            if (options.length === 0) {
                throw new BadRequest(`Weight group ${label} needs at least one weight option`);
            }
            const seen = new Map<number, string>();
            options.forEach((option, oi) => {
                const optLabel = option?.optionName ? `"${option.optionName}"` : `#${oi + 1}`;
                const t = toThousandths(option?.weightValue as any);
                if (t === null || t < 1) {
                    throw new BadRequest(`Weight option ${optLabel} of ${label} needs a weight_value greater than 0 with at most 3 decimals`);
                }
                if (!isSaneWeight(t / 1000, unit)) {
                    throw new BadRequest(`Weight option ${optLabel} of ${label} exceeds the maximum allowed (${SANE_MAX_WEIGHT[unit]} ${unit})`);
                }
                if (seen.has(t)) {
                    throw new BadRequest(`Weight option ${optLabel} of ${label} has the same weight_value as ${seen.get(t)}`);
                }
                seen.set(t, optLabel);
                weightValues.set(`${vi}:${oi}`, (t / 1000).toFixed(3));
            });
            weightGroups.set(vi, { isRequired: !allowCustomWeight, selectionType: "single" });
        } else {
            options.forEach((option, oi) => {
                const wv = option?.weightValue;
                if (wv !== undefined && wv !== null && wv !== "") {
                    const optLabel = option?.optionName ? `"${option.optionName}"` : `#${oi + 1}`;
                    throw new BadRequest(`Option ${optLabel} of ${label} is not in a weight group, so it cannot have a weight_value`);
                }
                weightValues.set(`${vi}:${oi}`, null);
            });
        }
    });

    return { allowCustomWeight, weightGroups, weightValues };
};

/**
 * A fixed-amount discount is applied per weight unit; on a per-gram food it would wipe out the price,
 * so it is rejected. Percentage discounts stay allowed for both units, fixed discounts for kg foods.
 */
export const FIXED_DISCOUNT_ON_GRAM_MESSAGE =
    "A fixed-amount discount is not allowed on a product sold per gram (it is applied per gram). Use a percentage discount instead.";

export const isFixedDiscountOnGramFood = (p: {
    soldBy: string | null | undefined;
    weightUnit: string | null | undefined;
    discountType: string | null | undefined;
    discountValue?: string | number | null;
}): boolean => {
    if (p.soldBy !== "weight" || p.weightUnit !== "gm") return false;
    if (p.discountType === "percentage" || !p.discountType) return false;
    const v = Number(p.discountValue ?? 0);
    return Number.isFinite(v) && v > 0;
};

/**
 * Splits a weighted line total into base / variations / addons portions whose sum
 * is EXACTLY the computeWeightedLineTotal() result (the variations portion absorbs
 * any 1-cent rounding difference). Used to fill order_items price columns for
 * weighted rows so that basePortion + variationsPortion + addonsPortion = total.
 */
export const splitWeightedLineTotal = (
    weight: number | string,
    foodUnitPrice: number | string,
    variationExtras: WeightedOptionExtra[] = [],
    addonExtras: WeightedOptionExtra[] = [],
    quantity: number = 1
): { total: string; basePortion: string; variationsPortion: string; addonsPortion: string } => {
    const toCents = (s: string) => Math.round(parseFloat(s) * 100);
    const totalCents = toCents(computeWeightedLineTotal(weight, foodUnitPrice, [...variationExtras, ...addonExtras], quantity));
    const baseCents = toCents(computeWeightedLineTotal(weight, foodUnitPrice, [], quantity));
    const addonsCents = toCents(computeWeightedLineTotal(weight, 0, addonExtras, quantity));
    const variationsCents = totalCents - baseCents - addonsCents;
    return {
        total: (totalCents / 100).toFixed(2),
        basePortion: (baseCents / 100).toFixed(2),
        variationsPortion: (variationsCents / 100).toFixed(2),
        addonsPortion: (addonsCents / 100).toFixed(2),
    };
};

/** Request booleans arrive as true/false, "true"/"false", "1"/"0", "yes"/"no". undefined/null/"" → undefined. */
export const parseBooleanInput = (value: unknown): boolean | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const t = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(t)) return true;
    if (["false", "0", "no", "n", "off"].includes(t)) return false;
    return undefined;
};

// ─────────────────────────────────────────────
// Line pricing shared by getCart and both weight-request detail screens
// ─────────────────────────────────────────────

const parseJsonDeep = (raw: any): any => {
    let v = raw;
    for (let i = 0; i < 3 && typeof v === "string"; i++) {
        try { v = JSON.parse(v); } catch { break; }
    }
    return v;
};

/**
 * Price snapshot of a cart row (cart_items.unit_price + stored option / addon prices).
 * - Weighted row: unit_price is the base price per weight unit.
 * - Unit row: unit_price is base + variations + addons per unit, so base = unit − extras.
 */
export const snapshotLinePricing = (
    row: { unitPrice?: string | number | null; variations?: unknown; addons?: unknown },
    isWeighted: boolean
) => {
    const rawVars = parseJsonDeep(row.variations);
    const vars: any[] = Array.isArray(rawVars) ? rawVars : (rawVars && Array.isArray(rawVars.variations) ? rawVars.variations : []);
    const rawAddons = parseJsonDeep(row.addons);
    const addonList: any[] = Array.isArray(rawAddons) ? rawAddons : [];
    const variationExtras: WeightedOptionExtra[] = vars.map((v: any) => ({
        price: Number(v.price ?? v.additionalPrice ?? 0),
        priceMode: v.priceMode === "per_weight" ? "per_weight" : "fixed",
    }));
    const addonExtras: WeightedOptionExtra[] = addonList.map((a: any) => ({ price: Number(a.price ?? 0), priceMode: "fixed" }));
    const unit = Number(row.unitPrice ?? 0) || 0;
    const varSum = variationExtras.reduce((s, e) => s + Number(e.price), 0);
    const addonSum = addonExtras.reduce((s, e) => s + Number(e.price), 0);
    const basePrice = isWeighted ? unit : Math.max(0, Math.round((unit - varSum - addonSum) * 100) / 100);
    return { basePrice, variationExtras, addonExtras, varSum, addonSum, vars, addonList };
};

export interface CartLinePriceInput {
    isWeighted: boolean;
    /** weighted rows: final weight if set, else the ordered weight */
    effectiveWeight?: number | string | null;
    /** unit rows */
    quantity: number;
    /** base price before the product discount (per unit, or per weight unit for weighted rows) */
    basePrice: number;
    /** base price after the product discount (formatProductsWithDiscounts().finalPrice) */
    discountedBasePrice: number;
    /** weighted rows: option / addon extras (fixed or per_weight) */
    extras?: WeightedOptionExtra[];
    /** unit rows: variations + addons per unit */
    unitExtras?: number;
}

export interface CartLinePrice {
    originalUnitPrice: number;
    finalUnitPrice: number;
    discountPerUnit: number;
    originalTotal: number;
    finalTotal: number;
    discountTotal: number;
}

/**
 * The ONE line-price formula: getCart, the customer weight-request screen and the restaurant
 * weight-request screen all call it, so their totals cannot differ.
 * - Weighted: total = computeWeightedLineTotal(weight, base, extras); discount on the per-unit base.
 * - Unit: total = (base + extras) × quantity (same float math getCart always used).
 */
export const priceCartLine = (p: CartLinePriceInput): CartLinePrice => {
    if (p.isWeighted) {
        const w = Number(p.effectiveWeight ?? 0);
        const extras = p.extras || [];
        const qty = Math.max(1, Math.round(Number(p.quantity) || 1));
        const originalTotal = parseFloat(computeWeightedLineTotal(w, p.basePrice, extras, qty));
        const finalTotal = parseFloat(computeWeightedLineTotal(w, p.discountedBasePrice, extras, qty));
        return {
            originalUnitPrice: p.basePrice,
            finalUnitPrice: p.discountedBasePrice,
            discountPerUnit: Math.max(0, p.basePrice - p.discountedBasePrice),
            originalTotal,
            finalTotal,
            discountTotal: Math.max(0, Math.round((originalTotal - finalTotal) * 100) / 100),
        };
    }
    const unitExtras = p.unitExtras ?? 0;
    const originalUnitPrice = p.basePrice + unitExtras;
    const finalUnitPrice = p.discountedBasePrice + unitExtras;
    const discountPerUnit = Math.max(0, originalUnitPrice - finalUnitPrice);
    return {
        originalUnitPrice,
        finalUnitPrice,
        discountPerUnit,
        originalTotal: originalUnitPrice * p.quantity,
        finalTotal: finalUnitPrice * p.quantity,
        discountTotal: discountPerUnit * p.quantity,
    };
};

/** Sums priced lines; lines marked unavailable are shown but not counted. */
export const summarizeCartLines = (lines: Array<CartLinePrice & { isUnavailable?: boolean | null }>) => {
    const counted = lines.filter((l) => !l.isUnavailable);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return {
        originalSubtotal: r2(counted.reduce((s, l) => s + l.originalTotal, 0)),
        discountTotal: r2(counted.reduce((s, l) => s + l.discountTotal, 0)),
        subtotal: r2(counted.reduce((s, l) => s + l.finalTotal, 0)),
    };
};
