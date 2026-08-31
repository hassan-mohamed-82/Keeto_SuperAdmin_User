"use strict";
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
    const [itemFood] = await connection_1.db.select().from(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.id, foodId)).limit(1);
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
        // Verify geo-resolved branch is active
        const [br] = await connection_1.db
            .select({ id: schema_1.branches.id })
            .from(schema_1.branches)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.id, resolvedBranchId), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")))
            .limit(1);
        if (!br)
            throw new BadRequest_1.BadRequest("Resolved delivery branch is inactive.");
    }
    if (resolvedBranchId && branchId) {
        // Verify manually-passed branchId
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
    // Validate cross-branch consistency
    if (resolvedBranchId && existingCart.length > 0 && existingCart[0].branchId && existingCart[0].branchId !== resolvedBranchId) {
        throw new BadRequest_1.BadRequest("All cart items must belong to the same branch. Please clear your cart before adding items from a different branch.");
    }
    // ─── Validate variation options ──────────────────────────────────
    const dbVariations = await connection_1.db
        .select()
        .from(schema_1.foodVariations)
        .where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, foodId));
    // Mandatory variations check
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
    let unitPrice;
    if (resolvedBranchId && resolvedServiceModule) {
        const priceResult = await (0, pricing_helper_1.calculateCalculatedPrice)(foodId, optionIds, resolvedBranchId, resolvedServiceModule);
        if (!priceResult.isAvailable) {
            throw new BadRequest_1.BadRequest("This item or one of its options is currently unavailable on this channel.");
        }
        // Addons are not covered by channel pricing — add them on top
        const addonTotal = addonSnapshot.reduce((sum, a) => sum + Number(a.price || 0), 0);
        unitPrice = priceResult.totalUnitPrice + addonTotal;
    }
    else {
        // Fallback: no channel context — use base food price + variant additionalPrice
        const basePrice = Number(itemFood.price);
        const varExtra = safeVariations.reduce(async (sumPromise, selected) => {
            return sumPromise;
        }, Promise.resolve(0));
        let totalExtra = 0;
        for (const selected of safeVariations) {
            const [opt] = await connection_1.db.select({ additionalPrice: schema_1.variationOptions.additionalPrice }).from(schema_1.variationOptions).where((0, drizzle_orm_1.eq)(schema_1.variationOptions.id, selected.optionId)).limit(1);
            totalExtra += Number(opt?.additionalPrice || 0);
        }
        const addonTotal = addonSnapshot.reduce((sum, a) => sum + Number(a.price || 0), 0);
        unitPrice = basePrice + totalExtra + addonTotal;
    }
    // ─── Dedup existing cart item ────────────────────────────────────
    const normalizedVariationsList = normalizeVariations(safeVariations);
    const normalizedAddonsList = normalizeAddons(addonSnapshot);
    const key = JSON.stringify({ variations: normalizedVariationsList, addons: normalizedAddonsList });
    const snapshot = { variations: normalizedVariationsList };
    const existingItems = await connection_1.db.select().from(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.foodId, foodId)));
    const existingSame = existingItems.find(item => {
        const { variations: dbVars } = parseCartSnapshot(item.variations);
        const dbAddonsParsed = deepParseJSON(item.addons);
        const normalizedDbAddons = normalizeAddons(Array.isArray(dbAddonsParsed) ? dbAddonsParsed : []);
        const existingKey = JSON.stringify({
            variations: normalizeVariations(dbVars),
            addons: normalizedDbAddons,
        });
        return existingKey === key;
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
        .leftJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.cartItems.foodId, schema_1.food.id))
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
    // ─── Optimization: Fetch Variations & Options in Batch ──────────
    const allVariationIds = new Set();
    const allOptionIds = new Set();
    const parsedItemsData = availableCartItems.map(item => {
        const { variations: parsedVariations } = parseCartSnapshot(item.variations);
        const parsedAddons = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];
        parsedVariations.forEach((v) => {
            if (v.variationId)
                allVariationIds.add(v.variationId);
            if (v.optionId)
                allOptionIds.add(v.optionId);
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
                liveUnitPrice = null;
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
        const variationDetails = parsedVariations.map((v) => {
            const variation = variationsMap.get(v.variationId);
            const option = optionsMap.get(v.optionId);
            if (!variation || !option)
                return null;
            return {
                variationId: variation.id,
                variationName: variation.name,
                variationNameAr: variation.nameAr,
                optionId: option.id,
                optionName: option.optionName,
                optionNameAr: option.optionNameAr,
                additionalPrice: option.additionalPrice,
            };
        }).filter(Boolean);
        const addonDetails = parsedAddons.map((a) => ({
            addonId: a.addonId,
            name: a.name,
            nameAr: a.nameAr,
            price: a.price,
        }));
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
            isAvailable: channelAvailable,
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
// export const getCart = async (req: Request | any, res: Response) => {
//     const userId = req.user?.id;
//     const queryRestaurantId = req.query.restaurantId as string | undefined;
//     const branchId = req.query.branchId as string | undefined;
//     const addressId = req.query.addressId as string | undefined;
//     const serviceModule = req.query.serviceModule as ServiceModule | undefined;
//     const conditions = [eq(cartItems.userId, userId)];
//     if (queryRestaurantId) {
//         conditions.push(eq(cartItems.restaurantId, queryRestaurantId));
//     }
//     const items = await db
//         .select({
//             cartId: cartItems.id,
//             foodId: food.id,
//             name: food.name,
//             nameAr: food.nameAr,
//             nameFr: food.nameFr,
//             description: food.description,
//             descriptionAr: food.descriptionAr,
//             descriptionFr: food.descriptionFr,
//             image: food.image,
//             price: food.price,
//             discountType: food.discount_type,
//             discountValue: food.discount_value,
//             isOutOfStock: food.isOutOfStock,
//             status: food.status,
//             restaurantId: restaurants.id,
//             restaurantName: restaurants.name,
//             quantity: cartItems.quantity,
//             unitPrice: cartItems.unitPrice,
//             totalPrice: cartItems.totalPrice,
//             variations: cartItems.variations,
//             addons: cartItems.addons,
//             note: cartItems.note,
//             storedBranchId: cartItems.branchId,
//             storedServiceModule: cartItems.serviceModule,
//             subcategoryId: food.subcategoryid,
//         })
//         .from(cartItems)
//         .leftJoin(food, eq(cartItems.foodId, food.id))
//         .leftJoin(restaurants, eq(cartItems.restaurantId, restaurants.id))
//         .where(and(...conditions));
//     if (items.length === 0) {
//         return SuccessResponse(res, { data: { items: [], unavailableItems: [], hasUnavailableItems: false, totalSummary: { subtotal: 0 } } });
//     }
//     const restaurantId = items[0].restaurantId;
//     // ─── Resolve active branch for this request ──────────────────────
//     let targetBranchId: string | undefined = undefined;
//     if (branchId || addressId) {
//         targetBranchId = (await resolveBranchIdForCart(branchId, addressId, restaurantId || undefined)) || undefined;
//     }
//     // ─── Classic availability check (ingredient locks + branchMenuItems) ─
//     const allFoodIds = items.map(i => i.foodId).filter((id): id is string => id !== null && id !== undefined);
//     const unavailableMap = allFoodIds.length > 0
//         ? await getUnavailableBranchesForFoods(allFoodIds)
//         : new Map<string, BranchInfo[]>();
//     // ─── Branch-subcategory availability check ────────────────────────
//     // Fetch all subcategoryIds that are explicitly set to "inactive" for this branch
//     const inactiveSubcategoryIds = new Set<string>();
//     if (targetBranchId) {
//         const inactiveRows = await db
//             .select({ subcategoryId: branchSubcategories.subcategoryId })
//             .from(branchSubcategories)
//             .where(and(
//                 eq(branchSubcategories.branchId, targetBranchId),
//                 eq(branchSubcategories.status, "inactive")
//             ));
//         for (const row of inactiveRows) {
//             inactiveSubcategoryIds.add(row.subcategoryId);
//         }
//     }
//     let availableCartItems: typeof items = [];
//     let unavailableCartItemsData: Array<typeof items[number] & { unavailableReason: string }> = [];
//     for (const item of items) {
//         const isGeneralUnavailable = Boolean(item.isOutOfStock) || item.status === "inactive";
//         const unavailableBranches = item.foodId ? (unavailableMap.get(item.foodId) || []) : [];
//         const isBranchUnavailable = Boolean(targetBranchId && unavailableBranches.some(b => b.id === targetBranchId));
//         const isSubcategoryInactive = Boolean(
//             targetBranchId &&
//             item.subcategoryId &&
//             inactiveSubcategoryIds.has(item.subcategoryId)
//         );
//         if (isGeneralUnavailable || isBranchUnavailable || isSubcategoryInactive) {
//             const reason = isGeneralUnavailable
//                 ? "Out of stock or inactive"
//                 : isSubcategoryInactive
//                     ? "This item's category is not available at the selected branch"
//                     : "Not available at the selected branch";
//             unavailableCartItemsData.push({ ...item, unavailableReason: reason });
//         } else {
//             availableCartItems.push(item);
//         }
//     }
//     // ─── Build initial subtotal for discount calculation ─────────────
//     let initialSubtotal = 0;
//     const itemsData = availableCartItems.map(item => {
//         const originalBasePrice = parseFloat(item.price as string || "0");
//         const { variations: parsedVariations } = parseCartSnapshot(item.variations);
//         const parsedAddonsParsed = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];
//         let initialDiscountPrice = originalBasePrice;
//         if (item.discountType && Number(item.discountValue) > 0) {
//             if (item.discountType === "percentage") {
//                 initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(item.discountValue) / 100));
//             } else if (item.discountType === "amount" || (item.discountType as any) === "fixed") {
//                 initialDiscountPrice = Math.max(0, originalBasePrice - Number(item.discountValue));
//             }
//         }
//         const dbUnitPrice = parseFloat(item.unitPrice as string || "0");
//         const varPrice = dbUnitPrice - originalBasePrice;
//         initialSubtotal += (initialDiscountPrice + varPrice) * item.quantity;
//         return { item, originalBasePrice, varPrice, parsedVariations, parsedAddons: parsedAddonsParsed };
//     });
//     const availableDiscounts = await getAvailableDiscounts(restaurantId!);
//     const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };
//     let finalSubtotal = 0;
//     const formattedAvailableItems = await Promise.all(
//         itemsData.map(async (data: any) => {
//             const { item, originalBasePrice, varPrice, parsedVariations, parsedAddons } = data;
//             // ─── Channel pricing live reprice (if context is stored or passed) ──
//             const effectiveBranchId = targetBranchId || item.storedBranchId || undefined;
//             const effectiveServiceModule = (serviceModule || item.storedServiceModule) as ServiceModule | undefined;
//             let liveUnitPrice: number | null = null;
//             let priceChanged = false;
//             let channelAvailable = true;
//             if (effectiveBranchId && effectiveServiceModule && item.foodId) {
//                 try {
//                     const optionIds = extractOptionIds(parsedVariations);
//                     const livePrice = await calculateCalculatedPrice(
//                         item.foodId,
//                         optionIds,
//                         effectiveBranchId,
//                         effectiveServiceModule
//                     );
//                     const addonTotal = parsedAddons.reduce((s: number, a: any) => s + Number(a.price || 0), 0);
//                     const computedLivePrice = livePrice.totalUnitPrice + addonTotal;
//                     liveUnitPrice = computedLivePrice;
//                     channelAvailable = livePrice.isAvailable;
//                     const storedUnit = parseFloat(item.unitPrice as string || "0");
//                     priceChanged = Math.abs(computedLivePrice - storedUnit) > 0.001;
//                 } catch {
//                     // Pricing engine error → fall back to stored price gracefully
//                     liveUnitPrice = null;
//                 }
//             }
//             // ─── Variation details ─────────────────────────────────────────
//             const variationDetails: any[] = [];
//             for (const v of parsedVariations) {
//                 if (!v.variationId || !v.optionId) continue;
//                 const [variation] = await db.select().from(foodVariations).where(eq(foodVariations.id, v.variationId)).limit(1);
//                 const [option] = await db.select().from(variationOptions).where(eq(variationOptions.id, v.optionId)).limit(1);
//                 if (variation && option) {
//                     variationDetails.push({
//                         variationId: variation.id,
//                         variationName: variation.name,
//                         variationNameAr: variation.nameAr,
//                         optionId: option.id,
//                         optionName: option.optionName,
//                         optionNameAr: option.optionNameAr,
//                         additionalPrice: option.additionalPrice,
//                     });
//                 }
//             }
//             const addonDetails = parsedAddons.map((a: any) => ({
//                 addonId: a.addonId,
//                 name: a.name,
//                 nameAr: a.nameAr,
//                 price: a.price,
//             }));
//             // ─── Discount ──────────────────────────────────────────────────
//             const baseForDiscount = liveUnitPrice !== null ? liveUnitPrice - varPrice : originalBasePrice;
//             const { price: discountedBasePrice } = applyPriorityDiscount(
//                 { id: item.foodId, discountType: item.discountType, discountValue: item.discountValue },
//                 baseForDiscount,
//                 initialSubtotal,
//                 availableDiscounts,
//                 discountState,
//                 true
//             );
//             const finalUnitPrice = liveUnitPrice !== null ? liveUnitPrice : discountedBasePrice + varPrice;
//             const finalTotalPrice = finalUnitPrice * item.quantity;
//             finalSubtotal += finalTotalPrice;
//             return {
//                 cartId: item.cartId,
//                 foodId: item.foodId,
//                 name: item.name,
//                 nameAr: item.nameAr,
//                 nameFr: item.nameFr,
//                 description: item.description,
//                 descriptionAr: item.descriptionAr,
//                 descriptionFr: item.descriptionFr,
//                 discountType: item.discountType,
//                 discountValue: item.discountValue,
//                 image: item.image,
//                 restaurantId: item.restaurantId,
//                 restaurantName: item.restaurantName,
//                 quantity: item.quantity,
//                 price: (originalBasePrice + varPrice).toString(),
//                 unitPrice: finalUnitPrice,
//                 totalPrice: finalTotalPrice,
//                 variations: variationDetails,
//                 addons: addonDetails,
//                 note: item.note || null,
//                 isAvailable: channelAvailable,
//                 priceChanged,
//                 resolvedBranchId: effectiveBranchId || null,
//                 serviceModule: effectiveServiceModule || null,
//             };
//         })
//     );
//     const formattedUnavailableItems = unavailableCartItemsData.map(item => {
//         const { variations: parsedVariations } = parseCartSnapshot(item.variations);
//         const parsedAddonsParsed = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];
//         return {
//             cartId: item.cartId,
//             foodId: item.foodId,
//             name: item.name,
//             nameAr: item.nameAr,
//             image: item.image,
//             quantity: item.quantity,
//             variations: parsedVariations,
//             addons: parsedAddonsParsed,
//             isAvailable: false,
//             reason: item.unavailableReason,
//         };
//     });
//     // ─── Free Delivery Offer check ────────────────────────────────────
//     const now = new Date();
//     const [freeDeliveryOffer] = await db
//         .select()
//         .from(freeDeliveryOffers)
//         .where(and(eq(freeDeliveryOffers.restaurantId, restaurantId!), eq(freeDeliveryOffers.status, "active")))
//         .limit(1);
//     let freeDeliveryInfo: { isEligible: boolean; minOrderAmount: number; remainingAmount: number } | null = null;
//     if (freeDeliveryOffer) {
//         const startOk = !freeDeliveryOffer.startDate || new Date(freeDeliveryOffer.startDate) <= now;
//         const endOk = !freeDeliveryOffer.endDate || new Date(freeDeliveryOffer.endDate) >= now;
//         if (startOk && endOk) {
//             const minAmount = parseFloat(freeDeliveryOffer.minOrderAmount as string || "0");
//             const isEligible = finalSubtotal >= minAmount;
//             freeDeliveryInfo = {
//                 isEligible,
//                 minOrderAmount: minAmount,
//                 remainingAmount: isEligible ? 0 : parseFloat((minAmount - finalSubtotal).toFixed(2)),
//             };
//         }
//     }
//     return SuccessResponse(res, {
//         message: "Cart fetched successfully",
//         data: {
//             items: formattedAvailableItems,
//             unavailableItems: formattedUnavailableItems,
//             hasUnavailableItems: formattedUnavailableItems.length > 0 || formattedAvailableItems.some(i => !i.isAvailable),
//             hasPriceChanges: formattedAvailableItems.some(i => i.priceChanged),
//             totalSummary: {
//                 subtotal: finalSubtotal,
//                 freeDelivery: freeDeliveryInfo,
//             },
//         },
//     });
// };
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
    const [itemFood] = await connection_1.db.select().from(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.id, cartItem.foodId)).limit(1);
    if (!itemFood)
        throw new BadRequest_1.BadRequest("Food item not found");
    // 🛡️ Check if food is out of stock or inactive
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
    // Validate availability via legacy ingredient/menu-lock check
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
    let unitPrice;
    if (resolvedBranchId && resolvedServiceModule) {
        const priceResult = await (0, pricing_helper_1.calculateCalculatedPrice)(cartItem.foodId, optionIds, resolvedBranchId, resolvedServiceModule);
        if (!priceResult.isAvailable) {
            throw new BadRequest_1.BadRequest("This item or one of its options is currently unavailable on this channel.");
        }
        const addonTotal = addonSnapshot.reduce((sum, a) => sum + Number(a.price || 0), 0);
        unitPrice = priceResult.totalUnitPrice + addonTotal;
    }
    else {
        // Fallback: no channel context
        let totalExtra = 0;
        for (const selected of safeVariations) {
            const [opt] = await connection_1.db.select({ additionalPrice: schema_1.variationOptions.additionalPrice }).from(schema_1.variationOptions).where((0, drizzle_orm_1.eq)(schema_1.variationOptions.id, selected.optionId)).limit(1);
            totalExtra += Number(opt?.additionalPrice || 0);
        }
        const addonTotal = addonSnapshot.reduce((sum, a) => sum + Number(a.price || 0), 0);
        unitPrice = Number(itemFood.price) + totalExtra + addonTotal;
    }
    const qty = quantity ?? cartItem.quantity;
    await connection_1.db.update(schema_1.cartItems)
        .set({
        quantity: qty,
        unitPrice: unitPrice.toString(),
        totalPrice: (unitPrice * qty).toString(),
        variations: JSON.stringify({ variations: safeVariations }),
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
    // ─── Input validation ─────────────────────────────────────────────
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
    // ─── Fetch User Cart Items from DB ────────────────────────────────
    const userCartItems = await connection_1.db
        .select()
        .from(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.restaurantId, restaurantId)));
    if (userCartItems.length === 0) {
        throw new BadRequest_1.BadRequest("Cart is empty for this restaurant.");
    }
    // ─── Resolve branch ───────────────────────────────────────────────
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
    // ─── Process each item from Database ──────────────────────────────
    let oldSubtotal = 0;
    let newSubtotal = 0;
    let isPriceChanged = false;
    let hasUnavailableItems = false;
    const itemResults = [];
    for (const item of userCartItems) {
        const foodId = item.foodId;
        const quantity = item.quantity;
        const storedUnitPrice = Number(item.unitPrice || 0);
        // فك تفاصيل الـ Variations والـ Addons من snapshot الـ Cart
        const { variations: parsedVariations } = parseCartSnapshot(item.variations);
        const parsedAddons = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];
        const optionIds = extractOptionIds(parsedVariations);
        const addonTotal = parsedAddons.reduce((s, a) => s + Number(a.price || 0), 0);
        // حساب السعر الحالي المباشر للفرع والقناة
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
