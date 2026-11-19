import { db } from "../../models/connection";
import {
    cartItems,
    food,
    variationOptions,
    foodVariations,
    addons,
    offers,
    offerFoods,
} from "../../models/schema";
import { eq, and, inArray } from "drizzle-orm";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";
import { computeWeightedLineTotal, splitWeightedLineTotal } from "../../helpers/weightPricing.helper";
import {
    type ActiveWeightRequest,
    evaluateWeightedCheckout,
    findActiveWeightRequest,
    hasUnitPriceChanged,
    isWeighedRow,
    isWeightBoundRow,
    snapshotPricing,
    WeightCartChangedError,
} from "../../helpers/weightCart.helper";
import { resolveCheckingOutRequest } from "../../helpers/weightPayment.helper";
import { calculateCalculatedPrice, type ServiceModule } from "../../helpers/pricing.helper";
import { formatProductsWithDiscounts } from "../discount.service";
import { validateUserNotBlocked } from "../../utils/userBlockCheck";
import { activeFoodCondition } from "../../helpers/foodConditions";
import { roundMoney, parseJsonArray } from "./checkout.types";

/**
 * Fetches user's cart, ensures it's not empty, and verifies the user is not blocked.
 */
export const getAndValidateUserCart = async (userId: string) => {
    const userCart = await db.select().from(cartItems).where(eq(cartItems.userId, userId));
    if (!userCart.length) throw new BadRequest("Your cart is empty");

    const restaurantId = userCart[0].restaurantId;
    await validateUserNotBlocked(userId, restaurantId);

    return { userCart, restaurantId };
};

/**
 * Evaluates weight gating rules for the user's cart.
 */
