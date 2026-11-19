import { db } from "../models/connection";
import { users } from "../models/schema";
import { eq, and, inArray } from "drizzle-orm";
import { BadRequest, UnauthorizedError } from "../Errors";

/**
 * Normalizes and validates Egyptian mobile numbers.
 * Supports formats: 01xxxxxxxxx, +201xxxxxxxxx, 00201xxxxxxxxx, 201xxxxxxxxx
 */
export const normalizeEgPhone = (raw: unknown): string => {
    if (typeof raw !== "string") throw new BadRequest("Phone number is required.");
    let trimmed = raw.trim();
    if (trimmed.startsWith("00")) {
        trimmed = trimmed.slice(1);
    } else if (!trimmed.startsWith("0")) {
        trimmed = `0${trimmed}`;
    }
    if (!/^01[0125][0-9]{8}$/.test(trimmed)) {
        throw new BadRequest("Phone number must be 11 digits and start with 01.");
    }
    return trimmed;
};

/** All formats a phone may have been stored in (for matching legacy data). */
export const phoneVariants = (phone11: string): string[] => {
    const withoutZero = phone11.startsWith("0") ? phone11.slice(1) : phone11;
    return [phone11, `+20${withoutZero}`, `20${withoutZero}`, `0020${withoutZero}`];
};

export interface ValidateUserPhoneResult {
    user: typeof users.$inferSelect;
    phone: string;
    alternatePhone: string | null;
    guestName?: string;
}

/**
 * Validates that the user (whether guest or registered) has a phone number
 * or an alternative phone number.
 * If neither is found in DB nor provided in body, throws BadRequest.
 */
export const validateUserPhone = async (
    userId: string,
    isGuestUser: boolean,
    body: {
        phone?: string;
        alternatePhone?: string;
        alternativePhone?: string;
        guestInfo?: { name?: string; phone?: string; alternatePhone?: string; alternativePhone?: string };
        name?: string;
    } = {},
    errorMessage: string = "Phone number or alternative phone number is required."
): Promise<ValidateUserPhoneResult> => {
    if (!userId) {
        throw new UnauthorizedError("Unauthenticated");
    }

    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    if (!user) {
        throw new UnauthorizedError("User not found");
    }

    if (isGuestUser) {
        const guestName = String(body.guestInfo?.name || body.name || user.name || "Guest").trim().slice(0, 100) || "Guest";

        const rawGuestPhone = body.guestInfo?.phone || body.phone || user.phone || null;
        const rawGuestAltPhone =
            body.guestInfo?.alternatePhone ||
            body.guestInfo?.alternativePhone ||
            body.alternatePhone ||
            body.alternativePhone ||
            user.alternatePhone ||
            null;

        if (!rawGuestPhone && !rawGuestAltPhone) {
            throw new BadRequest(errorMessage);
        }

        let guestPhone: string | null = null;
        let guestAltPhone: string | null = null;

        if (rawGuestPhone) {
            guestPhone = normalizeEgPhone(rawGuestPhone);
        }
        if (rawGuestAltPhone) {
            guestAltPhone = normalizeEgPhone(rawGuestAltPhone);
        }

        // If primary phone is missing but alternative phone exists, use alternative phone as primary guestPhone
        if (!guestPhone && guestAltPhone) {
            guestPhone = guestAltPhone;
        }

        // A phone that belongs to a registered account can't be used by a guest (no silent merge, no takeover).
        const phonesToCheck = [guestPhone, guestAltPhone].filter(Boolean) as string[];
        for (const phoneToCheck of phonesToCheck) {
            const [registered] = await db
                .select({ id: users.id })
                .from(users)
                .where(
                    and(
                        inArray(users.phone, phoneVariants(phoneToCheck)),
                        eq(users.isGuest, false),
                        eq(users.isDeleted, false)
                    )
                )
                .limit(1);

            if (registered) {
                throw new BadRequest(
                    "An account already exists with this phone number. Please log in to continue, or use a different phone number."
                );
            }
        }

        return {
            user,
            phone: guestPhone!,
            alternatePhone: guestAltPhone,
            guestName,
        };
    } else {
        let userPhone = user.phone ? user.phone.trim() : null;
        let userAltPhone = user.alternatePhone ? user.alternatePhone.trim() : null;

        const reqPhone = body.phone || body.guestInfo?.phone;
        const reqAltPhone =
            body.alternatePhone ||
            body.alternativePhone ||
            body.guestInfo?.alternatePhone ||
            body.guestInfo?.alternativePhone;

        if (!userPhone && reqPhone) {
            userPhone = normalizeEgPhone(reqPhone);
            await db.update(users).set({ phone: userPhone }).where(eq(users.id, userId));
            user.phone = userPhone;
        }

        if (!userAltPhone && reqAltPhone) {
            userAltPhone = normalizeEgPhone(reqAltPhone);
            await db.update(users).set({ alternatePhone: userAltPhone }).where(eq(users.id, userId));
            user.alternatePhone = userAltPhone;
        }

        if (!userPhone && !userAltPhone) {
            throw new BadRequest(errorMessage);
        }

        return {
            user,
            phone: (userPhone || userAltPhone)!,
            alternatePhone: userAltPhone,
        };
    }
};
