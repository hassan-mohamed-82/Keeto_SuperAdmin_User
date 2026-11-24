"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateCartPricingAndItems = exports.fetchCartLookupMaps = exports.evaluateCartWeightGating = exports.getAndValidateUserCart = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const weightPricing_helper_1 = require("../../helpers/weightPricing.helper");
const weightCart_helper_1 = require("../../helpers/weightCart.helper");
const weightPayment_helper_1 = require("../../helpers/weightPayment.helper");
const pricing_helper_1 = require("../../helpers/pricing.helper");
const discount_service_1 = require("../discount.service");
const userBlockCheck_1 = require("../../utils/userBlockCheck");
const foodConditions_1 = require("../../helpers/foodConditions");
const checkout_types_1 = require("./checkout.types");
/**
 * Fetches user's cart, ensures it's not empty, and verifies the user is not blocked.
 */
const getAndValidateUserCart = async (userId) => {
    const userCart = await connection_1.db.select().from(schema_1.cartItems).where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId));
    if (!userCart.length)
        throw new BadRequest_1.BadRequest("Your cart is empty");
    const restaurantId = userCart[0].restaurantId;
    await (0, userBlockCheck_1.validateUserNotBlocked)(userId, restaurantId);
    return { userCart, restaurantId };
};
exports.getAndValidateUserCart = getAndValidateUserCart;
/**
 * Evaluates weight gating rules for the user's cart.
 */
const evaluateCartWeightGating = async (userCart, userId, restaurantId) => {
    const userCartFoodIds = userCart.filter((c) => c.foodId).map((c) => c.foodId);
    const dbCartFoods = userCartFoodIds.length > 0
        ? await connection_1.db
            .select({ id: schema_1.food.id, sold_by: schema_1.food.sold_by, weight_unit: schema_1.food.weight_unit })
            .from(schema_1.food)
            .where((0, drizzle_orm_1.inArray)(schema_1.food.id, userCartFoodIds))
        : [];
    const weightedCartFoodMap = new Map(dbCartFoods.map((f) => [f.id, f]));
    const cartFoodSoldBy = (c) => c.offerId ? null : weightedCartFoodMap.get(c.foodId)?.sold_by ?? null;
    const cartHasWeightBoundRows = userCart.some((c) => !c.offerId && (0, weightCart_helper_1.isWeightBoundRow)(c, cartFoodSoldBy(c)));
    let activeWeightRequest = cartHasWeightBoundRows
        ? await (0, weightCart_helper_1.findActiveWeightRequest)(userId, restaurantId)
        : null;
    if (activeWeightRequest?.status === "checking_out") {
        await (0, weightPayment_helper_1.resolveCheckingOutRequest)(activeWeightRequest.id);
        activeWeightRequest = await (0, weightCart_helper_1.findActiveWeightRequest)(userId, restaurantId);
    }
    const weightGate = (0, weightCart_helper_1.evaluateWeightedCheckout)(userCart.map((c) => ({ ...c, foodSoldBy: cartFoodSoldBy(c) })), activeWeightRequest);
    const hasWeightedItems = weightGate.hasWeightedItems;
    const checkoutCart = weightGate.checkoutRows;
    const assertWeightCartUnchanged = async (tx, lockedRequestId) => {
        const lockedCart = await tx
            .select()
            .from(schema_1.cartItems)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.restaurantId, restaurantId)))
            .for("update");
        const pricedIds = new Set(checkoutCart.map((c) => c.id));
        const stray = lockedCart.filter((c) => !c.isUnavailable &&
            !c.offerId &&
            ((0, weightCart_helper_1.isWeightBoundRow)(c, cartFoodSoldBy(c)) || c.weightRequestId) &&
            (c.weightRequestId !== lockedRequestId || !pricedIds.has(c.id)));
        if (stray.length > 0) {
            throw new weightCart_helper_1.WeightCartChangedError(lockedRequestId, stray.map((c) => c.id));
        }
    };
    return {
        activeWeightRequest,
        hasWeightedItems,
        checkoutCart,
        cartFoodSoldBy,
        assertWeightCartUnchanged,
    };
};
exports.evaluateCartWeightGating = evaluateCartWeightGating;
/**
 * Fetches all necessary database lookups (variation options, addons, foods, offers) for items in the cart.
 */
