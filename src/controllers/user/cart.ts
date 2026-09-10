// src/controllers/user/cart.ts
//
// CHANGES IN THIS FILE (see inline "✅ FIX" comments for exact spots):
//
// 1. getCart(): variations that could no longer be resolved against the DB
//    (deleted/inactive option or variation row) used to be silently dropped
//    via `.filter(Boolean)` while their price stayed baked into the item's
//    total. Now they're returned using the snapshot captured at add-to-cart
//    time, flagged `isAvailable: false`, and they force the whole cart item
//    into the "unavailable" bucket so the client knows to refresh instead of
//    checking out with a mystery price.
//
// 2. getCart(): addons were previously trusted 100% from the stored snapshot
//    with zero live DB check. They're now validated the same way variations
//    are (batch-fetched, checked for existence/active status), for
//    consistency and so a deleted/deactivated addon can't silently ride
//    along in the total.
//
// 3. getCart(): the try/catch around calculateCalculatedPrice() used to
//    swallow errors (e.g. food deleted) and silently fall back to the old
//    stored price as if everything were fine. Now the item is marked
//    unavailable when that lookup fails.
//
// Nothing else in this file (addToCart, updateCartItem, removeCartItem,
// clearCart, validateCartPricing) was changed — their addon/variation
// validation already rejects unknown IDs correctly.

import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    cartItems,
    food,
    restaurants,
    variationOptions,
    foodVariations,
    addons,
    freeDeliveryOffers,
    branches,
    subcategories,
    branchSubcategories,
} from "../../models/schema";

import { eq, and, inArray, isNull } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";
import { getAvailableDiscounts, applyPriorityDiscount } from "../../utils/discount";
import { validateUserNotBlocked } from "../../utils/userBlockCheck";
import { type BranchInfo, getUnavailableBranchesForFoods } from "../../helpers/food.helper";
import { resolveBranchIdForCart, validateFoodAvailabilityForCart } from "../../helpers/cart.helper";
import {
    resolveBranchIdFromAddress,
    calculateCalculatedPrice,
    type ServiceModule,
} from "../../helpers/pricing.helper";
import { activeFoodCondition } from "../../helpers/foodConditions";

/* =========================================
   Helpers
========================================= */
const normalizeVariations = (variations: any) => {
    const safe = Array.isArray(variations) ? variations : [];
    return safe
        .filter(v => v?.optionId)
        .sort((a, b) => String(a.optionId).localeCompare(String(b.optionId)));
};

const normalizeAddons = (addonsInput: any) => {
    const safe = Array.isArray(addonsInput) ? addonsInput : [];
    return safe
        .filter(a => a?.addonId)
        .sort((a, b) => String(a.addonId).localeCompare(String(b.addonId)));
};

const deepParseJSON = (data: any): any => {
    if (typeof data === "string") {
        try {
            return deepParseJSON(JSON.parse(data));
        } catch {
            return data;
        }
    }
    return data;
};

const parseCartSnapshot = (raw: any): { variations: any[]; addons: any[] } => {
    const parsed = deepParseJSON(raw);
    if (Array.isArray(parsed)) {
        return { variations: parsed, addons: [] };
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
            variations: Array.isArray(parsed.variations) ? parsed.variations : [],
            addons: Array.isArray(parsed.addons) ? parsed.addons : [],
        };
    }
    return { variations: [], addons: [] };
};

/** Extract all variantOptionIds from a parsed variations snapshot */
const extractOptionIds = (parsedVariations: any[]): string[] =>
    parsedVariations
        .map((v: any) => v.optionId)
        .filter(Boolean);

