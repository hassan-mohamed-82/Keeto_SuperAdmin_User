import { z } from "zod";

/**
 * Egyptian mobile numbers format:
 * - Exactly 11 digits
 * - Starts with 01
 * - Followed by 0, 1, 2, or 5 (Vodafone, Etisalat, Orange, WE)
 * - Followed by 8 digits
 * Example: 01012345678, 01112345678, 01212345678, 01512345678
 * Rejects country code formats like +201236547899, 0020..., 20...
 */
export const egyptPhoneRegex = /^01[0125][0-9]{8}$/;

export const egyptPhoneErrorMessage =
    "Phone number must be 11 digits and start with 01.";

export const normalizePhoneInput = (val: string): string => {
    let trimmed = val.trim();
    if (!trimmed) return trimmed;
    if (trimmed.startsWith("00")) {
        trimmed = trimmed.slice(1); // removes one '0' -> leaves single '0'
    } else if (!trimmed.startsWith("0")) {
        trimmed = `0${trimmed}`; // adds '0' if missing
    }
    return trimmed;
};

export const egyptPhoneSchema = z.preprocess(
    (val) => {
        if (typeof val === "string") {
            return normalizePhoneInput(val);
        }
        return val;
    },
    z
        .string({ required_error: "Phone number is required" })
        .regex(egyptPhoneRegex, {
            message: egyptPhoneErrorMessage,
        })
);

export const optionalEgyptPhoneSchema = z
    .preprocess(
        (val) => {
            if (val === null || val === undefined) return val;
            if (typeof val === "string") {
                const normalized = normalizePhoneInput(val);
                if (normalized === "") return normalized;
                return normalized;
            }
            return val;
        },
        z.union([
            z.string().regex(egyptPhoneRegex, {
                message: egyptPhoneErrorMessage,
            }),
            z.literal(""),
            z.null(),
            z.undefined(),
        ])
    )
    .optional();