const fetchCartLookupMaps = async (checkoutCart) => {
    const allAddonIds = [];
    const cartParsed = checkoutCart.map((item) => {
        let safeVars = typeof item.variations === "string" ? JSON.parse(item.variations) : item.variations;
        if (typeof safeVars === "string")
            safeVars = JSON.parse(safeVars);
        let parsedVariations = [];
        let parsedAddons = [];
        if (Array.isArray(safeVars)) {
            parsedVariations = safeVars;
        }
        else if (safeVars && typeof safeVars === "object") {
            parsedVariations = Array.isArray(safeVars.variations) ? safeVars.variations : [];
            parsedAddons = Array.isArray(safeVars.addons) ? safeVars.addons : [];
        }
        let safeAddons = typeof item.addons === "string" ? JSON.parse(item.addons) : item.addons;
        if (typeof safeAddons === "string")
            safeAddons = JSON.parse(safeAddons);
        if (Array.isArray(safeAddons)) {
            parsedAddons = [...parsedAddons, ...safeAddons];
        }
        parsedAddons.forEach((a) => {
            if (a.addonId || a.id)
                allAddonIds.push(a.addonId || a.id);
        });
        return { cartItem: item, parsedVariations, parsedAddons };
    });
    const allCheckoutOptionIds = new Set();
    for (const { parsedVariations } of cartParsed) {
        for (const v of parsedVariations) {
            if (v.optionId) {
                allCheckoutOptionIds.add(v.optionId);
            }
        }
    }
    const uniqueFoodIds = [...new Set(checkoutCart.filter((c) => !c.offerId && c.foodId).map((c) => c.foodId))];
    const [optionsWithParent, addonsListDb, foodItemsDb] = await Promise.all([
        allCheckoutOptionIds.size > 0
            ? connection_1.db
                .select({
                optionId: schema_1.variationOptions.id,
                optionName: schema_1.variationOptions.optionName,
                optionNameAr: schema_1.variationOptions.optionNameAr,
                optionNameFr: schema_1.variationOptions.optionNameFr,
                additionalPrice: schema_1.variationOptions.additionalPrice,
                priceMode: schema_1.variationOptions.priceMode,
                status: schema_1.variationOptions.status,
                variationId: schema_1.foodVariations.id,
                variationName: schema_1.foodVariations.name,
                variationNameAr: schema_1.foodVariations.nameAr,
                variationNameFr: schema_1.foodVariations.nameFr,
                variationStatus: schema_1.foodVariations.status,
            })
                .from(schema_1.variationOptions)
                .leftJoin(schema_1.foodVariations, (0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, schema_1.foodVariations.id))
                .where((0, drizzle_orm_1.inArray)(schema_1.variationOptions.id, Array.from(allCheckoutOptionIds)))
            : [],
        allAddonIds.length > 0
            ? connection_1.db
                .select()
                .from(schema_1.addons)
                .where((0, drizzle_orm_1.inArray)(schema_1.addons.id, [...new Set(allAddonIds)]))
            : [],
        uniqueFoodIds.length > 0
            ? connection_1.db
                .select({
                id: schema_1.food.id,
                price: schema_1.food.price,
                status: schema_1.food.status,
                isOutOfStock: schema_1.food.isOutOfStock,
                discountId: schema_1.food.discountId,
                discount_type: schema_1.food.discount_type,
                discount_value: schema_1.food.discount_value,
                sold_by: schema_1.food.sold_by,
                weight_unit: schema_1.food.weight_unit,
            })
                .from(schema_1.food)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.food.id, uniqueFoodIds), foodConditions_1.activeFoodCondition))
            : [],
    ]);
    const optionsWithParentMap = new Map(optionsWithParent.map((o) => [o.optionId, o]));
    const addonsMap = new Map(addonsListDb.map((a) => [a.id, a]));
    const foodMap = new Map(foodItemsDb.map((f) => [f.id, f]));
    const checkoutOfferIds = [...new Set(checkoutCart.filter((c) => c.offerId).map((c) => c.offerId))];
    const [dbOffersForCheckout, dbOfferFoodsForCheckout] = checkoutOfferIds.length > 0
        ? await Promise.all([
            connection_1.db.select().from(schema_1.offers).where((0, drizzle_orm_1.inArray)(schema_1.offers.id, checkoutOfferIds)),
            connection_1.db.select().from(schema_1.offerFoods).where((0, drizzle_orm_1.inArray)(schema_1.offerFoods.offerId, checkoutOfferIds)),
        ])
        : [[], []];
    const checkoutOffersMap = new Map(dbOffersForCheckout.map((o) => [o.id, o]));
    const checkoutOfferFoodsMap = new Map();
    for (const ofRow of dbOfferFoodsForCheckout) {
        if (!checkoutOfferFoodsMap.has(ofRow.offerId)) {
            checkoutOfferFoodsMap.set(ofRow.offerId, []);
        }
        checkoutOfferFoodsMap.get(ofRow.offerId).push(ofRow);
    }
    if (dbOfferFoodsForCheckout.length > 0) {
        const bundleOptionIds = new Set();
        const bundleAddonIds = new Set();
        for (const ofRow of dbOfferFoodsForCheckout) {
            const rawOpts = (0, checkout_types_1.parseJsonArray)(ofRow.optionIds);
            rawOpts.forEach((id) => id && bundleOptionIds.add(String(id)));
            const rawVars = (0, checkout_types_1.parseJsonArray)(ofRow.variations);
            for (const pv of rawVars) {
                if (pv?.optionId)
                    bundleOptionIds.add(String(pv.optionId));
                if (Array.isArray(pv?.options)) {
                    pv.options.forEach((id) => id && bundleOptionIds.add(String(id)));
                }
            }
            const rawAddonIds = (0, checkout_types_1.parseJsonArray)(ofRow.addonIds);
            rawAddonIds.forEach((id) => id && bundleAddonIds.add(String(id)));
        }
        const missingOptionIds = Array.from(bundleOptionIds).filter((id) => !optionsWithParentMap.has(id));
        if (missingOptionIds.length > 0) {
            const extraOptions = await connection_1.db
                .select({
                optionId: schema_1.variationOptions.id,
                optionName: schema_1.variationOptions.optionName,
                optionNameAr: schema_1.variationOptions.optionNameAr,
                optionNameFr: schema_1.variationOptions.optionNameFr,
                additionalPrice: schema_1.variationOptions.additionalPrice,
                priceMode: schema_1.variationOptions.priceMode,
                status: schema_1.variationOptions.status,
                variationId: schema_1.foodVariations.id,
                variationName: schema_1.foodVariations.name,
                variationNameAr: schema_1.foodVariations.nameAr,
                variationNameFr: schema_1.foodVariations.nameFr,
                variationStatus: schema_1.foodVariations.status,
            })
                .from(schema_1.variationOptions)
                .leftJoin(schema_1.foodVariations, (0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, schema_1.foodVariations.id))
                .where((0, drizzle_orm_1.inArray)(schema_1.variationOptions.id, missingOptionIds));
            for (const opt of extraOptions) {
                optionsWithParentMap.set(opt.optionId, opt);
            }
        }
        const missingAddonIds = Array.from(bundleAddonIds).filter((id) => !addonsMap.has(id));
        if (missingAddonIds.length > 0) {
            const extraAddons = await connection_1.db
                .select({
                id: schema_1.addons.id,
                name: schema_1.addons.name,
                nameAr: schema_1.addons.nameAr,
                nameFr: schema_1.addons.nameFr,
                price: schema_1.addons.price,
            })
                .from(schema_1.addons)
                .where((0, drizzle_orm_1.inArray)(schema_1.addons.id, missingAddonIds));
            for (const a of extraAddons) {
                addonsMap.set(a.id, a);
            }
        }
    }
    return {
        cartParsed,
        optionsWithParentMap,
        addonsMap,
        foodMap,
        checkoutOffersMap,
        checkoutOfferFoodsMap,
    };
};
exports.fetchCartLookupMaps = fetchCartLookupMaps;
/**
 * Calculates pricing for all items in the cart and prepares items to be inserted.
 */