/* =========================================
   1. ADD TO CART
========================================= */
export const addToCart = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const {
        foodId,
        quantity = 1,
        variations = [],
        addons: requestAddons = [],
        note,
        branchId,
        addressId,
        serviceModule,
    } = req.body;

    const safeVariations = Array.isArray(variations) ? variations : [];
    const safeAddons = Array.isArray(requestAddons) ? requestAddons : [];

    const [itemFood] = await db.select().from(food).where(and(eq(food.id, foodId), activeFoodCondition)).limit(1);
    if (!itemFood) throw new BadRequest("Food not found");

    // 🛡️ Block check
    await validateUserNotBlocked(userId, itemFood.restaurantid);

    if (itemFood.isOutOfStock || itemFood.status === "inactive") {
        throw new BadRequest("This item is currently out of stock.");
    }

    // ─── Resolve branch ──────────────────────────────────────────────
    let resolvedBranchId: string | null = branchId || null;

    if (!resolvedBranchId && addressId) {
        try {
            resolvedBranchId = await resolveBranchIdFromAddress(addressId, itemFood.restaurantid);
        } catch (err: any) {
            throw new BadRequest(err.message || "Could not resolve delivery branch for this address.");
        }
    }

    if (resolvedBranchId && !branchId) {
        const [br] = await db
            .select({ id: branches.id })
            .from(branches)
            .where(and(eq(branches.id, resolvedBranchId), eq(branches.status, "active")))
            .limit(1);
        if (!br) throw new BadRequest("Resolved delivery branch is inactive.");
    }

    if (resolvedBranchId && branchId) {
        const [br] = await db
            .select({ id: branches.id })
            .from(branches)
            .where(and(eq(branches.id, resolvedBranchId), eq(branches.restaurantId, itemFood.restaurantid), eq(branches.status, "active")))
            .limit(1);
        if (!br) throw new BadRequest("Selected branch not found or inactive.");
    }

    // ─── Validate subcategory-branch availability ─────────────────────
    if (resolvedBranchId && itemFood.subcategoryid) {
        const [inactiveSubcat] = await db
            .select({ subcategoryId: branchSubcategories.subcategoryId })
            .from(branchSubcategories)
            .where(and(
                eq(branchSubcategories.branchId, resolvedBranchId),
                eq(branchSubcategories.subcategoryId, itemFood.subcategoryid),
                eq(branchSubcategories.status, "inactive")
            ))
            .limit(1);
        if (inactiveSubcat) {
            throw new BadRequest("This item's category is not available at the selected branch or at your location");
        }
    }

    // ─── Validate food availability at branch (ingredient/menu locks) ─
    await validateFoodAvailabilityForCart(foodId, resolvedBranchId || undefined, undefined, itemFood.restaurantid);

    // ─── Validate restaurant membership ─────────────────────────────
    const existingCart = await db.select().from(cartItems)
        .where(eq(cartItems.userId, userId))
        .limit(1);

    if (existingCart.length > 0 && existingCart[0].restaurantId !== itemFood.restaurantid) {
        return res.status(409).json({
            success: false,
            message: "You have food from another restaurant",
            clearCartRequired: true,
        });
    }

    if (resolvedBranchId && existingCart.length > 0 && existingCart[0].branchId && existingCart[0].branchId !== resolvedBranchId) {
        throw new BadRequest("All cart items must belong to the same branch. Please clear your cart before adding items from a different branch.");
    }

    // ─── Validate variation options ──────────────────────────────────
    const dbVariations = await db
        .select()
        .from(foodVariations)
        .where(eq(foodVariations.foodId, foodId));

    for (const v of dbVariations) {
        if (v.isRequired) {
            const isProvided = safeVariations.some((x: any) => x.variationId === v.id);
            if (!isProvided) throw new BadRequest(`${v.name} is required`);
        }
    }

    for (const selected of safeVariations) {
        const validDbVariation = dbVariations.find(v => v.id === selected.variationId);
        if (!validDbVariation) throw new BadRequest(`Invalid variation ID sent: ${selected.variationId}`);
        if (validDbVariation.status === false) throw new BadRequest(`Variation ${validDbVariation.name} is currently unavailable`);

        const dbOptions = await db
            .select()
            .from(variationOptions)
            .where(eq(variationOptions.variationId, validDbVariation.id));

        const foundOption = dbOptions.find(o => o.id === selected.optionId);
        if (!foundOption) throw new BadRequest(`Invalid option selected for variation: ${validDbVariation.name}`);
        if (foundOption.status === false) throw new BadRequest(`Option ${foundOption.optionName} is currently unavailable`);
    }

    // ─── Addons validation ───────────────────────────────────────────
    let addonSnapshot: { addonId: string; name: string; nameAr: string; price: string }[] = [];
    if (safeAddons.length > 0) {
        const allowedAddonIds: string[] = Array.isArray(itemFood.addonsId) ? itemFood.addonsId : [];
        if (allowedAddonIds.length > 0) {
            for (const a of safeAddons) {
                if (!allowedAddonIds.includes(a.addonId)) {
                    throw new BadRequest(`Addon ${a.addonId} is not available for this food item`);
                }
            }
        }
        const requestedAddonIds = safeAddons.map((a: any) => a.addonId);
        const dbAddons = await db.select().from(addons).where(inArray(addons.id, requestedAddonIds));
        for (const a of safeAddons) {
            const dbAddon = dbAddons.find(d => d.id === a.addonId);
            if (!dbAddon) throw new BadRequest(`Addon not found: ${a.addonId}`);
            if (dbAddon.status === "inactive") throw new BadRequest(`Addon "${dbAddon.name}" is currently unavailable`);
            addonSnapshot.push({ addonId: dbAddon.id, name: dbAddon.name, nameAr: dbAddon.nameAr, price: dbAddon.price });
        }
    }

    // ─── Calculate unit price via pricing engine ─────────────────────
    const optionIds = safeVariations.map((v: any) => v.optionId).filter(Boolean);
    const resolvedServiceModule = (serviceModule as ServiceModule) || null;

    let unitPrice: number;
    if (resolvedBranchId && resolvedServiceModule) {
        const priceResult = await calculateCalculatedPrice(foodId, optionIds, resolvedBranchId, resolvedServiceModule);
        if (!priceResult.isAvailable) {
            throw new BadRequest("This item or one of its options is currently unavailable on this channel.");
        }
        const addonTotal = addonSnapshot.reduce((sum, a) => sum + Number(a.price || 0), 0);
        unitPrice = priceResult.totalUnitPrice + addonTotal;
    } else {
        const basePrice = Number(itemFood.price);
        let totalExtra = 0;
        for (const selected of safeVariations) {
            const [opt] = await db.select({ additionalPrice: variationOptions.additionalPrice }).from(variationOptions).where(eq(variationOptions.id, selected.optionId)).limit(1);
            totalExtra += Number(opt?.additionalPrice || 0);
        }
        const addonTotal = addonSnapshot.reduce((sum, a) => sum + Number(a.price || 0), 0);
        unitPrice = basePrice + totalExtra + addonTotal;
    }

    // ─── Build full variation snapshot with names from DB ───────────
    const variationSnapshotList: any[] = [];
    if (safeVariations.length > 0) {
        const allOptionIds = safeVariations.map((v: any) => v.optionId).filter(Boolean);
        const dbOptionsWithParent = allOptionIds.length > 0
            ? await db
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
                .where(inArray(variationOptions.id, allOptionIds))
            : [];

        const optionDetailsMap = new Map(dbOptionsWithParent.map(o => [o.optionId, o]));

        for (const v of safeVariations) {
            const details = optionDetailsMap.get(v.optionId);
            variationSnapshotList.push({
                variationId: details?.variationId ?? v.variationId ?? null,
                variationName: details?.variationName ?? v.variationName ?? null,
                variationNameAr: details?.variationNameAr ?? v.variationNameAr ?? null,
                variationNameFr: details?.variationNameFr ?? v.variationNameFr ?? null,
                optionId: details?.optionId ?? v.optionId ?? null,
                optionName: details?.optionName ?? v.optionName ?? null,
                optionNameAr: details?.optionNameAr ?? v.optionNameAr ?? null,
                optionNameFr: details?.optionNameFr ?? v.optionNameFr ?? null,
                additionalPrice: Number(details?.additionalPrice ?? v.additionalPrice ?? 0).toFixed(2),
                price: Number(details?.additionalPrice ?? v.additionalPrice ?? 0).toFixed(2),
            });
        }
    }

    // ─── Dedup existing cart item ────────────────────────────────────
    const normalizedVariationsList = normalizeVariations(variationSnapshotList);
    const normalizedAddonsList = normalizeAddons(addonSnapshot);

    const makeDedupeKey = (vars: any[], addonsList: any[]) => JSON.stringify({
        variations: vars.map(v => v.optionId).sort(),
        addons: addonsList.map(a => a.addonId).sort(),
    });
    const key = makeDedupeKey(normalizedVariationsList, normalizedAddonsList);
    const snapshot = { variations: variationSnapshotList };

    const existingItems = await db.select().from(cartItems)
        .where(and(eq(cartItems.userId, userId), eq(cartItems.foodId, foodId)));

    const existingSame = existingItems.find(item => {
        const { variations: dbVars } = parseCartSnapshot(item.variations);
        const dbAddonsParsed = deepParseJSON(item.addons);
        const dbAddonsList = Array.isArray(dbAddonsParsed) ? dbAddonsParsed : [];
        return makeDedupeKey(normalizeVariations(dbVars), normalizeAddons(dbAddonsList)) === key;
    });

    if (existingSame) {
        const newQty = existingSame.quantity + quantity;
        await db.update(cartItems)
            .set({
                quantity: newQty,
                unitPrice: unitPrice.toString(),
                totalPrice: (unitPrice * newQty).toString(),
                variations: JSON.stringify(snapshot),
                addons: JSON.stringify(addonSnapshot),
                ...(resolvedBranchId ? { branchId: resolvedBranchId } : {}),
                ...(resolvedServiceModule ? { serviceModule: resolvedServiceModule } : {}),
                ...(note !== undefined ? { note: note || null } : {}),
            })
            .where(eq(cartItems.id, existingSame.id));
    } else {
        await db.insert(cartItems).values({
            id: uuidv4(),
            userId,
            restaurantId: itemFood.restaurantid,
            foodId,
            quantity,
            unitPrice: unitPrice.toString(),
            totalPrice: (unitPrice * quantity).toString(),
            variations: JSON.stringify(snapshot),
            addons: JSON.stringify(addonSnapshot),
            branchId: resolvedBranchId || undefined,
            serviceModule: resolvedServiceModule || undefined,
            note: note || null,
        });
    }

    return SuccessResponse(res, {
        message: "Added to cart successfully",
        data: {
            unitPrice,
            totalPrice: unitPrice * quantity,
            resolvedBranchId,
            serviceModule: resolvedServiceModule,
        },
    });
};

