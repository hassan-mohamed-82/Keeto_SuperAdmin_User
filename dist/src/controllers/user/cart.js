"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearCart = exports.removeCartItem = exports.updateCartItem = exports.getCart = exports.addToCart = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const discount_1 = require("../../utils/discount");
/* =========================================
   Helpers
========================================= */
const normalizeVariations = (variations) => {
    const safe = Array.isArray(variations) ? variations : [];
    return safe
        .filter(v => v?.optionId)
        .sort((a, b) => String(a.optionId).localeCompare(String(b.optionId)));
};
// الفك العميق لتفادي مشكلة (Double Stringification)
const deepParseJSON = (data) => {
    if (typeof data === 'string') {
        try {
            return deepParseJSON(JSON.parse(data));
        }
        catch {
            return data;
        }
    }
    return data;
};
/* =========================================
   1. ADD TO CART
========================================= */
const addToCart = async (req, res) => {
    const userId = req.user?.id;
    const { foodId, quantity = 1, variations = [], note } = req.body;
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
    // 1. التأكد من أن الإضافات المرسلة صحيحة وموجودة بالفعل للأكلة دي
    for (const selected of safeVariations) {
        const validDbVariation = dbVariations.find(v => v.id === selected.variationId);
        if (!validDbVariation) {
            throw new BadRequest_1.BadRequest(`Invalid variation ID sent: ${selected.variationId}`);
        }
        if (validDbVariation.status === false) {
            throw new BadRequest_1.BadRequest(`Variation ${validDbVariation.name} is currently unavailable`);
        }
        const dbOptions = await connection_1.db
            .select()
            .from(schema_1.variationOptions)
            .where((0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, validDbVariation.id));
        const foundOption = dbOptions.find(o => o.id === selected.optionId);
        if (!foundOption) {
            throw new BadRequest_1.BadRequest(`Invalid option selected for variation: ${validDbVariation.name}`);
        }
        if (foundOption.status === false) {
            throw new BadRequest_1.BadRequest(`Option ${foundOption.optionName} is currently unavailable`);
        }
        totalExtraPrice += Number(foundOption.additionalPrice || 0);
    }
    // 2. التأكد من أن الإضافات الإجبارية تم اختيارها
    for (const v of dbVariations) {
        if (v.isRequired) {
            const isProvided = safeVariations.some(x => x.variationId === v.id);
            if (!isProvided)
                throw new BadRequest_1.BadRequest(`${v.name} is required`);
        }
    }
    // 3. احتساب السعر الأصلي مع الإضافات لتخزينه في قاعدة البيانات
    const unitPrice = Number(itemFood.price) + totalExtraPrice;
    const normalized = normalizeVariations(safeVariations);
    const key = JSON.stringify(normalized);
    const existingItems = await connection_1.db.select().from(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.foodId, foodId)));
    const existingSame = existingItems.find(item => {
        let dbVars = deepParseJSON(item.variations);
        if (!Array.isArray(dbVars))
            dbVars = [];
        return JSON.stringify(normalizeVariations(dbVars)) === key;
    });
    if (existingSame) {
        const newQty = existingSame.quantity + quantity;
        await connection_1.db.update(schema_1.cartItems)
            .set({
            quantity: newQty,
            unitPrice: unitPrice.toString(),
            totalPrice: (unitPrice * newQty).toString(),
            variations: JSON.stringify(normalized),
            // update note only if provided
            ...(note !== undefined ? { note: note || null } : {})
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
            variations: JSON.stringify(normalized),
            note: note || null
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
        price: schema_1.food.price,
        discountType: schema_1.food.discount_type,
        discountValue: schema_1.food.discount_value,
        restaurantId: schema_1.restaurants.id,
        restaurantName: schema_1.restaurants.name,
        quantity: schema_1.cartItems.quantity,
        unitPrice: schema_1.cartItems.unitPrice,
        totalPrice: schema_1.cartItems.totalPrice,
        variations: schema_1.cartItems.variations,
        note: schema_1.cartItems.note
    })
        .from(schema_1.cartItems)
        .leftJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.cartItems.foodId, schema_1.food.id))
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.cartItems.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId));
    if (items.length === 0) {
        return (0, response_1.SuccessResponse)(res, { data: { items: [], totalSummary: { subtotal: 0 } } });
    }
    const restaurantId = items[0].restaurantId;
    // 1. Calculate initial subtotal using original food price + variations to evaluate minOrderAmount correctly
    let initialSubtotal = 0;
    const itemsData = items.map(item => {
        const originalBasePrice = parseFloat(item.price || "0");
        const safeVariations = deepParseJSON(item.variations) || [];
        const details = Array.isArray(safeVariations) ? safeVariations : [];
        let initialDiscountPrice = originalBasePrice;
        if (item.discountType && Number(item.discountValue) > 0) {
            if (item.discountType === "percentage") {
                initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(item.discountValue) / 100));
            }
            else if (item.discountType === "amount" || item.discountType === "fixed") {
                initialDiscountPrice = Math.max(0, originalBasePrice - Number(item.discountValue));
            }
        }
        const dbUnitPrice = parseFloat(item.unitPrice || "0");
        const varPrice = dbUnitPrice - originalBasePrice;
        initialSubtotal += (initialDiscountPrice + varPrice) * item.quantity;
        return { item, originalBasePrice, varPrice, details };
    });
    const availableDiscounts = await (0, discount_1.getAvailableDiscounts)(restaurantId);
    const discountState = { remainingMaxDiscounts: new Map(), appliedDiscounts: new Set() };
    let finalSubtotal = 0;
    const formatted = await Promise.all(itemsData.map(async (data) => {
        const { item, originalBasePrice, varPrice, details } = data;
        const variationDetails = [];
        for (const v of details) {
            if (!v.variationId || !v.optionId)
                continue;
            const [variation] = await connection_1.db.select().from(schema_1.foodVariations).where((0, drizzle_orm_1.eq)(schema_1.foodVariations.id, v.variationId)).limit(1);
            const [option] = await connection_1.db.select().from(schema_1.variationOptions).where((0, drizzle_orm_1.eq)(schema_1.variationOptions.id, v.optionId)).limit(1);
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
        const { price: discountedBasePrice } = (0, discount_1.applyPriorityDiscount)({ id: item.foodId, discountType: item.discountType, discountValue: item.discountValue }, originalBasePrice, initialSubtotal, availableDiscounts, discountState, true);
        const finalUnitPrice = discountedBasePrice + varPrice;
        const finalTotalPrice = finalUnitPrice * item.quantity;
        finalSubtotal += finalTotalPrice;
        return {
            cartId: item.cartId,
            foodId: item.foodId,
            name: item.name,
            image: item.image,
            restaurantId: item.restaurantId,
            restaurantName: item.restaurantName,
            quantity: item.quantity,
            price: (originalBasePrice + varPrice).toString(), // Original unit price with variations
            unitPrice: finalUnitPrice, // Final discounted unit price with variations
            totalPrice: finalTotalPrice,
            variations: variationDetails,
            note: item.note || null
        };
    }));
    return (0, response_1.SuccessResponse)(res, {
        message: "Cart fetched successfully",
        data: {
            items: formatted,
            totalSummary: {
                subtotal: finalSubtotal,
            }
        }
    });
};
exports.getCart = getCart;
/* =========================================
   3. UPDATE CART ITEM
========================================= */
const updateCartItem = async (req, res) => {
    const userId = req.user?.id;
    const { cartItemId } = req.params;
    const { quantity, variations, note } = req.body;
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
    // تجهيز الإضافات بشكل آمن باستخدام الفك العميق
    let safeVariations = [];
    if (variations !== undefined) {
        safeVariations = normalizeVariations(variations);
    }
    else {
        let parsedDbVars = deepParseJSON(cartItem.variations);
        safeVariations = normalizeVariations(parsedDbVars);
    }
    const qty = quantity ?? cartItem.quantity;
    const dbVariations = await connection_1.db
        .select()
        .from(schema_1.foodVariations)
        .where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, itemFood.id));
    let totalExtraPrice = 0;
    // التحقق من صحة الإضافات عند التحديث
    for (const selected of safeVariations) {
        const validDbVariation = dbVariations.find(v => v.id === selected.variationId);
        if (!validDbVariation)
            throw new BadRequest_1.BadRequest("Invalid variation ID");
        if (validDbVariation.status === false)
            throw new BadRequest_1.BadRequest(`Variation ${validDbVariation.name} is currently unavailable`);
        const dbOptions = await connection_1.db
            .select()
            .from(schema_1.variationOptions)
            .where((0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, validDbVariation.id));
        const foundOption = dbOptions.find(o => o.id === selected.optionId);
        if (!foundOption)
            throw new BadRequest_1.BadRequest("Invalid option selected");
        if (foundOption.status === false)
            throw new BadRequest_1.BadRequest(`Option ${foundOption.optionName} is currently unavailable`);
        totalExtraPrice += Number(foundOption.additionalPrice || 0);
    }
    // 4. احتساب السعر الأصلي مع الإضافات لتخزينه في قاعدة البيانات
    const unitPrice = Number(itemFood.price) + totalExtraPrice;
    await connection_1.db.update(schema_1.cartItems)
        .set({
        quantity: qty,
        unitPrice: unitPrice.toString(),
        totalPrice: (unitPrice * qty).toString(),
        variations: JSON.stringify(safeVariations),
        // update note only if provided
        ...(note !== undefined ? { note: note || null } : {})
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
