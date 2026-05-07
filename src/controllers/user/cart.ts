// controllers/user/CartController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cartItems, food, restaurants, variationOptions,foodVariations } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

export const addToCart = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { foodId, quantity = 1, variations = [] } = req.body;

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

        const selectedOptions = variations.filter((x: any) => x.variationId === v.id);

        if (v.isRequired && selectedOptions.length === 0) {
            throw new BadRequest(`${v.name} is required`);
        }

        if (v.min && selectedOptions.length < v.min) {
            throw new BadRequest(`Minimum ${v.min} required for ${v.name}`);
        }

        if (v.max && selectedOptions.length > v.max) {
            throw new BadRequest(`Maximum ${v.max} allowed for ${v.name}`);
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

    const normalized = variations.sort((a: any, b: any) =>
        a.optionId.localeCompare(b.optionId)
    );

    const key = JSON.stringify(normalized);

    const existingItems = await db.select().from(cartItems)
        .where(and(
            eq(cartItems.userId, userId),
            eq(cartItems.foodId, foodId)
        ));

    const existingSame = existingItems.find((item: any) =>
        JSON.stringify(item.variations) === key
    );

    if (existingSame) {

        const newQuantity = existingSame.quantity + quantity;
        const totalPrice = unitPrice * newQuantity;

        await db.update(cartItems)
            .set({
                quantity: newQuantity,
                unitPrice: unitPrice.toString(),
                totalPrice: totalPrice.toString(),
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

    const formattedItems = await Promise.all(
        items.map(async (item: any) => {

            const parsedVariations =
                typeof item.variations === "string"
                    ? JSON.parse(item.variations)
                    : item.variations || [];

            let detailedVariations: any[] = [];

            for (const v of parsedVariations) {

                // هات الفارييشن من الداتابيز
                const [variation] = await db
                    .select()
                    .from(foodVariations)
                    .where(eq(foodVariations.id, v.variationId))
                    .limit(1);

                // هات الاوبشن
                const [option] = await db
                    .select()
                    .from(variationOptions)
                    .where(eq(variationOptions.id, v.optionId))
                    .limit(1);

                if (variation && option) {
                    detailedVariations.push({
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
                variations: detailedVariations
            };
        })
    );

    return SuccessResponse(res, {
        data: formattedItems
    });
};

export const updateCartItem = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { cartItemId } = req.params;
    const { quantity, variations = [] } = req.body;

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

    if (!itemFood) throw new BadRequest("Food not found");

    const dbVariations = await db
        .select()
        .from(foodVariations)
        .where(eq(foodVariations.foodId, itemFood.id));

    let totalExtraPrice = 0;

    for (const v of dbVariations) {

        const selectedOptions = variations.filter((x: any) => x.variationId === v.id);

        if (v.isRequired && selectedOptions.length === 0) {
            throw new BadRequest(`${v.name} is required`);
        }

        if (v.min && selectedOptions.length < v.min) {
            throw new BadRequest(`Minimum ${v.min} required for ${v.name}`);
        }

        if (v.max && selectedOptions.length > v.max) {
            throw new BadRequest(`Maximum ${v.max} allowed for ${v.name}`);
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

    const finalQty = quantity ?? cartItem.quantity;

    const normalized = variations.sort((a: any, b: any) =>
        a.optionId.localeCompare(b.optionId)
    );

    const totalPrice = unitPrice * finalQty;

    await db.update(cartItems)
        .set({
            quantity: finalQty,
            unitPrice: unitPrice.toString(),
            totalPrice: totalPrice.toString(),
            variations: JSON.stringify(normalized)
        })
        .where(and(
            eq(cartItems.id, cartItemId),
            eq(cartItems.userId, userId)
        ));

    return SuccessResponse(res, {
        message: "Cart updated successfully",
        data: {
            unitPrice,
            totalPrice
        }
    });
};
// ==========================================
// 4. حذف صنف معين من السلة (Delete Item)
// ==========================================
export const removeCartItem = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { cartItemId } = req.params;

    const deleted = await db.delete(cartItems)
        .where(and(eq(cartItems.id, cartItemId), eq(cartItems.userId, userId)));

    if (deleted[0].affectedRows === 0) {
        throw new BadRequest("The item is not found in your cart");
    }

    return SuccessResponse(res, { message: "The item has been removed from the cart" });
};

// ==========================================
// 5. تفريغ السلة بالكامل (Clear Cart)
// ==========================================
export const clearCart = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;

    await db.delete(cartItems).where(eq(cartItems.userId, userId));

    return SuccessResponse(res, { message: "The cart has been cleared successfully" });
};