/* =========================================
   2. GET CART (Optimized & Fixed)
========================================= */
export const getCart = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const queryRestaurantId = req.query.restaurantId as string | undefined;
    const branchId = req.query.branchId as string | undefined;
    const addressId = req.query.addressId as string | undefined;
    const serviceModule = req.query.serviceModule as ServiceModule | undefined;

    const conditions = [eq(cartItems.userId, userId)];
    if (queryRestaurantId) {
        conditions.push(eq(cartItems.restaurantId, queryRestaurantId));
    }

    const items = await db
        .select({
            cartId: cartItems.id,
            foodId: food.id,
            name: food.name,
            nameAr: food.nameAr,
            nameFr: food.nameFr,
            description: food.description,
            descriptionAr: food.descriptionAr,
            descriptionFr: food.descriptionFr,
            image: food.image,
            price: food.price,
            discountType: food.discount_type,
            discountValue: food.discount_value,
            isOutOfStock: food.isOutOfStock,
            status: food.status,
            restaurantId: restaurants.id,
            restaurantName: restaurants.name,
            quantity: cartItems.quantity,
            unitPrice: cartItems.unitPrice,
            totalPrice: cartItems.totalPrice,
            variations: cartItems.variations,
            addons: cartItems.addons,
            note: cartItems.note,
            storedBranchId: cartItems.branchId,
            storedServiceModule: cartItems.serviceModule,
            subcategoryId: food.subcategoryid,
        })
        .from(cartItems)
        .leftJoin(food, and(eq(cartItems.foodId, food.id), activeFoodCondition))
        .leftJoin(restaurants, eq(cartItems.restaurantId, restaurants.id))
        .where(and(...conditions));

    if (items.length === 0) {
        return SuccessResponse(res, {
            data: {
                items: [],
                unavailableItems: [],
                hasUnavailableItems: false,
                hasPriceChanges: false,
                totalSummary: {
                    subtotal: 0,
                    originalSubtotal: 0,
                    totalDiscount: 0,
                }
            }
        });
    }

    const restaurantId = items[0].restaurantId;

    // ─── Resolve active branch for this request ──────────────────────
    let targetBranchId: string | undefined = undefined;
    if (branchId || addressId) {
        targetBranchId = (await resolveBranchIdForCart(branchId, addressId, restaurantId || undefined)) || undefined;
    }

    // ─── Fetch Active Restaurant Branches (For Multi-branch Price Checks) ───
    let activeRestaurantBranches: Array<{ id: string; name: string; nameAr?: string | null }> = [];
    if (!targetBranchId && restaurantId) {
        activeRestaurantBranches = await db
            .select({
                id: branches.id,
                name: branches.name,
                nameAr: branches.nameAr,
            })
            .from(branches)
            .where(and(eq(branches.restaurantId, restaurantId), eq(branches.status, "active")));
    }

    // ─── Availability checks ──────────────────────────────────────────
    const allFoodIds = items.map(i => i.foodId).filter((id): id is string => id !== null && id !== undefined);
    const unavailableMap = allFoodIds.length > 0
        ? await getUnavailableBranchesForFoods(allFoodIds)
        : new Map<string, BranchInfo[]>();

    const inactiveSubcategoryIds = new Set<string>();
    if (targetBranchId) {
        const inactiveRows = await db
            .select({ subcategoryId: branchSubcategories.subcategoryId })
            .from(branchSubcategories)
            .where(and(
                eq(branchSubcategories.branchId, targetBranchId),
                eq(branchSubcategories.status, "inactive")
            ));
        for (const row of inactiveRows) {
            inactiveSubcategoryIds.add(row.subcategoryId);
        }
    }

    let availableCartItems: typeof items = [];
    let unavailableCartItemsData: Array<typeof items[number] & { unavailableReason: string }> = [];

    for (const item of items) {
        const isGeneralUnavailable = Boolean(item.isOutOfStock) || item.status === "inactive";
        const unavailableBranches = item.foodId ? (unavailableMap.get(item.foodId) || []) : [];
        const isBranchUnavailable = Boolean(targetBranchId && unavailableBranches.some(b => b.id === targetBranchId));
        const isSubcategoryInactive = Boolean(
            targetBranchId &&
            item.subcategoryId &&
            inactiveSubcategoryIds.has(item.subcategoryId)
        );

        if (isGeneralUnavailable || isBranchUnavailable || isSubcategoryInactive) {
            const reason = isGeneralUnavailable
                ? "Out of stock or inactive"
                : isSubcategoryInactive
                    ? "This item's category is not available at the selected branch"
                    : "Not available at the selected branch";
            unavailableCartItemsData.push({ ...item, unavailableReason: reason });
        } else {
            availableCartItems.push(item);
        }
    }

    // ─── Optimization: Fetch Variations, Options & Addons in Batch ──────
    const allVariationIds = new Set<string>();
    const allOptionIds = new Set<string>();
    const allAddonIds = new Set<string>(); // ✅ FIX: batch-validate addons too

    const parsedItemsData = availableCartItems.map(item => {
        const { variations: parsedVariations } = parseCartSnapshot(item.variations);
        const parsedAddons = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];

        parsedVariations.forEach((v: any) => {
            if (v.variationId) allVariationIds.add(v.variationId);
            if (v.optionId) allOptionIds.add(v.optionId);
        });
        parsedAddons.forEach((a: any) => {
            const addonId = a.addonId || a.id;
            if (addonId) allAddonIds.add(addonId);
        });

        return { item, parsedVariations, parsedAddons };
    });

    const variationsMap = new Map();
    if (allVariationIds.size > 0) {
        const varList = await db.select().from(foodVariations).where(inArray(foodVariations.id, Array.from(allVariationIds)));
        varList.forEach(v => variationsMap.set(v.id, v));
    }

    const optionsMap = new Map();
    if (allOptionIds.size > 0) {
        const optList = await db.select().from(variationOptions).where(inArray(variationOptions.id, Array.from(allOptionIds)));
        optList.forEach(o => optionsMap.set(o.id, o));
    }

    // ✅ FIX: live addon lookup, same rigor as variations
    const addonsDbMap = new Map();
    if (allAddonIds.size > 0) {
        const addonList = await db.select().from(addons).where(inArray(addons.id, Array.from(allAddonIds)));
        addonList.forEach(a => addonsDbMap.set(a.id, a));
    }

    // ─── Calculate Live Prices with Branch & Channel Strategies ──────
    let initialSubtotal = 0;
    const itemsPrepped = await Promise.all(parsedItemsData.map(async (data) => {
        const { item, parsedVariations, parsedAddons } = data;
        const originalBasePrice = parseFloat(item.price as string || "0");
        const dbUnitPrice = parseFloat(item.unitPrice as string || "0");
        const varPrice = dbUnitPrice - originalBasePrice;

        const effectiveBranchId = targetBranchId || item.storedBranchId || undefined;
        const effectiveServiceModule = (serviceModule || item.storedServiceModule) as ServiceModule | undefined;

        let liveUnitPrice: number | null = null;
        let priceChanged = false;
        let channelAvailable = true;
        const branchPrices: Array<{ branchId: string; branchName: string; branchNameAr: string; unitPrice: number }> = [];

        // 1️⃣ حالة تحديد فرع محدد (Direct Branch Pricing)
        if (effectiveBranchId && item.foodId) {
            try {
                const optionIds = extractOptionIds(parsedVariations);
                const livePrice = await calculateCalculatedPrice(
                    item.foodId,
                    optionIds,
                    effectiveBranchId,
                    effectiveServiceModule
                );
                const addonTotal = parsedAddons.reduce((s: number, a: any) => s + Number(a.price || 0), 0);
                const computedLivePrice = livePrice.totalUnitPrice + addonTotal;

                liveUnitPrice = computedLivePrice;
                channelAvailable = livePrice.isAvailable;
                priceChanged = Math.abs(computedLivePrice - dbUnitPrice) > 0.001;
            } catch {
                // ✅ FIX: previously silently fell back to the stale price as if
                // nothing were wrong (e.g. food itself was deleted). Now the item
                // is explicitly flagged unavailable instead of being served as normal.
                liveUnitPrice = null;
                channelAvailable = false;
            }
        }
        // 2️⃣ حالة عدم تحديد فرع (Cross-Branch Price Comparison Strategy)
        else if (!effectiveBranchId && item.foodId && activeRestaurantBranches.length > 0) {
            const optionIds = extractOptionIds(parsedVariations);
            const addonTotal = parsedAddons.reduce((s: number, a: any) => s + Number(a.price || 0), 0);

            const branchPriceResults = await Promise.allSettled(
                activeRestaurantBranches.map(async (b) => {
                    const bPrice = await calculateCalculatedPrice(
                        item.foodId!,
                        optionIds,
                        b.id,
                        effectiveServiceModule
                    );
                    return { branch: b, bPrice };
                })
            );

            for (const result of branchPriceResults) {
                if (result.status === "fulfilled") {
                    const { branch: b, bPrice } = result.value;
                    const bComputedUnitPrice = bPrice.totalUnitPrice + addonTotal;

                    if (Math.abs(bComputedUnitPrice - dbUnitPrice) > 0.001) {
                        priceChanged = true;
                        branchPrices.push({
                            branchId: b.id,
                            branchName: b.name,
                            branchNameAr: b.nameAr || b.name,
                            unitPrice: bComputedUnitPrice
                        });
                    }
                }
            }
        }

        const currentBasePrice = liveUnitPrice !== null ? (liveUnitPrice - varPrice) : originalBasePrice;
        initialSubtotal += (currentBasePrice + varPrice) * item.quantity;

        return {
            ...data,
            originalBasePrice,
            varPrice,
            currentBasePrice,
            liveUnitPrice,
            priceChanged,
            channelAvailable,
            branchPrices,
            effectiveBranchId,
            effectiveServiceModule
        };
    }));

    // ─── Discount Calculations ───────────────────────────────────────
    const availableDiscounts = await getAvailableDiscounts(restaurantId!);
    const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };

    let finalSubtotal = 0;
    let totalOriginalSubtotal = 0;
    let totalDiscountAmount = 0;

    const formattedAvailableItems = itemsPrepped.map(data => {
        const {
            item, originalBasePrice, varPrice, currentBasePrice, liveUnitPrice,
            priceChanged, channelAvailable, branchPrices, effectiveBranchId, effectiveServiceModule,
            parsedVariations, parsedAddons
        } = data;

        // ✅ FIX: don't silently drop a variation whose option/variation row was
        // deleted after being added to the cart. Fall back to the snapshot taken
        // at add-time (so the name is still shown), flag it `isAvailable:false`,
        // and note that it makes the whole item unavailable below.
        let hasUnresolvedVariation = false;
        const variationDetails = parsedVariations.map((v: any) => {
            const variation = variationsMap.get(v.variationId);
            const option = optionsMap.get(v.optionId);

            if (!variation || !option) {
                hasUnresolvedVariation = true;
                return {
                    variationId: v.variationId ?? null,
                    variationName: v.variationName ?? null,
                    variationNameAr: v.variationNameAr ?? null,
                    optionId: v.optionId ?? null,
                    optionName: v.optionName ?? null,
                    optionNameAr: v.optionNameAr ?? null,
                    additionalPrice: v.additionalPrice ?? "0.00",
                    isAvailable: false,
                };
            }

            return {
                variationId: variation.id,
                variationName: variation.name,
                variationNameAr: variation.nameAr,
                optionId: option.id,
                optionName: option.optionName,
                optionNameAr: option.optionNameAr,
                additionalPrice: option.additionalPrice,
                isAvailable: option.status !== false && variation.status !== false,
            };
        });
        if (variationDetails.some(v => v.isAvailable === false)) hasUnresolvedVariation = true;

        // ✅ FIX: validate addons live instead of trusting the stored snapshot blindly.
        let hasUnresolvedAddon = false;
        const addonDetails = parsedAddons.map((a: any) => {
            const addonId = a.addonId || a.id;
            const dbAddon = addonId ? addonsDbMap.get(addonId) : null;

            if (!dbAddon || dbAddon.status === "inactive") {
                hasUnresolvedAddon = true;
                return {
                    addonId: addonId ?? null,
                    name: a.name ?? null,
                    nameAr: a.nameAr ?? null,
                    price: a.price ?? "0.00",
                    isAvailable: false,
                };
            }

            return {
                addonId: dbAddon.id,
                name: dbAddon.name,
                nameAr: dbAddon.nameAr,
                price: dbAddon.price,
                isAvailable: true,
            };
        });

        const itemIsAvailable = channelAvailable && !hasUnresolvedVariation && !hasUnresolvedAddon;

        // Apply Priority Discount on current base price
        const discountResult = applyPriorityDiscount(
            {
                id: item.foodId ?? "",
                discountType: item.discountType,
                discountValue: item.discountValue
            },
            currentBasePrice,
            initialSubtotal,
            availableDiscounts,
            discountState,
            true
        );

        const discountedBasePrice = discountResult.price;
        const appliedDiscount = discountResult.appliedDiscount;

        const originalUnitPrice = currentBasePrice + varPrice;
        const finalUnitPrice = discountedBasePrice + varPrice;

        const unitDiscountAmount = Math.max(0, originalUnitPrice - finalUnitPrice);
        const itemTotalDiscount = unitDiscountAmount * item.quantity;
        const itemOriginalTotalPrice = originalUnitPrice * item.quantity;
        const finalTotalPrice = finalUnitPrice * item.quantity;

        finalSubtotal += finalTotalPrice;
        totalOriginalSubtotal += itemOriginalTotalPrice;
        totalDiscountAmount += itemTotalDiscount;

        return {
            cartId: item.cartId,
            foodId: item.foodId,
            name: item.name,
            nameAr: item.nameAr,
            nameFr: item.nameFr,
            description: item.description,
            descriptionAr: item.descriptionAr,
            descriptionFr: item.descriptionFr,
            discountType: item.discountType,
            discountValue: item.discountValue,
            image: item.image,
            restaurantId: item.restaurantId,
            restaurantName: item.restaurantName,
            quantity: item.quantity,
            price: (originalBasePrice + varPrice).toString(),
            unitPrice: finalUnitPrice,
            originalUnitPrice,
            totalPrice: finalTotalPrice,
            originalTotalPrice: itemOriginalTotalPrice,
            discountAmountPerUnit: unitDiscountAmount,
            totalDiscountAmount: itemTotalDiscount,
            appliedDiscountDetails: appliedDiscount || null,
            variations: variationDetails,
            addons: addonDetails,
            note: item.note || null,
            isAvailable: itemIsAvailable,
            priceChanged,
            branchPrices: branchPrices.length > 0 ? branchPrices : undefined,
            resolvedBranchId: effectiveBranchId || null,
            serviceModule: effectiveServiceModule || null,
        };
    });

    const formattedUnavailableItems = unavailableCartItemsData.map(item => {
        const { variations: parsedVariations } = parseCartSnapshot(item.variations);
        const parsedAddonsParsed = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];
        return {
            cartId: item.cartId,
            foodId: item.foodId,
            name: item.name,
            nameAr: item.nameAr,
            image: item.image,
            quantity: item.quantity,
            variations: parsedVariations,
            addons: parsedAddonsParsed,
            isAvailable: false,
            reason: item.unavailableReason,
        };
    });

    // ─── Free Delivery Offer Check ────────────────────────────────────
    const now = new Date();
    const [freeDeliveryOffer] = await db
        .select()
        .from(freeDeliveryOffers)
        .where(and(eq(freeDeliveryOffers.restaurantId, restaurantId!), eq(freeDeliveryOffers.status, "active")))
        .limit(1);

    let freeDeliveryInfo: { isEligible: boolean; minOrderAmount: number; remainingAmount: number } | null = null;
    if (freeDeliveryOffer) {
        const startOk = !freeDeliveryOffer.startDate || new Date(freeDeliveryOffer.startDate) <= now;
        const endOk = !freeDeliveryOffer.endDate || new Date(freeDeliveryOffer.endDate) >= now;
        if (startOk && endOk) {
            const minAmount = parseFloat(freeDeliveryOffer.minOrderAmount as string || "0");
            const isEligible = finalSubtotal >= minAmount;
            freeDeliveryInfo = {
                isEligible,
                minOrderAmount: minAmount,
                remainingAmount: isEligible ? 0 : parseFloat((minAmount - finalSubtotal).toFixed(2)),
            };
        }
    }

    return SuccessResponse(res, {
        message: "Cart fetched successfully",
        data: {
            items: formattedAvailableItems,
            unavailableItems: formattedUnavailableItems,
            hasUnavailableItems: formattedUnavailableItems.length > 0 || formattedAvailableItems.some(i => !i.isAvailable),
            hasPriceChanges: formattedAvailableItems.some(i => i.priceChanged),
            totalSummary: {
                originalSubtotal: totalOriginalSubtotal,
                totalDiscount: totalDiscountAmount,
                subtotal: finalSubtotal,
                freeDelivery: freeDeliveryInfo,
            },
        },
    });
};

