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

/**
 * Computes line total for a weighted item using safe integer arithmetic:
 * item_total = round(weight * unit_price, 2)
 *
 * Avoids IEEE-754 floating point drift by scaling weight to thousandths (milligrams/grams)
 * and unitPrice to hundredths (cents/piastres).
 *
 * @param weight customer or restaurant weight (in food's weight_unit)
 * @param unitPrice price per weight_unit
 * @returns string formatted with 2 decimal places (e.g. "49.95")
 */
export const computeWeightedLineTotal = (
    weight: number | string,
    unitPrice: number | string
): string => {
    const w = typeof weight === "number" ? weight : parseFloat(weight);
    const p = typeof unitPrice === "number" ? unitPrice : parseFloat(unitPrice);

    if (isNaN(w) || isNaN(p) || w < 0 || p < 0) {
        throw new BadRequest("Invalid weight or unit price");
    }

    // w * 1000 to thousandths; p * 100 to hundredths
    const weightScaled = Math.round(w * 1000);
    const priceScaled = Math.round(p * 100);

    // weightScaled * priceScaled has scale 100,000
    // To get cents (scale 100), divide by 1000 and round
    const totalCents = Math.round((weightScaled * priceScaled) / 1000);

    return (totalCents / 100).toFixed(2);
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
