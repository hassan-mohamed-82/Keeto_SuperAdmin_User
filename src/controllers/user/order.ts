// controllers/user/OrderController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    restaurantZoneDeliveryFees, zoneDeliveryFees, restaurantSettings,
    restaurantSchedules, cartItems, users, addresses, branches,
    userWallets, userWalletTransactions, paymentMethods,
    coupons, couponUsages, couponRestaurants, discounts,
    selectReasons,
    orders,
    restaurants,
    orderItems,
    notifications,
    restaurantBusinessPlans, food,
    variationOptions,
    addons,
    zones,
    deliveryMen,
    freeDeliveryOffers,
    branchSubcategories,
    foodVariations,
    userRestaurantPoints,
    cities,
    offers,
    offerFoods,
    shippingCompanies,
    shippingZones,
    shippingCompanyRestaurants,
} from "../../models/schema";
import { releaseCourierForOrder } from "../../services/shipping/dispatchEngine";
import { eq, and, inArray, sql, desc, gte, ne } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";
import { UnauthorizedError } from "../../Errors";
import { sendPushNotification } from "../../utils/notifications";
import { calculateDistance, isLocationInZone } from "../../utils/geo";
import { formatProductsWithDiscounts } from "../../services/discount.service";
import { validateUserNotBlocked } from "../../utils/userBlockCheck";
import { calculateCurrentStatus } from "./restaurantFeatures";
import * as turf from "@turf/turf";
import { calculateCalculatedPrice, resolveBranchIdFromAddress, type ServiceModule } from "../../helpers/pricing.helper";
import { validateAndCalculateCoupon } from "../../helpers/coupon.helper";
import { resolveFirstOrderDiscount, recordFirstOrderDiscountUsage } from "../../helpers/firstOrderDiscount.helper";
import { activeFoodCondition } from "../../helpers/foodConditions";
import { createOrderPaymentSession } from "../../services/payments/paymentSession.service";
import { getNextDailyOrderNumber } from "../../helpers/getNextDailyOrderNumber";
import { chargePendingServiceFee, handleCancelledOrder, mapOrderSourceToPlatformType } from "../../services/restaurantWalletService";
import { calculateVisaCommission } from "../../utils/calculateVisaCommission";
import { getActiveCustomGateway } from "../../utils/getActiveCustomGateway";
import { getSystemVisaSettings } from "../../utils/getSystemVisaSettings";

// 👇 1. دالة تظبيط الوقت لتوقيت مصر عشان نص الإشعار
const formatToEgyptTime = (date: Date) => {
    return new Intl.DateTimeFormat("ar-EG", { // غيرتها لـ ar-EG عشان تطلع بالعربي لو حابة
        timeZone: "Africa/Cairo",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    }).format(date);
};

// 🗓️ Helper لتحويل التاريخ لصيغة مقروءة وواضحة
const formatDate = (date: Date | null | undefined): string | null => {
    if (!date) return null;
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Cairo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    }).format(new Date(date));
};

const parseJsonArray = (val: any): any[] => {
    if (!val) return [];
    if (typeof val === "string") {
        try {
            const parsed = JSON.parse(val);
            return typeof parsed === "string" ? JSON.parse(parsed) : (Array.isArray(parsed) ? parsed : []);
        } catch {
            return [];
        }
    }
    return Array.isArray(val) ? val : [];
};

// Helper to format order items variations, supporting both snapshot-stored variations and old database lookup fallback
const formatOrderItemsVariations = async (items: any[]) => {
    const parsedItems = items.map(item => {
        let cleanVariations = item.variations;
        if (typeof cleanVariations === 'string') {
            try {
                cleanVariations = JSON.parse(cleanVariations);
                if (typeof cleanVariations === 'string') {
                    cleanVariations = JSON.parse(cleanVariations);
                }
            } catch (e) {
                cleanVariations = [];
            }
        }
        if (!Array.isArray(cleanVariations)) cleanVariations = [];
        return { item, cleanVariations };
    });

    // ✅ FIX: collect option IDs per-variation, not per-item, so a single
    // incomplete variation doesn't force a re-fetch (and possible drop) of
    // its siblings that already have full details.
    const allOldOptionIds = new Set<string>();
    for (const { cleanVariations } of parsedItems) {
        for (const v of cleanVariations) {
            const hasFullDetails = Boolean(v?.variationName && v?.optionName);
            if (!hasFullDetails) {
                const optId = v?.optionId || v?.id;
                if (optId) allOldOptionIds.add(optId);
            }
        }
    }

    const optionsMap = new Map<string, any>();
    if (allOldOptionIds.size > 0) {
        const optionsWithParent = await db
            .select({
                optionId: variationOptions.id,
                optionName: variationOptions.optionName,
                optionNameAr: variationOptions.optionNameAr,
                optionNameFr: variationOptions.optionNameFr,
                additionalPrice: variationOptions.additionalPrice,
                variationId: foodVariations.id,
                variationName: foodVariations.name,
                variationNameAr: foodVariations.nameAr,
                variationNameFr: foodVariations.nameFr,
            })
            .from(variationOptions)
            .leftJoin(foodVariations, eq(variationOptions.variationId, foodVariations.id))
            .where(inArray(variationOptions.id, Array.from(allOldOptionIds)));

        for (const opt of optionsWithParent) {
            optionsMap.set(opt.optionId, opt);
        }
    }

    return parsedItems.map(({ item, cleanVariations }) => {
        const variationDetails = cleanVariations.map((v: any) => {
            const hasFullDetails = Boolean(v?.variationName && v?.optionName);

            if (hasFullDetails) {
                return {
                    optionId: v.optionId,
                    optionName: v.optionName,
                    optionNameAr: v.optionNameAr,
                    optionNameFr: v.optionNameFr || '',
                    additionalPrice: v.price || v.additionalPrice || '0',
                    variationId: v.variationId,
                    variationName: v.variationName,
                    variationNameAr: v.variationNameAr,
                    variationNameFr: v.variationNameFr || '',
                };
            }

            const optId = v?.optionId || v?.id;
            const optDetails = optId ? optionsMap.get(optId) : null;

            if (optDetails) {
                return optDetails;
            }

            // ✅ FIX: option/variation no longer exists in the DB (deleted after
            // the order was placed) — fall back to the order-item snapshot
            // instead of dropping the row, flagged as unavailable.
            if (v && (v.optionId || v.id)) {
                return {
                    optionId: v.optionId || v.id || null,
                    optionName: v.optionName || null,
                    optionNameAr: v.optionNameAr || null,
                    optionNameFr: v.optionNameFr || '',
                    additionalPrice: v.price || v.additionalPrice || '0',
                    variationId: v.variationId || null,
                    variationName: v.variationName || null,
                    variationNameAr: v.variationNameAr || null,
                    variationNameFr: v.variationNameFr || '',
                    isAvailable: false,
                };
            }

            return null;
        }).filter(Boolean);

        return {
            ...item,
            variations: variationDetails,
        };
    });
};

// ==========================================
// 1. إنشاء الطلب (Checkout)
// ==========================================
// دالة مساعدة لضمان سلامة العمليات الحسابية المالية

const roundMoney = (amount: number): number => Math.round(amount * 100) / 100;

// ==========================================================================
// ✏️ NEW HELPERS (put them in a utils file and import them if you prefer)
// ==========================================================================

/**
 * Normalizes an Egyptian mobile number to E.164 (+201XXXXXXXXX).
 * Accepts: 01012345678 / +201012345678 / 00201012345678 / 201012345678
 * Throws BadRequest if the format is invalid.
 */
export const normalizeEgPhone = (raw: unknown): string => {
    if (typeof raw !== "string") throw new BadRequest("Phone number is required.");
    let trimmed = raw.trim();
    if (trimmed && !trimmed.startsWith("0")) {
        trimmed = `0${trimmed}`;
    }
    if (!/^01[0125][0-9]{8}$/.test(trimmed)) {
        throw new BadRequest("Phone number must be 11 digits and start with 01.");
    }
    return trimmed;
};

/** All formats a phone may have been stored in (for matching legacy data). */
const phoneVariants = (phone11: string): string[] => {
    const withoutZero = phone11.startsWith("0") ? phone11.slice(1) : phone11;
    return [phone11, `+20${withoutZero}`, `20${withoutZero}`, `0020${withoutZero}`];
};

/** Validates + builds the guest address row. It is NOT inserted here — it is inserted inside the transaction. */
const buildGuestAddress = (guestAddress: any, userId: string) => {
    if (!guestAddress || typeof guestAddress !== "object") {
        throw new BadRequest("Delivery address is required.");
    }
    const lat = Number(guestAddress.lat);
    const lng = Number(guestAddress.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !lat || !lng || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new BadRequest("Delivery address requires valid latitude and longitude coordinates.");
    }
    if (!guestAddress.street || String(guestAddress.street).trim() === "") {
        throw new BadRequest("Street is required for the delivery address.");
    }
    const number = guestAddress.number != null ? String(guestAddress.number).trim() : "";
    return {
        id: uuidv4(),
        userId,
        title: guestAddress.title || "Guest Address",
        street: String(guestAddress.street).trim(),
        number: number || "-",
        floor: guestAddress.floor ? String(guestAddress.floor) : null,
        apartment: guestAddress.apartment ? String(guestAddress.apartment) : null,
        landmark: guestAddress.landmark || null,
        location: guestAddress.location || null,
        fulladdress: guestAddress.fulladdress || `${number} ${String(guestAddress.street).trim()}`.trim(),
        lat: String(lat),
        lng: String(lng),
    };
};

