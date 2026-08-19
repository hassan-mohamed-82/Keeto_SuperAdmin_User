import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    cartItems,
    food,
    restaurants,
    variationOptions,
    foodVariations,
    addons,
    addresses,
    branches
} from "../../models/schema";

import { eq, and, inArray } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";
import { getAvailableDiscounts, applyPriorityDiscount } from "../../utils/discount";
import { getUnavailableBranchesForFoods, type BranchInfo } from "../../helpers/food.helper";

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
    if (typeof data === 'string') {
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
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
            variations: Array.isArray(parsed.variations) ? parsed.variations : [],
            addons: Array.isArray(parsed.addons) ? parsed.addons : []
        };
    }
    return { variations: [], addons: [] };
};

/**
 * Resolves target branchId either directly or via address -> zone -> branch link.
 */
const resolveBranchId = async (branchId?: string, addressId?: string, restaurantId?: string): Promise<string | null> => {
    if (branchId) return branchId;

    if (addressId) {
        const [address] = await db
            .select({ zoneId: addresses.zoneId })
            .from(addresses)
            .where(eq(addresses.id, addressId))
            .limit(1);

        if (address?.zoneId) {
            const conditions = [eq(branches.zoneId, address.zoneId)];
            if (restaurantId) {
                conditions.push(eq(branches.restaurantId, restaurantId));
            }

            const [branch] = await db
                .select({ id: branches.id })
                .from(branches)
                .where(and(...conditions))
                .limit(1);

            if (branch) return branch.id;
        }
    }

    return null;
};

/**
 * Validates if a single food item is available at the specified branch/address.
 */
const validateFoodAvailabilityInBranch = async (
    foodId: string,
    branchId?: string,
    addressId?: string,
    restaurantId?: string
) => {
    const targetBranchId = await resolveBranchId(branchId, addressId, restaurantId);

    if (!targetBranchId) return;

    const unavailableMap = await getUnavailableBranchesForFoods([foodId]);
    const unavailableBranches = unavailableMap.get(foodId) || [];

    const isUnavailable = unavailableBranches.some(b => b.id === targetBranchId);

    if (isUnavailable) {
        if (branchId) {
            throw new BadRequest("This item is currently unavailable in the selected branch.");
        }

        if (addressId) {
            throw new BadRequest("This item is currently unavailable for delivery to your selected address.");
        }

        throw new BadRequest("This item is currently unavailable at your location.");
    }
};

