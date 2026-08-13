import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    cartItems,
    food,
    restaurants,
    variationOptions,
    foodVariations,
    addons
} from "../../models/schema";

import { eq, and, inArray } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";
import { getAvailableDiscounts, applyPriorityDiscount } from "../../utils/discount";

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

// الفك العميق لتفادي مشكلة (Double Stringification)
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

/**
 * Parse the cart item's `variations` JSON field.
 * Supports both legacy flat-array format and new object format { variations, addons }.
 */
const parseCartSnapshot = (raw: any): { variations: any[]; addons: any[] } => {
    const parsed = deepParseJSON(raw);
    if (Array.isArray(parsed)) {
        // Legacy: flat array was only variations
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

/* =========================================
   1. ADD TO CART
========================================= */
export const addToCart = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { foodId, quantity = 1, variations = [], addons: requestAddons = [], note } = req.body;

    const safeVariations = Array.isArray(variations) ? variations : [];
    const safeAddons = Array.isArray(requestAddons) ? requestAddons : [];

    const [itemFood] = await db.select().from(food).where(eq(food.id, foodId)).limit(1);
    if (!itemFood) throw new BadRequest("Food not found");

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

    // 1. التحقق من صحة الـ Variations المرسلة
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

    // 2. التأكد من أن الـ Variations الإجبارية تم اختيارها
    for (const v of dbVariations) {
        if (v.isRequired) {
            const isProvided = safeVariations.some(x => x.variationId === v.id);
            if (!isProvided) throw new BadRequest(`${v.name} is required`);
        }
    }

    // 3. التحقق من صحة الـ Addons المرسلة وحساب سعرها
    let addonSnapshot: { addonId: string; name: string; nameAr: string; price: string }[] = [];
    if (safeAddons.length > 0) {
        // التحقق من أن الـ addons مسموح بها لهذه الأكلة (فقط إذا كانت القائمة المسموح بها غير فارغة)
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

    // 4. احتساب السعر الكلي
    const unitPrice = Number(itemFood.price) + totalExtraPrice;

    const normalizedVariations = normalizeVariations(safeVariations);
    const normalizedAddons = normalizeAddons(addonSnapshot);
    // مفتاح التفرد يشمل كلاً من الـ variations والـ addons
    const key = JSON.stringify({ variations: normalizedVariations, addons: normalizedAddons });

    const snapshot = { variations: normalizedVariations, addons: addonSnapshot };

    const existingItems = await db.select().from(cartItems)
        .where(and(eq(cartItems.userId, userId), eq(cartItems.foodId, foodId)));

    const existingSame = existingItems.find(item => {
        const { variations: dbVars, addons: dbAddons } = parseCartSnapshot(item.variations);
        const existingKey = JSON.stringify({
            variations: normalizeVariations(dbVars),
            addons: normalizeAddons(dbAddons)
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
   2. GET CART (DETAILED)
========================================= */
export const getCart = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const queryRestaurantId = req.query.restaurantId as string | undefined;

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
            restaurantId: restaurants.id,
            restaurantName: restaurants.name,
            quantity: cartItems.quantity,
            unitPrice: cartItems.unitPrice,
            totalPrice: cartItems.totalPrice,
            variations: cartItems.variations,
            note: cartItems.note
        })
        .from(cartItems)
        .leftJoin(food, eq(cartItems.foodId, food.id))
        .leftJoin(restaurants, eq(cartItems.restaurantId, restaurants.id))
        .where(and(...conditions));

    if (items.length === 0) {
        return SuccessResponse(res, { data: { items: [], totalSummary: { subtotal: 0 } } });
    }

    const restaurantId = items[0].restaurantId;

    // 1. حساب الـ subtotal الأولي (السعر الأصلي + variations + addons) لتقييم الـ discount بشكل صحيح
    let initialSubtotal = 0;
    const itemsData = items.map(item => {
        const originalBasePrice = parseFloat(item.price as string || "0");
        const { variations: parsedVariations, addons: parsedAddons } = parseCartSnapshot(item.variations);

        let initialDiscountPrice = originalBasePrice;
        if (item.discountType && Number(item.discountValue) > 0) {
            if (item.discountType === "percentage") {
                initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(item.discountValue) / 100));
            } else if (item.discountType === "amount" || item.discountType === "fixed") {
                initialDiscountPrice = Math.max(0, originalBasePrice - Number(item.discountValue));
            }
        }

        const dbUnitPrice = parseFloat(item.unitPrice as string || "0");
        // varPrice = كل زيادة على السعر الأصلي (variations + addons)
        const varPrice = dbUnitPrice - originalBasePrice;

        initialSubtotal += (initialDiscountPrice + varPrice) * item.quantity;
        return { item, originalBasePrice, varPrice, parsedVariations, parsedAddons };
    });

    const availableDiscounts = await getAvailableDiscounts(restaurantId!);
    const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };

    let finalSubtotal = 0;

    const formatted = await Promise.all(
        itemsData.map(async (data: any) => {
            const { item, originalBasePrice, varPrice, parsedVariations, parsedAddons } = data;

            // جلب تفاصيل الـ Variations
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

            // جلب تفاصيل الـ Addons من الـ snapshot المخزن
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
                price: (originalBasePrice + varPrice).toString(), // السعر الأصلي شامل الـ variations والـ addons
                unitPrice: finalUnitPrice, // السعر بعد الخصم
                totalPrice: finalTotalPrice,
                variations: variationDetails,
                addons: addonDetails,
                note: item.note || null
            };
        })
    );

    return SuccessResponse(res, {
        message: "Cart fetched successfully",
        data: {
            items: formatted,
            totalSummary: {
                subtotal: finalSubtotal,
            }
        }
    });
};