export const checkout = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const isGuestUser = Boolean(req.user.isGuest);

    const {
        orderSource,
        paymentMethod,
        orderType,
        idempotencyKey,
        zoneId,
        branchId,
        addressId: inputAddressId,
        note,
        couponCode,
        guestInfo,
        guestAddress,
        restaurantName
    } = req.body;

    let addressId: string | null = inputAddressId || null;

    // ✏️ CHANGED: no more identity merge. The user id is always the authenticated one.
    const userId: string = req.user.id;

    // ==========================================
    // 🛡️ Guest Checkout — validation only (NO DB writes here)
    // ✏️ CHANGED: only runs for real guest sessions. `guestInfo` is ignored for registered users,
    // so a registered account can never be renamed / re-phoned / soft-deleted through this endpoint.
    // All writes happen later inside the transaction.
    // ==========================================
    let guestName: string | null = null;
    let guestPhone: string | null = null;

    if (isGuestUser) {
        guestName = String(guestInfo?.name || req.user.name || "Guest").trim().slice(0, 100) || "Guest";
        guestPhone = normalizeEgPhone(guestInfo?.phone); // throws BadRequest if missing / invalid
        const altPhone = guestInfo?.alternatePhone || guestInfo?.alternativePhone;
        if (altPhone) {
            normalizeEgPhone(altPhone);
        }

        // A phone that belongs to a registered account can't be used by a guest (no silent merge, no takeover).
        const [registered] = await db
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    inArray(users.phone, phoneVariants(guestPhone)),
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

    // ==========================================
    // 🏠 Guest Address (Delivery) — built in memory, inserted inside the transaction
    // ✏️ CHANGED: validated, and not inserted before the order is validated.
    // ==========================================
    let pendingGuestAddress: ReturnType<typeof buildGuestAddress> | null = null;

    if (isGuestUser && orderType === "delivery" && !addressId) {
        pendingGuestAddress = buildGuestAddress(guestAddress, userId);
        addressId = pendingGuestAddress.id;
    }

    // ==========================================
    // 🛡️ 1. Validation
    // ==========================================
    const validOrderSources = ["online_order_app", "online_order_web", "food_aggregator", "mykeeto", "pos"];
    if (!validOrderSources.includes(orderSource)) {
        throw new BadRequest("Invalid order source");
    }

    const [selectedPayment] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, paymentMethod)).limit(1);

    if (!selectedPayment || !selectedPayment.isActive) {
        throw new BadRequest("Invalid or inactive payment method");
    }

    const paymentMethodName = selectedPayment.name;
    const paymentMethodNameAr = selectedPayment.nameAr;
    const isWalletPayment = paymentMethodName === "wallet" || paymentMethodNameAr === "محفظتى";
    const isCashPayment = paymentMethodName === "cash_on_delivery" || paymentMethodNameAr === "الدفع عند الاستلام" || paymentMethodName === "cash";

    // 🛡️ Prevent wallet payment for guest accounts
    if (isGuestUser && isWalletPayment) {
        throw new BadRequest("Wallet payment is only available for registered accounts.");
    }

    const isVisaPayment =
        paymentMethodName?.toLowerCase() === "visa" ||
        paymentMethodNameAr === "بطاقة";

    // ==========================================
    // 2. Idempotency Check
    // ✏️ CHANGED: scoped by userId so one user can never receive another user's order.
    // (Also add a unique index on (user_id, idempotency_key).)
    // ==========================================
    if (idempotencyKey) {
        const [existing] = await db
            .select()
            .from(orders)
            .where(and(eq(orders.idempotencyKey, idempotencyKey), eq(orders.userId, userId)))
            .limit(1);
        if (existing) return SuccessResponse(res, { message: "Order already processed", data: existing });
    }

    // ==========================================
    // 3. Get Cart Items & User Verification
    // ==========================================
    const userCart = await db.select().from(cartItems).where(eq(cartItems.userId, userId));
    if (!userCart.length) throw new BadRequest("Your cart is empty");

    const restaurantId = userCart[0].restaurantId;
    const storedOrderSource = orderSource === "mykeeto" ? "my_keeto" : orderSource;

    await validateUserNotBlocked(userId, restaurantId);

    // ==========================================
    // 4. Get Restaurant, Business Plan, Schedules & Settings (Parallelized)
    // ==========================================
    const [
        [restaurant],
        [plan],
        schedulesList,
        [settings]
    ] = await Promise.all([
        db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1),
        db.select()
            .from(restaurantBusinessPlans)
            .where(
                and(
                    eq(restaurantBusinessPlans.restaurantId, restaurantId),
                    eq(restaurantBusinessPlans.platformType, mapOrderSourceToPlatformType(orderSource))
                )
            )
            .limit(1),
        db.select().from(restaurantSchedules).where(eq(restaurantSchedules.restaurantId, restaurantId)),
        db.select().from(restaurantSettings).where(eq(restaurantSettings.restaurantId, restaurantId)).limit(1)
    ]);

    if (!restaurant) throw new BadRequest("Restaurant not found");
    if (!plan) {
        throw new BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }

    if (!restaurant.slug && restaurantName) {
        await db
            .update(restaurants)
            .set({
                slug: restaurantName,
            })
            .where(eq(restaurants.id, restaurant.id));
    }

    // ==========================================
    // 🛡️ 4.5 Operating Hours & Channel Validation
    // ==========================================
    const validOrderTypes = ["delivery", "takeaway", "dine_in"];
    if (!orderType || !validOrderTypes.includes(orderType)) {
        throw new BadRequest("orderType is required and must be one of: delivery, takeaway, dine_in");
    }
    const resolvedOrderType = orderType;
    const status = calculateCurrentStatus(settings, schedulesList);

    if (!status.isOpenNow) throw new BadRequest(`Order failed. ${status.reason}`);
    if (resolvedOrderType === "delivery" && !status.canDeliveryNow) throw new BadRequest("Order failed. Delivery service is currently disabled for this restaurant.");
    if (resolvedOrderType === "takeaway" && !status.canTakeawayNow) throw new BadRequest("Order failed. Takeaway service is currently disabled for this restaurant.");

    // 🛡️ Cash payment guard
    if (isCashPayment && settings?.cashEnabled === false) {
        throw new BadRequest("Cash payment is not accepted by this restaurant. Please choose a different payment method.");
    }

    let defaultPreparingDuration: number;
    if (resolvedOrderType === "takeaway") {
        defaultPreparingDuration = settings?.maxTakeAwayTime ?? 25;
    } else if (resolvedOrderType === "dine_in") {
        defaultPreparingDuration = settings?.maxDineInTime ?? 25;
    } else {
        defaultPreparingDuration = settings?.maxDeliveryTime ?? 25;
    }

    // ==========================================
    // ⚡ 5. Channel Pricing Engine — Subtotal, Variations & Addons
    // orderType IS the serviceModule (they are the same concept)
    // ==========================================
    const serviceModule = resolvedOrderType as ServiceModule;

    let pricingBranchId: string | null = branchId || null;

    if (resolvedOrderType === "delivery") {
        if (!addressId) throw new BadRequest("Delivery address is required.");
        if (!pricingBranchId) {
            try {
                // ✏️ CHANGED: a pending guest address isn't in the DB yet, so skip the DB-based resolver
                // and go straight to the coordinate-based fallback below.
                if (pendingGuestAddress) throw new Error("GUEST_ADDRESS_NOT_SAVED_YET");
                pricingBranchId = await resolveBranchIdFromAddress(addressId, restaurantId);
            } catch (err: any) {
                const storedBranch = userCart.find(c => c.branchId);
                pricingBranchId = storedBranch?.branchId || null;

                if (!pricingBranchId && (settings?.shippingCompanyId || pendingGuestAddress)) {
                    let addr: { lat: string | null; lng: string | null } | undefined;
                    if (pendingGuestAddress) {
                        addr = { lat: pendingGuestAddress.lat, lng: pendingGuestAddress.lng };
                    } else {
                        [addr] = await db
                            .select({ lat: addresses.lat, lng: addresses.lng })
                            .from(addresses)
                            .where(eq(addresses.id, addressId))
                            .limit(1);
                    }

                    const cLat = parseFloat(addr?.lat || "0");
                    const cLng = parseFloat(addr?.lng || "0");

                    const activeBranches = await db
                        .select({ id: branches.id, lat: branches.lat, lng: branches.lng })
                        .from(branches)
                        .where(and(eq(branches.restaurantId, restaurantId), eq(branches.status, "active")));

                    if (activeBranches.length > 0) {
                        let closest = activeBranches[0];
                        let minDist = Infinity;
                        for (const b of activeBranches) {
                            const bLat = parseFloat(b.lat || "0");
                            const bLng = parseFloat(b.lng || "0");
                            if (bLat && bLng && cLat && cLng) {
                                const dist = calculateDistance(cLat, cLng, bLat, bLng);
                                if (dist < minDist) {
                                    minDist = dist;
                                    closest = b;
                                }
                            }
                        }
                        pricingBranchId = closest.id;
                    }
                }
            }
        }
    } else {
        // Takeaway / dine_in: branchId is required
        if (!branchId) throw new BadRequest("Branch is required for takeaway or dine-in orders.");
    }

    // ─── Subcategory-branch availability guard ──────────────────────────
    if (pricingBranchId) {
        const cartFoodIds = userCart.filter(c => !c.offerId).map(c => c.foodId).filter(Boolean) as string[];
        const cartFoods = cartFoodIds.length > 0
            ? await db
                .select({ id: food.id, subcategoryid: food.subcategoryid })
                .from(food)
                .where(and(inArray(food.id, cartFoodIds), activeFoodCondition))
            : [];

        const subcatIdsInCart = [...new Set(cartFoods.map(f => f.subcategoryid).filter(Boolean))] as string[];

        if (subcatIdsInCart.length > 0) {
            const inactiveSubcats = await db
                .select({ subcategoryId: branchSubcategories.subcategoryId })
                .from(branchSubcategories)
                .where(and(
                    eq(branchSubcategories.branchId, pricingBranchId),
                    inArray(branchSubcategories.subcategoryId, subcatIdsInCart),
                    eq(branchSubcategories.status, "inactive")
                ));

            if (inactiveSubcats.length > 0) {
                const inactiveSet = new Set(inactiveSubcats.map(r => r.subcategoryId));
                const blockedFoodIds = cartFoods
                    .filter(f => f.subcategoryid && inactiveSet.has(f.subcategoryid))
                    .map(f => f.id);

                return res.status(422).json({
                    success: false,
                    message: "One or more items in your cart are not available at the selected branch or location.",
                    data: {
                        unavailableItems: blockedFoodIds.map(foodId => ({ foodId })),
                    },
                });
            }
        }
    }

    // Parse cart variations + addons (needed for pricing engine + order items)
    const allAddonIds: string[] = [];
    const cartParsed = userCart.map(item => {
        let safeVars = typeof item.variations === "string" ? JSON.parse(item.variations) : item.variations;
        if (typeof safeVars === "string") safeVars = JSON.parse(safeVars);

        let parsedVariations: any[] = [];
        let parsedAddons: any[] = [];

        if (Array.isArray(safeVars)) {
            parsedVariations = safeVars;
        } else if (safeVars && typeof safeVars === "object") {
            parsedVariations = Array.isArray(safeVars.variations) ? safeVars.variations : [];
            parsedAddons = Array.isArray(safeVars.addons) ? safeVars.addons : [];
        }

        let safeAddons = typeof item.addons === "string" ? JSON.parse(item.addons) : item.addons;
        if (typeof safeAddons === "string") safeAddons = JSON.parse(safeAddons);
        if (Array.isArray(safeAddons)) {
            parsedAddons = [...parsedAddons, ...safeAddons];
        }

        parsedAddons.forEach((a: any) => { if (a.addonId || a.id) allAddonIds.push(a.addonId || a.id); });
        return { cartItem: item, parsedVariations, parsedAddons };
    });

    // Batch fetch variation details for snapshot storage
    const allCheckoutOptionIds = new Set<string>();
    for (const { parsedVariations } of cartParsed) {
        for (const v of parsedVariations) {
            if (v.optionId) {
                allCheckoutOptionIds.add(v.optionId);
            }
        }
    }

    const uniqueFoodIds = [...new Set(userCart.filter(c => !c.offerId && c.foodId).map(c => c.foodId))];

    const [optionsWithParent, addonsListDb, foodItemsDb] = await Promise.all([
        allCheckoutOptionIds.size > 0
            ? db
                .select({
                    optionId: variationOptions.id,
                    optionName: variationOptions.optionName,
                    optionNameAr: variationOptions.optionNameAr,
                    optionNameFr: variationOptions.optionNameFr,
                    additionalPrice: variationOptions.additionalPrice,
                    status: variationOptions.status,
                    variationId: foodVariations.id,
                    variationName: foodVariations.name,
                    variationNameAr: foodVariations.nameAr,
                    variationNameFr: foodVariations.nameFr,
                    variationStatus: foodVariations.status,
                })
                .from(variationOptions)
                .leftJoin(foodVariations, eq(variationOptions.variationId, foodVariations.id))
                .where(inArray(variationOptions.id, Array.from(allCheckoutOptionIds)))
            : [],
        allAddonIds.length > 0
            ? db.select().from(addons).where(inArray(addons.id, [...new Set(allAddonIds)]))
            : [],
        uniqueFoodIds.length > 0
            ? db.select({ id: food.id, price: food.price, status: food.status, isOutOfStock: food.isOutOfStock, discountId: food.discountId, discount_type: food.discount_type, discount_value: food.discount_value })
                .from(food).where(and(inArray(food.id, uniqueFoodIds), activeFoodCondition))
            : []
    ]);

    const optionsWithParentMap = new Map(optionsWithParent.map(o => [o.optionId, o]));
    const addonsMap = new Map(addonsListDb.map(a => [a.id, a]));
    const foodMap = new Map(foodItemsDb.map(f => [f.id, f]));

    const checkoutOfferIds = [...new Set(userCart.filter(c => c.offerId).map(c => c.offerId!))];
    const [dbOffersForCheckout, dbOfferFoodsForCheckout] = checkoutOfferIds.length > 0
        ? await Promise.all([
            db.select().from(offers).where(inArray(offers.id, checkoutOfferIds)),
            db.select().from(offerFoods).where(inArray(offerFoods.offerId, checkoutOfferIds))
        ])
        : [[], []];
    const checkoutOffersMap = new Map(dbOffersForCheckout.map(o => [o.id, o]));
    const checkoutOfferFoodsMap = new Map<string, any[]>();
    for (const ofRow of dbOfferFoodsForCheckout) {
        if (!checkoutOfferFoodsMap.has(ofRow.offerId)) {
            checkoutOfferFoodsMap.set(ofRow.offerId, []);
        }
                checkoutOfferFoodsMap.get(ofRow.offerId)!.push(ofRow);
    }

    if (dbOfferFoodsForCheckout.length > 0) {
        const bundleOptionIds = new Set<string>();
        const bundleAddonIds = new Set<string>();

        for (const ofRow of dbOfferFoodsForCheckout) {
            const rawOpts = parseJsonArray(ofRow.optionIds);
            rawOpts.forEach((id: any) => id && bundleOptionIds.add(String(id)));

            const rawVars = parseJsonArray(ofRow.variations);
            for (const pv of rawVars) {
                if (pv?.optionId) bundleOptionIds.add(String(pv.optionId));
                if (Array.isArray(pv?.options)) {
                    pv.options.forEach((id: any) => id && bundleOptionIds.add(String(id)));
                }
            }

            const rawAddonIds = parseJsonArray(ofRow.addonIds);
            rawAddonIds.forEach((id: any) => id && bundleAddonIds.add(String(id)));
        }

        const missingOptionIds = Array.from(bundleOptionIds).filter((id) => !optionsWithParentMap.has(id));
        if (missingOptionIds.length > 0) {
            const extraOptions = await db
                .select({
                    optionId: variationOptions.id,
                    optionName: variationOptions.optionName,
                    optionNameAr: variationOptions.optionNameAr,
                    optionNameFr: variationOptions.optionNameFr,
                    additionalPrice: variationOptions.additionalPrice,
                    status: variationOptions.status,
                    variationId: foodVariations.id,
                    variationName: foodVariations.name,
                    variationNameAr: foodVariations.nameAr,
                    variationNameFr: foodVariations.nameFr,
                    variationStatus: foodVariations.status,
                })
                .from(variationOptions)
                .leftJoin(foodVariations, eq(variationOptions.variationId, foodVariations.id))
                .where(inArray(variationOptions.id, missingOptionIds));

            for (const opt of extraOptions) {
                optionsWithParentMap.set(opt.optionId, opt);
            }
        }

        const missingAddonIds = Array.from(bundleAddonIds).filter((id) => !addonsMap.has(id));
        if (missingAddonIds.length > 0) {
            const extraAddons = await db
                .select({ id: addons.id, name: addons.name, nameAr: addons.nameAr, nameFr: addons.nameFr, price: addons.price })
                .from(addons)
                .where(inArray(addons.id, missingAddonIds));
            for (const a of extraAddons) {
                addonsMap.set(a.id, a as any);
            }
        }
    }

    // ─── Calculate pricing per item ───
    let subtotal = 0;
    let initialSubtotal = 0;
    const itemsWithData: any[] = [];
    let checkoutHasUnavailable = false;
    let checkoutPriceChanged = false;
    const priceChangedItems: any[] = [];
    let hasFoodLevelDiscount = false;

    for (const { cartItem, parsedVariations, parsedAddons } of cartParsed) {
        if (cartItem.offerId) {
            const offer = checkoutOffersMap.get(cartItem.offerId);
            if (!offer) {
                return res.status(422).json({
                    success: false,
                    message: "An offer in your cart was not found. Please refresh your cart.",
                });
            }
            const nowForOffer = new Date();
            const isOfferActive = offer.status === "active" && new Date(offer.endDate) >= nowForOffer && new Date(offer.startDate) <= nowForOffer;
            if (!isOfferActive) {
                return res.status(422).json({
                    success: false,
                    message: `Offer "${offer.name}" is no longer active or has expired. Please remove it from your cart.`,
                });
            }

            const offerUnitPrice = parseFloat(offer.price);
            const storedUnit = parseFloat(cartItem.unitPrice as string || "0");
            if (Math.abs(offerUnitPrice - storedUnit) > 0.01) {
                checkoutPriceChanged = true;
                priceChangedItems.push({
                    foodId: cartItem.foodId,
                    oldUnitPrice: storedUnit,
                    newUnitPrice: offerUnitPrice,
                });
            }

            const offerTotal = roundMoney(offerUnitPrice * cartItem.quantity);
            initialSubtotal += offerTotal;

            itemsWithData.push({
                cartItem,
                isOffer: true,
                offer,
                offerUnitPrice,
                offerTotal,
                itemIsAvailable: true,
            });
            continue;
        }

        const optionIds = parsedVariations.map((v: any) => v.optionId).filter(Boolean);

        let addonPrice = 0;
        for (const a of parsedAddons) {
            const addonId = a.addonId || a.id;
            const dbAddon = addonsMap.get(addonId);
            if (dbAddon) {
                if (dbAddon.status === "inactive") {
                    return res.status(422).json({
                        success: false,
                        message: `Add-on "${dbAddon.name}" is currently unavailable.`,
                    });
                }
                const p = parseFloat((dbAddon.price || "0") as string);
                addonPrice += p;
                a.price = p.toString();
                a.name = dbAddon.name;
                a.nameAr = dbAddon.nameAr;
                a.nameFr = dbAddon.nameFr;
            } else {
                return res.status(422).json({
                    success: false,
                    message: `Add-on is no longer available. Please refresh your cart.`,
                    data: { affectedFoodId: cartItem.foodId, addonId },
                });
            }
        }

        let channelBasePrice: number;
        let varPrice: number;
        let itemIsAvailable = true;

        const priceResult = await calculateCalculatedPrice(
            cartItem.foodId,
            optionIds,
            pricingBranchId || null,
            serviceModule
        );

        channelBasePrice = priceResult.basePrice;
        varPrice = priceResult.variants.reduce((s, v) => s + v.price, 0);
        itemIsAvailable = priceResult.isAvailable;

        for (const v of parsedVariations) {
            if (v.optionId) {
                const resolved = priceResult.variants.find(r => r.variantOptionId === v.optionId);
                if (resolved) v.additionalPrice = resolved.price.toString();
            }
        }

        const storedUnit = parseFloat(cartItem.unitPrice as string || "0");
        const liveUnit = channelBasePrice + varPrice + addonPrice;
        if (Math.abs(liveUnit - storedUnit) > 0.01) {
            checkoutPriceChanged = true;
            priceChangedItems.push({
                foodId: cartItem.foodId,
                oldUnitPrice: storedUnit,
                newUnitPrice: liveUnit,
            });
        }

        if (!itemIsAvailable) checkoutHasUnavailable = true;

        const originalBasePrice = channelBasePrice;
        const foodItem = foodMap.get(cartItem.foodId);

        let initialDiscountPrice = originalBasePrice;
        if (foodItem?.discount_value && Number(foodItem.discount_value) > 0) {
            hasFoodLevelDiscount = true;
            if (foodItem.discount_type === "percentage") {
                initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(foodItem.discount_value) / 100));
            } else if (foodItem.discount_type === "amount" || foodItem.discount_type === "fixed") {
                initialDiscountPrice = Math.max(0, originalBasePrice - Number(foodItem.discount_value));
            }
        }

        initialSubtotal += (initialDiscountPrice + varPrice + addonPrice) * cartItem.quantity;

        const detailedVariations = parsedVariations.map((v: any) => {
            const optDetails = optionsWithParentMap.get(v.optionId);
            const resolvedPrice = (v.additionalPrice ?? optDetails?.additionalPrice ?? v.price ?? "0.00");

            return {
                variationId: optDetails?.variationId ?? v.variationId ?? null,
                variationName: optDetails?.variationName ?? v.variationName ?? null,
                variationNameAr: optDetails?.variationNameAr ?? v.variationNameAr ?? null,
                variationNameFr: optDetails?.variationNameFr ?? v.variationNameFr ?? null,
                optionId: optDetails?.optionId ?? v.optionId ?? null,
                optionName: optDetails?.optionName ?? v.optionName ?? null,
                optionNameAr: optDetails?.optionNameAr ?? v.optionNameAr ?? null,
                optionNameFr: optDetails?.optionNameFr ?? v.optionNameFr ?? null,
                price: Number(resolvedPrice).toFixed(2),
                additionalPrice: Number(resolvedPrice).toFixed(2)
            };
        });

        const hasMissingDetails = detailedVariations.some(v => !v.variationName && !v.optionName);

        if (hasMissingDetails) {
            return res.status(422).json({
                success: false,
                message: "Some selected options are no longer available. Please refresh your cart.",
                data: {
                    affectedFoodId: cartItem.foodId,
                },
            });
        }

        itemsWithData.push({
            cartItem,
            foodItem,
            originalBasePrice,
            varPrice,
            addonPrice,
            vars: detailedVariations,
            addonsList: parsedAddons,
            itemIsAvailable,
        });
    }

    // ─── 422: Unavailable items guard ────────────────────────────────────
    if (checkoutHasUnavailable) {
        return res.status(422).json({
            success: false,
            message: "One or more items in your cart are unavailable. Please review your cart before placing the order.",
            data: {
                unavailableItems: itemsWithData
                    .filter(d => !d.itemIsAvailable)
                    .map(d => ({ foodId: d.cartItem.foodId })),
            },
        });
    }

    const resolvedOrderProducts = await formatProductsWithDiscounts(
        itemsWithData
            .filter(data => !data.isOffer && data.foodItem)
            .map(data => ({
                id: data.foodItem.id,
                price: data.originalBasePrice,
                discountId: data.foodItem.discountId,
                discountType: data.foodItem.discount_type,
                discountValue: data.foodItem.discount_value,
            })),
        restaurantId,
    );
    const resolvedOrderProductMap = new Map(resolvedOrderProducts.map(product => [product.id, product]));
    const appliedDiscountIds = new Set(
        resolvedOrderProducts
            .map(product => product.appliedDiscountId)
            .filter((id): id is string => Boolean(id))
    );
    const itemsToInsert: any[] = [];

    for (const data of itemsWithData) {
        if (data.isOffer) {
            const { cartItem, offer, offerUnitPrice, offerTotal } = data;
            subtotal += offerTotal;
            const bFoods = checkoutOfferFoodsMap.get(offer.id) || [];
            const perFoodPrice = bFoods.length > 0 ? roundMoney(offerUnitPrice / bFoods.length) : offerUnitPrice;
                        for (const bf of bFoods) {
                const rawOpts = parseJsonArray(bf.optionIds);
                const rawVars = parseJsonArray(bf.variations);

                const bfOptionIds = new Set<string>(rawOpts.map((id: any) => String(id)).filter(Boolean));
                for (const pv of rawVars) {
                    if (pv?.optionId) bfOptionIds.add(String(pv.optionId));
                    if (Array.isArray(pv?.options)) {
                        pv.options.forEach((id: any) => id && bfOptionIds.add(String(id)));
                    }
                }

                const bundleDetailedVariations = Array.from(bfOptionIds).map((optId) => {
                    const optDetails = optionsWithParentMap.get(optId);
                    const resolvedPrice = optDetails?.additionalPrice ?? "0.00";
                    return {
                        variationId: optDetails?.variationId ?? null,
                        variationName: optDetails?.variationName ?? null,
                        variationNameAr: optDetails?.variationNameAr ?? null,
                        variationNameFr: optDetails?.variationNameFr ?? null,
                        optionId: optDetails?.optionId ?? optId,
                        optionName: optDetails?.optionName ?? null,
                        optionNameAr: optDetails?.optionNameAr ?? null,
                        optionNameFr: optDetails?.optionNameFr ?? null,
                        price: Number(resolvedPrice).toFixed(2),
                        additionalPrice: Number(resolvedPrice).toFixed(2),
                    };
                });

                const rawBfAddonIds = parseJsonArray(bf.addonIds);
                const bundleDetailedAddons: any[] = [];
                let bundleAddonsPrice = 0;
                for (const addonId of rawBfAddonIds) {
                    const dbAddon = addonsMap.get(String(addonId));
                    if (dbAddon) {
                        const addonPrice = Number(dbAddon.price || 0);
                        bundleAddonsPrice += addonPrice;
                        bundleDetailedAddons.push({
                            addonId: dbAddon.id,
                            name: dbAddon.name,
                            nameAr: dbAddon.nameAr,
                            nameFr: dbAddon.nameFr,
                            price: addonPrice.toFixed(2),
                        });
                    }
                }
                const bundleItemTotal = roundMoney(perFoodPrice * cartItem.quantity + bundleAddonsPrice);

                itemsToInsert.push({
                    id: uuidv4(),
                    foodId: bf.foodId,
                    quantity: bf.quantity * cartItem.quantity,
                    basePrice: perFoodPrice.toFixed(2),
                    variationsPrice: "0.00",
                    addonsPrice: bundleAddonsPrice.toFixed(2),
                    totalPrice: bundleItemTotal.toFixed(2),
                    variations: bundleDetailedVariations,
                    addons: bundleDetailedAddons,
                    note: cartItem.note || null,
                    isBundle: true,
                });
            }
            continue;
        }

        const { cartItem, foodItem, originalBasePrice, varPrice, addonPrice, vars, addonsList } = data;

        const resolvedProduct = resolvedOrderProductMap.get(foodItem.id);
        const discountedBasePrice = resolvedProduct?.finalPrice ?? originalBasePrice;

        const itemTotal = roundMoney((discountedBasePrice + varPrice + addonPrice) * cartItem.quantity);
        subtotal += itemTotal;

        itemsToInsert.push({
            id: uuidv4(),
            foodId: cartItem.foodId,
            quantity: cartItem.quantity,
            basePrice: discountedBasePrice.toFixed(2),
            variationsPrice: varPrice.toFixed(2),
            addonsPrice: addonPrice.toFixed(2),
            totalPrice: itemTotal.toFixed(2),
            variations: vars,
            addons: addonsList,
            note: cartItem.note || null,
            isBundle: false,
        });
    }

    subtotal = roundMoney(subtotal);

    // ==========================================
    // 5.2 Fees & Commission
    // ==========================================
    const serviceFee = parseFloat(plan.serviceFee as string || "0");
    const commissionRate = parseFloat(plan.commissionRate as string || "0");
    const appCommission = roundMoney(subtotal * (commissionRate / 100));

    // ==========================================
    // 5.5 Check Coupons & Order Level Discounts
    // ==========================================
    let totalDiscount = 0;
    let appliedCoupon: any = null;
    let isFreeDelivery = false;

    let orderDiscountId: string | null = null;
    let orderCouponId: string | null = null;
    let orderDiscountType: "percentage" | "fixed_amount" | null = null;
    let orderDiscountValue: string | null = null;
    let orderDiscountSource: "food_level" | "restaurant_discount" | "global_discount" | "coupon" | "first_order_discount" | null = null;

    const appliedProduct = resolvedOrderProducts.find(product => product.discountAmount > 0);
    if (appliedProduct?.discountDetails) {
        orderDiscountId = appliedProduct.discountDetails.id;
        orderDiscountSource = appliedProduct.discountDetails.source === "product"
            ? "food_level"
            : appliedProduct.discountDetails.source === "global" ? "global_discount" : "restaurant_discount";
        orderDiscountType = appliedProduct.discountDetails.type === "percentage" ? "percentage" : "fixed_amount";
        orderDiscountValue = String(appliedProduct.discountDetails.value);
    } else if (hasFoodLevelDiscount) {
        orderDiscountSource = "food_level";
        orderDiscountValue = roundMoney(initialSubtotal - subtotal).toFixed(2);
    }

    // First Orders Discount — applies the maximum discount available
    let appliedFirstOrderDiscount: any = null;
    let firstOrderDiscountAmount = 0;
    let orderFirstOrderDiscountId: string | null = null;

    const existingProductDiscountAmount = roundMoney(Math.max(0, initialSubtotal - subtotal));

    // First-order discount is only for registered (non-guest) users
    if (!isGuestUser) {
        const eligibleFirstOrder = await resolveFirstOrderDiscount(
            userId,
            restaurantId,
            initialSubtotal > 0 ? initialSubtotal : subtotal
        );

        if (eligibleFirstOrder) {
            firstOrderDiscountAmount = eligibleFirstOrder.discountAmount;
            appliedFirstOrderDiscount = eligibleFirstOrder.discount;
        }
    }

    if (appliedFirstOrderDiscount && firstOrderDiscountAmount > existingProductDiscountAmount) {
        const additionalDiscount = roundMoney(firstOrderDiscountAmount - existingProductDiscountAmount);
        totalDiscount += additionalDiscount;
        orderFirstOrderDiscountId = appliedFirstOrderDiscount.id;
        orderDiscountSource = "first_order_discount";
        orderDiscountType = appliedFirstOrderDiscount.discountType === "percentage" ? "percentage" : "fixed_amount";
        orderDiscountValue = appliedFirstOrderDiscount.discountValue ? String(appliedFirstOrderDiscount.discountValue) : String(firstOrderDiscountAmount);
    } else {
        appliedFirstOrderDiscount = null;
    }

    // Coupon
    if (couponCode) {
        const couponResult = await validateAndCalculateCoupon(
            couponCode,
            userId,
            restaurantId,
            subtotal,
            0,
            itemsToInsert.map((c) => c.foodId).filter(Boolean) as string[],
            itemsToInsert.map((c) => ({
                foodId: c.foodId,
                totalPrice: parseFloat(c.totalPrice || "0"),
            }))
        );

        appliedCoupon = couponResult.coupon;
        const couponDiscountAmount = couponResult.discountAmount;
        isFreeDelivery = couponResult.isFreeDelivery;

        if (appliedCoupon) {
            orderCouponId = appliedCoupon.id || null;
            totalDiscount += couponDiscountAmount;

            if (!orderDiscountSource) {
                orderDiscountSource = "coupon";
                orderDiscountType = appliedCoupon.discountType === "percentage" ? "percentage" : "fixed_amount";
                orderDiscountValue = appliedCoupon.discountValue ? appliedCoupon.discountValue.toString() : couponDiscountAmount.toFixed(2);
            }
        }
    }

    totalDiscount = roundMoney(totalDiscount);

    // ==========================================
    // 6. Dynamic Delivery & Turf Zone Logic
    // ==========================================
    let deliveryFee = 0;
    let resolvedZoneId: string | null = zoneId || null;
    let resolvedBranchId: string | null = branchId || null;
    let deliveryGenericZoneId: string | null = null;
    let shippingAddressSnapshot: any = null;
    let targetShippingCompanyId: string | null = null;
    let isCompanyActive = false; // ✏️ CHANGED: hoisted so it's visible outside the delivery block

    if (resolvedOrderType === "delivery") {
        if (!addressId) throw new BadRequest("Delivery address is required");

        // ✏️ CHANGED: use the in-memory guest address if it hasn't been saved yet
        let userAddress: any;
        if (pendingGuestAddress) {
            userAddress = pendingGuestAddress;
        } else {
            [userAddress] = await db.select().from(addresses)
                .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId))).limit(1);
        }
        if (!userAddress) throw new BadRequest("Invalid delivery address");

        const lat = parseFloat(userAddress.lat as string || "0");
        const lng = parseFloat(userAddress.lng as string || "0");

        if (!lat || !lng) {
            throw new BadRequest("Delivery address requires valid latitude and longitude coordinates.");
        }

        targetShippingCompanyId = settings?.shippingCompanyId || null;

        if (!targetShippingCompanyId) {
            const [junctionLink] = await db
                .select({
                    shippingCompanyId: shippingCompanyRestaurants.shippingCompanyId,
                    shippingCompanyStatus: shippingCompanies.status,
                })
                .from(shippingCompanyRestaurants)
                .innerJoin(shippingCompanies, eq(shippingCompanyRestaurants.shippingCompanyId, shippingCompanies.id))
                .where(
                    and(
                        eq(shippingCompanyRestaurants.restaurantId, restaurantId),
                        eq(shippingCompanyRestaurants.status, "active"),
                        eq(shippingCompanies.status, "active")
                    )
                )
                .limit(1);

            if (junctionLink) {
                targetShippingCompanyId = junctionLink.shippingCompanyId;
                isCompanyActive = true;
            }
        } else {
            const [company] = await db
                .select({ id: shippingCompanies.id, status: shippingCompanies.status })
                .from(shippingCompanies)
                .where(eq(shippingCompanies.id, targetShippingCompanyId))
                .limit(1);

            if (company && company.status === "active") {
                isCompanyActive = true;
            } else {
                targetShippingCompanyId = null;
            }
        }

        let applicableFee: any = null;
        let maxDeliveryFee = -1;

        if (targetShippingCompanyId && isCompanyActive) {
            const companyZones = await db
                .select({
                    id: shippingZones.id,
                    name: shippingZones.name,
                    nameAr: shippingZones.nameAr,
                    coordinates: shippingZones.coordinates,
                    coverageAreaRadiusKm: shippingZones.coverageAreaRadiusKm,
                    deliveryFee: shippingZones.deliveryFee,
                    minOrderAmount: shippingZones.minOrderAmount,
                    status: shippingZones.status,
                })
                .from(shippingZones)
                .where(
                    and(
                        eq(shippingZones.shippingCompanyId, targetShippingCompanyId),
                        eq(shippingZones.status, "active")
                    )
                );

            for (const sz of companyZones) {
                let coords = sz.coordinates as any;
                if (typeof coords === "string") {
                    try {
                        coords = JSON.parse(coords);
                    } catch {
                        coords = [];
                    }
                }
                const isPolygon = Array.isArray(coords) && coords.length >= 3;
                const feeObj = {
                    id: sz.id,
                    zoneId: sz.id,
                    branchId: null,
                    branchStatus: "active",
                    deliveryFee: sz.deliveryFee,
                    coverageType: isPolygon ? "POLYGON" : "RADIUS",
                    customCoordinates: coords,
                    customRadiusKm: sz.coverageAreaRadiusKm,
                    defaultCoordinates: coords,
                    defaultRadiusKm: sz.coverageAreaRadiusKm,
                    zoneName: sz.name,
                    zoneNameAr: sz.nameAr,
                };

                if (isLocationInZone(lat, lng, feeObj.zoneId, feeObj)) {
                    const currentFee = parseFloat(feeObj.deliveryFee as string || "0");
                    if (currentFee > maxDeliveryFee) {
                        maxDeliveryFee = currentFee;
                        applicableFee = feeObj;
                    }
                }
            }
        }

        // If not linked to a shipping company or no zone matched, check the restaurant's own zones
        if (!applicableFee) {
            const restaurantFees = await db.select({
                id: restaurantZoneDeliveryFees.id,
                zoneId: restaurantZoneDeliveryFees.zoneId,
                branchId: restaurantZoneDeliveryFees.branchId,
                deliveryFee: restaurantZoneDeliveryFees.deliveryFee,
                coverageType: restaurantZoneDeliveryFees.coverageType,
                customCoordinates: restaurantZoneDeliveryFees.customCoordinates,
                customRadiusKm: restaurantZoneDeliveryFees.customRadiusKm,
                defaultCoordinates: zones.coordinates,
                defaultRadiusKm: zones.coverageAreaRadiusKm,
                zoneName: zones.name,
                zoneNameAr: zones.nameAr
            })
                .from(restaurantZoneDeliveryFees)
                .leftJoin(zones, eq(restaurantZoneDeliveryFees.zoneId, zones.id))
                .where(
                    and(
                        eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
                        eq(restaurantZoneDeliveryFees.status, "active"),
                        branchId ? eq(restaurantZoneDeliveryFees.branchId, branchId) : undefined
                    )
                );

            for (const fee of restaurantFees) {
                if (isLocationInZone(lat, lng, fee.zoneId, fee)) {
                    const currentFee = parseFloat(fee.deliveryFee as string || "0");
                    if (currentFee > maxDeliveryFee) {
                        maxDeliveryFee = currentFee;
                        applicableFee = fee;
                    }
                }
            }
        }

        if (!applicableFee) {
            throw new BadRequest("Your delivery address is outside our covered delivery zones.");
        }

        const genericZoneId = applicableFee.zoneId;
        deliveryGenericZoneId = genericZoneId;
        resolvedZoneId = applicableFee.id;
        if (!resolvedZoneId) {
            throw new BadRequest("No delivery zone found for this address.");
        }
        deliveryFee = parseFloat(applicableFee.deliveryFee as string || "0");

        if (applicableFee.branchId) {
            resolvedBranchId = applicableFee.branchId;
        } else if (branchId) {
            const [selectedBranch] = await db.select({ id: branches.id })
                .from(branches)
                .where(
                    and(
                        eq(branches.id, branchId),
                        eq(branches.restaurantId, restaurantId),
                        eq(branches.status, "active")
                    )
                )
                .limit(1);

            if (!selectedBranch) throw new BadRequest("Selected branch not found or inactive.");
            resolvedBranchId = selectedBranch.id;
        } else if (targetShippingCompanyId && isCompanyActive) {
            // 🚚 Shipping-company orders: pick the closest active branch to the customer
            const activeBranches = await db.select({
                id: branches.id,
                name: branches.name,
                lat: branches.lat,
                lng: branches.lng,
            })
                .from(branches)
                .where(
                    and(
                        eq(branches.restaurantId, restaurantId),
                        eq(branches.status, "active")
                    )
                );

            if (!activeBranches || activeBranches.length === 0) {
                throw new BadRequest("No active branch found for this restaurant.");
            }

            if (activeBranches.length === 1) {
                resolvedBranchId = activeBranches[0].id;
            } else {
                let closestBranch = activeBranches[0];
                let minDistance = Infinity;

                for (const b of activeBranches) {
                    const bLat = parseFloat(b.lat as string || "0");
                    const bLng = parseFloat(b.lng as string || "0");
                    if (bLat && bLng) {
                        const dist = calculateDistance(lat, lng, bLat, bLng);
                        if (dist < minDistance) {
                            minDistance = dist;
                            closestBranch = b;
                        }
                    }
                }
                resolvedBranchId = closestBranch.id;
            }
        } else {
            const [matchedBranch] = await db.select({ id: branches.id })
                .from(branches)
                .where(
                    and(
                        eq(branches.restaurantId, restaurantId),
                        genericZoneId ? eq(branches.zoneId, genericZoneId) : undefined,
                        eq(branches.status, "active")
                    )
                )
                .limit(1);

            if (!matchedBranch) throw new BadRequest("No active branch found serving your delivery zone.");
            resolvedBranchId = matchedBranch.id;
        }

        // ✏️ CHANGED: for guests the phone comes from the validated guestInfo (not yet saved on the user row)
        let snapshotPhone: string | null = guestPhone;
        if (!isGuestUser) {
            const [userInfoForAddress] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
            snapshotPhone = userInfoForAddress?.phone || null;
        }

        shippingAddressSnapshot = {
            title: userAddress.title,
            street: userAddress.street,
            building: userAddress.number || null,
            floor: userAddress.floor || null,
            apartment: userAddress.apartment || null,
            landmark: userAddress.landmark || null,
            location: userAddress.location || null,
            fulladdress: userAddress.fulladdress || null,
            lat: lat,
            lng: lng,
            phone: snapshotPhone,
            addressZoneId: genericZoneId || null,
            restaurantZoneId: resolvedZoneId || null,
            addressZoneName: applicableFee.zoneName || null,
            addressZoneNameAr: applicableFee.zoneNameAr || null,
        };
    } else {
        if (!branchId) throw new BadRequest("Branch is required for takeaway or dine-in orders.");

        const [branch] = await db.select({ id: branches.id, zoneId: branches.zoneId })
            .from(branches)
            .where(
                and(
                    eq(branches.id, branchId),
                    eq(branches.restaurantId, restaurantId),
                    eq(branches.status, "active")
                )
            )
            .limit(1);

        if (!branch) throw new BadRequest("Invalid or inactive branch selected.");

        resolvedBranchId = branch.id;
        resolvedZoneId = branch.zoneId;
    }

    // Branch Snapshot — zone data comes from the restaurant's own zone config
    // (restaurantZoneDeliveryFees) matching the order delivery zone, or the branch's zone.
    let branchSnapshotData: any = null;
    if (resolvedBranchId) {
        const [branchDetails] = await db
            .select({
                id: branches.id,
                name: branches.name,
                nameAr: branches.nameAr,
                nameFr: branches.nameFr,
                address: branches.address,
                addressAr: branches.addressAr,
                addressFr: branches.addressFr,
                phoneNumber: branches.phoneNumber,
                status: branches.status,
                cityId: branches.cityId,
                cityName: cities.name,
                cityNameAr: cities.nameAr,
                zoneId: deliveryGenericZoneId ? restaurantZoneDeliveryFees.zoneId : branches.zoneId,
                zoneName: zones.name,
                zoneNameAr: zones.nameAr,
                zoneDeliveryFee: restaurantZoneDeliveryFees.deliveryFee,
            })
            .from(branches)
            .leftJoin(cities, eq(branches.cityId, cities.id))
            .leftJoin(
                restaurantZoneDeliveryFees,
                and(
                    eq(restaurantZoneDeliveryFees.branchId, branches.id),
                    eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
                    deliveryGenericZoneId ? eq(restaurantZoneDeliveryFees.zoneId, deliveryGenericZoneId) : sql`1=0`
                )
            )
            .leftJoin(
                zones,
                eq(zones.id, deliveryGenericZoneId ? restaurantZoneDeliveryFees.zoneId : branches.zoneId)
            )
            .where(eq(branches.id, resolvedBranchId))
            .limit(1);

        if (branchDetails) {
            branchSnapshotData = {
                id: branchDetails.id,
                name: branchDetails.name,
                nameAr: branchDetails.nameAr || null,
                nameFr: branchDetails.nameFr || null,
                address: branchDetails.address,
                addressAr: branchDetails.addressAr || null,
                addressFr: branchDetails.addressFr || null,
                phone: branchDetails.phoneNumber || null,
                status: branchDetails.status,
                zoneId: branchDetails.zoneId || null,
                zoneName: branchDetails.zoneName || null,
                zoneNameAr: branchDetails.zoneNameAr || null,
                zoneDeliveryFee: branchDetails.zoneDeliveryFee
                    ? parseFloat(branchDetails.zoneDeliveryFee as string)
                    : null,
                cityId: branchDetails.cityId || null,
                cityName: branchDetails.cityName || null,
                cityNameAr: branchDetails.cityNameAr || null,
            };
        }
    }

    const calculatedDeliveryFee = deliveryFee;
    if (isFreeDelivery) deliveryFee = 0;

    // ==========================================
    // 6.5 Free Delivery Offer Check (schema-based)
    // ==========================================
    if (!isFreeDelivery && resolvedOrderType === "delivery") {
        const nowForOffer = new Date();
        const [freeDeliveryOffer] = await db
            .select()
            .from(freeDeliveryOffers)
            .where(
                and(
                    eq(freeDeliveryOffers.restaurantId, restaurantId),
                    eq(freeDeliveryOffers.status, "active")
                )
            )
            .limit(1);

        if (freeDeliveryOffer) {
            const startOk = !freeDeliveryOffer.startDate || new Date(freeDeliveryOffer.startDate) <= nowForOffer;
            const endOk = !freeDeliveryOffer.endDate || new Date(freeDeliveryOffer.endDate) >= nowForOffer;
            const minAmountOk = !freeDeliveryOffer.minOrderAmount || subtotal >= parseFloat(freeDeliveryOffer.minOrderAmount as string);

            let userLimitOk = true;
            if (freeDeliveryOffer.maxOrdersPerUser && freeDeliveryOffer.maxOrdersPerUser > 0) {
                const [userOrdersRow] = await db
                    .select({ cnt: sql<number>`count(*)` })
                    .from(orders)
                    .where(
                        and(
                            eq(orders.userId, userId),
                            eq(orders.restaurantId, restaurantId),
                            sql`${orders.status} NOT IN ('cancelled', 'failed')`
                        )
                    );
                const userOrderCount = Number(userOrdersRow?.cnt ?? 0);
                if (userOrderCount >= freeDeliveryOffer.maxOrdersPerUser) {
                    userLimitOk = false;
                }
            }

            if (startOk && endOk && minAmountOk && userLimitOk) {
                deliveryFee = 0;
                isFreeDelivery = true;
            }
        }
    }

    let totalAmount = roundMoney(subtotal + deliveryFee + serviceFee - totalDiscount);
    if (totalAmount < 0) totalAmount = 0;

    const orderId = uuidv4();
    const orderNumber = `ORD-${Date.now()}`;

    const [userRow] = await db.select({ id: users.id, name: users.name, phone: users.phone, email: users.email })
        .from(users).where(eq(users.id, userId)).limit(1);

    // ✏️ CHANGED: for guests, name/phone come from the validated guestInfo (they're saved in the transaction)
    const userInfo = isGuestUser
        ? { ...userRow, name: guestName, phone: guestPhone }
        : userRow;

    // ==========================================
    // 11. Create Payment Session BEFORE the DB transaction (if Visa/Online)
    // If this fails the order is never written to DB — no rollback needed.
    // ==========================================
    let paymentSessionData: any = null;
    if (isVisaPayment) {
        if (!settings?.enableOnlinePayment) {
            throw new BadRequest("Online payment is not enabled for this restaurant.");
        }

        paymentSessionData = await createOrderPaymentSession({
            orderId,
            orderNumber,
            restaurantId,
            totalAmount,
            restaurantSlug: restaurant?.slug || restaurantName || undefined,
            userInfo: {
                name: userInfo?.name,
                email: userInfo?.email,
                phone: userInfo?.phone,
            },
        });
    }

    const finalPaymentGatewayType = isWalletPayment ? "SYSTEM" : (paymentSessionData?.gatewayType ?? settings?.paymentGatewayType ?? "SYSTEM");

    let visaCommission = 0;
    if (isVisaPayment && finalPaymentGatewayType === "CUSTOM") {
        try {
            const activeCustom = await getActiveCustomGateway(restaurantId);
            if (activeCustom?.record) {
                visaCommission = calculateVisaCommission(
                    totalAmount,
                    activeCustom.record.percentageValue,
                    activeCustom.record.fixedValue,
                    activeCustom.record.tax
                );
            }
        } catch (e) {
            console.warn("[order] Failed to calculate custom gateway visaCommission:", e);
        }
    } else if (isVisaPayment && finalPaymentGatewayType === "SYSTEM") {
        const systemSettings = await getSystemVisaSettings();
        visaCommission = calculateVisaCommission(
            totalAmount,
            systemSettings.percentageValue,
            systemSettings.fixedValue,
            systemSettings.tax
        );
    }

    // ==========================================
    // 🛡️ 10. Execute Order (Transaction)
    // ==========================================
    const now = new Date();

    let createdDailyOrderNumber = 1;

    await db.transaction(async (tx) => {
        // ✏️ NEW: guest side-effects now happen ONLY here, atomically with the order.
        // If anything below fails, the guest row and the address are rolled back too.
        if (isGuestUser) {
            await tx.update(users)
                .set({ name: guestName!, phone: guestPhone! })
                .where(eq(users.id, userId));

            if (pendingGuestAddress) {
                await tx.insert(addresses).values(pendingGuestAddress);
            }
        }

        // 🔒 1. Wallet deduction with FOR UPDATE
        if (isWalletPayment) {
            const [userWallet] = await tx.select()
                .from(userWallets)
                .where(eq(userWallets.userId, userId))
                .for("update");

            const currentBalance = parseFloat(userWallet?.balance as string || "0");
            if (!userWallet || currentBalance < totalAmount) {
                throw new BadRequest("Insufficient wallet balance");
            }

            const newBalance = roundMoney(currentBalance - totalAmount);

            await tx.update(userWallets)
                .set({ balance: newBalance.toFixed(2) })
                .where(eq(userWallets.userId, userId));

            await tx.insert(userWalletTransactions).values({
                id: uuidv4(),
                userId,
                type: "debit",
                transactionType: "order_payment",
                amount: totalAmount.toFixed(2),
                balanceBefore: currentBalance.toFixed(2),
                reference: orderNumber,
                status: "approved",
                createdAt: now
            });
        }

        // 🔒 2. Daily order number calculation
        // For cash / wallet orders, calculate dailyOrderNumber immediately.
        // For online visa orders, defer dailyOrderNumber until confirmed paid by webhook.
        if (!isVisaPayment) {
            createdDailyOrderNumber = await getNextDailyOrderNumber(tx, restaurantId, settings, now);
        }

        // 3. Create order record
        await tx.insert(orders).values({
            id: orderId,
            orderNumber,
            idempotencyKey,
            userId,
            restaurantId,
            branchId: resolvedBranchId,
            zoneId: resolvedZoneId,
            addressId: addressId || null,
            orderSource: storedOrderSource,
            paymentMethod,
            paymentGatewayType: finalPaymentGatewayType,
            paymentGateway: paymentSessionData?.gateway
                ? (paymentSessionData.gateway.toLowerCase() as "kashier" | "paymob" | "geidea")
                : null,
            paymentOrderId: (
                paymentSessionData?.paymentOrderId ||
                paymentSessionData?.paymobOrderId ||
                paymentSessionData?.geideaOrderId ||
                paymentSessionData?.sessionId ||
                null
            ),
            paymentStatus: isVisaPayment ? "pending_payment" : "paid",
            orderType: resolvedOrderType,
            subtotal: subtotal.toFixed(2),
            deliveryFee: deliveryFee.toFixed(2),
            serviceFee: serviceFee.toFixed(2),
            appCommission: appCommission.toFixed(2),
            visaCommission: visaCommission.toFixed(2),

            shippingAddress: shippingAddressSnapshot,
            branchSnapshot: branchSnapshotData,

            discountId: orderDiscountId,
            couponId: orderCouponId,
            firstOrderDiscountId: orderFirstOrderDiscountId,
            discountAmount: totalDiscount.toFixed(2),
            discountType: orderDiscountType,
            discountValue: orderDiscountValue,
            discountSource: orderDiscountSource,

            couponCode: couponCode || null,
            totalAmount: totalAmount.toFixed(2),
            note: note || null,
            shippingCompanyId: targetShippingCompanyId || null,
            shippingStatus: "pending_dispatch",
            status: "pending",
            dailyOrderNumber: isVisaPayment ? null : createdDailyOrderNumber,
            durationOrderPreparing: defaultPreparingDuration,
            offerId: userCart.find(c => c.offerId)?.offerId || null,
            isBundle: Boolean(userCart.some(c => c.offerId)),
            createdAt: now
        });

        if (isCashPayment) {
            await chargePendingServiceFee(orderId, tx, "cash_pending");
        }

        await tx.insert(orderItems).values(itemsToInsert.map(i => ({ ...i, orderId })));

        // Clear the cart immediately for cash / wallet. For visa the cart stays until payment is confirmed.
        if (!isVisaPayment) {
            await tx.delete(cartItems).where(eq(cartItems.userId, userId));
        }

        // Increment user's total orders count
        await tx.update(users)
            .set({ totalOrders: sql`${users.totalOrders} + 1` })
            .where(eq(users.id, userId));

        // Increment user's total orders count for this restaurant
        const [existingPointRecord] = await tx.select().from(userRestaurantPoints)
            .where(and(eq(userRestaurantPoints.userId, userId), eq(userRestaurantPoints.restaurantId, restaurantId))).for("update");

        if (existingPointRecord) {
            await tx.update(userRestaurantPoints)
                .set({ totalOrders: sql`${userRestaurantPoints.totalOrders} + 1` })
                .where(eq(userRestaurantPoints.id, existingPointRecord.id));
        } else {
            await tx.insert(userRestaurantPoints).values({
                id: uuidv4(),
                userId,
                restaurantId,
                totalOrders: 1,
                points: 0
            });
        }

        // Superadmin notification (only for confirmed orders)
        if (!isVisaPayment) {
            await tx.insert(notifications).values({
                recipientType: "superadmin",
                recipientId: "superadmin",
                title: "New Order",
                body: `Order #${createdDailyOrderNumber} has been placed at ${restaurant?.name}.`,
                data: { orderId, orderNumber, createdDailyOrderNumber, restaurantName: restaurant?.name }
            });
        }

        // 4. Coupons and Discounts tracking
        if (appliedCoupon) {
            await tx.insert(couponUsages).values({
                id: uuidv4(),
                couponId: appliedCoupon.id,
                userId,
                orderId,
                discountAmount: appliedCoupon.discountType === "free_delivery"
                    ? calculatedDeliveryFee.toFixed(2)
                    : totalDiscount.toFixed(2)
            });

            await tx.update(coupons)
                .set({ usedCount: sql`used_count + 1` })
                .where(eq(coupons.id, appliedCoupon.id));
        }

        // Record first-order discount usage for confirmed (cash / wallet) orders
        if (orderFirstOrderDiscountId && !isVisaPayment) {
            await recordFirstOrderDiscountUsage(
                orderFirstOrderDiscountId,
                userId,
                orderId,
                firstOrderDiscountAmount,
                tx
            );
        }

        if (appliedDiscountIds.size > 0) {
            for (const dId of appliedDiscountIds) {
                await tx.update(discounts)
                    .set({ usedCount: sql`used_count + 1` })
                    .where(eq(discounts.id, dId));
            }
        }

        // Wallet settlement is recorded once the restaurant marks the order delivered.
    });

    // ==========================================
    // 11. Send Notification to Restaurant (non-visa only; visa orders are notified via webhook)
    // ==========================================
    if (!isVisaPayment) {
        const cairoTimeFormatted = new Intl.DateTimeFormat("ar-EG", {
            timeZone: "Africa/Cairo",
            hour: "numeric",
            minute: "numeric",
            hour12: true
        }).format(now);

        await sendPushNotification({
            recipientType: "restaurant",
            recipientId: restaurantId,
            branchId: resolvedBranchId || null,
            title: "طلب جديد! 🛒",
            body: `تم استلام طلب جديد #${createdDailyOrderNumber} بقيمة ${totalAmount} ج.م الساعة ${cairoTimeFormatted}.`,
            data: {
                restaurantId,
                orderId,
                orderNumber,
                branchId: resolvedBranchId || null,
                type: "new_order",
                createdAt: now.toISOString(),
                dailyOrderNumber: createdDailyOrderNumber
            }
        });
    }

    // ==========================================
    // 📤 Response
    // ==========================================
    return SuccessResponse(res, {
        message: "Order created successfully",
        payment: paymentSessionData ? {
            gateway: paymentSessionData.gateway,       // "KASHIER" | "PAYMOB"
            type: paymentSessionData.type,             // "redirect" | "iframe"
            sessionId: paymentSessionData.sessionId,
            sessionUrl: paymentSessionData.sessionUrl,
            status: paymentSessionData.status,
            expireAt: paymentSessionData.expireAt,
            error: paymentSessionData.error,
        } : null,
        order_level: {
            orderDetails: {
                orderId,
                orderNumber,
                paymentSessionUrl: paymentSessionData?.sessionUrl || null,
                zoneId: resolvedZoneId,
                subtotal,
                deliveryFee,
                serviceFee,
                discountAmount: totalDiscount,
                couponCode: couponCode || null,
                totalAmount,
                createdAt: now.toISOString(),
                dailyOrderNumber: createdDailyOrderNumber,
                durationOrderPreparing: defaultPreparingDuration,
            },
            discountDetails: {
                discountId: orderDiscountId,
                couponId: orderCouponId,
                firstOrderDiscountId: orderFirstOrderDiscountId,
                discountAmount: totalDiscount,
                discountType: orderDiscountType,
                discountValue: orderDiscountValue,
                discountSource: orderDiscountSource,
                couponCode: couponCode || null,
                isFreeDelivery
            },
            customerDetails: userInfo
        }
    });
};