/* =========================================
   1. ADD TO CART
========================================= */
export const addToCart = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { foodId, quantity = 1, variations = [], addons: requestAddons = [], note, branchId, addressId } = req.body;

    const safeVariations = Array.isArray(variations) ? variations : [];
    const safeAddons = Array.isArray(requestAddons) ? requestAddons : [];

    const [itemFood] = await db.select().from(food).where(eq(food.id, foodId)).limit(1);
    if (!itemFood) throw new BadRequest("Food not found");
    if (itemFood.isOutOfStock || itemFood.status === "inactive") {
        throw new BadRequest("This item is currently out of stock.");
    }

    // Verify branch/address availability for the single item being added
    await validateFoodAvailabilityInBranch(foodId, branchId, addressId, itemFood.restaurantid);

    const existingCart = await db.select().from(cartItems)
        .where(eq(cartItems.userId, userId))
        .limit(1);

    if (existingCart.length > 0 && existingCart[0].restaurantId !== itemFood.restaurantid) {
        return res.status(409).json({
            success: false,
            message: "You have food from another restaurant",
            clearCartRequired: true
        });
    }

    const dbVariations = await db
        .select()
        .from(foodVariations)
        .where(eq(foodVariations.foodId, foodId));

    let totalExtraPrice = 0;

    // 1. Check variations
    for (const selected of safeVariations) {
        const validDbVariation = dbVariations.find(v => v.id === selected.variationId);

        if (!validDbVariation) {
            throw new BadRequest(`Invalid variation ID sent: ${selected.variationId}`);
        }
        if (validDbVariation.status === false) {
            throw new BadRequest(`Variation ${validDbVariation.name} is currently unavailable`);
        }

        const dbOptions = await db
            .select()
            .from(variationOptions)
            .where(eq(variationOptions.variationId, validDbVariation.id));

        const foundOption = dbOptions.find(o => o.id === selected.optionId);
        if (!foundOption) {
            throw new BadRequest(`Invalid option selected for variation: ${validDbVariation.name}`);
        }
        if (foundOption.status === false) {
            throw new BadRequest(`Option ${foundOption.optionName} is currently unavailable`);
        }

        totalExtraPrice += Number(foundOption.additionalPrice || 0);
    }

    // 2. Mandatory variations check
    for (const v of dbVariations) {
        if (v.isRequired) {
            const isProvided = safeVariations.some(x => x.variationId === v.id);
            if (!isProvided) throw new BadRequest(`${v.name} is required`);
        }
    }

    // 3. Addons validation
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
        const dbAddons = await db
            .select()
            .from(addons)
            .where(inArray(addons.id, requestedAddonIds));

        for (const a of safeAddons) {
            const dbAddon = dbAddons.find(d => d.id === a.addonId);
            if (!dbAddon) throw new BadRequest(`Addon not found: ${a.addonId}`);
            if (dbAddon.status === "inactive") throw new BadRequest(`Addon "${dbAddon.name}" is currently unavailable`);

            totalExtraPrice += Number(dbAddon.price || 0);
            addonSnapshot.push({
                addonId: dbAddon.id,
                name: dbAddon.name,
                nameAr: dbAddon.nameAr,
                price: dbAddon.price
            });
        }
    }

    // 4. Calculate total price
    const unitPrice = Number(itemFood.price) + totalExtraPrice;

    const normalizedVariationsList = normalizeVariations(safeVariations);
    const normalizedAddonsList = normalizeAddons(addonSnapshot);
    const key = JSON.stringify({ variations: normalizedVariationsList, addons: normalizedAddonsList });

    const snapshot = { variations: normalizedVariationsList };

    const existingItems = await db.select().from(cartItems)
        .where(and(eq(cartItems.userId, userId), eq(cartItems.foodId, foodId)));

    const existingSame = existingItems.find(item => {
        const { variations: dbVars } = parseCartSnapshot(item.variations);
        const dbAddons = deepParseJSON(item.addons);
        const normalizedDbAddons = normalizeAddons(Array.isArray(dbAddons) ? dbAddons : []);
        const existingKey = JSON.stringify({
            variations: normalizeVariations(dbVars),
            addons: normalizedDbAddons
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
                ...(note !== undefined ? { note: note || null } : {})
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
            note: note || null
        });
    }

    return SuccessResponse(res, {
        message: "Added to cart successfully",
        data: {
            unitPrice,
            totalPrice: unitPrice * quantity
        }
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
            note: cartItems.note
        })
        .from(cartItems)
        .leftJoin(food, eq(cartItems.foodId, food.id))
        .leftJoin(restaurants, eq(cartItems.restaurantId, restaurants.id))
        .where(and(...conditions));

    if (items.length === 0) {
        return SuccessResponse(res, { data: { items: [], unavailableItems: [], hasUnavailableItems: false, totalSummary: { subtotal: 0 } } });
    }

    const restaurantId = items[0].restaurantId;
    let availableCartItems: typeof items = [];
    let unavailableCartItemsData: typeof items = [];

    const allFoodIds = items
        .map(i => i.foodId)
        .filter((id): id is string => id !== null && id !== undefined);

    const unavailableMap = allFoodIds.length > 0
        ? await getUnavailableBranchesForFoods(allFoodIds)
        : new Map<string, BranchInfo[]>();

    let targetBranchId: string | undefined = undefined;
    if (branchId || addressId) {
        targetBranchId = (await resolveBranchId(branchId, addressId, restaurantId || undefined)) || undefined;
    }

    for (const item of items) {
        const isGeneralUnavailable = Boolean(item.isOutOfStock) || item.status === "inactive";
        const unavailableBranches = item.foodId ? (unavailableMap.get(item.foodId) || []) : [];
        const isBranchUnavailable = Boolean(targetBranchId && unavailableBranches.some(b => b.id === targetBranchId));

        if (isGeneralUnavailable || isBranchUnavailable) {
            unavailableCartItemsData.push(item);
        } else {
            availableCartItems.push(item);
        }
    }
    let initialSubtotal = 0;
    const itemsData = availableCartItems.map(item => {
        const originalBasePrice = parseFloat(item.price as string || "0");
        const { variations: parsedVariations } = parseCartSnapshot(item.variations);
        const parsedAddons = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];

        let initialDiscountPrice = originalBasePrice;
        if (item.discountType && Number(item.discountValue) > 0) {
            if (item.discountType === "percentage") {
                initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(item.discountValue) / 100));
            } else if (item.discountType === "amount" || item.discountType === "fixed") {
                initialDiscountPrice = Math.max(0, originalBasePrice - Number(item.discountValue));
            }
        }

        const dbUnitPrice = parseFloat(item.unitPrice as string || "0");
        const varPrice = dbUnitPrice - originalBasePrice;

        initialSubtotal += (initialDiscountPrice + varPrice) * item.quantity;
        return { item, originalBasePrice, varPrice, parsedVariations, parsedAddons };
    });

    const availableDiscounts = await getAvailableDiscounts(restaurantId!);
    const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };

    let finalSubtotal = 0;

    const formattedAvailableItems = await Promise.all(
        itemsData.map(async (data: any) => {
            const { item, originalBasePrice, varPrice, parsedVariations, parsedAddons } = data;

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
                        additionalPrice: option.additionalPrice
                    });
                }
            }

            const addonDetails = parsedAddons.map((a: any) => ({
                addonId: a.addonId,
                name: a.name,
                nameAr: a.nameAr,
                price: a.price
            }));

            const { price: discountedBasePrice } = applyPriorityDiscount(
                { id: item.foodId, discountType: item.discountType, discountValue: item.discountValue },
                originalBasePrice,
                initialSubtotal,
                availableDiscounts,
                discountState,
                true
            );

            const finalUnitPrice = discountedBasePrice + varPrice;
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
                isAvailable: true
            };
        })
    );

    const formattedUnavailableItems = unavailableCartItemsData.map(item => {
        const { variations: parsedVariations } = parseCartSnapshot(item.variations);
        const parsedAddons = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];

        return {
            cartId: item.cartId,
            foodId: item.foodId,
            name: item.name,
            nameAr: item.nameAr,
            image: item.image,
            quantity: item.quantity,
            variations: parsedVariations,
            addons: parsedAddons,
            isAvailable: false,
            reason: "Out of stock or unavailable at selected location"
        };
    });

    return SuccessResponse(res, {
        message: "Cart fetched successfully",
        data: {
            items: formattedAvailableItems,
            unavailableItems: formattedUnavailableItems,
            hasUnavailableItems: formattedUnavailableItems.length > 0,
            totalSummary: {
                subtotal: finalSubtotal,
            }
        }
    });
};

