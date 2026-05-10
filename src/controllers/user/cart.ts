import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    cartItems,
    food,
    restaurants,
    variationOptions,
    foodVariations
} from "../../models/schema";

import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

/* =========================================
   Helpers
========================================= */
const normalizeVariations = (variations: any) => {
    const safe = Array.isArray(variations) ? variations : [];
    return safe
        .filter(v => v?.optionId)
        .sort((a, b) => String(a.optionId).localeCompare(String(b.optionId)));
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

/* =========================================
   1. ADD TO CART
========================================= */
export const addToCart = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { foodId, quantity = 1, variations = [] } = req.body;

    const safeVariations = Array.isArray(variations) ? variations : [];

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

    // 1. التأكد من أن الإضافات المرسلة صحيحة وموجودة بالفعل للأكلة دي
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

    // 2. التأكد من أن الإضافات الإجبارية تم اختيارها
    for (const v of dbVariations) {
        if (v.isRequired) {
            const isProvided = safeVariations.some(x => x.variationId === v.id);
            if (!isProvided) throw new BadRequest(`${v.name} is required`);
        }
    }

    const basePrice = Number(itemFood.price);
    const unitPrice = basePrice + totalExtraPrice;

    const normalized = normalizeVariations(safeVariations);
    const key = JSON.stringify(normalized);

    const existingItems = await db.select().from(cartItems)
        .where(and(eq(cartItems.userId, userId), eq(cartItems.foodId, foodId)));

    const existingSame = existingItems.find(item => {
        let dbVars = deepParseJSON(item.variations);
        if (!Array.isArray(dbVars)) dbVars = [];
        return JSON.stringify(normalizeVariations(dbVars)) === key;
    });

    if (existingSame) {
        const newQty = existingSame.quantity + quantity;

        await db.update(cartItems)
            .set({
                quantity: newQty,
                unitPrice: unitPrice.toString(),
                totalPrice: (unitPrice * newQty).toString(),
                variations: JSON.stringify(normalized) 
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
            variations: JSON.stringify(normalized)
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

    const items = await db
        .select({
            cartId: cartItems.id,
            foodId: food.id,
            name: food.name,
            image: food.image,
            restaurantId: restaurants.id,
            restaurantName: restaurants.name,
            quantity: cartItems.quantity,
            unitPrice: cartItems.unitPrice,
            totalPrice: cartItems.totalPrice,
            variations: cartItems.variations
        })
        .from(cartItems)
        .leftJoin(food, eq(cartItems.foodId, food.id))
        .leftJoin(restaurants, eq(cartItems.restaurantId, restaurants.id))
        .where(eq(cartItems.userId, userId));

    const formatted = await Promise.all(
        items.map(async (item: any) => {

            let parsedVariations = deepParseJSON(item.variations);
            
            if (!Array.isArray(parsedVariations)) {
                parsedVariations = [];
            }

            const details: any[] = [];

            for (const v of parsedVariations) {
                if (!v.variationId || !v.optionId) continue;

                const [variation] = await db
                    .select()
                    .from(foodVariations)
                    .where(eq(foodVariations.id, v.variationId))
                    .limit(1);

                const [option] = await db
                    .select()
                    .from(variationOptions)
                    .where(eq(variationOptions.id, v.optionId))
                    .limit(1);

                if (variation && option) {
                    details.push({
                        variationId: variation.id,
                        variationName: variation.name,
                        variationNameAr: variation.nameAr,
                        optionId: option.id,
                        optionName: option.optionName,
                        optionNameAr: option.optionNameAr,
                        additionalPrice: option.additionalPrice
                    });
                } else {
                    console.log(`[Warning]: Variation or Option not found in DB! VarID: ${v.variationId}, OptID: ${v.optionId}`);
                }
            }

            return {
                cartId: item.cartId,
                foodId: item.foodId,
                name: item.name,
                image: item.image,
                restaurantId: item.restaurantId,
                restaurantName: item.restaurantName,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
                variations: details
            };
        })
    );

    return SuccessResponse(res, {
        data: formatted
    });
};

/* =========================================
   3. UPDATE CART ITEM
========================================= */
export const updateCartItem = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { cartItemId } = req.params;
    const { quantity, variations } = req.body;

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

    // تجهيز الإضافات بشكل آمن باستخدام الفك العميق
    let safeVariations: any[] = [];
    if (variations !== undefined) {
        safeVariations = normalizeVariations(variations);
    } else {
        let parsedDbVars = deepParseJSON(cartItem.variations);
        safeVariations = normalizeVariations(parsedDbVars);
    }

    const qty = quantity ?? cartItem.quantity;

    const dbVariations = await db
        .select()
        .from(foodVariations)
        .where(eq(foodVariations.foodId, itemFood.id));

    let totalExtraPrice = 0;

    // التحقق من صحة الإضافات عند التحديث
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

    const unitPrice = Number(itemFood.price) + totalExtraPrice;

    await db.update(cartItems)
        .set({
            quantity: qty,
            unitPrice: unitPrice.toString(),
            totalPrice: (unitPrice * qty).toString(),
            variations: JSON.stringify(safeVariations)
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