const calculateCartPricingAndItems = async (params) => {
    const { cartParsed, checkoutOffersMap, checkoutOfferFoodsMap, optionsWithParentMap, addonsMap, foodMap, pricingBranchId, serviceModule, hasWeightedItems, cartFoodSoldBy, restaurantId, } = params;
    const isSnapshotRow = (c) => hasWeightedItems && !c.offerId && (0, weightCart_helper_1.isWeightBoundRow)(c, cartFoodSoldBy(c));
    let subtotal = 0;
    let initialSubtotal = 0;
    const itemsWithData = [];
    let checkoutHasUnavailable = false;
    let checkoutPriceChanged = false;
    const priceChangedItems = [];
    let hasFoodLevelDiscount = false;
    for (const { cartItem, parsedVariations, parsedAddons } of cartParsed) {
        if (cartItem.offerId) {
            const offer = checkoutOffersMap.get(cartItem.offerId);
            if (!offer) {
                return {
                    error: {
                        status: 422,
                        message: "An offer in your cart was not found. Please refresh your cart.",
                    },
                };
            }
            const nowForOffer = new Date();
            const isOfferActive = offer.status === "active" &&
                new Date(offer.endDate) >= nowForOffer &&
                new Date(offer.startDate) <= nowForOffer;
            if (!isOfferActive) {
                return {
                    error: {
                        status: 422,
                        message: `Offer "${offer.name}" is no longer active or has expired. Please remove it from your cart.`,
                    },
                };
            }
            const offerUnitPrice = parseFloat(offer.price);
            const storedUnit = parseFloat(cartItem.unitPrice || "0");
            if (Math.abs(offerUnitPrice - storedUnit) > 0.01) {
                checkoutPriceChanged = true;
                priceChangedItems.push({
                    foodId: cartItem.foodId,
                    oldUnitPrice: storedUnit,
                    newUnitPrice: offerUnitPrice,
                });
            }
            const offerTotal = (0, checkout_types_1.roundMoney)(offerUnitPrice * cartItem.quantity);
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
        const optionIds = parsedVariations.map((v) => v.optionId).filter(Boolean);
        const snapshotRow = isSnapshotRow(cartItem);
        const isWeightedLine = (0, weightCart_helper_1.isWeighedRow)(cartItem, cartFoodSoldBy(cartItem));
        let addonPrice = 0;
        for (const a of parsedAddons) {
            const addonId = a.addonId || a.id;
            const dbAddon = addonsMap.get(addonId);
            if (dbAddon) {
                if (dbAddon.status === "inactive") {
                    return {
                        error: {
                            status: 422,
                            message: `Add-on "${dbAddon.name}" is currently unavailable.`,
                        },
                    };
                }
                const p = snapshotRow ? Number(a.price ?? 0) : parseFloat((dbAddon.price || "0"));
                addonPrice += p;
                a.price = p.toString();
                a.name = dbAddon.name;
                a.nameAr = dbAddon.nameAr;
                a.nameFr = dbAddon.nameFr;
            }
            else {
                return {
                    error: {
                        status: 422,
                        message: `Add-on is no longer available. Please refresh your cart.`,
                        data: { affectedFoodId: cartItem.foodId, addonId },
                    },
                };
            }
        }
        let channelBasePrice;
        let varPrice;
        let itemIsAvailable = true;
        const priceResult = await (0, pricing_helper_1.calculateCalculatedPrice)(cartItem.foodId, optionIds, pricingBranchId || null, serviceModule);
        channelBasePrice = priceResult.basePrice;
        varPrice = priceResult.variants.reduce((s, v) => s + v.price, 0);
        itemIsAvailable = priceResult.isAvailable;
        if (snapshotRow) {
            const snap = (0, weightCart_helper_1.snapshotPricing)(cartItem, isWeightedLine);
            channelBasePrice = snap.basePrice;
            varPrice = snap.varSum;
            for (const v of parsedVariations) {
                const p = Number(v.price ?? v.additionalPrice ?? 0).toString();
                v.additionalPrice = p;
                v.price = p;
            }
        }
        else {
            for (const v of parsedVariations) {
                if (v.optionId) {
                    const resolved = priceResult.variants.find((r) => r.variantOptionId === v.optionId);
                    if (resolved)
                        v.additionalPrice = resolved.price.toString();
                }
            }
        }
        const storedUnit = parseFloat(cartItem.unitPrice || "0");
        const liveUnit = isWeightedLine ? priceResult.basePrice : channelBasePrice + varPrice + addonPrice;
        if ((0, weightCart_helper_1.hasUnitPriceChanged)({
            isWeighted: isWeightedLine,
            liveBasePrice: priceResult.basePrice,
            liveTotalUnitPrice: channelBasePrice + varPrice + addonPrice,
            storedUnitPrice: storedUnit,
            tolerance: 0.01,
        })) {
            checkoutPriceChanged = true;
            priceChangedItems.push({
                foodId: cartItem.foodId,
                oldUnitPrice: storedUnit,
                newUnitPrice: liveUnit,
            });
        }
        if (!itemIsAvailable)
            checkoutHasUnavailable = true;
        const originalBasePrice = channelBasePrice;
        const foodItem = foodMap.get(cartItem.foodId);
        let initialDiscountPrice = originalBasePrice;
        if (foodItem?.discount_value && Number(foodItem.discount_value) > 0) {
            hasFoodLevelDiscount = true;
            if (foodItem.discount_type === "percentage") {
                initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(foodItem.discount_value)) / 100);
            }
            else if (foodItem.discount_type === "amount" || foodItem.discount_type === "fixed") {
                initialDiscountPrice = Math.max(0, originalBasePrice - Number(foodItem.discount_value));
            }
        }
        if (isWeightedLine) {
            const effectiveWeight = cartItem.finalWeight ?? cartItem.weight ?? 0;
            initialSubtotal += parseFloat((0, weightPricing_helper_1.computeWeightedLineTotal)(effectiveWeight, initialDiscountPrice, [
                ...parsedVariations.map((v) => ({
                    price: v.additionalPrice ?? v.price ?? 0,
                    priceMode: v.priceMode || "fixed",
                })),
                ...parsedAddons.map((a) => ({ price: a.price ?? 0, priceMode: "fixed" })),
            ], cartItem.quantity));
        }
        else {
            initialSubtotal += (initialDiscountPrice + varPrice + addonPrice) * cartItem.quantity;
        }
        const detailedVariations = parsedVariations.map((v) => {
            const optDetails = optionsWithParentMap.get(v.optionId);
            const resolvedPrice = v.additionalPrice ?? optDetails?.additionalPrice ?? v.price ?? "0.00";
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
                additionalPrice: Number(resolvedPrice).toFixed(2),
                priceMode: snapshotRow
                    ? v.priceMode ?? "fixed"
                    : optDetails?.priceMode ?? v.priceMode ?? "fixed",
            };
        });
        const hasMissingDetails = detailedVariations.some((v) => !v.variationName && !v.optionName);
        if (hasMissingDetails) {
            return {
                error: {
                    status: 422,
                    message: "Some selected options are no longer available. Please refresh your cart.",
                    data: { affectedFoodId: cartItem.foodId },
                },
            };
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
    if (checkoutHasUnavailable) {
        return {
            error: {
                status: 422,
                message: "One or more items in your cart are unavailable. Please review your cart before placing the order.",
                data: {
                    unavailableItems: itemsWithData
                        .filter((d) => !d.itemIsAvailable)
                        .map((d) => ({ foodId: d.cartItem.foodId })),
                },
            },
        };
    }
    const resolvedOrderProducts = await (0, discount_service_1.formatProductsWithDiscounts)(itemsWithData
        .filter((data) => !data.isOffer && data.foodItem)
        .map((data) => ({
        id: data.foodItem.id,
        price: data.originalBasePrice,
        discountId: data.foodItem.discountId,
        discountType: data.foodItem.discount_type,
        discountValue: data.foodItem.discount_value,
    })), restaurantId);
    const resolvedOrderProductMap = new Map(resolvedOrderProducts.map((product) => [product.id, product]));
    const appliedDiscountIds = new Set(resolvedOrderProducts.map((product) => product.appliedDiscountId).filter((id) => Boolean(id)));
    const itemsToInsert = [];
    for (const data of itemsWithData) {
        if (data.isOffer) {
            const { cartItem, offer, offerUnitPrice, offerTotal } = data;
            subtotal += offerTotal;
            const bFoods = checkoutOfferFoodsMap.get(offer.id) || [];
            const perFoodPrice = bFoods.length > 0 ? (0, checkout_types_1.roundMoney)(offerUnitPrice / bFoods.length) : offerUnitPrice;
            for (const bf of bFoods) {
                const rawOpts = (0, checkout_types_1.parseJsonArray)(bf.optionIds);
                const rawVars = (0, checkout_types_1.parseJsonArray)(bf.variations);
                const bfOptionIds = new Set(rawOpts.map((id) => String(id)).filter(Boolean));
                for (const pv of rawVars) {
                    if (pv?.optionId)
                        bfOptionIds.add(String(pv.optionId));
                    if (Array.isArray(pv?.options)) {
                        pv.options.forEach((id) => id && bfOptionIds.add(String(id)));
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
                const rawBfAddonIds = (0, checkout_types_1.parseJsonArray)(bf.addonIds);
                const bundleDetailedAddons = [];
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
                const bundleItemTotal = (0, checkout_types_1.roundMoney)(perFoodPrice * cartItem.quantity + bundleAddonsPrice);
                itemsToInsert.push({
                    id: (0, uuid_1.v4)(),
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
        const isWeightedFood = (0, weightCart_helper_1.isWeighedRow)(cartItem, foodItem?.sold_by);
        let itemTotal;
        let lineVariationsPrice = varPrice;
        let lineAddonsPrice = addonPrice;
        if (isWeightedFood) {
            const effectiveWeight = cartItem.finalWeight
                ? Number(cartItem.finalWeight)
                : Number(cartItem.weight || 0);
            const split = (0, weightPricing_helper_1.splitWeightedLineTotal)(effectiveWeight, discountedBasePrice, vars.map((v) => ({
                price: v.additionalPrice || v.price || 0,
                priceMode: v.priceMode || "fixed",
            })), addonsList.map((a) => ({ price: a.price || 0, priceMode: "fixed" })), cartItem.quantity);
            itemTotal = parseFloat(split.total);
            lineVariationsPrice = parseFloat(split.variationsPortion);
            lineAddonsPrice = parseFloat(split.addonsPortion);
        }
        else {
            itemTotal = (0, checkout_types_1.roundMoney)((discountedBasePrice + varPrice + addonPrice) * cartItem.quantity);
        }
        subtotal += itemTotal;
        itemsToInsert.push({
            id: (0, uuid_1.v4)(),
            foodId: cartItem.foodId,
            quantity: cartItem.quantity,
            basePrice: discountedBasePrice.toFixed(2),
            variationsPrice: lineVariationsPrice.toFixed(2),
            addonsPrice: lineAddonsPrice.toFixed(2),
            totalPrice: itemTotal.toFixed(2),
            variations: vars,
            addons: addonsList,
            note: cartItem.note || null,
            isBundle: false,
            orderedWeight: isWeightedFood && cartItem.weight ? String(cartItem.weight) : null,
            finalWeight: isWeightedFood && (cartItem.finalWeight ?? cartItem.weight)
                ? String(cartItem.finalWeight ?? cartItem.weight)
                : null,
            weightUnit: isWeightedFood ? cartItem.weightUnit || foodItem?.weight_unit || null : null,
        });
    }
    subtotal = (0, checkout_types_1.roundMoney)(subtotal);
    return {
        subtotal,
        initialSubtotal,
        hasFoodLevelDiscount,
        resolvedOrderProducts,
        appliedDiscountIds,
        itemsToInsert,
    };
};
exports.calculateCartPricingAndItems = calculateCartPricingAndItems;