// export const getCart = async (req: Request | any, res: Response) => {
//     const userId = req.user?.id;
//     const queryRestaurantId = req.query.restaurantId as string | undefined;

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
//             restaurantId: restaurants.id,
//             restaurantName: restaurants.name,
//             quantity: cartItems.quantity,
//             unitPrice: cartItems.unitPrice,
//             totalPrice: cartItems.totalPrice,
//             variations: cartItems.variations,
//             addons: cartItems.addons,
//             note: cartItems.note
//         })
//         .from(cartItems)
//         .leftJoin(food, eq(cartItems.foodId, food.id))
//         .leftJoin(restaurants, eq(cartItems.restaurantId, restaurants.id))
//         .where(and(...conditions));

//     if (items.length === 0) {
//         return SuccessResponse(res, { data: { items: [], totalSummary: { subtotal: 0 } } });
//     }

//     const restaurantId = items[0].restaurantId;

//     // 1. حساب الـ subtotal الأولي (السعر الأصلي + variations + addons) لتقييم الـ discount بشكل صحيح
//     let initialSubtotal = 0;
//     const itemsData = items.map(item => {
//         const originalBasePrice = parseFloat(item.price as string || "0");
//         const { variations: parsedVariations } = parseCartSnapshot(item.variations);
//         const parsedAddons = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];

//         let initialDiscountPrice = originalBasePrice;
//         if (item.discountType && Number(item.discountValue) > 0) {
//             if (item.discountType === "percentage") {
//                 initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(item.discountValue) / 100));
//             } else if (item.discountType === "amount" || item.discountType === "fixed") {
//                 initialDiscountPrice = Math.max(0, originalBasePrice - Number(item.discountValue));
//             }
//         }

//         const dbUnitPrice = parseFloat(item.unitPrice as string || "0");
//         // varPrice = كل زيادة على السعر الأصلي (variations + addons)
//         const varPrice = dbUnitPrice - originalBasePrice;

//         initialSubtotal += (initialDiscountPrice + varPrice) * item.quantity;
//         return { item, originalBasePrice, varPrice, parsedVariations, parsedAddons };
//     });

//     const availableDiscounts = await getAvailableDiscounts(restaurantId!);
//     const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };

//     let finalSubtotal = 0;

//     const formatted = await Promise.all(
//         itemsData.map(async (data: any) => {
//             const { item, originalBasePrice, varPrice, parsedVariations, parsedAddons } = data;

//             // جلب تفاصيل الـ Variations
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
//                         additionalPrice: option.additionalPrice
//                     });
//                 }
//             }

//             // جلب تفاصيل الـ Addons من الـ snapshot المخزن
//             const addonDetails = parsedAddons.map((a: any) => ({
//                 addonId: a.addonId,
//                 name: a.name,
//                 nameAr: a.nameAr,
//                 price: a.price
//             }));

//             const { price: discountedBasePrice } = applyPriorityDiscount(
//                 { id: item.foodId, discountType: item.discountType, discountValue: item.discountValue },
//                 originalBasePrice,
//                 initialSubtotal,
//                 availableDiscounts,
//                 discountState,
//                 true
//             );