// ==========================================
// 2. جلب الطلبات النشطة (الحالية)
// ==========================================
export const getActiveOrders = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { restaurantId } = req.query;

    const activeOrders = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            dailyOrderNumber: orders.dailyOrderNumber,
            orderType: orders.orderType,
            durationOrderPreparing: orders.durationOrderPreparing,
            restaurantName: restaurants.name,
            restaurantNameAr: restaurants.nameAr,
            restaurantNameFr: restaurants.nameFr,
            restaurantImage: restaurants.logo,
            totalAmount: orders.totalAmount,
            status: orders.status,
            createdAt: orders.createdAt,
            itemsCount: sql<number>`(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${orders.id})`,
            // Branch info (for takeaway / dine_in)
            branchName: branches.name,
            // Address info (for delivery)
            addressTitle: addresses.title,
            addressStreet: addresses.street,
            addressLandmark: addresses.landmark,
            // Delivery man info
            deliveryManId: orders.deliveryManId,
            deliveryManName: deliveryMen.name,
            deliveryManPhone: deliveryMen.phone,
            // Cancellation info
            cancelReason: orders.cancelReason,
            cancelReasonType: orders.cancelReasonType ? orders.cancelReasonType : selectReasons.type,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(addresses, eq(orders.addressId, addresses.id))
        .leftJoin(deliveryMen, eq(orders.deliveryManId, deliveryMen.id))
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .where(
            and(
                eq(orders.userId, userId),
                restaurantId ? eq(orders.restaurantId, String(restaurantId)) : undefined,
                ne(orders.paymentStatus, "pending_payment"),
                ne(orders.status, "failed"),
                inArray(orders.status, ["pending", "accepted", "preparing", "out_for_delivery"])
            )
        )
        .orderBy(desc(orders.createdAt));

    // Fetch items for the active orders
    const orderIds = activeOrders.map(o => o.orderId);
    let allItems: any[] = [];
    if (orderIds.length > 0) {
        allItems = await db.select({
            orderId: orderItems.orderId,
            foodId: orderItems.foodId,
            foodName: food.name,
            foodNameAr: food.nameAr,
            foodNameFr: food.nameFr,
            foodDescription: food.description,
            foodDescriptionAr: food.descriptionAr,
            foodDescriptionFr: food.descriptionFr,
            foodImage: food.image,
            quantity: orderItems.quantity,
            basePrice: orderItems.basePrice,
            variationsPrice: orderItems.variationsPrice,
            addonsPrice: orderItems.addonsPrice,
            totalPrice: orderItems.totalPrice,
            note: orderItems.note,
            variations: orderItems.variations,
            addons: orderItems.addons
        })
            .from(orderItems)
            .leftJoin(food, and(eq(orderItems.foodId, food.id), activeFoodCondition))
            .where(inArray(orderItems.orderId, orderIds));

        allItems = await formatOrderItemsVariations(allItems);
    }

    // Return branch name or address depending on orderType
    const formatted = activeOrders.map(o => ({
        orderId: o.orderId,
        orderNumber: o.orderNumber,
        dailyOrderNumber: o.dailyOrderNumber,
        orderType: o.orderType,
        durationOrderPreparing: o.durationOrderPreparing,
        restaurantName: o.restaurantName,
        restaurantNameAr: o.restaurantNameAr,
        restaurantNameFr: o.restaurantNameFr,
        restaurantImage: o.restaurantImage,
        totalAmount: o.totalAmount,
        status: o.status,
        createdAt: formatDate(o.createdAt),
        itemsCount: o.itemsCount,
        cancellation: o.status === "cancelled"
            ? { reason: o.cancelReason, type: o.cancelReasonType }
            : null,
        location: o.orderType === "delivery"
            ? { type: "address", title: o.addressTitle, street: o.addressStreet, landmark: o.addressLandmark }
            : { type: "branch", name: o.branchName },
        deliveryMan: o.orderType === "delivery" && o.deliveryManId
            ? { id: o.deliveryManId, name: o.deliveryManName, phone: o.deliveryManPhone }
            : null,
        items: allItems.filter(item => item.orderId === o.orderId).map(item => {
            const { orderId, ...rest } = item;
            return rest;
        })
    }));

    return SuccessResponse(res, { data: formatted });
};

