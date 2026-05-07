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
   Helper
========================================= */
const normalizeVariations = (variations: any) => {
    const safe = Array.isArray(variations) ? variations : [];
    return safe
        .filter(v => v?.optionId)
        .sort((a, b) => String(a.optionId).localeCompare(String(b.optionId)));
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

    for (const v of dbVariations) {
        const selectedOptions = safeVariations.filter(x => x.variationId === v.id);

        if (v.isRequired && selectedOptions.length === 0) {
            throw new BadRequest(`${v.name} is required`);
        }

        const dbOptions = await db
            .select()
            .from(variationOptions)
            .where(eq(variationOptions.variationId, v.id));

        for (const selected of selectedOptions) {
            const found = dbOptions.find(o => o.id === selected.optionId);
            if (!found) throw new BadRequest("Invalid option selected");

            totalExtraPrice += Number(found.additionalPrice || 0);
        }
    }

    const basePrice = Number(itemFood.price);
    const unitPrice = basePrice + totalExtraPrice;

    const normalized = normalizeVariations(safeVariations);
    const key = JSON.stringify(normalized);

    const existingItems = await db.select().from(cartItems)
        .where(and(eq(cartItems.userId, userId), eq(cartItems.foodId, foodId)));

    const existingSame = existingItems.find(item =>
        JSON.stringify(item.variations) === key
    );

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

            const parsed = typeof item.variations === "string"
                ? JSON.parse(item.variations)
                : item.variations || [];

            const details = [];

            for (const v of parsed) {
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
                        optionId: option.id,
                        optionName: option.optionName,
                        additionalPrice: option.additionalPrice
                    });
                }
            }

            return {
                ...item,
                variations: details
            };
        })
    );

    return SuccessResponse(res, { data: formatted });
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

    const safeVariations =
        variations !== undefined
            ? normalizeVariations(variations)
            : normalizeVariations(
                  typeof cartItem.variations === "string" 
                      ? JSON.parse(cartItem.variations) 
                      : cartItem.variations || []
              );

    const qty = quantity ?? cartItem.quantity;

    const dbVariations = await db
        .select()
        .from(foodVariations)
        .where(eq(foodVariations.foodId, itemFood.id));

    let totalExtraPrice = 0;

    for (const v of dbVariations) {
        const selected = safeVariations.filter(x => x.variationId === v.id);

        const dbOptions = await db
            .select()
            .from(variationOptions)
            .where(eq(variationOptions.variationId, v.id));

        for (const s of selected) {
            const found = dbOptions.find(o => o.id === s.optionId);
            if (!found) throw new BadRequest("Invalid option");

            totalExtraPrice += Number(found.additionalPrice || 0);
        }
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