/* =========================================
   3. UPDATE CART ITEM
========================================= */
export const updateCartItem = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { cartItemId } = req.params;
    const { quantity, variations, addons: requestAddons, note } = req.body;

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

    // تجهيز الـ Variations بشكل آمن
    let safeVariations: any[] = [];
    if (variations !== undefined) {
        safeVariations = normalizeVariations(variations);
    } else {
        const { variations: existingVars } = parseCartSnapshot(cartItem.variations);
        safeVariations = normalizeVariations(existingVars);
    }

    // تجهيز الـ Addons بشكل آمن
    let safeAddons: any[] = [];
    if (requestAddons !== undefined) {
        safeAddons = Array.isArray(requestAddons) ? requestAddons : [];
    } else {
        const { addons: existingAddons } = parseCartSnapshot(cartItem.variations);
        safeAddons = existingAddons;
    }

    const qty = quantity ?? cartItem.quantity;

    const dbVariations = await db
        .select()
        .from(foodVariations)
        .where(eq(foodVariations.foodId, itemFood.id));

    let totalExtraPrice = 0;

    // التحقق من صحة الـ Variations
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

    // التحقق من صحة الـ Addons وحساب سعرها
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
        // لو المستخدم ما بعتش addons في الريكويست، نحتفظ بالـ snapshot الموجود
        const { addons: existingAddonSnapshot } = parseCartSnapshot(cartItem.variations);
        addonSnapshot = existingAddonSnapshot.map((a: any) => ({
            addonId: a.addonId,
            name: a.name,
            nameAr: a.nameAr,
            price: a.price
        }));
        // إعادة حساب سعر الـ addons من الـ snapshot الموجود
        for (const a of addonSnapshot) {
            totalExtraPrice += Number(a.price || 0);
        }
    }

    const unitPrice = Number(itemFood.price) + totalExtraPrice;
    const snapshot = { variations: safeVariations, addons: addonSnapshot };

    await db.update(cartItems)
        .set({
            quantity: qty,
            unitPrice: unitPrice.toString(),
            totalPrice: (unitPrice * qty).toString(),
            variations: JSON.stringify(snapshot),
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