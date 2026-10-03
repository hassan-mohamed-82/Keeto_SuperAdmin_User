/**
 * Calculate Visa Commission for Custom Payment Gateways
 *
 * Formula:
 * y = ((( orderamount * percentage value ) + fixed value ) + tax )
 *
 * Where:
 * - orderAmount: The order's totalAmount
 * - percentageValue: Normal percentage rate (e.g. 2.5 means 2.5%, so orderAmount * 2.5 / 100)
 * - fixedValue: Fixed amount per transaction (e.g. 3.00 EGP)
 * - tax: Tax amount (e.g. 0.50 EGP)
 */
export function calculateVisaCommission(
    orderAmount: number | string | null | undefined,
    percentageValue: number | string | null | undefined,
    fixedValue: number | string | null | undefined,
    tax: number | string | null | undefined
): number {
    const amount = Math.max(0, parseFloat(String(orderAmount || "0")));
    const pVal = parseFloat(String(percentageValue || "0"));
    const fVal = parseFloat(String(fixedValue || "0"));
    const tVal = parseFloat(String(tax || "0"));

    if (amount <= 0) return 0;

    const percentagePart = (amount * pVal) / 100;
    const y = ((percentagePart + fVal) + tVal);

    return Math.max(0, Math.round(y * 100) / 100);
}
