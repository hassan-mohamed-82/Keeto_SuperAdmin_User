"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCartPricing = exports.clearCart = exports.removeCartItem = exports.updateCartItem = exports.getCart = exports.addToCart = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const uuid_1 = require("uuid");
const discount_service_1 = require("../../services/discount.service");
const userBlockCheck_1 = require("../../utils/userBlockCheck");
const userPhoneCheck_1 = require("../../utils/userPhoneCheck");
const food_helper_1 = require("../../helpers/food.helper");
const cart_helper_1 = require("../../helpers/cart.helper");
const pricing_helper_1 = require("../../helpers/pricing.helper");
const foodConditions_1 = require("../../helpers/foodConditions");
const weightPricing_helper_1 = require("../../helpers/weightPricing.helper");
const weightCart_helper_1 = require("../../helpers/weightCart.helper");
const firstOrderDiscount_helper_1 = require("../../helpers/firstOrderDiscount.helper");
/* =========================================
   Helpers
========================================= */
const normalizeVariations = (variations) => {
    const safe = Array.isArray(variations) ? variations : [];
    return safe
        .map(v => {
        const optionId = v?.optionId || v?.option_id || (Array.isArray(v?.options) ? v.options[0] : undefined);
        const variationId = v?.variationId || v?.variation_id || v?.id;
        return optionId ? { ...v, optionId, variationId } : v;
    })
        .filter(v => v?.optionId)
        .sort((a, b) => String(a.optionId).localeCompare(String(b.optionId)));
};
const normalizeAddons = (addonsInput) => {
    const safe = Array.isArray(addonsInput) ? addonsInput : [];
    return safe
        .filter(a => a?.addonId)
        .sort((a, b) => String(a.addonId).localeCompare(String(b.addonId)));
};
const deepParseJSON = (data) => {
    if (typeof data === "string") {
        try {
            return deepParseJSON(JSON.parse(data));
        }
        catch {
            return data;
        }
    }
    return data;
};
const parseCartSnapshot = (raw) => {
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
/** Cart subtotal from stored line totals (excluding rows marked unavailable by the restaurant). */
const sumStoredCartSubtotal = async (userId, restaurantId) => {
    const rows = await connection_1.db
        .select({ totalPrice: schema_1.cartItems.totalPrice, isUnavailable: schema_1.cartItems.isUnavailable })
        .from(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.restaurantId, restaurantId)));
    return rows
        .filter(r => !r.isUnavailable)
        .reduce((s, r) => s + parseFloat(r.totalPrice || "0"), 0);
};
/** Extract all variantOptionIds from a parsed variations snapshot */
const extractOptionIds = (parsedVariations) => parsedVariations
    .map((v) => v.optionId)
    .filter(Boolean);
