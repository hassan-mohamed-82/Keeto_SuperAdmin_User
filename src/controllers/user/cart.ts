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

    // 1. Get food
    const [itemFood] = await db.select().from(food).where(eq(food.id, foodId)).limit(1);
    if (!itemFood) throw new BadRequest("Food not found");

    // 2. Check restaurant rule
    const existingCart = await db.select().from(cartItems).where(eq(cartItems.userId, userId)).limit(1);

    if (existingCart.length > 0 && existingCart[0].restaurantId !== itemFood.restaurantid) {
        return res.status(409).json({
            success: false,
            message: "You have food from another restaurant",
            clearCartRequired: true
        });
    }

    // 3. Get variations from DB
    const dbVariations = await db.select().from(foodVariations).where(eq(foodVariations.foodId, foodId));

    let totalExtraPrice = 0;

    // 🔥 VALIDATION
    for (const v of dbVariations) {

        const selectedOptions = variations.filter((x: any) => x.variationId === v.id);

        // Required
        if (v.isRequired && selectedOptions.length === 0) {
            throw new BadRequest(`${v.name} is required`);
        }

        // Min
        if (v.min && selectedOptions.length < v.min) {
            throw new BadRequest(`Minimum ${v.min} required for ${v.name}`);
        }

        // Max
        if (v.max && selectedOptions.length > v.max) {
            throw new BadRequest(`Maximum ${v.max} allowed for ${v.name}`);
        }

        // Single
        if (v.selectionType === "single" && selectedOptions.length > 1) {
            throw new BadRequest(`${v.name} allows only one option`);
        }

        // Get options
        const dbOptions = await db.select().from(variationOptions).where(eq(variationOptions.variationId, v.id));

        for (const selected of selectedOptions) {
            const found = dbOptions.find(o => o.id === selected.optionId);

            if (!found) {
                throw new BadRequest("Invalid option selected");
            }

            totalExtraPrice += Number(found.additionalPrice || 0);
        }
    }

    // 4. Calculate price
    const basePrice = Number(itemFood.price);
    const unitPrice = basePrice + totalExtraPrice;

    // 5. Unique key
    const key = JSON.stringify(
        variations.sort((a: any, b: any) => a.optionId.localeCompare(b.optionId))
    );

    const existingItems = await db.select().from(cartItems)
        .where(and(eq(cartItems.userId, userId), eq(cartItems.foodId, foodId)));

    const existingSame = existingItems.find((item: any) =>
        JSON.stringify(item.variations) === key
    );

    if (existingSame) {
        const newQuantity = existingSame.quantity + quantity;
        const newTotal = unitPrice * newQuantity;

        await db.update(cartItems)
            .set({
                quantity: newQuantity,
                totalPrice: newTotal.toString()
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
            variations
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

export const getMyCart = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;

    const items = await db.select({
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
    .innerJoin(food, eq(cartItems.foodId, food.id))
    .innerJoin(restaurants, eq(cartItems.restaurantId, restaurants.id))
    .where(eq(cartItems.userId, userId));

    // ===============================
    // 2. فكّ الـ variations IDs وجيب تفاصيلها
    // ===============================
    const formatted = await Promise.all(
        items.map(async (item: any) => {

            const variations = item.variations || [];

            const detailedVariations = [];

            for (const v of variations) {

                const variationId = v.variationId;
                const optionId = v.optionId;

                const [variation] = await db
                    .select()
                    .from(foodVariations)
                    .where(eq(foodVariations.id, variationId))
                    .limit(1);

                const [option] = await db
                    .select()
                    .from(variationOptions)
                    .where(eq(variationOptions.id, optionId))
                    .limit(1);

                if (variation && option) {
                    detailedVariations.push({
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
                variations: detailedVariations
            };
        })
    );

    return SuccessResponse(res, {
        data: formatted
    });
};

export const updateCartItem = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { cartItemId } = req.params;
    const { quantity } = req.body;

    // لو الموبايل بعت الكمية 0 أو أقل، نعتبرها عملية حذف
    if (quantity <= 0) {
        await db.delete(cartItems)
            .where(and(eq(cartItems.id, cartItemId), eq(cartItems.userId, userId)));
        return SuccessResponse(res, { message: "The item has been removed from the cart" });
    }

    // تحديث الكمية
    const updated = await db.update(cartItems)
        .set({ quantity })
        .where(and(eq(cartItems.id, cartItemId), eq(cartItems.userId, userId)));

    if (updated[0].affectedRows === 0) {
        throw new BadRequest("The item is not found in your cart");
    }

    return SuccessResponse(res, { message: "The quantity has been updated successfully" });
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