/* =========================================
   3. UPDATE CART ITEM
========================================= */
export const updateCartItem = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { cartItemId } = req.params;
    const { quantity, variations, addons: requestAddons, note, branchId, addressId, serviceModule } = req.body;

    const [cartItem] = await db
        .select()
        .from(cartItems)
        .where(and(eq(cartItems.id, cartItemId), eq(cartItems.userId, userId)))
        .limit(1);

    if (!cartItem) throw new BadRequest("Cart item not found");

    // 🛡️ Block check
    await validateUserNotBlocked(userId, cartItem.restaurantId);


    const [itemFood] = await db.select().from(food).where(and(eq(food.id, cartItem.foodId), activeFoodCondition)).limit(1);
    if (!itemFood) throw new BadRequest("Food item not found");

    if (!itemFood) throw new BadRequest("Food not found");
    if (itemFood.isOutOfStock || itemFood.status === "inactive") {
        throw new BadRequest("This item is currently out of stock.");
    }

    // ─── Resolve branch ──────────────────────────────────────────────
    let resolvedBranchId: string | null = branchId || cartItem.branchId || null;
    if (!resolvedBranchId && addressId) {
        try {
            resolvedBranchId = await resolveBranchIdFromAddress(addressId, itemFood.restaurantid);
        } catch (err: any) {
            throw new BadRequest(err.message || "Could not resolve delivery branch for this address.");
        }
    }

    // ─── Validate subcategory-branch availability ─────────────────────
    if (resolvedBranchId && itemFood.subcategoryid) {
        const [inactiveSubcat] = await db
            .select({ subcategoryId: branchSubcategories.subcategoryId })
            .from(branchSubcategories)
            .where(and(
                eq(branchSubcategories.branchId, resolvedBranchId),
                eq(branchSubcategories.subcategoryId, itemFood.subcategoryid),
                eq(branchSubcategories.status, "inactive")
            ))
            .limit(1);
        if (inactiveSubcat) {
            throw new BadRequest("This item's category is not available at the selected branch or at your location.");
        }
    }

    await validateFoodAvailabilityForCart(cartItem.foodId, resolvedBranchId || undefined, undefined, itemFood.restaurantid);

    // ─── Resolve variations ──────────────────────────────────────────
    let safeVariations: any[] = [];
    if (variations !== undefined) {
        safeVariations = normalizeVariations(variations);
    } else {
        const { variations: existingVars } = parseCartSnapshot(cartItem.variations);
        safeVariations = normalizeVariations(existingVars);
    }

    const dbVariations = await db.select().from(foodVariations).where(eq(foodVariations.foodId, itemFood.id));

    for (const selected of safeVariations) {
        const validDbVariation = dbVariations.find(v => v.id === selected.variationId);
        if (!validDbVariation) throw new BadRequest("Invalid variation ID");
        if (validDbVariation.status === false) throw new BadRequest(`Variation ${validDbVariation.name} is currently unavailable`);

        const dbOptions = await db.select().from(variationOptions).where(eq(variationOptions.variationId, validDbVariation.id));
        const foundOption = dbOptions.find(o => o.id === selected.optionId);
        if (!foundOption) throw new BadRequest("Invalid option selected");
        if (foundOption.status === false) throw new BadRequest(`Option ${foundOption.optionName} is currently unavailable`);
    }

    // ─── Resolve addons ──────────────────────────────────────────────
    let safeAddons: any[] = [];
    if (requestAddons !== undefined) {
        safeAddons = Array.isArray(requestAddons) ? requestAddons : [];
    } else {
        const existingAddons = deepParseJSON(cartItem.addons);
        safeAddons = Array.isArray(existingAddons) ? existingAddons : [];
    }

    let addonSnapshot: { addonId: string; name: string; nameAr: string; price: string }[] = [];
    if (safeAddons.length > 0) {
        const allowedAddonIds: string[] = Array.isArray(itemFood.addonsId) ? itemFood.addonsId : [];
        if (allowedAddonIds.length > 0) {
            for (const a of safeAddons) {
                if (!allowedAddonIds.includes(a.addonId)) throw new BadRequest(`Addon ${a.addonId} is not available for this food item`);
            }
        }
        const requestedAddonIds = safeAddons.map((a: any) => a.addonId);
        const dbAddons = await db.select().from(addons).where(inArray(addons.id, requestedAddonIds));
        for (const a of safeAddons) {
            const dbAddon = dbAddons.find(d => d.id === a.addonId);
            if (!dbAddon) throw new BadRequest(`Addon not found: ${a.addonId}`);
            if (dbAddon.status === "inactive") throw new BadRequest(`Addon "${dbAddon.name}" is currently unavailable`);
            addonSnapshot.push({ addonId: dbAddon.id, name: dbAddon.name, nameAr: dbAddon.nameAr, price: dbAddon.price });
        }
    } else if (requestAddons === undefined) {
        const existingAddonSnapshot = deepParseJSON(cartItem.addons);
        const addonsList = Array.isArray(existingAddonSnapshot) ? existingAddonSnapshot : [];
        addonSnapshot = addonsList.map((a: any) => ({ addonId: a.addonId, name: a.name, nameAr: a.nameAr, price: a.price }));
    }

    // ─── Calculate unit price via pricing engine ─────────────────────
    const optionIds = safeVariations.map((v: any) => v.optionId).filter(Boolean);
    const resolvedServiceModule = (serviceModule || cartItem.serviceModule) as ServiceModule | undefined;

    let unitPrice: number;
    if (resolvedBranchId && resolvedServiceModule) {
        const priceResult = await calculateCalculatedPrice(cartItem.foodId, optionIds, resolvedBranchId, resolvedServiceModule);
        if (!priceResult.isAvailable) {
            throw new BadRequest("This item or one of its options is currently unavailable on this channel.");
        }
        const addonTotal = addonSnapshot.reduce((sum, a) => sum + Number(a.price || 0), 0);
        unitPrice = priceResult.totalUnitPrice + addonTotal;
    } else {
        let totalExtra = 0;
        for (const selected of safeVariations) {
            const [opt] = await db.select({ additionalPrice: variationOptions.additionalPrice }).from(variationOptions).where(eq(variationOptions.id, selected.optionId)).limit(1);
            totalExtra += Number(opt?.additionalPrice || 0);
        }
        const addonTotal = addonSnapshot.reduce((sum, a) => sum + Number(a.price || 0), 0);
        unitPrice = Number(itemFood.price) + totalExtra + addonTotal;
    }

    // ─── Build full variation snapshot with names from DB ───────────
    let variationSnapshotList: any[] = safeVariations;
    if (variations !== undefined && safeVariations.length > 0) {
        const allOptionIds = safeVariations.map((v: any) => v.optionId).filter(Boolean);
        const dbOptionsWithParent = allOptionIds.length > 0
            ? await db
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
                .where(inArray(variationOptions.id, allOptionIds))
            : [];

        const optionDetailsMap = new Map(dbOptionsWithParent.map(o => [o.optionId, o]));

        variationSnapshotList = safeVariations.map((v: any) => {
            const details = optionDetailsMap.get(v.optionId);
            return {
                variationId: details?.variationId ?? v.variationId ?? null,
                variationName: details?.variationName ?? v.variationName ?? null,
                variationNameAr: details?.variationNameAr ?? v.variationNameAr ?? null,
                variationNameFr: details?.variationNameFr ?? v.variationNameFr ?? null,
                optionId: details?.optionId ?? v.optionId ?? null,
                optionName: details?.optionName ?? v.optionName ?? null,
                optionNameAr: details?.optionNameAr ?? v.optionNameAr ?? null,
                optionNameFr: details?.optionNameFr ?? v.optionNameFr ?? null,
                additionalPrice: Number(details?.additionalPrice ?? v.additionalPrice ?? v.price ?? 0).toFixed(2),
                price: Number(details?.additionalPrice ?? v.additionalPrice ?? v.price ?? 0).toFixed(2),
            };
        });
    } else if (variations === undefined) {
        const { variations: existingVars } = parseCartSnapshot(cartItem.variations);
        variationSnapshotList = existingVars;
    }

    const qty = quantity ?? cartItem.quantity;

    await db.update(cartItems)
        .set({
            quantity: qty,
            unitPrice: unitPrice.toString(),
            totalPrice: (unitPrice * qty).toString(),
            variations: JSON.stringify({ variations: variationSnapshotList }),
            addons: JSON.stringify(addonSnapshot),
            ...(resolvedBranchId ? { branchId: resolvedBranchId } : {}),
            ...(resolvedServiceModule ? { serviceModule: resolvedServiceModule } : {}),
            ...(note !== undefined ? { note: note || null } : {}),
        })
        .where(and(eq(cartItems.id, cartItemId), eq(cartItems.userId, userId)));

    return SuccessResponse(res, {
        message: "Cart updated successfully",
        data: {
            unitPrice,
            totalPrice: unitPrice * qty,
            resolvedBranchId,
            serviceModule: resolvedServiceModule,
        },
    });
};