/* =========================================
   1. ADD TO CART
========================================= */
const addToCart = async (req, res) => {
    const userId = req.user?.id;
    const isGuestUser = Boolean(req.user?.isGuest);
    await (0, userPhoneCheck_1.validateUserPhone)(userId, isGuestUser, req.body);
    const { foodId, offerId, quantity = 1, weight, variations = [], addons: requestAddons = [], note, branchId, addressId, serviceModule, } = req.body;
    if (!foodId && !offerId) {
        throw new BadRequest_1.BadRequest("foodId or offerId is required");
    }
    // ─── If adding a bundle offer ────────────────────────────────────
    if (offerId) {
        const [offer] = await connection_1.db.select().from(schema_1.offers).where((0, drizzle_orm_1.eq)(schema_1.offers.id, offerId)).limit(1);
        if (!offer)
            throw new BadRequest_1.BadRequest("Offer not found");
        if (offer.status !== "active")
            throw new BadRequest_1.BadRequest("This offer is no longer active");
        const now = new Date();
        if (new Date(offer.endDate) < now)
            throw new BadRequest_1.BadRequest("This offer has expired");
        if (new Date(offer.startDate) > now)
            throw new BadRequest_1.BadRequest("This offer has not started yet");
        await (0, userBlockCheck_1.validateUserNotBlocked)(userId, offer?.restaurantId || "");
        const bundleFoods = await connection_1.db.select().from(schema_1.offerFoods).where((0, drizzle_orm_1.eq)(schema_1.offerFoods.offerId, offerId));
        if (bundleFoods.length === 0) {
            throw new BadRequest_1.BadRequest("This bundle offer has no foods configured.");
        }
        const representativeFoodId = foodId || bundleFoods[0].foodId;
        let resolvedBranchId = branchId || null;
        if (!resolvedBranchId && addressId) {
            try {
                resolvedBranchId = await (0, pricing_helper_1.resolveBranchIdFromAddress)(addressId, offer.restaurantId || "");
            }
            catch (err) {
                throw new BadRequest_1.BadRequest(err.message || "Could not resolve delivery branch for this address.");
            }
        }
        if (resolvedBranchId) {
            const [br] = await connection_1.db
                .select({ id: schema_1.branches.id })
                .from(schema_1.branches)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.id, resolvedBranchId), (0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, offer?.restaurantId || ""), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")))
                .limit(1);
            if (!br)
                throw new BadRequest_1.BadRequest("Selected branch not found or inactive.");
        }
        const existingCart = await connection_1.db.select().from(schema_1.cartItems)
            .where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId))
            .limit(1);
        if (existingCart.length > 0 && existingCart[0].restaurantId !== offer.restaurantId) {
            return res.status(409).json({
                success: false,
                message: "You have food from another restaurant",
                clearCartRequired: true,
            });
        }
        if (resolvedBranchId && existingCart.length > 0 && existingCart[0].branchId && existingCart[0].branchId !== resolvedBranchId) {
            throw new BadRequest_1.BadRequest("All cart items must belong to the same branch. Please clear your cart before adding items from a different branch.");
        }
        // Bundle offers are normal (unit) items: allowed during an active weight request,
        // rejected only while the cart is frozen for payment.
        (0, weightCart_helper_1.assertCartWriteAllowed)({
            kind: "add",
            activeRequest: await (0, weightCart_helper_1.findActiveWeightRequest)(userId, offer.restaurantId || ""),
            targetIsWeightBound: false,
        });
        const unitPrice = parseFloat(offer.price);
        const resolvedServiceModule = serviceModule || null;
        const [existingOfferItem] = await connection_1.db.select().from(schema_1.cartItems)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.offerId, offerId)))
            .limit(1);
        if (existingOfferItem) {
            const newQty = existingOfferItem.quantity + quantity;
            await connection_1.db.update(schema_1.cartItems)
                .set({
                quantity: newQty,
                unitPrice: unitPrice.toString(),
                totalPrice: (unitPrice * newQty).toFixed(2),
                variations: JSON.stringify({ variations: [] }),
                addons: JSON.stringify([]),
                ...(resolvedBranchId ? { branchId: resolvedBranchId } : {}),
                ...(resolvedServiceModule ? { serviceModule: resolvedServiceModule } : {}),
                ...(note !== undefined ? { note: note || null } : {}),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.cartItems.id, existingOfferItem.id));
        }
        else {
            await connection_1.db.insert(schema_1.cartItems).values({
                id: (0, uuid_1.v4)(),
                userId,
                restaurantId: offer.restaurantId || "",
                foodId: representativeFoodId,
                offerId: offer.id || "",
                quantity,
                unitPrice: unitPrice.toString(),
                totalPrice: (unitPrice * quantity).toFixed(2),
                variations: JSON.stringify({ variations: [] }),
                addons: JSON.stringify([]),
                branchId: resolvedBranchId || undefined,
                serviceModule: resolvedServiceModule || undefined,
                note: note || null,
            });
        }
        return (0, response_1.SuccessResponse)(res, {
            message: "Offer added to cart successfully",
            data: {
                offerId: offer.id,
                name: offer.name,
                unitPrice,
                totalPrice: unitPrice * quantity,
                resolvedBranchId,
                serviceModule: resolvedServiceModule,
            },
        });
    }
    const safeVariations = Array.isArray(variations) ? variations : [];
    const safeAddons = Array.isArray(requestAddons) ? requestAddons : [];
    const [itemFood] = await connection_1.db.select().from(schema_1.food).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.id, foodId), foodConditions_1.activeFoodCondition)).limit(1);
    if (!itemFood)
        throw new BadRequest_1.BadRequest("Food not found");
    const isWeightedFood = itemFood.sold_by === "weight";
    // Full weight validation (including weight-group option derivation) runs after the selected
    // options are loaded below (line ~393). Here we only do a quick unit-sold guard: if the food
    // is NOT weight-based, reject any positive weight that was sent so we fail fast.
    const numericWeight = (weight !== undefined && weight !== null && weight !== "") ? Number(weight) : null;
    if (!isWeightedFood && numericWeight !== null && Number.isFinite(numericWeight) && numericWeight > 0) {
        throw new BadRequest_1.BadRequest("Weight cannot be specified for unit-sold products");
    }
    // Placeholder; will be assigned after full validation below.
    let requestedWeight = null;
    // 🛡️ Block check
    await (0, userBlockCheck_1.validateUserNotBlocked)(userId, itemFood.restaurantid);
    // 🛡️ Weight-request cart rules: weighted foods cannot be added while a request is active;
    // normal items can (except while the cart is frozen for payment).
    (0, weightCart_helper_1.assertCartWriteAllowed)({
        kind: "add",
        activeRequest: await (0, weightCart_helper_1.findActiveWeightRequest)(userId, itemFood.restaurantid),
        targetIsWeightBound: isWeightedFood,
    });
    if (itemFood.isOutOfStock || itemFood.status === "inactive") {
        throw new BadRequest_1.BadRequest("This item is currently out of stock.");
    }
    // ─── Resolve branch ──────────────────────────────────────────────
    let resolvedBranchId = branchId || null;
    if (!resolvedBranchId && addressId) {
        try {
            resolvedBranchId = await (0, pricing_helper_1.resolveBranchIdFromAddress)(addressId, itemFood.restaurantid);
        }
        catch (err) {
            throw new BadRequest_1.BadRequest(err.message || "Could not resolve delivery branch for this address.");
        }
    }
    if (resolvedBranchId && !branchId) {
        const [br] = await connection_1.db
            .select({ id: schema_1.branches.id })
            .from(schema_1.branches)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.id, resolvedBranchId), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")))
            .limit(1);
        if (!br)
            throw new BadRequest_1.BadRequest("Resolved delivery branch is inactive.");
    }
    if (resolvedBranchId && branchId) {
        const [br] = await connection_1.db
            .select({ id: schema_1.branches.id })
            .from(schema_1.branches)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.id, resolvedBranchId), (0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, itemFood.restaurantid), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")))
            .limit(1);
        if (!br)
            throw new BadRequest_1.BadRequest("Selected branch not found or inactive.");
    }
    // ─── Validate subcategory-branch availability ─────────────────────
    if (resolvedBranchId && itemFood.subcategoryid) {
        const [inactiveSubcat] = await connection_1.db
            .select({ subcategoryId: schema_1.branchSubcategories.subcategoryId })
            .from(schema_1.branchSubcategories)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branchSubcategories.branchId, resolvedBranchId), (0, drizzle_orm_1.eq)(schema_1.branchSubcategories.subcategoryId, itemFood.subcategoryid), (0, drizzle_orm_1.eq)(schema_1.branchSubcategories.status, "inactive")))
            .limit(1);
        if (inactiveSubcat) {
            throw new BadRequest_1.BadRequest("This item's category is not available at the selected branch or at your location");
        }
    }
    // ─── Validate food availability at branch (ingredient/menu locks) ─
    await (0, cart_helper_1.validateFoodAvailabilityForCart)(foodId, resolvedBranchId || undefined, undefined, itemFood.restaurantid);
    // ─── Validate restaurant membership ─────────────────────────────
    const existingCart = await connection_1.db.select().from(schema_1.cartItems)
        .where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId))
        .limit(1);
    if (existingCart.length > 0 && existingCart[0].restaurantId !== itemFood.restaurantid) {
        return res.status(409).json({
            success: false,
            message: "You have food from another restaurant",
            clearCartRequired: true,
        });
    }
    if (resolvedBranchId && existingCart.length > 0 && existingCart[0].branchId && existingCart[0].branchId !== resolvedBranchId) {
        throw new BadRequest_1.BadRequest("All cart items must belong to the same branch. Please clear your cart before adding items from a different branch.");
    }
    // ─── Validate variation options ──────────────────────────────────
    const dbVariations = await connection_1.db
        .select()
        .from(schema_1.foodVariations)
        .where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, foodId));
    for (const v of dbVariations) {
        if (v.isRequired) {
            const isProvided = safeVariations.some((x) => x.variationId === v.id);
            if (!isProvided)
                throw new BadRequest_1.BadRequest(`${v.name} is required`);
        }
    }
    const selectedWeightOptions = [];
    for (const selected of safeVariations) {
        const varId = selected.variationId || selected.variation_id || selected.id;
        const validDbVariation = dbVariations.find(v => v.id === varId);
        if (!validDbVariation)
            throw new BadRequest_1.BadRequest(`Invalid variation ID sent: ${varId}`);
        if (validDbVariation.status === false)
            throw new BadRequest_1.BadRequest(`Variation ${validDbVariation.name} is currently unavailable`);
        const dbOptions = await connection_1.db
            .select()
            .from(schema_1.variationOptions)
            .where((0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, validDbVariation.id));
        const optId = selected.optionId || selected.option_id || (Array.isArray(selected.options) ? selected.options[0] : null);
        const foundOption = dbOptions.find(o => o.id === optId);
        if (!foundOption)
            throw new BadRequest_1.BadRequest(`Invalid option selected for variation: ${validDbVariation.name}`);
        if (foundOption.status === false)
            throw new BadRequest_1.BadRequest(`Option ${foundOption.optionName} is currently unavailable`);
        selectedWeightOptions.push({ isWeightGroup: validDbVariation.isWeightGroup, weightValue: foundOption.weightValue });
    }
    // ⚖️ Full weight validation: weight-group option derivation + allow_custom_weight rules.
    // Returns the normalised weight (or null for unit-sold foods).
    requestedWeight = (0, weightPricing_helper_1.validateWeightInput)(itemFood, weight, selectedWeightOptions);
    const hasWeightOption = selectedWeightOptions.some(o => o.isWeightGroup);
    // ─── Addons validation ───────────────────────────────────────────
    let addonSnapshot = [];
    if (safeAddons.length > 0) {
        const allowedAddonIds = Array.isArray(itemFood.addonsId) ? itemFood.addonsId : [];
        if (allowedAddonIds.length > 0) {
            for (const a of safeAddons) {
                if (!allowedAddonIds.includes(a.addonId)) {
                    throw new BadRequest_1.BadRequest(`Addon ${a.addonId} is not available for this food item`);
                }
            }
        }
        const requestedAddonIds = safeAddons.map((a) => a.addonId);
        const dbAddons = await connection_1.db.select().from(schema_1.addons).where((0, drizzle_orm_1.inArray)(schema_1.addons.id, requestedAddonIds));
        for (const a of safeAddons) {
            const dbAddon = dbAddons.find(d => d.id === a.addonId);
            if (!dbAddon)
                throw new BadRequest_1.BadRequest(`Addon not found: ${a.addonId}`);
            if (dbAddon.status === "inactive")
                throw new BadRequest_1.BadRequest(`Addon "${dbAddon.name}" is currently unavailable`);
            addonSnapshot.push({ addonId: dbAddon.id, name: dbAddon.name, nameAr: dbAddon.nameAr, price: dbAddon.price });
        }
    }
    // ─── Calculate unit price via pricing engine ─────────────────────
    const optionIds = safeVariations.map((v) => v.optionId).filter(Boolean);
    const resolvedServiceModule = serviceModule || null;
    // let unitPrice: number;
    // if (resolvedBranchId && resolvedServiceModule) {
    const priceResult = await (0, pricing_helper_1.calculateCalculatedPrice)(foodId, optionIds, resolvedBranchId || null, resolvedServiceModule || undefined);
    if (!priceResult.isAvailable) {
        throw new BadRequest_1.BadRequest("This item or one of its options is currently unavailable on this channel.");
    }
    const addonTotal = addonSnapshot.reduce((sum, a) => sum + Number(a.price || 0), 0);
    const unitPrice = priceResult.totalUnitPrice + addonTotal;
    // }else {
    //                 const basePrice = Number(itemFood.price);
    //                 let totalExtra = 0;
    //                 for (const selected of safeVariations) {
    //                     const [opt] = await db.select({ additionalPrice: variationOptions.additionalPrice }).from(variationOptions).where(eq(variationOptions.id, selected.optionId)).limit(1);
    //                     totalExtra += Number(opt?.additionalPrice || 0);
    //                 }
    //                 const addonTotal = addonSnapshot.reduce((sum, a) => sum + Number(a.price || 0), 0);
    //                 unitPrice = basePrice + totalExtra + addonTotal;
    //             }
    // ─── Build full variation snapshot with names from DB ───────────
    const variationSnapshotList = [];
    if (safeVariations.length > 0) {
        const allOptionIds = safeVariations.map((v) => v.optionId).filter(Boolean);
        const dbOptionsWithParent = allOptionIds.length > 0
            ? await connection_1.db
                .select({
                optionId: schema_1.variationOptions.id,
                optionName: schema_1.variationOptions.optionName,
                optionNameAr: schema_1.variationOptions.optionNameAr,
                optionNameFr: schema_1.variationOptions.optionNameFr,
                additionalPrice: schema_1.variationOptions.additionalPrice,
                priceMode: schema_1.variationOptions.priceMode,
                variationId: schema_1.foodVariations.id,
                variationName: schema_1.foodVariations.name,
                variationNameAr: schema_1.foodVariations.nameAr,
                variationNameFr: schema_1.foodVariations.nameFr,
                isWeightGroup: schema_1.foodVariations.isWeightGroup,
            })
                .from(schema_1.variationOptions)
                .leftJoin(schema_1.foodVariations, (0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, schema_1.foodVariations.id))
                .where((0, drizzle_orm_1.inArray)(schema_1.variationOptions.id, allOptionIds))
            : [];
        const optionDetailsMap = new Map(dbOptionsWithParent.map(o => [o.optionId, o]));
        // Channel/branch-resolved option prices (same source as checkout), not the raw additionalPrice.
        const resolvedOptionMap = new Map(priceResult.variants.map(r => [r.variantOptionId, r]));
        for (const v of safeVariations) {
            const details = optionDetailsMap.get(v.optionId);
            const resolved = resolvedOptionMap.get(v.optionId);
            const optionPrice = Number(resolved?.price ?? details?.additionalPrice ?? v.additionalPrice ?? 0).toFixed(2);
            variationSnapshotList.push({
                variationId: details?.variationId ?? v.variationId ?? null,
                variationName: details?.variationName ?? v.variationName ?? null,
                variationNameAr: details?.variationNameAr ?? v.variationNameAr ?? null,
                variationNameFr: details?.variationNameFr ?? v.variationNameFr ?? null,
                optionId: details?.optionId ?? v.optionId ?? null,
                optionName: details?.optionName ?? v.optionName ?? null,
                optionNameAr: details?.optionNameAr ?? v.optionNameAr ?? null,
                optionNameFr: details?.optionNameFr ?? v.optionNameFr ?? null,
                additionalPrice: optionPrice,
                price: optionPrice,
                priceMode: (details?.priceMode ?? v.priceMode ?? "fixed"),
                isWeightGroup: Boolean(details?.isWeightGroup ?? v.isWeightGroup),
            });
        }
    }
    for (const v of variationSnapshotList) {
        if (!isWeightedFood && v.priceMode === "per_weight") {
            throw new BadRequest_1.BadRequest("per_weight price_mode is only allowed on weight-based products");
        }
    }
    // ─── Dedup existing cart item ────────────────────────────────────
    const normalizedVariationsList = normalizeVariations(variationSnapshotList);
    const normalizedAddonsList = normalizeAddons(addonSnapshot);
    const makeDedupeKey = (vars, addonsList) => JSON.stringify({
        variations: vars.map(v => v.optionId).sort(),
        addons: addonsList.map(a => a.addonId).sort(),
    });
    const key = makeDedupeKey(normalizedVariationsList, normalizedAddonsList);
    const snapshot = { variations: variationSnapshotList };
    // Only unlocked customer rows can be merged into (a locked row belongs to a weight request).
    const existingItems = await connection_1.db.select().from(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.foodId, foodId), (0, drizzle_orm_1.isNull)(schema_1.cartItems.weightRequestId), (0, drizzle_orm_1.eq)(schema_1.cartItems.addedBy, "customer"), (0, drizzle_orm_1.isNull)(schema_1.cartItems.offerId)));
    // A preset weight option merges by incrementing quantity; custom weight merges by summing weights.
    const existingSame = existingItems.find(item => {
        const { variations: dbVars } = parseCartSnapshot(item.variations);
        const dbAddonsParsed = deepParseJSON(item.addons);
        const dbAddonsList = Array.isArray(dbAddonsParsed) ? dbAddonsParsed : [];
        return makeDedupeKey(normalizeVariations(dbVars), normalizeAddons(dbAddonsList)) === key;
    });
    const unitPriceNumber = unitPrice;
    const unitPriceStr = isWeightedFood ? priceResult.basePrice.toFixed(2) : unitPriceNumber.toFixed(2);
    const weightedOptionExtras = [
        ...variationSnapshotList.map(v => ({ price: v.price || v.additionalPrice, priceMode: v.priceMode })),
        ...addonSnapshot.map(a => ({ price: a.price, priceMode: "fixed" })),
    ];
    let lineTotalStr;
    if (existingSame) {
        if (isWeightedFood) {
            if (hasWeightOption) {
                // If weight-group option selected (e.g. 1/4 kg), keep weight as option weight and increment quantity
                const addQty = Math.max(1, Number(quantity) || 1);
                const newQty = existingSame.quantity + addQty;
                const newTotalPriceStr = (0, weightPricing_helper_1.computeWeightedLineTotal)(requestedWeight, unitPriceStr, weightedOptionExtras, newQty);
                lineTotalStr = newTotalPriceStr;
                await connection_1.db.update(schema_1.cartItems)
                    .set({
                    quantity: newQty,
                    weight: requestedWeight.toFixed(3),
                    weightUnit: itemFood.weight_unit,
                    unitPrice: unitPriceStr,
                    totalPrice: newTotalPriceStr,
                    variations: JSON.stringify(snapshot),
                    addons: JSON.stringify(addonSnapshot),
                    ...(resolvedBranchId ? { branchId: resolvedBranchId } : {}),
                    ...(resolvedServiceModule ? { serviceModule: resolvedServiceModule } : {}),
                    ...(note !== undefined ? { note: note || null } : {}),
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.cartItems.id, existingSame.id));
            }
            else {
                // Custom weight: Sum in thousandths to avoid float drift, then re-validate (sane maximum applies to the sum).
                const summed = (Math.round(Number(existingSame.weight || 0) * 1000) + Math.round(requestedWeight * 1000)) / 1000;
                const newWeight = (0, weightPricing_helper_1.validateWeightInput)(itemFood, summed, selectedWeightOptions);
                const newTotalPriceStr = (0, weightPricing_helper_1.computeWeightedLineTotal)(newWeight, unitPriceStr, weightedOptionExtras, 1);
                lineTotalStr = newTotalPriceStr;
                await connection_1.db.update(schema_1.cartItems)
                    .set({
                    quantity: 1,
                    weight: newWeight.toFixed(3),
                    weightUnit: itemFood.weight_unit,
                    unitPrice: unitPriceStr,
                    totalPrice: newTotalPriceStr,
                    variations: JSON.stringify(snapshot),
                    addons: JSON.stringify(addonSnapshot),
                    ...(resolvedBranchId ? { branchId: resolvedBranchId } : {}),
                    ...(resolvedServiceModule ? { serviceModule: resolvedServiceModule } : {}),
                    ...(note !== undefined ? { note: note || null } : {}),
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.cartItems.id, existingSame.id));
            }
        }
        else {
            const newQty = existingSame.quantity + quantity;
            const priceCents = Math.round(unitPriceNumber * 100);
            const newTotalPriceStr = ((priceCents * newQty) / 100).toFixed(2);
            lineTotalStr = newTotalPriceStr;
            await connection_1.db.update(schema_1.cartItems)
                .set({
                quantity: newQty,
                unitPrice: unitPriceStr,
                totalPrice: newTotalPriceStr,
                variations: JSON.stringify(snapshot),
                addons: JSON.stringify(addonSnapshot),
                ...(resolvedBranchId ? { branchId: resolvedBranchId } : {}),
                ...(resolvedServiceModule ? { serviceModule: resolvedServiceModule } : {}),
                ...(note !== undefined ? { note: note || null } : {}),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.cartItems.id, existingSame.id));
        }
    }
    else {
        const itemQty = (isWeightedFood && !hasWeightOption) ? 1 : Math.max(1, Number(quantity) || 1);
        let itemTotalPriceStr;
        if (isWeightedFood) {
            itemTotalPriceStr = (0, weightPricing_helper_1.computeWeightedLineTotal)(requestedWeight, unitPriceStr, weightedOptionExtras, itemQty);
        }
        else {
            const priceCents = Math.round(unitPriceNumber * 100);
            itemTotalPriceStr = ((priceCents * itemQty) / 100).toFixed(2);
        }
        lineTotalStr = itemTotalPriceStr;
        await connection_1.db.insert(schema_1.cartItems).values({
            id: (0, uuid_1.v4)(),
            userId,
            restaurantId: itemFood.restaurantid,
            foodId,
            quantity: itemQty,
            weight: isWeightedFood ? requestedWeight.toFixed(3) : null,
            weightUnit: isWeightedFood ? itemFood.weight_unit : null,
            finalWeight: null,
            isUnavailable: false,
            weightRequestId: null,
            unitPrice: unitPriceStr,
            totalPrice: itemTotalPriceStr,
            variations: JSON.stringify(snapshot),
            addons: JSON.stringify(addonSnapshot),
            branchId: resolvedBranchId || undefined,
            serviceModule: resolvedServiceModule || undefined,
            note: note || null,
        });
    }
    // ─── First-order discount preview (registered users only) ────────
    let firstOrderDiscount = null;
    if (!isGuestUser && itemFood?.restaurantid) {
        // Whole-cart subtotal from the stored line totals (weighted rows store the weighted
        // line total), excluding rows the restaurant marked unavailable.
        const orderSource = (req.body?.orderSource || req.query?.orderSource);
        const cartSubtotalForFod = await sumStoredCartSubtotal(userId, itemFood.restaurantid);
        const fodResult = await (0, firstOrderDiscount_helper_1.resolveFirstOrderDiscount)(userId, itemFood.restaurantid, cartSubtotalForFod, orderSource);
        if (fodResult) {
            firstOrderDiscount = {
                discountId: fodResult.discount.id,
                name: fodResult.discount.name,
                nameAr: fodResult.discount.nameAr,
                nameFr: fodResult.discount.nameFr,
                discountType: fodResult.discount.discountType,
                discountValue: parseFloat(fodResult.discount.discountValue),
                discountAmount: fodResult.discountAmount,
                maxDiscountAmount: fodResult.discount.maxDiscountAmount
                    ? parseFloat(fodResult.discount.maxDiscountAmount)
                    : null,
                firstOrderCount: fodResult.discount.firstOrderCount,
            };
        }
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Added to cart successfully",
        data: {
            unitPrice,
            totalPrice: parseFloat(lineTotalStr),
            weight: isWeightedFood ? requestedWeight : null,
            resolvedBranchId,
            serviceModule: resolvedServiceModule,
            firstOrderDiscount,
        },
    });
};
exports.addToCart = addToCart;
/* =========================================
   2. GET CART (Optimized & Fixed)
========================================= */
const getCart = async (req, res) => {
    const userId = req.user?.id;
    const queryRestaurantId = req.query.restaurantId;
    const branchId = req.query.branchId;
    const addressId = req.query.addressId;
    const serviceModule = req.query.serviceModule;
    const orderSource = (req.query.orderSource || req.query.ordersource);
    const conditions = [(0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId)];
    if (queryRestaurantId) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.cartItems.restaurantId, queryRestaurantId));
    }
    const items = await connection_1.db
        .select({
        cartId: schema_1.cartItems.id,
        foodId: schema_1.food.id,
        name: schema_1.food.name,
        nameAr: schema_1.food.nameAr,
        nameFr: schema_1.food.nameFr,
        description: schema_1.food.description,
        descriptionAr: schema_1.food.descriptionAr,
        descriptionFr: schema_1.food.descriptionFr,
        image: schema_1.food.image,
        price: schema_1.food.price,
        discountId: schema_1.food.discountId,
        discountType: schema_1.food.discount_type,
        discountValue: schema_1.food.discount_value,
        isOutOfStock: schema_1.food.isOutOfStock,
        status: schema_1.food.status,
        restaurantId: schema_1.restaurants.id,
        restaurantName: schema_1.restaurants.name,
        quantity: schema_1.cartItems.quantity,
        unitPrice: schema_1.cartItems.unitPrice,
        totalPrice: schema_1.cartItems.totalPrice,
        variations: schema_1.cartItems.variations,
        addons: schema_1.cartItems.addons,
        note: schema_1.cartItems.note,
        storedBranchId: schema_1.cartItems.branchId,
        storedServiceModule: schema_1.cartItems.serviceModule,
        subcategoryId: schema_1.food.subcategoryid,
        offerId: schema_1.cartItems.offerId,
        weight: schema_1.cartItems.weight,
        finalWeight: schema_1.cartItems.finalWeight,
        weightUnit: schema_1.cartItems.weightUnit,
        isUnavailable: schema_1.cartItems.isUnavailable,
        weightRequestId: schema_1.cartItems.weightRequestId,
        addedBy: schema_1.cartItems.addedBy,
        addedByAdminId: schema_1.cartItems.addedByAdminId,
        sold_by: schema_1.food.sold_by,
        foodWeightUnit: schema_1.food.weight_unit,
        allow_custom_weight: schema_1.food.allow_custom_weight,
    })
        .from(schema_1.cartItems)
        .leftJoin(schema_1.food, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.foodId, schema_1.food.id), foodConditions_1.activeFoodCondition))
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.cartItems.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.and)(...conditions));
    if (items.length === 0) {
        return (0, response_1.SuccessResponse)(res, {
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
    let targetBranchId = undefined;
    if (branchId || addressId) {
        targetBranchId = (await (0, cart_helper_1.resolveBranchIdForCart)(branchId, addressId, restaurantId || undefined)) || undefined;
    }
    // ─── Fetch Active Restaurant Branches (For Multi-branch Price Checks) ───
    let activeRestaurantBranches = [];
    if (!targetBranchId && restaurantId) {
        activeRestaurantBranches = await connection_1.db
            .select({
            id: schema_1.branches.id,
            name: schema_1.branches.name,
            nameAr: schema_1.branches.nameAr,
        })
            .from(schema_1.branches)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")));
    }
    // ─── Separate offer items and regular food items ───────────────────
    const normalItems = items.filter(i => !i.offerId);
    const offerCartItems = items.filter(i => i.offerId);
    // ─── Fetch Offer Data for Bundle Offer Items in Cart ──────────────
    const offerIds = [...new Set(offerCartItems.map(i => i.offerId))];
    const dbOffers = offerIds.length > 0
        ? await connection_1.db.select().from(schema_1.offers).where((0, drizzle_orm_1.inArray)(schema_1.offers.id, offerIds))
        : [];
    const offersMap = new Map(dbOffers.map(o => [o.id, o]));
    const dbOfferFoods = offerIds.length > 0
        ? await connection_1.db
            .select({
            offerId: schema_1.offerFoods.offerId,
            foodId: schema_1.offerFoods.foodId,
            quantity: schema_1.offerFoods.quantity,
            variations: schema_1.offerFoods.variations,
            foodName: schema_1.food.name,
            foodNameAr: schema_1.food.nameAr,
            foodImage: schema_1.food.image,
            foodPrice: schema_1.food.price,
        })
            .from(schema_1.offerFoods)
            .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.offerFoods.foodId, schema_1.food.id))
            .where((0, drizzle_orm_1.inArray)(schema_1.offerFoods.offerId, offerIds))
        : [];
    const offerFoodsGroupMap = new Map();
    for (const ofRow of dbOfferFoods) {
        if (!offerFoodsGroupMap.has(ofRow.offerId)) {
            offerFoodsGroupMap.set(ofRow.offerId, []);
        }
        offerFoodsGroupMap.get(ofRow.offerId).push({
            foodId: ofRow.foodId,
            name: ofRow.foodName,
            nameAr: ofRow.foodNameAr,
            image: ofRow.foodImage,
            price: parseFloat(ofRow.foodPrice || "0"),
            quantity: ofRow.quantity,
            variations: ofRow.variations ?? [],
        });
    }
    const nowForOffers = new Date();
    const formattedOfferAvailableItems = [];
    let unavailableCartItemsData = [];
    for (const item of offerCartItems) {
        const offer = offersMap.get(item.offerId);
        const isOfferActive = !!offer && offer.status === "active" && new Date(offer.endDate) >= nowForOffers && new Date(offer.startDate) <= nowForOffers;
        if (!isOfferActive) {
            unavailableCartItemsData.push({
                ...item,
                name: offer?.name || item.name || "Offer Bundle",
                unavailableReason: !offer ? "Offer not found" : "Offer has expired or is inactive",
            });
        }
        else {
            const unitPrice = parseFloat(offer.price);
            const totalPrice = unitPrice * item.quantity;
            formattedOfferAvailableItems.push({
                cartId: item.cartId,
                foodId: item.foodId,
                offerId: item.offerId,
                isOffer: true,
                name: offer.name,
                nameAr: offer.name,
                nameFr: offer.name,
                description: null,
                descriptionAr: null,
                descriptionFr: null,
                discountType: null,
                discountValue: null,
                image: offer.image || item.image,
                restaurantId: item.restaurantId,
                restaurantName: item.restaurantName,
                quantity: item.quantity,
                price: offer.price,
                unitPrice,
                originalUnitPrice: unitPrice,
                totalPrice,
                originalTotalPrice: totalPrice,
                discountAmountPerUnit: 0,
                totalDiscountAmount: 0,
                appliedDiscountDetails: null,
                bundleFoods: offerFoodsGroupMap.get(offer.id) || [],
                variations: [],
                addons: [],
                note: item.note || null,
                isAvailable: true,
                sold_by: "unit",
                allowCustomWeight: true,
                locked: Boolean(item.weightRequestId),
                requiresWeighing: false,
                addedBy: item.addedBy || "customer",
                priceChanged: false,
                resolvedBranchId: targetBranchId || item.storedBranchId || null,
                serviceModule: (serviceModule || item.storedServiceModule) || null,
            });
        }
    }
    // ─── Availability checks for Regular Food Items ────────────────────
    const allFoodIds = normalItems.map(i => i.foodId).filter((id) => id !== null && id !== undefined);
    const unavailableMap = allFoodIds.length > 0
        ? await (0, food_helper_1.getUnavailableBranchesForFoods)(allFoodIds)
        : new Map();
    const inactiveSubcategoryIds = new Set();
    if (targetBranchId) {
        const inactiveRows = await connection_1.db
            .select({ subcategoryId: schema_1.branchSubcategories.subcategoryId })
            .from(schema_1.branchSubcategories)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branchSubcategories.branchId, targetBranchId), (0, drizzle_orm_1.eq)(schema_1.branchSubcategories.status, "inactive")));
        for (const row of inactiveRows) {
            inactiveSubcategoryIds.add(row.subcategoryId);
        }
    }
    let availableCartItems = [];
    for (const item of normalItems) {
        const isGeneralUnavailable = Boolean(item.isOutOfStock) || item.status === "inactive";
        const unavailableBranches = item.foodId ? (unavailableMap.get(item.foodId) || []) : [];
        const isBranchUnavailable = Boolean(targetBranchId && unavailableBranches.some(b => b.id === targetBranchId));
        const isSubcategoryInactive = Boolean(targetBranchId &&
            item.subcategoryId &&
            inactiveSubcategoryIds.has(item.subcategoryId));
        if (isGeneralUnavailable || isBranchUnavailable || isSubcategoryInactive) {
            const reason = isGeneralUnavailable
                ? "Out of stock or inactive"
                : isSubcategoryInactive
                    ? "This item's category is not available at the selected branch"
                    : "Not available at the selected branch";
            unavailableCartItemsData.push({ ...item, unavailableReason: reason });
        }
        else {
            availableCartItems.push(item);
        }
    }
    // ─── Optimization: Fetch Variations, Options & Addons in Batch ──────
    const allVariationIds = new Set();
    const allOptionIds = new Set();
    const allAddonIds = new Set(); // ✅ FIX: batch-validate addons too
    const parsedItemsData = availableCartItems.map(item => {
        const { variations: parsedVariations } = parseCartSnapshot(item.variations);
        const parsedAddons = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];
        parsedVariations.forEach((v) => {
            if (v.variationId)
                allVariationIds.add(v.variationId);
            if (v.optionId)
                allOptionIds.add(v.optionId);
        });
        parsedAddons.forEach((a) => {
            const addonId = a.addonId || a.id;
            if (addonId)
                allAddonIds.add(addonId);
        });
        return { item, parsedVariations, parsedAddons };
    });
    const variationsMap = new Map();
    if (allVariationIds.size > 0) {
        const varList = await connection_1.db.select().from(schema_1.foodVariations).where((0, drizzle_orm_1.inArray)(schema_1.foodVariations.id, Array.from(allVariationIds)));
        varList.forEach(v => variationsMap.set(v.id, v));
    }
    const optionsMap = new Map();
    if (allOptionIds.size > 0) {
        const optList = await connection_1.db.select().from(schema_1.variationOptions).where((0, drizzle_orm_1.inArray)(schema_1.variationOptions.id, Array.from(allOptionIds)));
        optList.forEach(o => optionsMap.set(o.id, o));
    }
    // ✅ FIX: live addon lookup, same rigor as variations
    const addonsDbMap = new Map();
    if (allAddonIds.size > 0) {
        const addonList = await connection_1.db.select().from(schema_1.addons).where((0, drizzle_orm_1.inArray)(schema_1.addons.id, Array.from(allAddonIds)));
        addonList.forEach(a => addonsDbMap.set(a.id, a));
    }
    // ─── Calculate Live Prices with Branch & Channel Strategies ──────
    const itemsPrepped = await Promise.all(parsedItemsData.map(async (data) => {
        const { item, parsedVariations, parsedAddons } = data;
        const originalBasePrice = parseFloat(item.price || "0");
        const dbUnitPrice = parseFloat(item.unitPrice || "0");
        const fallbackVarPrice = Math.max(0, dbUnitPrice - originalBasePrice);
        // Weighted rows store the base price PER WEIGHT UNIT in unit_price (not base+variants+addons).
        const isWeightedRow = (0, weightCart_helper_1.isWeighedRow)(item, item.sold_by);
        // Rows locked to a weight request are priced from their snapshot, exactly like checkout.
        const snapshot = item.weightRequestId && (0, weightCart_helper_1.isWeightBoundRow)(item, item.sold_by)
            ? (0, weightCart_helper_1.snapshotPricing)(item, isWeightedRow)
            : null;
        // Live addon prices (same source as checkout), falling back to the stored snapshot.
        const liveAddonPrice = (a) => {
            const dbAddon = addonsDbMap.get(a.addonId || a.id);
            return Number(dbAddon?.price ?? a.price ?? 0);
        };
        let liveVariantMap = new Map();
        // Resolve branch to use for pricing:
        // 1. targetBranchId (from query branchId or addressId)
        // 2. storedBranchId (from when item was added to cart)
        // 3. If restaurant has only 1 active branch, use it
        let effectiveBranchId = targetBranchId || item.storedBranchId || undefined;
        if (!effectiveBranchId && activeRestaurantBranches.length === 1) {
            effectiveBranchId = activeRestaurantBranches[0].id;
        }
        const effectiveServiceModule = (serviceModule || item.storedServiceModule);
        let liveUnitPrice = null;
        let resolvedBasePrice = originalBasePrice;
        let resolvedVarPrice = fallbackVarPrice;
        let priceChanged = false;
        let channelAvailable = true;
        const branchPrices = [];
        if (item.foodId) {
            const optionIds = extractOptionIds(parsedVariations);
            const addonTotal = parsedAddons.reduce((s, a) => s + liveAddonPrice(a), 0);
            // Determine pricing branch: effective branch, or first branch if multiple exist, or null (for general/channel overrides)
            const pricingBranch = effectiveBranchId || (activeRestaurantBranches.length > 0 ? activeRestaurantBranches[0].id : null);
            try {
                const livePrice = await (0, pricing_helper_1.calculateCalculatedPrice)(item.foodId, optionIds, pricingBranch, effectiveServiceModule);
                resolvedBasePrice = livePrice.basePrice;
                resolvedVarPrice = livePrice.variants.reduce((s, v) => s + Number(v.price || 0), 0) + addonTotal;
                liveVariantMap = new Map(livePrice.variants.map(v => [v.variantOptionId, { price: v.price, priceMode: v.priceMode }]));
                const computedLivePrice = livePrice.totalUnitPrice + addonTotal;
                liveUnitPrice = computedLivePrice;
                channelAvailable = livePrice.isAvailable;
                // Weighted rows: compare the per-weight-unit base price only.
                priceChanged = (0, weightCart_helper_1.hasUnitPriceChanged)({
                    isWeighted: isWeightedRow,
                    liveBasePrice: livePrice.basePrice,
                    liveTotalUnitPrice: computedLivePrice,
                    storedUnitPrice: dbUnitPrice,
                });
            }
            catch {
                liveUnitPrice = null;
                channelAvailable = false;
            }
            // Cross-Branch Price Comparison (when multiple branches exist; not for snapshot-priced rows)
            if (!snapshot && activeRestaurantBranches.length > 1) {
                const branchPriceResults = await Promise.allSettled(activeRestaurantBranches.map(async (b) => {
                    const bPrice = await (0, pricing_helper_1.calculateCalculatedPrice)(item.foodId, optionIds, b.id, effectiveServiceModule);
                    return { branch: b, bPrice };
                }));
                for (const result of branchPriceResults) {
                    if (result.status === "fulfilled") {
                        const { branch: b, bPrice } = result.value;
                        const bComputedUnitPrice = isWeightedRow ? bPrice.basePrice : bPrice.totalUnitPrice + addonTotal;
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
        }
        // Snapshot rows (locked to a weight request) are charged at their snapshot price at checkout.
        if (snapshot) {
            resolvedBasePrice = snapshot.basePrice;
            resolvedVarPrice = snapshot.varSum + snapshot.addonSum;
            priceChanged = false;
        }
        // Option extras for weighted rows: snapshot, or the live channel-resolved option prices.
        const weightedExtras = snapshot
            ? [...snapshot.variationExtras, ...snapshot.addonExtras]
            : [
                ...parsedVariations.map((v) => {
                    const live = liveVariantMap.get(v.optionId);
                    return {
                        price: live?.price ?? Number(v.price ?? v.additionalPrice ?? 0),
                        priceMode: (live?.priceMode ?? v.priceMode ?? "fixed"),
                    };
                }),
                ...parsedAddons.map((a) => ({ price: liveAddonPrice(a), priceMode: "fixed" })),
            ];
        const optionDisplayPrice = (v, fallback) => snapshot ? (v.price ?? v.additionalPrice ?? fallback) : (liveVariantMap.get(v.optionId)?.price ?? fallback);
        const currentBasePrice = resolvedBasePrice;
        const varPrice = resolvedVarPrice;
        return {
            ...data,
            isWeightedRow,
            weightedExtras,
            optionDisplayPrice,
            liveAddonPrice: (a) => (snapshot ? Number(a.price ?? 0) : liveAddonPrice(a)),
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
    const resolvedCartItems = await (0, discount_service_1.formatProductsWithDiscounts)(itemsPrepped.map(data => ({
        ...data.item,
        id: data.item.foodId ?? undefined,
        price: data.currentBasePrice,
        discountId: data.item.discountId,
        discountType: data.item.discountType,
        discountValue: data.item.discountValue,
    })), restaurantId);
    const resolvedByCartId = new Map(resolvedCartItems.map((item, index) => [itemsPrepped[index].item.cartId, item]));
    let finalSubtotal = 0;
    let totalOriginalSubtotal = 0;
    let totalDiscountAmount = 0;
    const formattedAvailableItems = itemsPrepped.map(data => {
        const { item, varPrice, currentBasePrice, priceChanged, channelAvailable, branchPrices, effectiveBranchId, effectiveServiceModule, parsedVariations, parsedAddons, isWeightedRow, weightedExtras, optionDisplayPrice, liveAddonPrice } = data;
        // ✅ FIX: don't silently drop a variation whose option/variation row was
        // deleted after being added to the cart. Fall back to the snapshot taken
        // at add-time (so the name is still shown), flag it `isAvailable:false`,
        // and note that it makes the whole item unavailable below.
        let hasUnresolvedVariation = false;
        const variationDetails = parsedVariations.map((v) => {
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
                    priceMode: v.priceMode || "fixed",
                    isWeightGroup: Boolean(v.isWeightGroup),
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
                additionalPrice: Number(optionDisplayPrice(v, option.additionalPrice) ?? 0).toFixed(2),
                priceMode: v.priceMode || option.priceMode || "fixed",
                isWeightGroup: Boolean(variation.isWeightGroup ?? v.isWeightGroup),
                isAvailable: option.status !== false && variation.status !== false,
            };
        });
        if (variationDetails.some(v => v.isAvailable === false))
            hasUnresolvedVariation = true;
        // ✅ FIX: validate addons live instead of trusting the stored snapshot blindly.
        let hasUnresolvedAddon = false;
        const addonDetails = parsedAddons.map((a) => {
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
                price: liveAddonPrice(a).toFixed(2),
                isAvailable: true,
            };
        });
        const itemIsAvailable = channelAvailable && !hasUnresolvedVariation && !hasUnresolvedAddon;
        // Apply Priority Discount on current base price
        const resolvedPrice = resolvedByCartId.get(item.cartId);
        const discountedBasePrice = resolvedPrice?.finalPrice ?? currentBasePrice;
        const appliedDiscount = resolvedPrice?.appliedDiscountId
            ? { id: resolvedPrice.appliedDiscountId }
            : null;
        const originalUnitPrice = currentBasePrice + varPrice;
        const finalUnitPrice = discountedBasePrice + varPrice;
        // The shared line-price formula (also used by both weight-request detail screens).
        const linePrice = (0, weightPricing_helper_1.priceCartLine)({
            isWeighted: isWeightedRow,
            effectiveWeight: item.finalWeight ? Number(item.finalWeight) : Number(item.weight || 0),
            quantity: item.quantity,
            basePrice: currentBasePrice,
            discountedBasePrice,
            extras: weightedExtras,
            unitExtras: varPrice,
        });
        const unitDiscountAmount = linePrice.discountPerUnit;
        const itemTotalDiscount = linePrice.discountTotal;
        const itemOriginalTotalPrice = linePrice.originalTotal;
        const finalTotalPrice = linePrice.finalTotal;
        // Rows the restaurant marked unavailable are not ordered, so they don't count in the totals.
        if (!item.isUnavailable) {
            finalSubtotal += finalTotalPrice;
            totalOriginalSubtotal += itemOriginalTotalPrice;
            totalDiscountAmount += itemTotalDiscount;
        }
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
            price: originalUnitPrice.toString(),
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
            isAvailable: itemIsAvailable && !item.isUnavailable,
            sold_by: item.sold_by || "unit",
            allowCustomWeight: Boolean(item.allow_custom_weight ?? true),
            weight: item.weight ? item.weight.toString() : null,
            finalWeight: item.finalWeight ? item.finalWeight.toString() : null,
            weightUnit: item.weightUnit || item.foodWeightUnit || null,
            isUnavailable: Boolean(item.isUnavailable),
            weightRequestId: item.weightRequestId || null,
            locked: Boolean(item.weightRequestId),
            requiresWeighing: isWeightedRow,
            addedBy: item.addedBy || "customer",
            addedByAdminId: item.addedByAdminId || null,
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
            offerId: item.offerId || null,
            isOffer: Boolean(item.offerId),
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
    // ─── Add Offer Totals to Final Subtotals ───────────────────────────
    for (const offerItem of formattedOfferAvailableItems) {
        finalSubtotal += offerItem.totalPrice;
        totalOriginalSubtotal += offerItem.originalTotalPrice;
    }
    const allAvailableCartItems = [...formattedAvailableItems, ...formattedOfferAvailableItems];
    // ─── Free Delivery Offer Check ────────────────────────────────────
    const now = new Date();
    const [freeDeliveryOffer] = await connection_1.db
        .select()
        .from(schema_1.freeDeliveryOffers)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.freeDeliveryOffers.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.freeDeliveryOffers.status, "active")))
        .limit(1);
    let freeDeliveryInfo = null;
    if (freeDeliveryOffer) {
        const startOk = !freeDeliveryOffer.startDate || new Date(freeDeliveryOffer.startDate) <= now;
        const endOk = !freeDeliveryOffer.endDate || new Date(freeDeliveryOffer.endDate) >= now;
        // Check Branch Eligibility:
        // An empty branchIds array means the offer applies to ALL branches.
        // If branchIds has items, the resolved cart branch must be in the list.
        let offerBranchIds = [];
        const rawBranchIds = freeDeliveryOffer.branchIds;
        if (Array.isArray(rawBranchIds)) {
            offerBranchIds = rawBranchIds.map(String).filter(Boolean);
        }
        else if (typeof rawBranchIds === "string") {
            try {
                const parsed = JSON.parse(rawBranchIds);
                if (Array.isArray(parsed))
                    offerBranchIds = parsed.map(String).filter(Boolean);
            }
            catch {
                offerBranchIds = [];
            }
        }
        let branchOk = true;
        if (offerBranchIds.length > 0) {
            let effectiveCartBranchId = targetBranchId;
            if (!effectiveCartBranchId) {
                const itemWithBranch = items.find((i) => i.storedBranchId);
                if (itemWithBranch?.storedBranchId) {
                    effectiveCartBranchId = itemWithBranch.storedBranchId;
                }
                else if (activeRestaurantBranches.length === 1) {
                    effectiveCartBranchId = activeRestaurantBranches[0].id;
                }
            }
            branchOk = Boolean(effectiveCartBranchId && offerBranchIds.includes(effectiveCartBranchId));
        }
        if (startOk && endOk && branchOk) {
            let userLimitOk = true;
            if (userId && freeDeliveryOffer.maxOrdersPerUser && freeDeliveryOffer.maxOrdersPerUser > 0) {
                const [userOrdersRow] = await connection_1.db
                    .select({ cnt: (0, drizzle_orm_1.sql) `count(*)` })
                    .from(schema_1.orders)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId), (0, drizzle_orm_1.sql) `${schema_1.orders.status} NOT IN ('cancelled', 'failed')`));
                const userOrderCount = Number(userOrdersRow?.cnt ?? 0);
                if (userOrderCount >= freeDeliveryOffer.maxOrdersPerUser) {
                    userLimitOk = false;
                }
            }
            if (userLimitOk) {
                const minAmount = parseFloat(freeDeliveryOffer.minOrderAmount || "0");
                const isEligible = finalSubtotal >= minAmount;
                freeDeliveryInfo = {
                    isEligible,
                    minOrderAmount: minAmount,
                    remainingAmount: isEligible ? 0 : parseFloat((minAmount - finalSubtotal).toFixed(2)),
                };
            }
        }
    }
    // ─── First-order discount preview (registered users only) ────────────
    const isGuestUser = Boolean(req.user?.isGuest);
    let firstOrderDiscount = null;
    if (!isGuestUser && restaurantId) {
        const fodResult = await (0, firstOrderDiscount_helper_1.resolveFirstOrderDiscount)(userId, restaurantId, finalSubtotal, orderSource);
        if (fodResult) {
            firstOrderDiscount = {
                discountId: fodResult.discount.id,
                name: fodResult.discount.name,
                nameAr: fodResult.discount.nameAr,
                nameFr: fodResult.discount.nameFr,
                discountType: fodResult.discount.discountType,
                discountValue: parseFloat(fodResult.discount.discountValue),
                discountAmount: fodResult.discountAmount,
                maxDiscountAmount: fodResult.discount.maxDiscountAmount
                    ? parseFloat(fodResult.discount.maxDiscountAmount)
                    : null,
                firstOrderCount: fodResult.discount.firstOrderCount,
                summary: {
                    subtotal: parseFloat(finalSubtotal.toFixed(2)),
                    discountAmount: fodResult.discountAmount,
                    finalSubtotal: parseFloat(Math.max(0, finalSubtotal - fodResult.discountAmount).toFixed(2)),
                },
            };
            // Reflect first-order discount in the main totals
            totalDiscountAmount = parseFloat((totalDiscountAmount + fodResult.discountAmount).toFixed(2));
            finalSubtotal = parseFloat(Math.max(0, finalSubtotal - fodResult.discountAmount).toFixed(2));
        }
    }
    let activeWeightRequest = null;
    if (restaurantId) {
        const [activeReq] = await connection_1.db
            .select({
            id: schema_1.weightRequests.id,
            status: schema_1.weightRequests.status,
            expiresAt: schema_1.weightRequests.expiresAt,
            weighedAt: schema_1.weightRequests.weighedAt,
        })
            .from(schema_1.weightRequests)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.weightRequests.userId, userId), (0, drizzle_orm_1.eq)(schema_1.weightRequests.restaurantId, restaurantId), (0, drizzle_orm_1.inArray)(schema_1.weightRequests.status, [...weightCart_helper_1.ACTIVE_WEIGHT_REQUEST_STATUSES, ...weightCart_helper_1.FROZEN_CART_STATUSES])))
            .limit(1);
        if (activeReq) {
            activeWeightRequest = activeReq;
        }
    }
    const requiresWeighing = items.some((i) => (0, weightCart_helper_1.isWeighedRow)(i, i.sold_by));
    const hasWeightBoundRows = items.some((i) => (0, weightCart_helper_1.isWeightBoundRow)(i, i.sold_by));
    const isWeightExpired = activeWeightRequest ? new Date(activeWeightRequest.expiresAt) <= new Date() : false;
    const isEstimatedTotal = requiresWeighing && activeWeightRequest?.status !== "awaiting_customer_approval";
    // Normal rule: nothing unavailable among the rows that will actually be ordered.
    const normalRowsOk = !formattedUnavailableItems.length &&
        !allAvailableCartItems.some((i) => !i.isAvailable && !i.isUnavailable);
    // Weighted carts: same gate as checkout (approved request, not expired, every weighted /
    // restaurant-added row tagged with that request).
    const canCheckout = hasWeightBoundRows
        ? normalRowsOk && (0, weightCart_helper_1.canCheckoutWeightedCart)(items.map((i) => ({ ...i, id: i.cartId, foodSoldBy: i.sold_by })), activeWeightRequest)
        : (!formattedUnavailableItems.length && !allAvailableCartItems.some((i) => !i.isAvailable));
    const weightRequestResponse = activeWeightRequest
        ? {
            id: activeWeightRequest.id,
            status: activeWeightRequest.status,
            expiresAt: activeWeightRequest.expiresAt,
            weighedAt: activeWeightRequest.weighedAt,
            isExpired: isWeightExpired,
        }
        : null;
    return (0, response_1.SuccessResponse)(res, {
        message: "Cart fetched successfully",
        data: {
            items: allAvailableCartItems,
            unavailableItems: formattedUnavailableItems,
            hasUnavailableItems: formattedUnavailableItems.length > 0 || allAvailableCartItems.some(i => !i.isAvailable),
            hasPriceChanges: allAvailableCartItems.some(i => i.priceChanged),
            requiresWeighing,
            canCheckout,
            isEstimatedTotal,
            weightRequest: weightRequestResponse,
            totalSummary: {
                originalSubtotal: totalOriginalSubtotal,
                totalDiscount: totalDiscountAmount,
                subtotal: finalSubtotal,
                isEstimated: isEstimatedTotal,
                freeDelivery: freeDeliveryInfo,
                firstOrderDiscount,
            },
            activeWeightRequest,
        },
    });
};
exports.getCart = getCart;
/* =========================================
   3. UPDATE CART ITEM
========================================= */
const updateCartItem = async (req, res) => {
    const userId = req.user?.id;
    const isGuestUser = Boolean(req.user?.isGuest);
    await (0, userPhoneCheck_1.validateUserPhone)(userId, isGuestUser, req.body);
    const { cartItemId } = req.params;
    const { quantity, weight, variations, addons: requestAddons, note, branchId, addressId, serviceModule } = req.body;
    const [cartItem] = await connection_1.db
        .select()
        .from(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.id, cartItemId), (0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId)))
        .limit(1);
    if (!cartItem)
        throw new BadRequest_1.BadRequest("Cart item not found");
    // 🛡️ Weight-request cart rules (locked rows, weighted rows during an active request, frozen cart)
    const [rowFood] = await connection_1.db.select({ sold_by: schema_1.food.sold_by }).from(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.id, cartItem.foodId)).limit(1);
    (0, weightCart_helper_1.assertCartWriteAllowed)({
        kind: "update",
        activeRequest: await (0, weightCart_helper_1.findActiveWeightRequest)(userId, cartItem.restaurantId),
        targetIsWeightBound: !cartItem.offerId && (0, weightCart_helper_1.isWeightBoundRow)(cartItem, rowFood?.sold_by),
        rowWeightRequestId: cartItem.weightRequestId,
    });
    if (cartItem.addedBy === "restaurant") {
        throw new BadRequest_1.BadRequest("Items added by the restaurant cannot be edited.");
    }
    // 🛡️ Block check
    await (0, userBlockCheck_1.validateUserNotBlocked)(userId, cartItem.restaurantId);
    // ─── If cart item is an offer ────────────────────────────────────
    if (cartItem.offerId) {
        const [offer] = await connection_1.db.select().from(schema_1.offers).where((0, drizzle_orm_1.eq)(schema_1.offers.id, cartItem.offerId)).limit(1);
        if (!offer)
            throw new BadRequest_1.BadRequest("Offer not found");
        if (offer.status !== "active")
            throw new BadRequest_1.BadRequest("Offer is no longer active");
        const newQty = quantity ? Number(quantity) : cartItem.quantity;
        const unitPrice = parseFloat(offer.price);
        const priceCents = Math.round(unitPrice * 100);
        const totalPriceStr = ((priceCents * newQty) / 100).toFixed(2);
        await connection_1.db.update(schema_1.cartItems)
            .set({
            quantity: newQty,
            unitPrice: unitPrice.toFixed(2),
            totalPrice: totalPriceStr,
            ...(note !== undefined ? { note: note || null } : {}),
            ...(branchId ? { branchId } : {}),
            ...(serviceModule ? { serviceModule } : {}),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.cartItems.id, cartItemId));
        return (0, response_1.SuccessResponse)(res, {
            message: "Cart item updated successfully",
            data: {
                cartItemId,
                quantity: newQty,
                unitPrice,
                totalPrice: parseFloat(totalPriceStr),
            },
        });
    }
    const [itemFood] = await connection_1.db.select().from(schema_1.food).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.id, cartItem.foodId), foodConditions_1.activeFoodCondition)).limit(1);
    if (!itemFood)
        throw new BadRequest_1.BadRequest("Food item not found");
    if (itemFood.isOutOfStock || itemFood.status === "inactive") {
        throw new BadRequest_1.BadRequest("This item is currently out of stock.");
    }
    const isWeightedFood = itemFood.sold_by === "weight";
    let newWeight = null;
    let newQty = 1;
    const numericWeight = (weight !== undefined && weight !== null && weight !== "") ? Number(weight) : null;
    if (!isWeightedFood && numericWeight !== null && Number.isFinite(numericWeight) && numericWeight > 0) {
        throw new BadRequest_1.BadRequest("Weight cannot be specified for unit-sold products");
    }
    // ─── Resolve branch ──────────────────────────────────────────────
    let resolvedBranchId = branchId || cartItem.branchId || null;
    if (!resolvedBranchId && addressId) {
        try {
            resolvedBranchId = await (0, pricing_helper_1.resolveBranchIdFromAddress)(addressId, itemFood.restaurantid);
        }
        catch (err) {
            throw new BadRequest_1.BadRequest(err.message || "Could not resolve delivery branch for this address.");
        }
    }
    // ─── Validate subcategory-branch availability ─────────────────────
    if (resolvedBranchId && itemFood.subcategoryid) {
        const [inactiveSubcat] = await connection_1.db
            .select({ subcategoryId: schema_1.branchSubcategories.subcategoryId })
            .from(schema_1.branchSubcategories)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branchSubcategories.branchId, resolvedBranchId), (0, drizzle_orm_1.eq)(schema_1.branchSubcategories.subcategoryId, itemFood.subcategoryid), (0, drizzle_orm_1.eq)(schema_1.branchSubcategories.status, "inactive")))
            .limit(1);
        if (inactiveSubcat) {
            throw new BadRequest_1.BadRequest("This item's category is not available at the selected branch or at your location.");
        }
    }
    await (0, cart_helper_1.validateFoodAvailabilityForCart)(cartItem.foodId, resolvedBranchId || undefined, undefined, itemFood.restaurantid);
    // ─── Resolve variations ──────────────────────────────────────────
    let safeVariations = [];
    if (variations !== undefined) {
        safeVariations = normalizeVariations(variations);
    }
    else {
        const { variations: existingVars } = parseCartSnapshot(cartItem.variations);
        safeVariations = normalizeVariations(existingVars);
    }
    const dbVariations = await connection_1.db.select().from(schema_1.foodVariations).where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, itemFood.id));
    const selectedWeightOptions = [];
    for (const selected of safeVariations) {
        const varId = selected.variationId || selected.variation_id || selected.id;
        const validDbVariation = dbVariations.find(v => v.id === varId);
        if (!validDbVariation)
            throw new BadRequest_1.BadRequest("Invalid variation ID");
        if (validDbVariation.status === false)
            throw new BadRequest_1.BadRequest(`Variation ${validDbVariation.name} is currently unavailable`);
        const dbOptions = await connection_1.db.select().from(schema_1.variationOptions).where((0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, validDbVariation.id));
        const optId = selected.optionId || selected.option_id || (Array.isArray(selected.options) ? selected.options[0] : null);
        const foundOption = dbOptions.find(o => o.id === optId);
        if (!foundOption)
            throw new BadRequest_1.BadRequest("Invalid option selected");
        if (foundOption.status === false)
            throw new BadRequest_1.BadRequest(`Option ${foundOption.optionName} is currently unavailable`);
        selectedWeightOptions.push({ isWeightGroup: validDbVariation.isWeightGroup, weightValue: foundOption.weightValue });
    }
    // ⚖️ Weight groups / allow_custom_weight (same rule as addToCart).
    const hasWeightOption = selectedWeightOptions.some(o => o.isWeightGroup);
    if (isWeightedFood) {
        const hasExplicitWeight = weight !== undefined && weight !== null && weight !== "" && Number(weight) > 0;
        // If a weight option is selected and no explicit weight was provided in this update request,
        // use null so validateWeightInput derives it directly from the selected option instead of
        // keeping an outdated cartItem.weight from a previous option.
        const inputWeight = hasExplicitWeight ? weight : (hasWeightOption ? null : cartItem.weight);
        newWeight = (0, weightPricing_helper_1.validateWeightInput)(itemFood, inputWeight, selectedWeightOptions);
        if (hasWeightOption) {
            newQty = quantity !== undefined ? Math.max(1, Number(quantity)) : cartItem.quantity;
        }
        else {
            newQty = 1;
        }
    }
    else {
        newQty = quantity !== undefined ? Number(quantity) : cartItem.quantity;
    }
    // ─── Resolve addons ──────────────────────────────────────────────
    let safeAddons = [];
    if (requestAddons !== undefined) {
        safeAddons = Array.isArray(requestAddons) ? requestAddons : [];
    }
    else {
        const existingAddons = deepParseJSON(cartItem.addons);
        safeAddons = Array.isArray(existingAddons) ? existingAddons : [];
    }
    let addonSnapshot = [];
    if (safeAddons.length > 0) {
        const allowedAddonIds = Array.isArray(itemFood.addonsId) ? itemFood.addonsId : [];
        if (allowedAddonIds.length > 0) {
            for (const a of safeAddons) {
                if (!allowedAddonIds.includes(a.addonId))
                    throw new BadRequest_1.BadRequest(`Addon ${a.addonId} is not available for this food item`);
            }
        }
        const requestedAddonIds = safeAddons.map((a) => a.addonId);
        const dbAddons = await connection_1.db.select().from(schema_1.addons).where((0, drizzle_orm_1.inArray)(schema_1.addons.id, requestedAddonIds));
        for (const a of safeAddons) {
            const dbAddon = dbAddons.find(d => d.id === a.addonId);
            if (!dbAddon)
                throw new BadRequest_1.BadRequest(`Addon not found: ${a.addonId}`);
            if (dbAddon.status === "inactive")
                throw new BadRequest_1.BadRequest(`Addon "${dbAddon.name}" is currently unavailable`);
            addonSnapshot.push({ addonId: dbAddon.id, name: dbAddon.name, nameAr: dbAddon.nameAr, price: dbAddon.price });
        }
    }
    else if (requestAddons === undefined) {
        const existingAddonSnapshot = deepParseJSON(cartItem.addons);
        const addonsList = Array.isArray(existingAddonSnapshot) ? existingAddonSnapshot : [];
        addonSnapshot = addonsList.map((a) => ({ addonId: a.addonId, name: a.name, nameAr: a.nameAr, price: a.price }));
    }
    // ─── Calculate unit price via pricing engine ─────────────────────
    const optionIds = safeVariations.map((v) => v.optionId).filter(Boolean);
    const resolvedServiceModule = (serviceModule || cartItem.serviceModule);
    // let unitPrice: number;
    // if (resolvedBranchId && resolvedServiceModule) {
    const priceResult = await (0, pricing_helper_1.calculateCalculatedPrice)(cartItem.foodId, optionIds, resolvedBranchId || null, resolvedServiceModule || undefined);
    if (!priceResult.isAvailable) {
        throw new BadRequest_1.BadRequest("This item or one of its options is currently unavailable on this channel.");
    }
    const addonTotal = addonSnapshot.reduce((sum, a) => sum + Number(a.price || 0), 0);
    const unitPrice = priceResult.totalUnitPrice + addonTotal;
    // }else {
    //         let totalExtra = 0;
    //         for (const selected of safeVariations) {
    //             const [opt] = await db.select({ additionalPrice: variationOptions.additionalPrice }).from(variationOptions).where(eq(variationOptions.id, selected.optionId)).limit(1);
    //             totalExtra += Number(opt?.additionalPrice || 0);
    //         }
    //         const addonTotal = addonSnapshot.reduce((sum, a) => sum + Number(a.price || 0), 0);
    //         unitPrice = Number(itemFood.price) + totalExtra + addonTotal;
    //     }
    // ─── Build full variation snapshot with names from DB ───────────
    let variationSnapshotList = safeVariations;
    if (variations !== undefined && safeVariations.length > 0) {
        const allOptionIds = safeVariations.map((v) => v.optionId).filter(Boolean);
        const dbOptionsWithParent = allOptionIds.length > 0
            ? await connection_1.db
                .select({
                optionId: schema_1.variationOptions.id,
                optionName: schema_1.variationOptions.optionName,
                optionNameAr: schema_1.variationOptions.optionNameAr,
                optionNameFr: schema_1.variationOptions.optionNameFr,
                additionalPrice: schema_1.variationOptions.additionalPrice,
                priceMode: schema_1.variationOptions.priceMode,
                variationId: schema_1.foodVariations.id,
                variationName: schema_1.foodVariations.name,
                variationNameAr: schema_1.foodVariations.nameAr,
                variationNameFr: schema_1.foodVariations.nameFr,
                isWeightGroup: schema_1.foodVariations.isWeightGroup,
            })
                .from(schema_1.variationOptions)
                .leftJoin(schema_1.foodVariations, (0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, schema_1.foodVariations.id))
                .where((0, drizzle_orm_1.inArray)(schema_1.variationOptions.id, allOptionIds))
            : [];
        const optionDetailsMap = new Map(dbOptionsWithParent.map(o => [o.optionId, o]));
        variationSnapshotList = safeVariations.map((v) => {
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
                priceMode: (details?.priceMode ?? v.priceMode ?? "fixed"),
                isWeightGroup: Boolean(details?.isWeightGroup ?? v.isWeightGroup),
            };
        });
    }
    else if (variations === undefined) {
        const { variations: existingVars } = parseCartSnapshot(cartItem.variations);
        variationSnapshotList = existingVars;
    }
    // Refresh option prices with the channel/branch-resolved prices (same source as checkout).
    const resolvedOptionMap = new Map(priceResult.variants.map(r => [r.variantOptionId, r]));
    variationSnapshotList = variationSnapshotList.map((v) => {
        const resolved = resolvedOptionMap.get(v.optionId);
        if (!resolved)
            return v;
        const p = Number(resolved.price).toFixed(2);
        return { ...v, price: p, additionalPrice: p, priceMode: resolved.priceMode ?? v.priceMode ?? "fixed" };
    });
    for (const v of variationSnapshotList) {
        if (!isWeightedFood && v.priceMode === "per_weight") {
            throw new BadRequest_1.BadRequest("per_weight price_mode is only allowed on weight-based products");
        }
    }
    const unitPriceNumber = unitPrice;
    const unitPriceStr = isWeightedFood ? priceResult.basePrice.toFixed(2) : unitPriceNumber.toFixed(2);
    const weightedOptionExtras = [
        ...variationSnapshotList.map(v => ({ price: v.price || v.additionalPrice, priceMode: v.priceMode })),
        ...addonSnapshot.map(a => ({ price: a.price, priceMode: "fixed" })),
    ];
    let totalPriceStr;
    if (isWeightedFood) {
        totalPriceStr = (0, weightPricing_helper_1.computeWeightedLineTotal)(newWeight, unitPriceStr, weightedOptionExtras, newQty);
    }
    else {
        const priceCents = Math.round(unitPriceNumber * 100);
        totalPriceStr = ((priceCents * newQty) / 100).toFixed(2);
    }
    await connection_1.db.update(schema_1.cartItems)
        .set({
        quantity: newQty,
        weight: isWeightedFood ? newWeight.toFixed(3) : null,
        weightUnit: isWeightedFood ? itemFood.weight_unit : null,
        unitPrice: unitPriceStr,
        totalPrice: totalPriceStr,
        variations: JSON.stringify({ variations: variationSnapshotList }),
        addons: JSON.stringify(addonSnapshot),
        ...(resolvedBranchId ? { branchId: resolvedBranchId } : {}),
        ...(resolvedServiceModule ? { serviceModule: resolvedServiceModule } : {}),
        ...(note !== undefined ? { note: note || null } : {}),
    })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.id, cartItemId), (0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId)));
    // ─── First-order discount preview (registered users only) ────────
    const isGuestUserUpdate = Boolean(req.user?.isGuest);
    let firstOrderDiscountUpdate = null;
    if (!isGuestUserUpdate && cartItem.restaurantId) {
        // Recompute cart subtotal across all items for this restaurant
        const orderSource = (req.body?.orderSource || req.query?.orderSource);
        const cartSubtotalForFod = await sumStoredCartSubtotal(userId, cartItem.restaurantId);
        const fodResult = await (0, firstOrderDiscount_helper_1.resolveFirstOrderDiscount)(userId, cartItem.restaurantId, cartSubtotalForFod, orderSource);
        if (fodResult) {
            firstOrderDiscountUpdate = {
                discountId: fodResult.discount.id,
                name: fodResult.discount.name,
                nameAr: fodResult.discount.nameAr,
                nameFr: fodResult.discount.nameFr,
                discountType: fodResult.discount.discountType,
                discountValue: parseFloat(fodResult.discount.discountValue),
                discountAmount: fodResult.discountAmount,
                maxDiscountAmount: fodResult.discount.maxDiscountAmount
                    ? parseFloat(fodResult.discount.maxDiscountAmount)
                    : null,
                firstOrderCount: fodResult.discount.firstOrderCount,
            };
        }
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Cart updated successfully",
        data: {
            unitPrice,
            totalPrice: parseFloat(totalPriceStr),
            resolvedBranchId,
            serviceModule: resolvedServiceModule,
            firstOrderDiscount: firstOrderDiscountUpdate,
        },
    });
};
exports.updateCartItem = updateCartItem;
/* =========================================
   4. REMOVE ITEM
========================================= */
const removeCartItem = async (req, res) => {
    const userId = req.user?.id;
    const { cartItemId } = req.params;
    const [item] = await connection_1.db
        .select({
        id: schema_1.cartItems.id,
        restaurantId: schema_1.cartItems.restaurantId,
        weightRequestId: schema_1.cartItems.weightRequestId,
        weight: schema_1.cartItems.weight,
        addedBy: schema_1.cartItems.addedBy,
        offerId: schema_1.cartItems.offerId,
        soldBy: schema_1.food.sold_by,
    })
        .from(schema_1.cartItems)
        .leftJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.cartItems.foodId, schema_1.food.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.id, cartItemId), (0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId)))
        .limit(1);
    if (!item) {
        throw new NotFound_1.NotFound("Cart item not found");
    }
    // 🛡️ Weight-request cart rules (locked rows, weighted rows during an active request, frozen cart)
    (0, weightCart_helper_1.assertCartWriteAllowed)({
        kind: "remove",
        activeRequest: await (0, weightCart_helper_1.findActiveWeightRequest)(userId, item.restaurantId),
        targetIsWeightBound: !item.offerId && (0, weightCart_helper_1.isWeightBoundRow)(item, item.soldBy),
        rowWeightRequestId: item.weightRequestId,
    });
    await connection_1.db.delete(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.id, cartItemId), (0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId)));
    return (0, response_1.SuccessResponse)(res, {
        message: "The item has been removed from the cart",
    });
};
exports.removeCartItem = removeCartItem;
/* =========================================
   5. CLEAR CART
========================================= */
const clearCart = async (req, res) => {
    const userId = req.user?.id;
    const cartRows = await connection_1.db
        .select({ restaurantId: schema_1.cartItems.restaurantId, weightRequestId: schema_1.cartItems.weightRequestId })
        .from(schema_1.cartItems)
        .where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId));
    // 🛡️ Rejected while locked rows exist or a weight request is active / frozen.
    // (A cart only ever holds one restaurant, so the first row's restaurant is enough.)
    (0, weightCart_helper_1.assertCartWriteAllowed)({
        kind: "clear",
        activeRequest: cartRows.length ? await (0, weightCart_helper_1.findActiveWeightRequest)(userId, cartRows[0].restaurantId) : null,
        targetIsWeightBound: false,
        lockedRowRequestId: cartRows.find(r => r.weightRequestId)?.weightRequestId ?? null,
    });
    await connection_1.db.delete(schema_1.cartItems)
        .where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId));
    return (0, response_1.SuccessResponse)(res, {
        message: "The cart has been cleared successfully",
    });
};
exports.clearCart = clearCart;
/* =========================================
   6. VALIDATE CART PRICING
   POST /api/cart/validate-pricing
========================================= */
const validateCartPricing = async (req, res) => {
    const userId = req.user?.id;
    const { restaurantId, serviceModule, branchId, addressId, } = req.body;
    if (!userId)
        throw new BadRequest_1.BadRequest("User authentication required.");
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("restaurantId is required.");
    if (!serviceModule || !["takeaway", "dine_in", "delivery"].includes(serviceModule)) {
        throw new BadRequest_1.BadRequest("serviceModule must be one of: takeaway, dine_in, delivery.");
    }
    if (!branchId && !addressId) {
        throw new BadRequest_1.BadRequest("Either branchId or addressId is required.");
    }
    if (serviceModule === "delivery" && !branchId && !addressId) {
        throw new BadRequest_1.BadRequest("addressId or branchId is required for delivery orders.");
    }
    const userCartItems = await connection_1.db
        .select()
        .from(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.restaurantId, restaurantId)));
    if (userCartItems.length === 0) {
        throw new BadRequest_1.BadRequest("Cart is empty for this restaurant.");
    }
    let resolvedBranchId;
    if (branchId) {
        const [br] = await connection_1.db
            .select({ id: schema_1.branches.id })
            .from(schema_1.branches)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.id, branchId), (0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")))
            .limit(1);
        if (!br)
            throw new BadRequest_1.BadRequest("Provided branchId is invalid or inactive.");
        resolvedBranchId = br.id;
    }
    else {
        resolvedBranchId = await (0, pricing_helper_1.resolveBranchIdFromAddress)(addressId, restaurantId);
    }
    let oldSubtotal = 0;
    let newSubtotal = 0;
    let isPriceChanged = false;
    let hasUnavailableItems = false;
    const itemResults = [];
    for (const item of userCartItems) {
        if (item.offerId) {
            const [offer] = await connection_1.db.select().from(schema_1.offers).where((0, drizzle_orm_1.eq)(schema_1.offers.id, item.offerId)).limit(1);
            const now = new Date();
            const isAvailable = !!offer && offer.status === "active" && new Date(offer.startDate) <= now && new Date(offer.endDate) >= now;
            const currentOfferPrice = offer ? parseFloat(offer.price) : Number(item.unitPrice || 0);
            const storedUnitPrice = Number(item.unitPrice || 0);
            const priceChanged = Math.abs(currentOfferPrice - storedUnitPrice) > 0.001;
            if (priceChanged)
                isPriceChanged = true;
            if (!isAvailable)
                hasUnavailableItems = true;
            const oldTotal = storedUnitPrice * item.quantity;
            const newTotal = currentOfferPrice * item.quantity;
            oldSubtotal += oldTotal;
            newSubtotal += newTotal;
            itemResults.push({
                cartItemId: item.id,
                foodId: item.foodId,
                offerId: item.offerId,
                quantity: item.quantity,
                isAvailable,
                priceChanged,
                oldUnitPrice: storedUnitPrice,
                newUnitPrice: currentOfferPrice,
                totalItemPrice: newTotal,
            });
            continue;
        }
        const foodId = item.foodId;
        const quantity = item.quantity;
        const storedUnitPrice = Number(item.unitPrice || 0);
        const { variations: parsedVariations } = parseCartSnapshot(item.variations);
        const parsedAddons = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];
        const optionIds = extractOptionIds(parsedVariations);
        const addonTotal = parsedAddons.reduce((s, a) => s + Number(a.price || 0), 0);
        const priceResult = await (0, pricing_helper_1.calculateCalculatedPrice)(foodId, optionIds, resolvedBranchId, serviceModule);
        // Weighted rows: unit_price is the base price per weight unit, and the line total
        // depends on the weight (+ fixed / per_weight extras).
        const isWeightedRow = item.weight != null;
        const newCalculatedUnitPrice = isWeightedRow ? priceResult.basePrice : priceResult.totalUnitPrice + addonTotal;
        const basePriceChanged = Math.abs(newCalculatedUnitPrice - storedUnitPrice) > 0.001;
        const itemIsAvailable = priceResult.isAvailable;
        if (basePriceChanged)
            isPriceChanged = true;
        if (!itemIsAvailable)
            hasUnavailableItems = true;
        let oldTotal = storedUnitPrice * quantity;
        let newTotal = newCalculatedUnitPrice * quantity;
        if (isWeightedRow) {
            const w = item.finalWeight ?? item.weight;
            const extras = [
                ...parsedVariations.map((v) => {
                    const r = priceResult.variants.find(x => x.variantOptionId === v.optionId);
                    return { price: r?.price ?? Number(v.price ?? v.additionalPrice ?? 0), priceMode: r?.priceMode ?? v.priceMode ?? "fixed" };
                }),
                ...parsedAddons.map((a) => ({ price: Number(a.price || 0), priceMode: "fixed" })),
            ];
            oldTotal = parseFloat(item.totalPrice || "0");
            newTotal = (0, weightCart_helper_1.weightedLineTotal)(w, newCalculatedUnitPrice, extras, [], quantity);
        }
        if (item.isUnavailable) {
            oldTotal = 0;
            newTotal = 0;
        }
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
exports.validateCartPricing = validateCartPricing;