// ==========================================
// 3. جلب سجل الطلبات (History) - المكتملة والملغية
// ==========================================
export const getOrderHistory = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { restaurantId } = req.query;

    const historyOrders = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            dailyOrderNumber: orders.dailyOrderNumber,
            orderType: orders.orderType,
            durationOrderPreparing: orders.durationOrderPreparing,
            restaurantName: restaurants.name,
            restaurantNameAr: restaurants.nameAr,
            restaurantNameFr: restaurants.nameFr,
            restaurantImage: restaurants.logo,
            totalAmount: orders.totalAmount,
            status: orders.status,
            createdAt: orders.createdAt,
            rating: orders.rating,
            ratingComment: orders.ratingComment,
            itemsCount: sql<number>`(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${orders.id})`,
            // Branch info (for takeaway / dine_in)
            branchName: branches.name,
            // Address info (for delivery)
            addressTitle: addresses.title,
            addressStreet: addresses.street,
            addressLandmark: addresses.landmark,
            // Delivery man info
            deliveryManId: orders.deliveryManId,
            deliveryManName: deliveryMen.name,
            deliveryManPhone: deliveryMen.phone,
            // Cancellation info
            cancelReason: orders.cancelReason,
            cancelReasonType: orders.cancelReasonType ? orders.cancelReasonType : selectReasons.type,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(addresses, eq(orders.addressId, addresses.id))
        .leftJoin(deliveryMen, eq(orders.deliveryManId, deliveryMen.id))
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .where(
            and(
                eq(orders.userId, userId),
                restaurantId ? eq(orders.restaurantId, String(restaurantId)) : undefined,
                ne(orders.status, "failed"),
                inArray(orders.status, ["delivered", "cancelled", "refund"])
            )
        )
        .orderBy(desc(orders.createdAt));

    // Fetch items for the history orders
    const orderIds = historyOrders.map(o => o.orderId);
    let allItems: any[] = [];
    if (orderIds.length > 0) {
        allItems = await db.select({
            orderId: orderItems.orderId,
            foodId: orderItems.foodId,
            foodName: food.name,
            foodNameAr: food.nameAr,
            foodNameFr: food.nameFr,
            foodDescription: food.description,
            foodDescriptionAr: food.descriptionAr,
            foodDescriptionFr: food.descriptionFr,
            foodImage: food.image,
            quantity: orderItems.quantity,
            basePrice: orderItems.basePrice,
            variationsPrice: orderItems.variationsPrice,
            addonsPrice: orderItems.addonsPrice,
            totalPrice: orderItems.totalPrice,
            note: orderItems.note,
            variations: orderItems.variations,
            addons: orderItems.addons
        })
            .from(orderItems)
            .leftJoin(food, and(eq(orderItems.foodId, food.id), activeFoodCondition))
            .where(inArray(orderItems.orderId, orderIds));

        allItems = await formatOrderItemsVariations(allItems);
    }

    // Return branch name or address depending on orderType
    const formatted = historyOrders.map(o => ({
        orderId: o.orderId,
        orderNumber: o.orderNumber,
        dailyOrderNumber: o.dailyOrderNumber,
        orderType: o.orderType,
        durationOrderPreparing: o.durationOrderPreparing,
        restaurantName: o.restaurantName,
        restaurantNameAr: o.restaurantNameAr,
        restaurantNameFr: o.restaurantNameFr,
        restaurantImage: o.restaurantImage,
        totalAmount: o.totalAmount,
        status: o.status,
        createdAt: formatDate(o.createdAt),
        rating: o.rating,
        ratingComment: o.ratingComment,
        itemsCount: o.itemsCount,
        cancellation: o.status === "cancelled"
            ? { reason: o.cancelReason, type: o.cancelReasonType }
            : null,
        location: o.orderType === "delivery"
            ? { type: "address", title: o.addressTitle, street: o.addressStreet, landmark: o.addressLandmark }
            : { type: "branch", name: o.branchName },
        deliveryMan: o.orderType === "delivery" && o.deliveryManId
            ? { id: o.deliveryManId, name: o.deliveryManName, phone: o.deliveryManPhone }
            : null,
        items: allItems.filter(item => item.orderId === o.orderId).map(item => {
            const { orderId, ...rest } = item;
            return rest;
        })
    }));

    return SuccessResponse(res, { data: formatted });
};