//             const finalUnitPrice = discountedBasePrice + varPrice;
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
//                 price: (originalBasePrice + varPrice).toString(), // السعر الأصلي شامل الـ variations والـ addons
//                 unitPrice: finalUnitPrice, // السعر بعد الخصم
//                 totalPrice: finalTotalPrice,
//                 variations: variationDetails,
//                 addons: addonDetails,
//                 note: item.note || null
//             };
//         })
//     );

//     return SuccessResponse(res, {
//         message: "Cart fetched successfully",
//         data: {
//             items: formatted,
//             totalSummary: {
//                 subtotal: finalSubtotal,
//             }
//         }
//     });
// };

/* =========================================
   3. UPDATE CART ITEM
========================================= */
export const updateCartItem = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { cartItemId } = req.params;
    const { quantity, variations, addons: requestAddons, note, branchId, addressId } = req.body;

    const [cartItem] = await db
        .select()
        .from(cartItems)
        .where(and(eq(cartItems.id, cartItemId), eq(cartItems.userId, userId)))
        .limit(1);

    if (!cartItem) throw new BadRequest("Cart item not found");

    const [itemFood] = await db
        .select()
        .from(food)
        .where(eq(food.id, cartItem.foodId))
        .limit(1);

    // Verify branch/address availability
    await validateFoodAvailabilityInBranch(cartItem.foodId, branchId, addressId, itemFood.restaurantid);

    let safeVariations: any[] = [];
    if (variations !== undefined) {
        safeVariations = normalizeVariations(variations);
    } else {
        const { variations: existingVars } = parseCartSnapshot(cartItem.variations);
        safeVariations = normalizeVariations(existingVars);
    }

    let safeAddons: any[] = [];
    if (requestAddons !== undefined) {
        safeAddons = Array.isArray(requestAddons) ? requestAddons : [];
    } else {
        const existingAddons = deepParseJSON(cartItem.addons);
        safeAddons = Array.isArray(existingAddons) ? existingAddons : [];
    }

    const qty = quantity ?? cartItem.quantity;

    const dbVariations = await db
        .select()
        .from(foodVariations)
        .where(eq(foodVariations.foodId, itemFood.id));

    let totalExtraPrice = 0;

    for (const selected of safeVariations) {
        const validDbVariation = dbVariations.find(v => v.id === selected.variationId);
        if (!validDbVariation) throw new BadRequest("Invalid variation ID");
        if (validDbVariation.status === false) throw new BadRequest(`Variation ${validDbVariation.name} is currently unavailable`);

        const dbOptions = await db
            .select()
            .from(variationOptions)
            .where(eq(variationOptions.variationId, validDbVariation.id));

        const foundOption = dbOptions.find(o => o.id === selected.optionId);
        if (!foundOption) throw new BadRequest("Invalid option selected");
        if (foundOption.status === false) throw new BadRequest(`Option ${foundOption.optionName} is currently unavailable`);

        totalExtraPrice += Number(foundOption.additionalPrice || 0);
    }

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
        const dbAddons = await db
            .select()
            .from(addons)
            .where(inArray(addons.id, requestedAddonIds));

        for (const a of safeAddons) {
            const dbAddon = dbAddons.find(d => d.id === a.addonId);
            if (!dbAddon) throw new BadRequest(`Addon not found: ${a.addonId}`);
            if (dbAddon.status === "inactive") throw new BadRequest(`Addon "${dbAddon.name}" is currently unavailable`);

            totalExtraPrice += Number(dbAddon.price || 0);
            addonSnapshot.push({
                addonId: dbAddon.id,
                name: dbAddon.name,
                nameAr: dbAddon.nameAr,
                price: dbAddon.price
            });
        }
    } else if (requestAddons === undefined) {
        const existingAddonSnapshot = deepParseJSON(cartItem.addons);
        const addonsList = Array.isArray(existingAddonSnapshot) ? existingAddonSnapshot : [];
        addonSnapshot = addonsList.map((a: any) => ({
            addonId: a.addonId,
            name: a.name,
            nameAr: a.nameAr,
            price: a.price
        }));
        for (const a of addonSnapshot) {
            totalExtraPrice += Number(a.price || 0);
        }
    }

    const unitPrice = Number(itemFood.price) + totalExtraPrice;

    await db.update(cartItems)
        .set({
            quantity: qty,
            unitPrice: unitPrice.toString(),
            totalPrice: (unitPrice * qty).toString(),
            variations: JSON.stringify({ variations: safeVariations }),
            addons: JSON.stringify(addonSnapshot),
            ...(note !== undefined ? { note: note || null } : {})
        })
        .where(and(eq(cartItems.id, cartItemId), eq(cartItems.userId, userId)));

    return SuccessResponse(res, {
        message: "Cart updated successfully",
        data: {
            unitPrice,
            totalPrice: unitPrice * qty
        }
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
        message: "The item has been removed from the cart"
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
        message: "The cart has been cleared successfully"
    });
};