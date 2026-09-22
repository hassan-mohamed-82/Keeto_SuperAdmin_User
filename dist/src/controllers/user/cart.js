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
const uuid_1 = require("uuid");
const discount_1 = require("../../utils/discount");
const userBlockCheck_1 = require("../../utils/userBlockCheck");
const food_helper_1 = require("../../helpers/food.helper");
const cart_helper_1 = require("../../helpers/cart.helper");
const pricing_helper_1 = require("../../helpers/pricing.helper");
const foodConditions_1 = require("../../helpers/foodConditions");
/* =========================================
   Helpers
========================================= */
const normalizeVariations = (variations) => {
    const safe = Array.isArray(variations) ? variations : [];
    return safe
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
/** Extract all variantOptionIds from a parsed variations snapshot */
const extractOptionIds = (parsedVariations) => parsedVariations
    .map((v) => v.optionId)
    .filter(Boolean);
/* =========================================
   1. ADD TO CART
========================================= */
const addToCart = async (req, res) => {
    const userId = req.user?.id;
    const { foodId, quantity = 1, variations = [], addons: requestAddons = [], note, branchId, addressId, serviceModule, } = req.body;
    const safeVariations = Array.isArray(variations) ? variations : [];
    const safeAddons = Array.isArray(requestAddons) ? requestAddons : [];
    const [itemFood] = await connection_1.db.select().from(schema_1.food).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.id, foodId), foodConditions_1.activeFoodCondition)).limit(1);
    if (!itemFood)
        throw new BadRequest_1.BadRequest("Food not found");
    // 🛡️ Block check
    await (0, userBlockCheck_1.validateUserNotBlocked)(userId, itemFood.restaurantid);
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
    for (const selected of safeVariations) {
        const validDbVariation = dbVariations.find(v => v.id === selected.variationId);
        if (!validDbVariation)
            throw new BadRequest_1.BadRequest(`Invalid variation ID sent: ${selected.variationId}`);
        if (validDbVariation.status === false)
            throw new BadRequest_1.BadRequest(`Variation ${validDbVariation.name} is currently unavailable`);
        const dbOptions = await connection_1.db
            .select()
            .from(schema_1.variationOptions)
            .where((0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, validDbVariation.id));
        const foundOption = dbOptions.find(o => o.id === selected.optionId);
        if (!foundOption)
            throw new BadRequest_1.BadRequest(`Invalid option selected for variation: ${validDbVariation.name}`);
        if (foundOption.status === false)
            throw new BadRequest_1.BadRequest(`Option ${foundOption.optionName} is currently unavailable`);
    }
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
                variationId: schema_1.foodVariations.id,
                variationName: schema_1.foodVariations.name,
                variationNameAr: schema_1.foodVariations.nameAr,
                variationNameFr: schema_1.foodVariations.nameFr,
            })
                .from(schema_1.variationOptions)
                .leftJoin(schema_1.foodVariations, (0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, schema_1.foodVariations.id))
                .where((0, drizzle_orm_1.inArray)(schema_1.variationOptions.id, allOptionIds))
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
    const makeDedupeKey = (vars, addonsList) => JSON.stringify({
        variations: vars.map(v => v.optionId).sort(),
        addons: addonsList.map(a => a.addonId).sort(),
    });
    const key = makeDedupeKey(normalizedVariationsList, normalizedAddonsList);
    const snapshot = { variations: variationSnapshotList };
    const existingItems = await connection_1.db.select().from(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.foodId, foodId)));
    const existingSame = existingItems.find(item => {
        const { variations: dbVars } = parseCartSnapshot(item.variations);
        const dbAddonsParsed = deepParseJSON(item.addons);
        const dbAddonsList = Array.isArray(dbAddonsParsed) ? dbAddonsParsed : [];
        return makeDedupeKey(normalizeVariations(dbVars), normalizeAddons(dbAddonsList)) === key;
    });
    if (existingSame) {
        const newQty = existingSame.quantity + quantity;
        await connection_1.db.update(schema_1.cartItems)
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
            .where((0, drizzle_orm_1.eq)(schema_1.cartItems.id, existingSame.id));
    }
    else {
        await connection_1.db.insert(schema_1.cartItems).values({
            id: (0, uuid_1.v4)(),
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
    return (0, response_1.SuccessResponse)(res, {
        message: "Added to cart successfully",
        data: {
            unitPrice,
            totalPrice: unitPrice * quantity,
            resolvedBranchId,
            serviceModule: resolvedServiceModule,
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
    // ─── Availability checks ──────────────────────────────────────────
    const allFoodIds = items.map(i => i.foodId).filter((id) => id !== null && id !== undefined);
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
    let unavailableCartItemsData = [];
    for (const item of items) {
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
    let initialSubtotal = 0;
    const itemsPrepped = await Promise.all(parsedItemsData.map(async (data) => {
        const { item, parsedVariations, parsedAddons } = data;
        const originalBasePrice = parseFloat(item.price || "0");
        const dbUnitPrice = parseFloat(item.unitPrice || "0");
        const varPrice = dbUnitPrice - originalBasePrice;
        const effectiveBranchId = targetBranchId || item.storedBranchId || undefined;
        const effectiveServiceModule = (serviceModule || item.storedServiceModule);
        let liveUnitPrice = null;
        let priceChanged = false;
        let channelAvailable = true;
        const branchPrices = [];
        // 1️⃣ حالة تحديد فرع محدد (Direct Branch Pricing)
        if (effectiveBranchId && item.foodId) {
            try {
                const optionIds = extractOptionIds(parsedVariations);
                const livePrice = await (0, pricing_helper_1.calculateCalculatedPrice)(item.foodId, optionIds, effectiveBranchId, effectiveServiceModule);
                const addonTotal = parsedAddons.reduce((s, a) => s + Number(a.price || 0), 0);
                const computedLivePrice = livePrice.totalUnitPrice + addonTotal;
                liveUnitPrice = computedLivePrice;
                channelAvailable = livePrice.isAvailable;
                priceChanged = Math.abs(computedLivePrice - dbUnitPrice) > 0.001;
            }
            catch {
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
            const addonTotal = parsedAddons.reduce((s, a) => s + Number(a.price || 0), 0);
            const branchPriceResults = await Promise.allSettled(activeRestaurantBranches.map(async (b) => {
                const bPrice = await (0, pricing_helper_1.calculateCalculatedPrice)(item.foodId, optionIds, b.id, effectiveServiceModule);
                return { branch: b, bPrice };
            }));
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
    const availableDiscounts = await (0, discount_1.getAvailableDiscounts)(restaurantId);
    const discountState = { remainingMaxDiscounts: new Map(), appliedDiscounts: new Set() };
    let finalSubtotal = 0;
    let totalOriginalSubtotal = 0;
    let totalDiscountAmount = 0;
    const formattedAvailableItems = itemsPrepped.map(data => {
        const { item, originalBasePrice, varPrice, currentBasePrice, liveUnitPrice, priceChanged, channelAvailable, branchPrices, effectiveBranchId, effectiveServiceModule, parsedVariations, parsedAddons } = data;
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
                price: dbAddon.price,
                isAvailable: true,
            };
        });
        const itemIsAvailable = channelAvailable && !hasUnresolvedVariation && !hasUnresolvedAddon;
        // Apply Priority Discount on current base price
        const discountResult = (0, discount_1.applyPriorityDiscount)({
            id: item.foodId ?? "",
            discountType: item.discountType,
            discountValue: item.discountValue
        }, currentBasePrice, initialSubtotal, availableDiscounts, discountState, true);
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
    const [freeDeliveryOffer] = await connection_1.db
        .select()
        .from(schema_1.freeDeliveryOffers)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.freeDeliveryOffers.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.freeDeliveryOffers.status, "active")))
        .limit(1);
    let freeDeliveryInfo = null;
    if (freeDeliveryOffer) {
        const startOk = !freeDeliveryOffer.startDate || new Date(freeDeliveryOffer.startDate) <= now;
        const endOk = !freeDeliveryOffer.endDate || new Date(freeDeliveryOffer.endDate) >= now;
        if (startOk && endOk) {
            const minAmount = parseFloat(freeDeliveryOffer.minOrderAmount || "0");
            const isEligible = finalSubtotal >= minAmount;
            freeDeliveryInfo = {
                isEligible,
                minOrderAmount: minAmount,
                remainingAmount: isEligible ? 0 : parseFloat((minAmount - finalSubtotal).toFixed(2)),
            };
        }
    }
    return (0, response_1.SuccessResponse)(res, {
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
exports.getCart = getCart;
/* =========================================
   3. UPDATE CART ITEM
========================================= */
const updateCartItem = async (req, res) => {
    const userId = req.user?.id;
    const { cartItemId } = req.params;
    const { quantity, variations, addons: requestAddons, note, branchId, addressId, serviceModule } = req.body;
    const [cartItem] = await connection_1.db
        .select()
        .from(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.id, cartItemId), (0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId)))
        .limit(1);
    if (!cartItem)
        throw new BadRequest_1.BadRequest("Cart item not found");
    // 🛡️ Block check
    await (0, userBlockCheck_1.validateUserNotBlocked)(userId, cartItem.restaurantId);
    const [itemFood] = await connection_1.db.select().from(schema_1.food).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.id, cartItem.foodId), foodConditions_1.activeFoodCondition)).limit(1);
    if (!itemFood)
        throw new BadRequest_1.BadRequest("Food item not found");
    if (!itemFood)
        throw new BadRequest_1.BadRequest("Food not found");
    if (itemFood.isOutOfStock || itemFood.status === "inactive") {
        throw new BadRequest_1.BadRequest("This item is currently out of stock.");
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
    for (const selected of safeVariations) {
        const validDbVariation = dbVariations.find(v => v.id === selected.variationId);
        if (!validDbVariation)
            throw new BadRequest_1.BadRequest("Invalid variation ID");
        if (validDbVariation.status === false)
            throw new BadRequest_1.BadRequest(`Variation ${validDbVariation.name} is currently unavailable`);
        const dbOptions = await connection_1.db.select().from(schema_1.variationOptions).where((0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, validDbVariation.id));
        const foundOption = dbOptions.find(o => o.id === selected.optionId);
        if (!foundOption)
            throw new BadRequest_1.BadRequest("Invalid option selected");
        if (foundOption.status === false)
            throw new BadRequest_1.BadRequest(`Option ${foundOption.optionName} is currently unavailable`);
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
                variationId: schema_1.foodVariations.id,
                variationName: schema_1.foodVariations.name,
                variationNameAr: schema_1.foodVariations.nameAr,
                variationNameFr: schema_1.foodVariations.nameFr,
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
            };
        });
    }
    else if (variations === undefined) {
        const { variations: existingVars } = parseCartSnapshot(cartItem.variations);
        variationSnapshotList = existingVars;
    }
    const qty = quantity ?? cartItem.quantity;
    await connection_1.db.update(schema_1.cartItems)
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
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.id, cartItemId), (0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId)));
    return (0, response_1.SuccessResponse)(res, {
        message: "Cart updated successfully",
        data: {
            unitPrice,
            totalPrice: unitPrice * qty,
            resolvedBranchId,
            serviceModule: resolvedServiceModule,
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
        const foodId = item.foodId;
        const quantity = item.quantity;
        const storedUnitPrice = Number(item.unitPrice || 0);
        const { variations: parsedVariations } = parseCartSnapshot(item.variations);
        const parsedAddons = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];
        const optionIds = extractOptionIds(parsedVariations);
        const addonTotal = parsedAddons.reduce((s, a) => s + Number(a.price || 0), 0);
        const priceResult = await (0, pricing_helper_1.calculateCalculatedPrice)(foodId, optionIds, resolvedBranchId, serviceModule);
        const newCalculatedUnitPrice = priceResult.totalUnitPrice + addonTotal;
        const basePriceChanged = Math.abs(newCalculatedUnitPrice - storedUnitPrice) > 0.001;
        const itemIsAvailable = priceResult.isAvailable;
        if (basePriceChanged)
            isPriceChanged = true;
        if (!itemIsAvailable)
            hasUnavailableItems = true;
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
exports.validateCartPricing = validateCartPricing;
