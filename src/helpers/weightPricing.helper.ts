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
    options: WeightedOptionExtra[] = []
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

    return (finalCents / 100).toFixed(2);
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
}

/**
 * Single source of truth for validating a weight entered by a customer or by
 * restaurant staff. Returns the normalised weight (3 decimals) for weight-sold
 * foods, or null for unit-sold foods (where a weight must not be sent).
 *
 * Rules:
 * - at most 3 decimal places;
 * - must be >= 0.001 after rounding (0.0004 would otherwise be stored as "0.000");
 * - must be <= the sane maximum for the food's weight_unit (isSaneWeight).
 *
 * `selectedOptions` is reserved for the weight-group / allow_custom_weight rules.
 * Those columns (food.allow_custom_weight, variation_options.weight_value, a
 * "weight group" flag on food_variations) do NOT exist in either schema yet, so
 * no weight-group rule is enforced here. Wire them in once the columns exist.
 */
export const validateWeightInput = (
    food: WeightInputFood,
    weight: number | string | null | undefined,
    _selectedOptions: unknown[] = []
): number | null => {
    const hasWeight = weight !== undefined && weight !== null && weight !== "";

    if (food.sold_by !== "weight") {
        if (hasWeight) throw new BadRequest("Weight cannot be specified for unit-sold products");
        return null;
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

    return normalised;
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
    addonExtras: WeightedOptionExtra[] = []
): { total: string; basePortion: string; variationsPortion: string; addonsPortion: string } => {
    const toCents = (s: string) => Math.round(parseFloat(s) * 100);
    const totalCents = toCents(computeWeightedLineTotal(weight, foodUnitPrice, [...variationExtras, ...addonExtras]));
    const baseCents = toCents(computeWeightedLineTotal(weight, foodUnitPrice, []));
    const addonsCents = toCents(computeWeightedLineTotal(weight, 0, addonExtras));
    const variationsCents = totalCents - baseCents - addonsCents;
    return {
        total: (totalCents / 100).toFixed(2),
        basePortion: (baseCents / 100).toFixed(2),
        variationsPortion: (variationsCents / 100).toFixed(2),
        addonsPortion: (addonsCents / 100).toFixed(2),
    };
};
