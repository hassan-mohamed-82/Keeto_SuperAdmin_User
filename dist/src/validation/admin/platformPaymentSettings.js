"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePlatformPaymentSettingsSchema = void 0;
// src/validation/admin/platformPaymentSettings.ts
// Zod schemas for the platform-level SYSTEM-visa gateway fee settings.
const zod_1 = require("zod");
/**
 * Body schema for updating the platform SYSTEM-visa fee settings.
 * - percentageValue: 0–100 (e.g. 2 means 2%)
 * - fixedValue: >= 0 flat EGP per transaction
 * - tax: >= 0 flat EGP per transaction
 */
exports.updatePlatformPaymentSettingsSchema = zod_1.z.object({
    percentageValue: zod_1.z
        .number({ required_error: "percentageValue is required" })
        .min(0, "percentageValue must be >= 0")
        .max(100, "percentageValue must be <= 100"),
    fixedValue: zod_1.z
        .number({ required_error: "fixedValue is required" })
        .min(0, "fixedValue must be >= 0"),
    tax: zod_1.z
        .number({ required_error: "tax is required" })
        .min(0, "tax must be >= 0"),
});
