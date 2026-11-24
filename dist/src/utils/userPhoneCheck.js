"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateUserPhone = exports.phoneVariants = exports.normalizeEgPhone = void 0;
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const Errors_1 = require("../Errors");
/**
 * Normalizes and validates Egyptian mobile numbers.
 * Supports formats: 01xxxxxxxxx, +201xxxxxxxxx, 00201xxxxxxxxx, 201xxxxxxxxx
 */
const normalizeEgPhone = (raw) => {
    if (typeof raw !== "string")
        throw new Errors_1.BadRequest("Phone number is required.");
    let trimmed = raw.trim();
    if (trimmed.startsWith("00")) {
        trimmed = trimmed.slice(1);
    }
    else if (!trimmed.startsWith("0")) {
        trimmed = `0${trimmed}`;
    }
    if (!/^01[0125][0-9]{8}$/.test(trimmed)) {
        throw new Errors_1.BadRequest("Phone number must be 11 digits and start with 01.");
    }
    return trimmed;
};
exports.normalizeEgPhone = normalizeEgPhone;
/** All formats a phone may have been stored in (for matching legacy data). */
const phoneVariants = (phone11) => {
    const withoutZero = phone11.startsWith("0") ? phone11.slice(1) : phone11;
    return [phone11, `+20${withoutZero}`, `20${withoutZero}`, `0020${withoutZero}`];
};
exports.phoneVariants = phoneVariants;
/**
 * Validates that the user (whether guest or registered) has a phone number
 * or an alternative phone number.
 * If neither is found in DB nor provided in body, throws BadRequest.
 */
const validateUserPhone = async (userId, isGuestUser, body = {}, errorMessage = "Phone number or alternative phone number is required.") => {
    if (!userId) {
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    }
    const [user] = await connection_1.db
        .select()
        .from(schema_1.users)
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId))
        .limit(1);
    if (!user) {
        throw new Errors_1.UnauthorizedError("User not found");
    }
    if (isGuestUser) {
        const guestName = String(body.guestInfo?.name || body.name || user.name || "Guest").trim().slice(0, 100) || "Guest";
        const rawGuestPhone = body.guestInfo?.phone || body.phone || user.phone || null;
        const rawGuestAltPhone = body.guestInfo?.alternatePhone ||
            body.guestInfo?.alternativePhone ||
            body.alternatePhone ||
            body.alternativePhone ||
            user.alternatePhone ||
            null;
        if (!rawGuestPhone && !rawGuestAltPhone) {
            throw new Errors_1.BadRequest(errorMessage);
        }
        let guestPhone = null;
        let guestAltPhone = null;
        if (rawGuestPhone) {
            guestPhone = (0, exports.normalizeEgPhone)(rawGuestPhone);
        }
        if (rawGuestAltPhone) {
            guestAltPhone = (0, exports.normalizeEgPhone)(rawGuestAltPhone);
        }
        // If primary phone is missing but alternative phone exists, use alternative phone as primary guestPhone
        if (!guestPhone && guestAltPhone) {
            guestPhone = guestAltPhone;
        }
        // A phone that belongs to a registered account can't be used by a guest (no silent merge, no takeover).
        // Note: we intentionally do NOT filter by isDeleted — a soft-deleted account still owns its phone number.
        const phonesToCheck = [guestPhone, guestAltPhone].filter(Boolean);
        for (const phoneToCheck of phonesToCheck) {
            const [registered] = await connection_1.db
                .select({ id: schema_1.users.id })
                .from(schema_1.users)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.users.phone, (0, exports.phoneVariants)(phoneToCheck)), (0, drizzle_orm_1.eq)(schema_1.users.isGuest, false)
            //eq(users.isDeleted, false)
            ))
                .limit(1);
            if (registered) {
                throw new Errors_1.BadRequest("An account already exists with this phone number. Please log in to continue, or use a different phone number.");
            }
        }
        return {
            user,
            phone: guestPhone,
            alternatePhone: guestAltPhone,
            guestName,
        };
    }
    else {
        let userPhone = user.phone ? user.phone.trim() : null;
        let userAltPhone = user.alternatePhone ? user.alternatePhone.trim() : null;
        const reqPhone = body.phone || body.guestInfo?.phone;
        const reqAltPhone = body.alternatePhone ||
            body.alternativePhone ||
            body.guestInfo?.alternatePhone ||
            body.guestInfo?.alternativePhone;
        if (!userPhone && reqPhone) {
            userPhone = (0, exports.normalizeEgPhone)(reqPhone);
            await connection_1.db.update(schema_1.users).set({ phone: userPhone }).where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
            user.phone = userPhone;
        }
        if (!userAltPhone && reqAltPhone) {
            userAltPhone = (0, exports.normalizeEgPhone)(reqAltPhone);
            await connection_1.db.update(schema_1.users).set({ alternatePhone: userAltPhone }).where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
            user.alternatePhone = userAltPhone;
        }
        if (!userPhone && !userAltPhone) {
            throw new Errors_1.BadRequest(errorMessage);
        }
        return {
            user,
            phone: (userPhone || userAltPhone),
            alternatePhone: userAltPhone,
        };
    }
};
exports.validateUserPhone = validateUserPhone;
