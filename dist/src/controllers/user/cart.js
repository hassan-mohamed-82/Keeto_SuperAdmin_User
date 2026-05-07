"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearCart = exports.removeCartItem = exports.updateCartItem = exports.getCart = exports.addToCart = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
/* =========================================
   Helper
========================================= */
const normalizeVariations = (variations) => {
    const safe = Array.isArray(variations) ? variations : [];
    return safe
        .filter(v => v?.optionId)
        .sort((a, b) => String(a.optionId).localeCompare(String(b.optionId)));
};
/* =========================================
   1. ADD TO CART
========================================= */
const addToCart = async (req, res) => {
    const userId = req.user?.id;
    const { foodId, quantity = 1, variations = [] } = req.body;
    const safeVariations = Array.isArray(variations) ? variations : [];
    const [itemFood] = await connection_1.db.select().from(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.id, foodId)).limit(1);
    if (!itemFood)
        throw new BadRequest_1.BadRequest("Food not found");
    const existingCart = await connection_1.db.select().from(schema_1.cartItems)
        .where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId))
        .limit(1);
    if (existingCart.length > 0 && existingCart[0].restaurantId !== itemFood.restaurantid) {
        return res.status(409).json({
            success: false,
            message: "You have food from another restaurant",
            clearCartRequired: true
        });
    }
    const dbVariations = await connection_1.db
        .select()
        .from(schema_1.foodVariations)
        .where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, foodId));
    let totalExtraPrice = 0;
    for (const v of dbVariations) {
        const selectedOptions = safeVariations.filter(x => x.variationId === v.id);
        if (v.isRequired && selectedOptions.length === 0) {
            throw new BadRequest_1.BadRequest(`${v.name} is required`);
        }
        const dbOptions = await connection_1.db
            .select()
            .from(schema_1.variationOptions)
            .where((0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, v.id));
        for (const selected of selectedOptions) {
            const found = dbOptions.find(o => o.id === selected.optionId);
            if (!found)
                throw new BadRequest_1.BadRequest("Invalid option selected");
            totalExtraPrice += Number(found.additionalPrice || 0);
        }
    }
    const basePrice = Number(itemFood.price);
    const unitPrice = basePrice + totalExtraPrice;
    const normalized = normalizeVariations(safeVariations);
    const key = JSON.stringify(normalized);
    const existingItems = await connection_1.db.select().from(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.foodId, foodId)));
    const existingSame = existingItems.find(item => JSON.stringify(item.variations) === key);
    if (existingSame) {
        const newQty = existingSame.quantity + quantity;
        await connection_1.db.update(schema_1.cartItems)
            .set({
            quantity: newQty,
            unitPrice: unitPrice.toString(),
            totalPrice: (unitPrice * newQty).toString(),
            variations: JSON.stringify(normalized)
        })
            .where((0, drizzle_orm_1.eq)(schema_1.cartItems.id, existingSame.id));
    }
    else {
        await connection_1.db.insert(schema_1.cartItems).values({
            id: (0, uuid_1.v4)(),
            userId,
            restaurantId: itemFood.restaurantid,
            foodId,
            quantity,
            unitPrice: unitPrice.toString(),
            totalPrice: (unitPrice * quantity).toString(),
            variations: JSON.stringify(normalized)
        });
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Added to cart successfully",
        data: {
            unitPrice,
            totalPrice: unitPrice * quantity
        }
    });
};
exports.addToCart = addToCart;
/* =========================================
   2. GET CART (DETAILED)
========================================= */
const getCart = async (req, res) => {
    const userId = req.user?.id;
    const items = await connection_1.db
        .select({
        cartId: schema_1.cartItems.id,
        foodId: schema_1.food.id,
        name: schema_1.food.name,
        image: schema_1.food.image,
        restaurantId: schema_1.restaurants.id,
        restaurantName: schema_1.restaurants.name,
        quantity: schema_1.cartItems.quantity,
        unitPrice: schema_1.cartItems.unitPrice,
        totalPrice: schema_1.cartItems.totalPrice,
        variations: schema_1.cartItems.variations
    })
        .from(schema_1.cartItems)
        .leftJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.cartItems.foodId, schema_1.food.id))
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.cartItems.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId));
    const formatted = await Promise.all(items.map(async (item) => {
        const parsed = typeof item.variations === "string"
            ? JSON.parse(item.variations)
            : item.variations || [];
        const details = [];
        for (const v of parsed) {
            const [variation] = await connection_1.db
                .select()
                .from(schema_1.foodVariations)
                .where((0, drizzle_orm_1.eq)(schema_1.foodVariations.id, v.variationId))
                .limit(1);
            const [option] = await connection_1.db
                .select()
                .from(schema_1.variationOptions)
                .where((0, drizzle_orm_1.eq)(schema_1.variationOptions.id, v.optionId))
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
    }));
    return (0, response_1.SuccessResponse)(res, { data: formatted });
};
exports.getCart = getCart;
/* =========================================
   3. UPDATE CART ITEM
========================================= */
const updateCartItem = async (req, res) => {
    const userId = req.user?.id;
    const { cartItemId } = req.params;
    const { quantity, variations } = req.body;
    const [cartItem] = await connection_1.db
        .select()
        .from(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.id, cartItemId), (0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId)))
        .limit(1);
    if (!cartItem)
        throw new BadRequest_1.BadRequest("Cart item not found");
    const [itemFood] = await connection_1.db
        .select()
        .from(schema_1.food)
        .where((0, drizzle_orm_1.eq)(schema_1.food.id, cartItem.foodId))
        .limit(1);
    const safeVariations = variations !== undefined
        ? normalizeVariations(variations)
        : normalizeVariations(typeof cartItem.variations === "string"
            ? JSON.parse(cartItem.variations)
            : cartItem.variations || []);
    const qty = quantity ?? cartItem.quantity;
    const dbVariations = await connection_1.db
        .select()
        .from(schema_1.foodVariations)
        .where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, itemFood.id));
    let totalExtraPrice = 0;
    for (const v of dbVariations) {
        const selected = safeVariations.filter(x => x.variationId === v.id);
        const dbOptions = await connection_1.db
            .select()
            .from(schema_1.variationOptions)
            .where((0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, v.id));
        for (const s of selected) {
            const found = dbOptions.find(o => o.id === s.optionId);
            if (!found)
                throw new BadRequest_1.BadRequest("Invalid option");
            totalExtraPrice += Number(found.additionalPrice || 0);
        }
    }
    const unitPrice = Number(itemFood.price) + totalExtraPrice;
    await connection_1.db.update(schema_1.cartItems)
        .set({
        quantity: qty,
        unitPrice: unitPrice.toString(),
        totalPrice: (unitPrice * qty).toString(),
        variations: JSON.stringify(safeVariations)
    })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.id, cartItemId), (0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId)));
    return (0, response_1.SuccessResponse)(res, {
        message: "Cart updated successfully",
        data: {
            unitPrice,
            totalPrice: unitPrice * qty
        }
    });
};
exports.updateCartItem = updateCartItem;
/* =========================================
   4. REMOVE ITEM
========================================= */
const removeCartItem = async (req, res) => {
    const userId = req.user?.id;
    const { cartItemId } = req.params;
    await connection_1.db.delete(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.id, cartItemId), (0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId)));
    return (0, response_1.SuccessResponse)(res, {
        message: "The item has been removed from the cart"
    });
};
exports.removeCartItem = removeCartItem;
/* =========================================
   5. CLEAR CART
========================================= */
const clearCart = async (req, res) => {
    const userId = req.user?.id;
    await connection_1.db.delete(schema_1.cartItems)
        .where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId));
    return (0, response_1.SuccessResponse)(res, {
        message: "The cart has been cleared successfully"
    });
};
exports.clearCart = clearCart;
