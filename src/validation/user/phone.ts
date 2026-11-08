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

export const egyptPhoneSchema = z.preprocess(
    (val) => {
        if (typeof val === "string") {
            const trimmed = val.trim();
            if (trimmed && !trimmed.startsWith("0")) {
                return `0${trimmed}`;
            }
            return trimmed;
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
                const trimmed = val.trim();
                if (trimmed === "") return trimmed;
                return !trimmed.startsWith("0") ? `0${trimmed}` : trimmed;
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