// ==========================================
// 4. تفاصيل الطلب (Order Details)
// ==========================================
export const getOrderDetails = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;

    const orderInfo = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            dailyOrderNumber: orders.dailyOrderNumber,
            status: orders.status,
            createdAt: orders.createdAt,
            paymentMethod: orders.paymentMethod,
            paymentMethodDetails: {
                id: paymentMethods.id,
                name: paymentMethods.name,
                nameAr: paymentMethods.nameAr,
            },
            orderType: orders.orderType,
            durationOrderPreparing: orders.durationOrderPreparing,
            subtotal: orders.subtotal,
            deliveryFee: orders.deliveryFee,
            serviceFee: orders.serviceFee,
            discountAmount: orders.discountAmount,
            couponCode: orders.couponCode,
            totalAmount: orders.totalAmount,

            note: orders.note,
            rating: orders.rating,
            ratingComment: orders.ratingComment,

            restaurantName: restaurants.name,
            restaurantNameAr: restaurants.nameAr,
            restaurantNameFr: restaurants.nameFr,
            restaurantImage: restaurants.logo,

            // Branch (takeaway / dine_in)
            branchId: branches.id,
            branchName: branches.name,
            branchAddress: branches.address,

            // Address (delivery)
            addressId: addresses.id,
            addressTitle: addresses.title,
            addressStreet: addresses.street,
            addressLandmark: addresses.landmark,

            // Delivery man info
            deliveryManId: orders.deliveryManId,
            deliveryManName: deliveryMen.name,
            deliveryManPhone: deliveryMen.phone,
            // Cancellation info
            cancelReason: orders.cancelReason,
            cancelReasonType: orders.cancelReasonType ? orders.cancelReasonType : selectReasons.type,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(paymentMethods, eq(orders.paymentMethod, paymentMethods.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(addresses, eq(orders.addressId, addresses.id))
        .leftJoin(deliveryMen, eq(orders.deliveryManId, deliveryMen.id))
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .where(
            and(
                eq(orders.id, orderId),
                eq(orders.userId, userId),
                ne(orders.status, "failed")
            )
        )
        .limit(1);

    if (!orderInfo.length) {
        throw new NotFound("Order not found");
    }

    const o = orderInfo[0];

    // 1. جلب عناصر الطلب الأساسية
    const itemsRaw = await db
        .select({
            foodId: orderItems.foodId,
            foodName: food.name,
            foodNameAr: food.nameAr,
            foodNameFr: food.nameFr,
            foodDescription: food.description,
            foodDescriptionAr: food.descriptionAr,
            foodDescriptionFr: food.descriptionFr,
            foodImage: food.image,
            quantity: orderItems.quantity,
            basePrice: orderItems.basePrice,
            variationsPrice: orderItems.variationsPrice,
            addonsPrice: orderItems.addonsPrice,
            totalPrice: orderItems.totalPrice,
            note: orderItems.note,
            variations: orderItems.variations,
            addons: orderItems.addons
        })
        .from(orderItems)
        .leftJoin(food, and(eq(orderItems.foodId, food.id), activeFoodCondition))
        .where(eq(orderItems.orderId, orderId));

    // 2. معالجة الـ Variations واستخراج أسماء الفارييشنز وتفاصيلها كاملة
    const formattedItems = await formatOrderItemsVariations(itemsRaw);

    return SuccessResponse(res, {
        data: {
            orderId: o.orderId,
            orderNumber: o.orderNumber,
            dailyOrderNumber: o.dailyOrderNumber,
            status: o.status,
            orderType: o.orderType,
            durationOrderPreparing: o.durationOrderPreparing,
            createdAt: formatDate(o.createdAt),
            paymentMethod: o.paymentMethod,
            paymentMethodDetails: o.paymentMethodDetails,
            subtotal: o.subtotal,
            deliveryFee: o.deliveryFee,
            serviceFee: o.serviceFee,
            discountAmount: o.discountAmount,
            couponCode: o.couponCode,
            totalAmount: o.totalAmount,
            note: o.note,
            rating: o.rating,
            ratingComment: o.ratingComment,
            cancellation: o.status === "cancelled"
                ? { reason: o.cancelReason, type: o.cancelReasonType }
                : null,
            restaurantName: o.restaurantName,
            restaurantNameAr: o.restaurantNameAr,
            restaurantNameFr: o.restaurantNameFr,
            restaurantImage: o.restaurantImage,
            location: o.orderType === "delivery"
                ? {
                    type: "address",
                    id: o.addressId,
                    title: o.addressTitle,
                    street: o.addressStreet,
                    landmark: o.addressLandmark,
                }
                : {
                    type: "branch",
                    id: o.branchId,
                    name: o.branchName,
                    address: o.branchAddress,
                },
            deliveryMan: o.orderType === "delivery" && o.deliveryManId
                ? { id: o.deliveryManId, name: o.deliveryManName, phone: o.deliveryManPhone }
                : null,
            items: formattedItems
        }
    });
};

// ==========================================
// 5. متطلبات الطلب المسبقة (Order Prerequisites)
// ==========================================
export const getOrderPrerequisites = async (req: Request | any, res: Response) => {
    if (!req.user) {
        throw new UnauthorizedError("Unauthenticated: Token is missing or invalid");
    }

    const userId = req.user.id;
    const restaurantId = req.query.restaurantId as string;
    const orderSource = req.query.orderSource as string;

    if (!restaurantId) {
        throw new BadRequest("restaurantId is required");
    }

    const validOrderSources = ["online_order_app", "online_order_web", "food_aggregator", "mykeeto", "pos"];
    if (!orderSource || !validOrderSources.includes(orderSource)) {
        throw new BadRequest("Invalid or missing order source");
    }

    // 1. جلب البيانات من الداتا بيز بالتوازي
    const [
        userAddresses,
        restaurantBranches,
        restaurantZoneFees,
        allActivePaymentMethods,
        getCancelReasons,
        businessPlans,
        freeDeliveryOfferRows,
        restaurantSettingsRows
    ] = await Promise.all([
        db.select().from(addresses).where(eq(addresses.userId, userId)),
        db.select().from(branches).where(
            and(
                eq(branches.restaurantId, restaurantId),
                eq(branches.status, "active")
            )
        ),
        db.select({
            id: restaurantZoneDeliveryFees.id,
            zoneId: restaurantZoneDeliveryFees.zoneId,
            zoneName: zones.name,
            zoneNameAr: zones.nameAr,
            branchId: restaurantZoneDeliveryFees.branchId,
            branchStatus: branches.status,
            deliveryFee: restaurantZoneDeliveryFees.deliveryFee,
            coverageType: restaurantZoneDeliveryFees.coverageType,
            customCoordinates: restaurantZoneDeliveryFees.customCoordinates,
            customRadiusKm: restaurantZoneDeliveryFees.customRadiusKm,
            defaultCoordinates: zones.coordinates,
            defaultRadiusKm: zones.coverageAreaRadiusKm,
        })
            .from(restaurantZoneDeliveryFees)
            .leftJoin(zones, eq(restaurantZoneDeliveryFees.zoneId, zones.id))
            .leftJoin(branches, eq(restaurantZoneDeliveryFees.branchId, branches.id))
            .where(
                and(
                    eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
                    eq(restaurantZoneDeliveryFees.status, "active")
                )
            ),
        db.select({
            id: paymentMethods.id,
            name: paymentMethods.name,
            nameAr: paymentMethods.nameAr
        }).from(paymentMethods).where(eq(paymentMethods.isActive, true)),
        db.select().from(selectReasons).where(eq(selectReasons.type, "user")),
        db.select({ serviceFee: restaurantBusinessPlans.serviceFee })
            .from(restaurantBusinessPlans)
            .where(
                and(
                    eq(restaurantBusinessPlans.restaurantId, restaurantId),
                    eq(restaurantBusinessPlans.platformType, mapOrderSourceToPlatformType(orderSource))
                )
            )
            .limit(1),
        db.select()
            .from(freeDeliveryOffers)
            .where(
                and(
                    eq(freeDeliveryOffers.restaurantId, restaurantId),
                    eq(freeDeliveryOffers.status, "active")
                )
            )
            .limit(1),
        // 🛡️ جلب إعدادات المطعم لمعرفة هل الدفع الإلكتروني و الكاش مفعلين أم لا ومعرفة شركة الشحن المرتبطة
        db.select({
            enableOnlinePayment: restaurantSettings.enableOnlinePayment,
            cashEnabled: restaurantSettings.cashEnabled,
            shippingCompanyId: restaurantSettings.shippingCompanyId,
            shippingCompanyName: shippingCompanies.name,
            shippingCompanyStatus: shippingCompanies.status,
        })
            .from(restaurantSettings)
            .leftJoin(shippingCompanies, eq(restaurantSettings.shippingCompanyId, shippingCompanies.id))
            .where(eq(restaurantSettings.restaurantId, restaurantId))
            .limit(1)
    ]);

    // 🛡️ تحقق من إعداد الدفع الإلكتروني والكاش للمطعم
    const enableOnlinePayment = restaurantSettingsRows[0]?.enableOnlinePayment ?? true;
    const cashEnabled = restaurantSettingsRows[0]?.cashEnabled ?? true;

    // إذا كان الدفع الإلكتروني معطلاً للمطعم، نحذف طريقة الدفع بالفيزا من القائمة
    // إذا كان الكاش معطلاً للمطعم، نحذف طريقة الكاش من القائمة
    const activePaymentMethods = allActivePaymentMethods.filter((pm) => {
        const name = pm.name?.toLowerCase() ?? "";
        const nameAr = pm.nameAr ?? "";

        // Remove Visa/card if online payment is disabled
        if (!enableOnlinePayment && (name === "visa" || name === "card" || nameAr === "بطاقة")) {
            return false;
        }

        // Remove cash if cash is disabled
        if (!cashEnabled && (name === "cash" || name === "cash_on_delivery" || nameAr === "الدفع عند الاستلام")) {
            return false;
        }

        return true;
    });

    const plan = businessPlans[0];
    if (!plan) {
        throw new BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }

    let targetShippingCompanyId = restaurantSettingsRows[0]?.shippingCompanyId || null;
    let shippingCompanyName = restaurantSettingsRows[0]?.shippingCompanyName || null;
    let isCompanyActive = restaurantSettingsRows[0]?.shippingCompanyStatus === "active";

    // إذا لم تكن شركة الشحن مسجلة في الإعدادات، نتحقق من جدول الربط shippingCompanyRestaurants كخيار بديل
    if (!targetShippingCompanyId) {
        const [junctionLink] = await db
            .select({
                shippingCompanyId: shippingCompanyRestaurants.shippingCompanyId,
                shippingCompanyName: shippingCompanies.name,
                shippingCompanyStatus: shippingCompanies.status,
            })
            .from(shippingCompanyRestaurants)
            .innerJoin(shippingCompanies, eq(shippingCompanyRestaurants.shippingCompanyId, shippingCompanies.id))
            .where(
                and(
                    eq(shippingCompanyRestaurants.restaurantId, restaurantId),
                    eq(shippingCompanyRestaurants.status, "active"),
                    eq(shippingCompanies.status, "active")
                )
            )
            .limit(1);

        if (junctionLink) {
            targetShippingCompanyId = junctionLink.shippingCompanyId;
            shippingCompanyName = junctionLink.shippingCompanyName;
            isCompanyActive = true;
        }
    }

    // 🚚 إذا كان المطعم مرتبطاً بشركة شحن نشطة، نستخدم نطاقات شركة الشحن (shipping_zones) بدلاً من نطاقات المطعم
    let zoneFees: any[] = [];
    if (targetShippingCompanyId && isCompanyActive) {
        const companyZones = await db
            .select({
                id: shippingZones.id,
                name: shippingZones.name,
                nameAr: shippingZones.nameAr,
                coordinates: shippingZones.coordinates,
                coverageAreaRadiusKm: shippingZones.coverageAreaRadiusKm,
                deliveryFee: shippingZones.deliveryFee,
                minOrderAmount: shippingZones.minOrderAmount,
                status: shippingZones.status,
            })
            .from(shippingZones)
            .where(
                and(
                    eq(shippingZones.shippingCompanyId, targetShippingCompanyId),
                    eq(shippingZones.status, "active")
                )
            );

        if (companyZones.length > 0) {
            zoneFees = companyZones.map((sz) => {
                let coords = sz.coordinates as any;
                if (typeof coords === "string") {
                    try {
                        coords = JSON.parse(coords);
                    } catch {
                        coords = [];
                    }
                }
                const isPolygon = Array.isArray(coords) && coords.length >= 3;
                return {
                    id: sz.id,
                    zoneId: sz.id,
                    branchId: null,
                    branchStatus: "active",
                    deliveryFee: sz.deliveryFee,
                    coverageType: isPolygon ? "POLYGON" : "RADIUS",
                    customCoordinates: coords,
                    customRadiusKm: sz.coverageAreaRadiusKm,
                    defaultCoordinates: coords,
                    defaultRadiusKm: sz.coverageAreaRadiusKm,
                    name: sz.name,
                    nameAr: sz.nameAr,
                    minOrderAmount: sz.minOrderAmount,
                    shippingCompanyId: targetShippingCompanyId,
                    isShippingCompanyZone: true,
                };
            });
        } else {
            // Fallback لنطاقات المطعم في حال لم يتم إدخال نطاقات لشركة الشحن بعد
            zoneFees = restaurantZoneFees;
        }
    } else {
        zoneFees = restaurantZoneFees;
    }

    // 2. معالجة كل عنوان عند المستخدم ومعرفة هل هو قابل للتوصيل ومعرفة zoneId الخاص به
    const addressesWithDeliveryInfo = userAddresses.map((addr) => {
        let isDeliverable = false;
        let applicableDeliveryFee: number | null = null;
        let matchedZoneId: string | null = null;
        let matchedRestaurantDeliveryZoneId: string | null = null;

        const addrLat = parseFloat(addr.lat || "0");
        const addrLng = parseFloat(addr.lng || "0");

        if (!addrLat || !addrLng) {
            return {
                ...addr,
                isDeliverable: false,
                deliveryFee: null,
                restaurantDeliveryZoneId: null,
                zoneId: null,
            };
        }

        for (const fee of zoneFees) {
            let matchesZone = isLocationInZone(addrLat, addrLng, addr.zoneId, fee);

            // لو النطاق ده طابق موقع العميل
            if (matchesZone) {
                const isBranchActive = !fee.branchId || fee.branchStatus === "active";

                if (!isBranchActive) {
                    continue;
                }

                isDeliverable = true;
                const currentFee = parseFloat((fee.deliveryFee || "0") as string);

                // 🚀 اختيار السعر الأعلى والـ zoneId التابع له في حالة مطابقة أكثر من نطاق
                if (applicableDeliveryFee === null || currentFee > applicableDeliveryFee) {
                    applicableDeliveryFee = currentFee;
                    matchedZoneId = fee.zoneId;
                    matchedRestaurantDeliveryZoneId = fee.id;
                }
            }
        }

        return {
            ...addr,
            isDeliverable,
            deliveryFee: applicableDeliveryFee,
            zoneId: matchedRestaurantDeliveryZoneId,
        };
    });

    const serviceFee = parseFloat((plan.serviceFee || "0") as string);

    // Free delivery offer — check validity window
    const nowForPrereq = new Date();
    const activeFreeDeliveryOffer = freeDeliveryOfferRows[0] ?? null;
    let freeDeliveryOfferData: {
        minOrderAmount: number;
        startDate: string | null;
        endDate: string | null;
    } | null = null;

    if (activeFreeDeliveryOffer) {
        const startOk = !activeFreeDeliveryOffer.startDate || new Date(activeFreeDeliveryOffer.startDate) <= nowForPrereq;
        const endOk = !activeFreeDeliveryOffer.endDate || new Date(activeFreeDeliveryOffer.endDate) >= nowForPrereq;
        if (startOk && endOk) {
            freeDeliveryOfferData = {
                minOrderAmount: parseFloat(activeFreeDeliveryOffer.minOrderAmount as string || "0"),
                startDate: activeFreeDeliveryOffer.startDate ? activeFreeDeliveryOffer.startDate.toISOString() : null,
                endDate: activeFreeDeliveryOffer.endDate ? activeFreeDeliveryOffer.endDate.toISOString() : null,
            };
        }
    }

    return SuccessResponse(res, {
        data: {
            addresses: addressesWithDeliveryInfo,
            branches: restaurantBranches,
            zones: zoneFees, // 👈 إرجاع مناطق التوصيل وأسعارها الخاصة بشركة الشحن أو المطعم
            paymentMethods: activePaymentMethods, // visa filtered out when enableOnlinePayment=false
            enableOnlinePayment, // 👈 هل الدفع الإلكتروني (فيزا) مفعّل لهذا المطعم؟
            reasons: getCancelReasons,
            serviceFee: serviceFee.toFixed(2),
            freeDeliveryOffer: freeDeliveryOfferData,
            shippingCompany: (targetShippingCompanyId && isCompanyActive) ? {
                id: targetShippingCompanyId,
                name: shippingCompanyName,
            } : null,
        }
    });
};

// ==========================================
// 6. إلغاء الطلب من قبل المستخدم (Cancel Order)
// ==========================================
export const cancelOrder = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;
    const { cancelReasonId, customReason } = req.body;

    const inputCustomReason = customReason as string | undefined;

    if (!cancelReasonId && (!inputCustomReason || typeof inputCustomReason !== "string" || inputCustomReason.trim() === "")) {
        throw new BadRequest("Cancel reason or cancel reason ID is required");
    }

    // 1. جلب الطلب والتأكد أنه للمستخدم وأنه قابل للإلغاء
    const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).limit(1);
    if (!order) throw new NotFound("Order not found");
    if (!["pending", "accepted"].includes(order.status as string)) {
        throw new BadRequest("Order cannot be cancelled at this stage");
    }

    // 2. التحقق من سبب الإلغاء
    let finalReasonId: string | null = null;
    let finalReasonText: string | null = null;

    if (cancelReasonId) {
        const [reason] = await db.select().from(selectReasons).where(and(eq(selectReasons.id, cancelReasonId), eq(selectReasons.type, "user"))).limit(1);
        if (!reason) throw new BadRequest("Invalid cancel reason for user");
        finalReasonId = reason.id;
        finalReasonText = (inputCustomReason && inputCustomReason.trim()) ? inputCustomReason.trim() : reason.name;
    } else {
        finalReasonId = null;
        finalReasonText = (inputCustomReason as string).trim();
    }

    // 3. تحديث حالة الطلب وإرجاع المبالغ المالية (إلغاء أرباح المطعم والعمولة)
    await db.transaction(async (tx) => {
        // تحديث الطلب
        await tx.update(orders)
            .set({
                status: "cancelled",
                cancelReasonId: finalReasonId,
                cancelReason: finalReasonText,
                cancelReasonType: "user",
                updatedAt: new Date()
            })
            .where(eq(orders.id, orderId));

        // حسابات المبالغ التي تم دفعها أو خصمها
        const totalAmount = parseFloat(order.totalAmount as string || "0");
        // إرجاع فلوس المستخدم لو دفع بالمحفظة
        // note: paymentMethod stores UUID, so we check userWalletTransactions to know if it was a wallet payment
        const [walletTx] = await tx.select().from(userWalletTransactions).where(and(eq(userWalletTransactions.reference, order.orderNumber), eq(userWalletTransactions.transactionType, "order_payment"))).limit(1);

        if (walletTx) {
            // Revert User Wallet
            const [userWallet] = await tx.select().from(userWallets).where(eq(userWallets.userId, userId)).limit(1);
            if (userWallet) {
                const balanceBefore = parseFloat(userWallet.balance as string || "0");
                const newBalance = balanceBefore + totalAmount;
                await tx.update(userWallets).set({ balance: newBalance.toString() }).where(eq(userWallets.userId, userId));
                await tx.insert(userWalletTransactions).values({
                    id: uuidv4(),
                    userId,
                    type: "credit",
                    transactionType: "refund",
                    amount: totalAmount.toString(),
                    balanceBefore: balanceBefore.toString(),
                    reference: order.orderNumber,
                    status: "approved"
                });
            }
        }

        await handleCancelledOrder({ orderId, cancelReasonType: "user", tx });
    });

    // 4. إرسال إشعارات إلغاء الطلب (Type: cancel)
    await sendPushNotification({
        recipientType: "restaurant",
        recipientId: order.restaurantId,
        branchId: order.branchId || null,
        title: "إلغاء الطلب ❌",
        body: `تم إلغاء الطلب #${order.dailyOrderNumber} من قبل العميل. السبب: ${finalReasonText}`,
        data: {
            restaurantId: order.restaurantId,
            orderId: order.id,
            orderNumber: order.orderNumber,
            dailyOrderNumber: order.dailyOrderNumber,
            branchId: order.branchId || null,
            type: "cancel",
            reason: finalReasonText
        }
    });

    // Release courier active orders count if order had courier assigned
    if (order.deliveryManId) {
        releaseCourierForOrder(order.id, order.deliveryManId).catch((err) => {
            console.error(`[releaseCourierForOrder:userCancel] failed for order ${order.id}:`, err);
        });
    }

    return SuccessResponse(res, { message: "Order cancelled successfully" });
};

// ==========================================
// 7. Get Cancel Reasons
// ==========================================
export const getCancelReasons = async (req: Request | any, res: Response) => {
    const cancelReasons = await db
        .select()
        .from(selectReasons)
        .where(eq(selectReasons.type, "user"));
    return SuccessResponse(res, { data: cancelReasons });
};

// ==========================================
// 8. Rate Order (User)
// ==========================================
export const rateOrder = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;
    const { rating, comment } = req.body;

    if (!rating) {
        throw new BadRequest("Rating is required");
    }

    if (typeof rating !== "number" || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        throw new BadRequest("Rating must be an integer between 1 and 5");
    }

    const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
        .limit(1);

    if (!order) {
        throw new NotFound("Order not found");
    }

    if (order.status !== "delivered") {
        throw new BadRequest("Only delivered orders can be rated");
    }

    await db
        .update(orders)
        .set({
            rating,
            ratingComment: comment ?? null,
            updatedAt: new Date()
        })
        .where(eq(orders.id, orderId));

    return SuccessResponse(res, {
        message: "Order rated successfully",
        data: {
            orderId,
            rating,
            ratingComment: comment ?? null,
        }
    });
};

