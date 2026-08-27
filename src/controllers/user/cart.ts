// src/controllers/user/cart.ts
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

    const [itemFood] = await db.select().from(food).where(eq(food.id, foodId)).limit(1);
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
        // Verify geo-resolved branch is active
        const [br] = await db
            .select({ id: branches.id })
            .from(branches)
            .where(and(eq(branches.id, resolvedBranchId), eq(branches.status, "active")))
            .limit(1);
        if (!br) throw new BadRequest("Resolved delivery branch is inactive.");
    }

    if (resolvedBranchId && branchId) {
        // Verify manually-passed branchId
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

    // Validate cross-branch consistency
    if (resolvedBranchId && existingCart.length > 0 && existingCart[0].branchId && existingCart[0].branchId !== resolvedBranchId) {
        throw new BadRequest("All cart items must belong to the same branch. Please clear your cart before adding items from a different branch.");
    }

    // ─── Validate variation options ──────────────────────────────────
    const dbVariations = await db
        .select()
        .from(foodVariations)
        .where(eq(foodVariations.foodId, foodId));

    // Mandatory variations check
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
        // Addons are not covered by channel pricing — add them on top
        const addonTotal = addonSnapshot.reduce((sum, a) => sum + Number(a.price || 0), 0);
        unitPrice = priceResult.totalUnitPrice + addonTotal;
    } else {
        // Fallback: no channel context — use base food price + variant additionalPrice
        const basePrice = Number(itemFood.price);
        const varExtra = safeVariations.reduce(async (sumPromise: any, selected: any) => {
            return sumPromise;
        }, Promise.resolve(0));
        let totalExtra = 0;
        for (const selected of safeVariations) {
            const [opt] = await db.select({ additionalPrice: variationOptions.additionalPrice }).from(variationOptions).where(eq(variationOptions.id, selected.optionId)).limit(1);
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

    const existingItems = await db.select().from(cartItems)
        .where(and(eq(cartItems.userId, userId), eq(cartItems.foodId, foodId)));

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
   2. GET CART
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
        .leftJoin(food, eq(cartItems.foodId, food.id))
        .leftJoin(restaurants, eq(cartItems.restaurantId, restaurants.id))
        .where(and(...conditions));

    if (items.length === 0) {
        return SuccessResponse(res, { data: { items: [], unavailableItems: [], hasUnavailableItems: false, totalSummary: { subtotal: 0 } } });
    }

    const restaurantId = items[0].restaurantId;

    // ─── Resolve active branch for this request ──────────────────────
    let targetBranchId: string | undefined = undefined;
    if (branchId || addressId) {
        targetBranchId = (await resolveBranchIdForCart(branchId, addressId, restaurantId || undefined)) || undefined;
    }

    // ─── Classic availability check (ingredient locks + branchMenuItems) ─
    const allFoodIds = items.map(i => i.foodId).filter((id): id is string => id !== null && id !== undefined);
    const unavailableMap = allFoodIds.length > 0
        ? await getUnavailableBranchesForFoods(allFoodIds)
        : new Map<string, BranchInfo[]>();

    // ─── Branch-subcategory availability check ────────────────────────
    // Fetch all subcategoryIds that are explicitly set to "inactive" for this branch
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

    // ─── Build initial subtotal for discount calculation ─────────────
    let initialSubtotal = 0;
    const itemsData = availableCartItems.map(item => {
        const originalBasePrice = parseFloat(item.price as string || "0");
        const { variations: parsedVariations } = parseCartSnapshot(item.variations);
        const parsedAddonsParsed = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];

        let initialDiscountPrice = originalBasePrice;
        if (item.discountType && Number(item.discountValue) > 0) {
            if (item.discountType === "percentage") {
                initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(item.discountValue) / 100));
            } else if (item.discountType === "amount" || (item.discountType as any) === "fixed") {
                initialDiscountPrice = Math.max(0, originalBasePrice - Number(item.discountValue));
            }
        }

        const dbUnitPrice = parseFloat(item.unitPrice as string || "0");
        const varPrice = dbUnitPrice - originalBasePrice;
        initialSubtotal += (initialDiscountPrice + varPrice) * item.quantity;
        return { item, originalBasePrice, varPrice, parsedVariations, parsedAddons: parsedAddonsParsed };
    });

    const availableDiscounts = await getAvailableDiscounts(restaurantId!);
    const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };
    let finalSubtotal = 0;

    const formattedAvailableItems = await Promise.all(
        itemsData.map(async (data: any) => {
            const { item, originalBasePrice, varPrice, parsedVariations, parsedAddons } = data;

            // ─── Channel pricing live reprice (if context is stored or passed) ──
            const effectiveBranchId = targetBranchId || item.storedBranchId || undefined;
            const effectiveServiceModule = (serviceModule || item.storedServiceModule) as ServiceModule | undefined;

            let liveUnitPrice: number | null = null;
            let priceChanged = false;
            let channelAvailable = true;

            if (effectiveBranchId && effectiveServiceModule && item.foodId) {
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
                    const storedUnit = parseFloat(item.unitPrice as string || "0");
                    priceChanged = Math.abs(computedLivePrice - storedUnit) > 0.001;
                } catch {
                    // Pricing engine error → fall back to stored price gracefully
                    liveUnitPrice = null;
                }
            }

            // ─── Variation details ─────────────────────────────────────────
            const variationDetails: any[] = [];
            for (const v of parsedVariations) {
                if (!v.variationId || !v.optionId) continue;
                const [variation] = await db.select().from(foodVariations).where(eq(foodVariations.id, v.variationId)).limit(1);
                const [option] = await db.select().from(variationOptions).where(eq(variationOptions.id, v.optionId)).limit(1);
                if (variation && option) {
                    variationDetails.push({
                        variationId: variation.id,
                        variationName: variation.name,
                        variationNameAr: variation.nameAr,
                        optionId: option.id,
                        optionName: option.optionName,
                        optionNameAr: option.optionNameAr,
                        additionalPrice: option.additionalPrice,
                    });
                }
            }

            const addonDetails = parsedAddons.map((a: any) => ({
                addonId: a.addonId,
                name: a.name,
                nameAr: a.nameAr,
                price: a.price,
            }));

            // ─── Discount ──────────────────────────────────────────────────
            const baseForDiscount = liveUnitPrice !== null ? liveUnitPrice - varPrice : originalBasePrice;

            const { price: discountedBasePrice } = applyPriorityDiscount(
                { id: item.foodId, discountType: item.discountType, discountValue: item.discountValue },
                baseForDiscount,
                initialSubtotal,
                availableDiscounts,
                discountState,
                true
            );

            const finalUnitPrice = liveUnitPrice !== null ? liveUnitPrice : discountedBasePrice + varPrice;
            const finalTotalPrice = finalUnitPrice * item.quantity;
            finalSubtotal += finalTotalPrice;

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
                totalPrice: finalTotalPrice,
                variations: variationDetails,
                addons: addonDetails,
                note: item.note || null,
                isAvailable: channelAvailable,
                priceChanged,
                resolvedBranchId: effectiveBranchId || null,
                serviceModule: effectiveServiceModule || null,
            };
        })
    );

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

    // ─── Free Delivery Offer check ────────────────────────────────────
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


    const [itemFood] = await db.select().from(food).where(eq(food.id, cartItem.foodId)).limit(1);
    if (!itemFood) throw new BadRequest("Food item not found");

    // 🛡️ Check if food is out of stock or inactive
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

    // Validate availability via legacy ingredient/menu-lock check
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
        // Fallback: no channel context
        let totalExtra = 0;
        for (const selected of safeVariations) {
            const [opt] = await db.select({ additionalPrice: variationOptions.additionalPrice }).from(variationOptions).where(eq(variationOptions.id, selected.optionId)).limit(1);
            totalExtra += Number(opt?.additionalPrice || 0);
        }
        const addonTotal = addonSnapshot.reduce((sum, a) => sum + Number(a.price || 0), 0);
        unitPrice = Number(itemFood.price) + totalExtra + addonTotal;
    }

    const qty = quantity ?? cartItem.quantity;

    await db.update(cartItems)
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
    const {
        restaurantId,
        serviceModule,
        branchId,
        addressId,
        items: reqItems,
    } = req.body;

    // ─── Input validation ─────────────────────────────────────────────
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
    if (!Array.isArray(reqItems) || reqItems.length === 0) {
        throw new BadRequest("items array is required and must not be empty.");
    }

    // ─── Resolve branch ───────────────────────────────────────────────
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

    // ─── Process each item ────────────────────────────────────────────
    let oldSubtotal = 0;
    let newSubtotal = 0;
    let isPriceChanged = false;
    let hasUnavailableItems = false;

    const itemResults: any[] = [];

    for (const reqItem of reqItems) {
        const { foodId, quantity, expectedUnitPrice, selectedVariants = [] } = reqItem;

        if (!foodId || !quantity || expectedUnitPrice === undefined) {
            throw new BadRequest(`Invalid item payload: foodId, quantity, and expectedUnitPrice are required.`);
        }

        const optionIds: string[] = selectedVariants.map((v: any) => v.variantOptionId).filter(Boolean);

        const priceResult = await calculateCalculatedPrice(
            foodId,
            optionIds,
            resolvedBranchId,
            serviceModule as ServiceModule
        );

        const newUnitPrice = priceResult.basePrice;
        const oldUnitPrice = Number(expectedUnitPrice);
        const basePriceChanged = Math.abs(newUnitPrice - oldUnitPrice) > 0.001;
        const itemIsAvailable = priceResult.isAvailable;

        if (basePriceChanged) isPriceChanged = true;
        if (!itemIsAvailable) hasUnavailableItems = true;

        // Per-variant comparison
        const variantResults: any[] = [];
        for (const sv of selectedVariants) {
            const { variantOptionId, expectedPrice } = sv;
            const resolved = priceResult.variants.find(v => v.variantOptionId === variantOptionId);
            const newVarPrice = resolved ? resolved.price : 0;
            const varAvailable = resolved ? resolved.isAvailable : false;
            const varPriceChanged = Math.abs(newVarPrice - Number(expectedPrice)) > 0.001;

            if (varPriceChanged) isPriceChanged = true;
            if (!varAvailable) hasUnavailableItems = true;

            variantResults.push({
                variantOptionId,
                isAvailable: varAvailable,
                priceChanged: varPriceChanged,
                oldPrice: Number(expectedPrice),
                newPrice: newVarPrice,
            });
        }

        const variantPriceSum = priceResult.variants.reduce((s, v) => s + v.price, 0);
        const oldTotal = oldUnitPrice * quantity;
        const newTotal = priceResult.totalUnitPrice * quantity;
        oldSubtotal += Number(expectedUnitPrice) * quantity + selectedVariants.reduce((s: number, v: any) => s + Number(v.expectedPrice) * quantity, 0);
        newSubtotal += priceResult.totalUnitPrice * quantity;

        itemResults.push({
            foodId,
            isAvailable: itemIsAvailable,
            basePriceChanged,
            oldUnitPrice,
            newUnitPrice,
            quantity,
            totalItemPrice: newTotal,
            selectedVariants: variantResults,
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