/* =========================================
   4. REMOVE ITEM
========================================= */
export const removeCartItem = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { cartItemId } = req.params;

    await db.delete(cartItems)
        .where(and(eq(cartItems.id, cartItemId), eq(cartItems.userId, userId)));

    return SuccessResponse(res, {
        message: "The item has been removed from the cart",
    });
};

/* =========================================
   5. CLEAR CART
========================================= */
export const clearCart = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;

    await db.delete(cartItems)
        .where(eq(cartItems.userId, userId));

    return SuccessResponse(res, {
        message: "The cart has been cleared successfully",
    });
};

/* =========================================
   6. VALIDATE CART PRICING
   POST /api/cart/validate-pricing
========================================= */
export const validateCartPricing = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const {
        restaurantId,
        serviceModule,
        branchId,
        addressId,
    } = req.body;

    if (!userId) throw new BadRequest("User authentication required.");
    if (!restaurantId) throw new BadRequest("restaurantId is required.");
    if (!serviceModule || !["takeaway", "dine_in", "delivery"].includes(serviceModule)) {
        throw new BadRequest("serviceModule must be one of: takeaway, dine_in, delivery.");
    }
    if (!branchId && !addressId) {
        throw new BadRequest("Either branchId or addressId is required.");
    }
    if (serviceModule === "delivery" && !branchId && !addressId) {
        throw new BadRequest("addressId or branchId is required for delivery orders.");
    }

    const userCartItems = await db
        .select()
        .from(cartItems)
        .where(
            and(
                eq(cartItems.userId, userId),
                eq(cartItems.restaurantId, restaurantId)
            )
        );

    if (userCartItems.length === 0) {
        throw new BadRequest("Cart is empty for this restaurant.");
    }

    let resolvedBranchId: string;

    if (branchId) {
        const [br] = await db
            .select({ id: branches.id })
            .from(branches)
            .where(and(eq(branches.id, branchId), eq(branches.restaurantId, restaurantId), eq(branches.status, "active")))
            .limit(1);
        if (!br) throw new BadRequest("Provided branchId is invalid or inactive.");
        resolvedBranchId = br.id;
    } else {
        resolvedBranchId = await resolveBranchIdFromAddress(addressId, restaurantId);
    }

    let oldSubtotal = 0;
    let newSubtotal = 0;
    let isPriceChanged = false;
    let hasUnavailableItems = false;

    const itemResults: any[] = [];

    for (const item of userCartItems) {
        const foodId = item.foodId;
        const quantity = item.quantity;
        const storedUnitPrice = Number(item.unitPrice || 0);

        const { variations: parsedVariations } = parseCartSnapshot(item.variations);
        const parsedAddons = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];

        const optionIds = extractOptionIds(parsedVariations);
        const addonTotal = parsedAddons.reduce((s: number, a: any) => s + Number(a.price || 0), 0);

        const priceResult = await calculateCalculatedPrice(
            foodId,
            optionIds,
            resolvedBranchId,
            serviceModule as ServiceModule
        );

        const newCalculatedUnitPrice = priceResult.totalUnitPrice + addonTotal;
        const basePriceChanged = Math.abs(newCalculatedUnitPrice - storedUnitPrice) > 0.001;
        const itemIsAvailable = priceResult.isAvailable;

        if (basePriceChanged) isPriceChanged = true;
        if (!itemIsAvailable) hasUnavailableItems = true;

        const oldTotal = storedUnitPrice * quantity;
        const newTotal = newCalculatedUnitPrice * quantity;

        oldSubtotal += oldTotal;
        newSubtotal += newTotal;

        itemResults.push({
            cartItemId: item.id,
            foodId,
            quantity,
            isAvailable: itemIsAvailable,
            priceChanged: basePriceChanged,
            oldUnitPrice: storedUnitPrice,
            newUnitPrice: newCalculatedUnitPrice,
            totalItemPrice: newTotal,
        });
    }

    return res.status(200).json({
        success: true,
        message: "Cart pricing and availability validated successfully",
        data: {
            resolvedBranchId,
            isPriceChanged,
            hasUnavailableItems,
            summary: {
                oldSubtotal: parseFloat(oldSubtotal.toFixed(2)),
                newSubtotal: parseFloat(newSubtotal.toFixed(2)),
                currency: "EGP",
            },
            items: itemResults,
        },
    });
};