"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalEgyptPhoneSchema = exports.egyptPhoneSchema = exports.normalizePhoneInput = exports.egyptPhoneErrorMessage = exports.egyptPhoneRegex = void 0;
const zod_1 = require("zod");
/**
 * Egyptian mobile numbers format:
 * - Exactly 11 digits
 * - Starts with 01
 * - Followed by 0, 1, 2, or 5 (Vodafone, Etisalat, Orange, WE)
 * - Followed by 8 digits
 * Example: 01012345678, 01112345678, 01212345678, 01512345678
 * Rejects country code formats like +201236547899, 0020..., 20...
 */
exports.egyptPhoneRegex = /^01[0125][0-9]{8}$/;
exports.egyptPhoneErrorMessage = "Phone number must be 11 digits and start with 01.";
const normalizePhoneInput = (val) => {
    let trimmed = val.trim();
    if (!trimmed)
        return trimmed;
    if (trimmed.startsWith("00")) {
        trimmed = trimmed.slice(1); // removes one '0' -> leaves single '0'
    }
    else if (!trimmed.startsWith("0")) {
        trimmed = `0${trimmed}`; // adds '0' if missing
    }
    return trimmed;
};
exports.normalizePhoneInput = normalizePhoneInput;
exports.egyptPhoneSchema = zod_1.z.preprocess((val) => {
    if (typeof val === "string") {
        return (0, exports.normalizePhoneInput)(val);
    }
    return val;
}, zod_1.z
    .string({ required_error: "Phone number is required" })
    .regex(exports.egyptPhoneRegex, {
    message: exports.egyptPhoneErrorMessage,
}));
exports.optionalEgyptPhoneSchema = zod_1.z
    .preprocess((val) => {
    if (val === null || val === undefined)
        return val;
    if (typeof val === "string") {
        const normalized = (0, exports.normalizePhoneInput)(val);
        if (normalized === "")
            return normalized;
        return normalized;
    }
    return val;
}, zod_1.z.union([
    zod_1.z.string().regex(exports.egyptPhoneRegex, {
        message: exports.egyptPhoneErrorMessage,
    }),
    zod_1.z.literal(""),
    zod_1.z.null(),
    zod_1.z.undefined(),
]))
    .optional();
