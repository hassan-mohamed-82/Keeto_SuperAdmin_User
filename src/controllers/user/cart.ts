// controllers/user/CartController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cartItems, food, restaurants } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

export const addToCart = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { foodId, quantity, variations } = req.body;

    // 1. جلب بيانات الأكلة عشان نعرف هي تبع أي مطعم
    const [itemFood] = await db.select().from(food).where(eq(food.id, foodId)).limit(1);
    if (!itemFood) throw new BadRequest("The food is not found");

    // 2. 🔥 التأكد من "قاعدة المطعم الواحد"
    const existingCart = await db.select().from(cartItems).where(eq(cartItems.userId, userId)).limit(1);
    
    if (existingCart.length > 0 && existingCart[0].restaurantId !== itemFood.restaurantid) {
        return res.status(409).json({ 
            success: false, 
            message: "You have food from another restaurant in the cart, would you like to clear the cart and start a new order from here?",
            clearCartRequired: true 
        });
    }

    // 3. لو الأكلة موجودة أصلاً زود الكمية، لو مش موجودة ضيفها
    const [alreadyInCart] = await db.select().from(cartItems)
        .where(and(eq(cartItems.userId, userId), eq(cartItems.foodId, foodId))).limit(1);

    if (alreadyInCart) {
        await db.update(cartItems)
            .set({ quantity: alreadyInCart.quantity + (quantity || 1) })
            .where(eq(cartItems.id, alreadyInCart.id));
    } else {
        await db.insert(cartItems).values({
            id: uuidv4(),
            userId,
            restaurantId: itemFood.restaurantid,
            foodId,
            quantity: quantity || 1,
            variations
        });
    }

    return SuccessResponse(res, { message: "Added to cart successfully" });
};

export const getMyCart = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;

    const items = await db.select({
        cartId: cartItems.id,
        foodId: food.id,
        name: food.name,
        image: food.image,
        price: food.price,
        quantity: cartItems.quantity,
        restaurantName: restaurants.name // جرب تعمل Join مع الـ restaurants
    })
    .from(cartItems)
    .innerJoin(food, eq(cartItems.foodId, food.id))
    .where(eq(cartItems.userId, userId));

    return SuccessResponse(res, { data: items });
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