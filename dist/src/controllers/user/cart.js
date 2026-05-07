"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearCart = exports.removeCartItem = exports.updateCartItem = exports.getCart = exports.addToCart = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const addToCart = async (req, res) => {
    const userId = req.user?.id;
    const { foodId, quantity = 1, variations = [] } = req.body;
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
        const selectedOptions = variations.filter((x) => x.variationId === v.id);
        if (v.isRequired && selectedOptions.length === 0) {
            throw new BadRequest_1.BadRequest(`${v.name} is required`);
        }
        if (v.min && selectedOptions.length < v.min) {
            throw new BadRequest_1.BadRequest(`Minimum ${v.min} required for ${v.name}`);
        }
        if (v.max && selectedOptions.length > v.max) {
            throw new BadRequest_1.BadRequest(`Maximum ${v.max} allowed for ${v.name}`);
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
    const normalized = variations.sort((a, b) => a.optionId.localeCompare(b.optionId));
    const key = JSON.stringify(normalized);
    const existingItems = await connection_1.db.select().from(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.foodId, foodId)));
    const existingSame = existingItems.find((item) => JSON.stringify(item.variations) === key);
    if (existingSame) {
        const newQuantity = existingSame.quantity + quantity;
        const totalPrice = unitPrice * newQuantity;
        await connection_1.db.update(schema_1.cartItems)
            .set({
            quantity: newQuantity,
            unitPrice: unitPrice.toString(),
            totalPrice: totalPrice.toString(),
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
    const formattedItems = await Promise.all(items.map(async (item) => {
        const parsedVariations = typeof item.variations === "string"
            ? JSON.parse(item.variations)
            : item.variations || [];
        let detailedVariations = [];
        for (const v of parsedVariations) {
            // هات الفارييشن من الداتابيز
            const [variation] = await connection_1.db
                .select()
                .from(schema_1.foodVariations)
                .where((0, drizzle_orm_1.eq)(schema_1.foodVariations.id, v.variationId))
                .limit(1);
            // هات الاوبشن
            const [option] = await connection_1.db
                .select()
                .from(schema_1.variationOptions)
                .where((0, drizzle_orm_1.eq)(schema_1.variationOptions.id, v.optionId))
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
    }));
    return (0, response_1.SuccessResponse)(res, {
        data: formattedItems
    });
};
exports.getCart = getCart;
const updateCartItem = async (req, res) => {
    const userId = req.user?.id;
    const { cartItemId } = req.params;
    const { quantity, variations = [] } = req.body;
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
    if (!itemFood)
        throw new BadRequest_1.BadRequest("Food not found");
    const dbVariations = await connection_1.db
        .select()
        .from(schema_1.foodVariations)
        .where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, itemFood.id));
    let totalExtraPrice = 0;
    for (const v of dbVariations) {
        const selectedOptions = variations.filter((x) => x.variationId === v.id);
        if (v.isRequired && selectedOptions.length === 0) {
            throw new BadRequest_1.BadRequest(`${v.name} is required`);
        }
        if (v.min && selectedOptions.length < v.min) {
            throw new BadRequest_1.BadRequest(`Minimum ${v.min} required for ${v.name}`);
        }
        if (v.max && selectedOptions.length > v.max) {
            throw new BadRequest_1.BadRequest(`Maximum ${v.max} allowed for ${v.name}`);
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
    const finalQty = quantity ?? cartItem.quantity;
    const normalized = variations.sort((a, b) => a.optionId.localeCompare(b.optionId));
    const totalPrice = unitPrice * finalQty;
    await connection_1.db.update(schema_1.cartItems)
        .set({
        quantity: finalQty,
        unitPrice: unitPrice.toString(),
        totalPrice: totalPrice.toString(),
        variations: JSON.stringify(normalized)
    })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.id, cartItemId), (0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId)));
    return (0, response_1.SuccessResponse)(res, {
        message: "Cart updated successfully",
        data: {
            unitPrice,
            totalPrice
        }
    });
};
exports.updateCartItem = updateCartItem;
// ==========================================
// 4. حذف صنف معين من السلة (Delete Item)
// ==========================================
const removeCartItem = async (req, res) => {
    const userId = req.user?.id;
    const { cartItemId } = req.params;
    const deleted = await connection_1.db.delete(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.id, cartItemId), (0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId)));
    if (deleted[0].affectedRows === 0) {
        throw new BadRequest_1.BadRequest("The item is not found in your cart");
    }
    return (0, response_1.SuccessResponse)(res, { message: "The item has been removed from the cart" });
};
exports.removeCartItem = removeCartItem;
// ==========================================
// 5. تفريغ السلة بالكامل (Clear Cart)
// ==========================================
const clearCart = async (req, res) => {
    const userId = req.user?.id;
    await connection_1.db.delete(schema_1.cartItems).where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId));
    return (0, response_1.SuccessResponse)(res, { message: "The cart has been cleared successfully" });
};
exports.clearCart = clearCart;