export const evaluateCartWeightGating = async (
    userCart: any[],
    userId: string,
    restaurantId: string
) => {
    const userCartFoodIds = userCart.filter((c) => c.foodId).map((c) => c.foodId!);
    const dbCartFoods =
        userCartFoodIds.length > 0
            ? await db
                .select({ id: food.id, sold_by: food.sold_by, weight_unit: food.weight_unit })
                .from(food)
                .where(inArray(food.id, userCartFoodIds))
            : [];
    const weightedCartFoodMap = new Map(dbCartFoods.map((f) => [f.id, f]));
    const cartFoodSoldBy = (c: { foodId: string; offerId?: string | null }) =>
        c.offerId ? null : weightedCartFoodMap.get(c.foodId)?.sold_by ?? null;

    const cartHasWeightBoundRows = userCart.some((c) => !c.offerId && isWeightBoundRow(c, cartFoodSoldBy(c)));
    let activeWeightRequest: ActiveWeightRequest | null = cartHasWeightBoundRows
        ? await findActiveWeightRequest(userId, restaurantId)
        : null;

    if (activeWeightRequest?.status === "checking_out") {
        await resolveCheckingOutRequest(activeWeightRequest.id);
        activeWeightRequest = await findActiveWeightRequest(userId, restaurantId);
    }

    const weightGate = evaluateWeightedCheckout(
        userCart.map((c) => ({ ...c, foodSoldBy: cartFoodSoldBy(c) })),
        activeWeightRequest
    );
    const hasWeightedItems = weightGate.hasWeightedItems;
    const checkoutCart = weightGate.checkoutRows;

    const assertWeightCartUnchanged = async (tx: any, lockedRequestId: string) => {
        const lockedCart: typeof userCart = await tx
            .select()
            .from(cartItems)
            .where(and(eq(cartItems.userId, userId), eq(cartItems.restaurantId, restaurantId)))
            .for("update");
        const pricedIds = new Set(checkoutCart.map((c) => c.id));
        const stray = lockedCart.filter(
            (c) =>
                !c.isUnavailable &&
                !c.offerId &&
                (isWeightBoundRow(c, cartFoodSoldBy(c)) || c.weightRequestId) &&
                (c.weightRequestId !== lockedRequestId || !pricedIds.has(c.id))
        );
        if (stray.length > 0) {
            throw new WeightCartChangedError(
                lockedRequestId,
                stray.map((c) => c.id)
            );
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

/**
 * Fetches all necessary database lookups (variation options, addons, foods, offers) for items in the cart.
 */
export const fetchCartLookupMaps = async (checkoutCart: any[]) => {
    const allAddonIds: string[] = [];
    const cartParsed = checkoutCart.map((item) => {
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

        parsedAddons.forEach((a: any) => {
            if (a.addonId || a.id) allAddonIds.push(a.addonId || a.id);
        });
        return { cartItem: item, parsedVariations, parsedAddons };
    });

    const allCheckoutOptionIds = new Set<string>();
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
            ? db
                .select({
                    optionId: variationOptions.id,
                    optionName: variationOptions.optionName,
                    optionNameAr: variationOptions.optionNameAr,
                    optionNameFr: variationOptions.optionNameFr,
                    additionalPrice: variationOptions.additionalPrice,
                    priceMode: variationOptions.priceMode,
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
            ? db
                .select()
                .from(addons)
                .where(inArray(addons.id, [...new Set(allAddonIds)]))
            : [],
        uniqueFoodIds.length > 0
            ? db
                .select({
                    id: food.id,
                    price: food.price,
                    status: food.status,
                    isOutOfStock: food.isOutOfStock,
                    discountId: food.discountId,
                    discount_type: food.discount_type,
                    discount_value: food.discount_value,
                    sold_by: food.sold_by,
                    weight_unit: food.weight_unit,
                })
                .from(food)
                .where(and(inArray(food.id, uniqueFoodIds), activeFoodCondition))
            : [],
    ]);

    const optionsWithParentMap = new Map(optionsWithParent.map((o) => [o.optionId, o]));
    const addonsMap = new Map(addonsListDb.map((a) => [a.id, a]));
    const foodMap = new Map(foodItemsDb.map((f) => [f.id, f]));

    const checkoutOfferIds = [...new Set(checkoutCart.filter((c) => c.offerId).map((c) => c.offerId!))];
    const [dbOffersForCheckout, dbOfferFoodsForCheckout] =
        checkoutOfferIds.length > 0
            ? await Promise.all([
                db.select().from(offers).where(inArray(offers.id, checkoutOfferIds)),
                db.select().from(offerFoods).where(inArray(offerFoods.offerId, checkoutOfferIds)),
            ])
            : [[], []];
    const checkoutOffersMap = new Map(dbOffersForCheckout.map((o) => [o.id, o]));
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
                    priceMode: variationOptions.priceMode,
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
                .select({
                    id: addons.id,
                    name: addons.name,
                    nameAr: addons.nameAr,
                    nameFr: addons.nameFr,
                    price: addons.price,
                })
                .from(addons)
                .where(inArray(addons.id, missingAddonIds));
            for (const a of extraAddons) {
                addonsMap.set(a.id, a as any);
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

/**
 * Calculates pricing for all items in the cart and prepares items to be inserted.
 */
export const calculateCartPricingAndItems = async (params: {
    cartParsed: any[];
    checkoutOffersMap: Map<string, any>;
    checkoutOfferFoodsMap: Map<string, any[]>;
    optionsWithParentMap: Map<string, any>;
    addonsMap: Map<string, any>;
    foodMap: Map<string, any>;
    pricingBranchId: string | null;
    serviceModule: ServiceModule;
    hasWeightedItems: boolean;
    cartFoodSoldBy: (c: any) => string | null;
    restaurantId: string;
}) => {
    const {
        cartParsed,
        checkoutOffersMap,
        checkoutOfferFoodsMap,
        optionsWithParentMap,
        addonsMap,
        foodMap,
        pricingBranchId,
        serviceModule,
        hasWeightedItems,
        cartFoodSoldBy,
        restaurantId,
    } = params;

    const isSnapshotRow = (c: any) => hasWeightedItems && !c.offerId && isWeightBoundRow(c, cartFoodSoldBy(c));

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
                return {
                    error: {
                        status: 422,
                        message: "An offer in your cart was not found. Please refresh your cart.",
                    },
                };
            }
            const nowForOffer = new Date();
            const isOfferActive =
                offer.status === "active" &&
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
            const storedUnit = parseFloat((cartItem.unitPrice as string) || "0");
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
        const snapshotRow = isSnapshotRow(cartItem);
        const isWeightedLine = isWeighedRow(cartItem, cartFoodSoldBy(cartItem));

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
                const p = snapshotRow ? Number(a.price ?? 0) : parseFloat((dbAddon.price || "0") as string);
                addonPrice += p;
                a.price = p.toString();
                a.name = dbAddon.name;
                a.nameAr = dbAddon.nameAr;
                a.nameFr = dbAddon.nameFr;
            } else {
                return {
                    error: {
                        status: 422,
                        message: `Add-on is no longer available. Please refresh your cart.`,
                        data: { affectedFoodId: cartItem.foodId, addonId },
                    },
                };
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

        if (snapshotRow) {
            const snap = snapshotPricing(cartItem, isWeightedLine);
            channelBasePrice = snap.basePrice;
            varPrice = snap.varSum;
            for (const v of parsedVariations) {
                const p = Number(v.price ?? v.additionalPrice ?? 0).toString();
                v.additionalPrice = p;
                v.price = p;
            }
        } else {
            for (const v of parsedVariations) {
                if (v.optionId) {
                    const resolved = priceResult.variants.find((r) => r.variantOptionId === v.optionId);
                    if (resolved) v.additionalPrice = resolved.price.toString();
                }
            }
        }

        const storedUnit = parseFloat((cartItem.unitPrice as string) || "0");
        const liveUnit = isWeightedLine ? priceResult.basePrice : channelBasePrice + varPrice + addonPrice;
        if (
            hasUnitPriceChanged({
                isWeighted: isWeightedLine,
                liveBasePrice: priceResult.basePrice,
                liveTotalUnitPrice: channelBasePrice + varPrice + addonPrice,
                storedUnitPrice: storedUnit,
                tolerance: 0.01,
            })
        ) {
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
                initialDiscountPrice = Math.max(
                    0,
                    originalBasePrice - (originalBasePrice * Number(foodItem.discount_value)) / 100
                );
            } else if (foodItem.discount_type === "amount" || foodItem.discount_type === "fixed") {
                initialDiscountPrice = Math.max(0, originalBasePrice - Number(foodItem.discount_value));
            }
        }

        if (isWeightedLine) {
            const effectiveWeight = cartItem.finalWeight ?? cartItem.weight ?? 0;
            initialSubtotal += parseFloat(
                computeWeightedLineTotal(
                    effectiveWeight,
                    initialDiscountPrice,
                    [
                        ...parsedVariations.map((v: any) => ({
                            price: v.additionalPrice ?? v.price ?? 0,
                            priceMode: v.priceMode || "fixed",
                        })),
                        ...parsedAddons.map((a: any) => ({ price: a.price ?? 0, priceMode: "fixed" })),
                    ],
                    cartItem.quantity
                )
            );
        } else {
            initialSubtotal += (initialDiscountPrice + varPrice + addonPrice) * cartItem.quantity;
        }

        const detailedVariations = parsedVariations.map((v: any) => {
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

        const hasMissingDetails = detailedVariations.some((v: any) => !v.variationName && !v.optionName);

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
                message:
                    "One or more items in your cart are unavailable. Please review your cart before placing the order.",
                data: {
                    unavailableItems: itemsWithData
                        .filter((d) => !d.itemIsAvailable)
                        .map((d) => ({ foodId: d.cartItem.foodId })),
                },
            },
        };
    }

    const resolvedOrderProducts = await formatProductsWithDiscounts(
        itemsWithData
            .filter((data) => !data.isOffer && data.foodItem)
            .map((data) => ({
                id: data.foodItem.id,
                price: data.originalBasePrice,
                discountId: data.foodItem.discountId,
                discountType: data.foodItem.discount_type,
                discountValue: data.foodItem.discount_value,
            })),
        restaurantId
    );
    const resolvedOrderProductMap = new Map(resolvedOrderProducts.map((product) => [product.id, product]));
    const appliedDiscountIds = new Set(
        resolvedOrderProducts.map((product) => product.appliedDiscountId).filter((id): id is string => Boolean(id))
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

        const isWeightedFood = isWeighedRow(cartItem, foodItem?.sold_by);
        let itemTotal: number;
        let lineVariationsPrice = varPrice;
        let lineAddonsPrice = addonPrice;
        if (isWeightedFood) {
            const effectiveWeight = cartItem.finalWeight
                ? Number(cartItem.finalWeight)
                : Number(cartItem.weight || 0);
            const split = splitWeightedLineTotal(
                effectiveWeight,
                discountedBasePrice,
                vars.map((v: any) => ({
                    price: v.additionalPrice || v.price || 0,
                    priceMode: v.priceMode || "fixed",
                })),
                addonsList.map((a: any) => ({ price: a.price || 0, priceMode: "fixed" })),
                cartItem.quantity
            );
            itemTotal = parseFloat(split.total);
            lineVariationsPrice = parseFloat(split.variationsPortion);
            lineAddonsPrice = parseFloat(split.addonsPortion);
        } else {
            itemTotal = roundMoney((discountedBasePrice + varPrice + addonPrice) * cartItem.quantity);
        }
        subtotal += itemTotal;

        itemsToInsert.push({
            id: uuidv4(),
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
            finalWeight:
                isWeightedFood && (cartItem.finalWeight ?? cartItem.weight)
                    ? String(cartItem.finalWeight ?? cartItem.weight)
                    : null,
            weightUnit: isWeightedFood ? cartItem.weightUnit || foodItem?.weight_unit || null : null,
        });
    }

    subtotal = roundMoney(subtotal);

    return {
        subtotal,
        initialSubtotal,
        hasFoodLevelDiscount,
        resolvedOrderProducts,
        appliedDiscountIds,
        itemsToInsert,
    };
};
