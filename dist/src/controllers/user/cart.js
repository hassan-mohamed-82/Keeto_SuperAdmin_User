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
const normalizeAddons = (addonsInput) => {
    const safe = Array.isArray(addonsInput) ? addonsInput : [];
    return safe
        .filter(a => a?.addonId)
        .sort((a, b) => String(a.addonId).localeCompare(String(b.addonId)));
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
/**
 * Parse the cart item's `variations` JSON field.
 * Supports both legacy flat-array format and new object format { variations, addons }.
 */
const parseCartSnapshot = (raw) => {
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
const addToCart = async (req, res) => {
    const userId = req.user?.id;
    const { foodId, quantity = 1, variations = [], addons: requestAddons = [], note } = req.body;
    const safeVariations = Array.isArray(variations) ? variations : [];
    const safeAddons = Array.isArray(requestAddons) ? requestAddons : [];
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
    // 1. التحقق من صحة الـ Variations المرسلة
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
    // 2. التأكد من أن الـ Variations الإجبارية تم اختيارها
    for (const v of dbVariations) {
        if (v.isRequired) {
            const isProvided = safeVariations.some(x => x.variationId === v.id);
            if (!isProvided)
                throw new BadRequest_1.BadRequest(`${v.name} is required`);
        }
    }
    // 3. التحقق من صحة الـ Addons المرسلة وحساب سعرها
    let addonSnapshot = [];
    if (safeAddons.length > 0) {
        // التحقق من أن الـ addons مسموح بها لهذه الأكلة (فقط إذا كانت القائمة المسموح بها غير فارغة)
        const allowedAddonIds = Array.isArray(itemFood.addonsId) ? itemFood.addonsId : [];
        if (allowedAddonIds.length > 0) {
            for (const a of safeAddons) {
                if (!allowedAddonIds.includes(a.addonId)) {
                    throw new BadRequest_1.BadRequest(`Addon ${a.addonId} is not available for this food item`);
                }
            }
        }
        const requestedAddonIds = safeAddons.map((a) => a.addonId);
        const dbAddons = await connection_1.db
            .select()
            .from(schema_1.addons)
            .where((0, drizzle_orm_1.inArray)(schema_1.addons.id, requestedAddonIds));
        for (const a of safeAddons) {
            const dbAddon = dbAddons.find(d => d.id === a.addonId);
            if (!dbAddon)
                throw new BadRequest_1.BadRequest(`Addon not found: ${a.addonId}`);
            if (dbAddon.status === "inactive")
                throw new BadRequest_1.BadRequest(`Addon "${dbAddon.name}" is currently unavailable`);
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
    const existingItems = await connection_1.db.select().from(schema_1.cartItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.foodId, foodId)));
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
        await connection_1.db.update(schema_1.cartItems)
            .set({
            quantity: newQty,
            unitPrice: unitPrice.toString(),
            totalPrice: (unitPrice * newQty).toString(),
            variations: JSON.stringify(snapshot),
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
            variations: JSON.stringify(snapshot),
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
    // 1. حساب الـ subtotal الأولي (السعر الأصلي + variations + addons) لتقييم الـ discount بشكل صحيح
    let initialSubtotal = 0;
    const itemsData = items.map(item => {
        const originalBasePrice = parseFloat(item.price || "0");
        const { variations: parsedVariations, addons: parsedAddons } = parseCartSnapshot(item.variations);
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
        // varPrice = كل زيادة على السعر الأصلي (variations + addons)
        const varPrice = dbUnitPrice - originalBasePrice;
        initialSubtotal += (initialDiscountPrice + varPrice) * item.quantity;
        return { item, originalBasePrice, varPrice, parsedVariations, parsedAddons };
    });
    const availableDiscounts = await (0, discount_1.getAvailableDiscounts)(restaurantId);
    const discountState = { remainingMaxDiscounts: new Map(), appliedDiscounts: new Set() };
    let finalSubtotal = 0;
    const formatted = await Promise.all(itemsData.map(async (data) => {
        const { item, originalBasePrice, varPrice, parsedVariations, parsedAddons } = data;
        // جلب تفاصيل الـ Variations
        const variationDetails = [];
        for (const v of parsedVariations) {
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
        // جلب تفاصيل الـ Addons من الـ snapshot المخزن
        const addonDetails = parsedAddons.map((a) => ({
            addonId: a.addonId,
            name: a.name,
            nameAr: a.nameAr,
            price: a.price
        }));
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
            price: (originalBasePrice + varPrice).toString(), // السعر الأصلي شامل الـ variations والـ addons
            unitPrice: finalUnitPrice, // السعر بعد الخصم
            totalPrice: finalTotalPrice,
            variations: variationDetails,
            addons: addonDetails,
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
    const { quantity, variations, addons: requestAddons, note } = req.body;
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
    // تجهيز الـ Variations بشكل آمن
    let safeVariations = [];
    if (variations !== undefined) {
        safeVariations = normalizeVariations(variations);
    }
    else {
        const { variations: existingVars } = parseCartSnapshot(cartItem.variations);
        safeVariations = normalizeVariations(existingVars);
    }
    // تجهيز الـ Addons بشكل آمن
    let safeAddons = [];
    if (requestAddons !== undefined) {
        safeAddons = Array.isArray(requestAddons) ? requestAddons : [];
    }
    else {
        const { addons: existingAddons } = parseCartSnapshot(cartItem.variations);
        safeAddons = existingAddons;
    }
    const qty = quantity ?? cartItem.quantity;
    const dbVariations = await connection_1.db
        .select()
        .from(schema_1.foodVariations)
        .where((0, drizzle_orm_1.eq)(schema_1.foodVariations.foodId, itemFood.id));
    let totalExtraPrice = 0;
    // التحقق من صحة الـ Variations
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
    // التحقق من صحة الـ Addons وحساب سعرها
    let addonSnapshot = [];
    if (safeAddons.length > 0) {
        const allowedAddonIds = Array.isArray(itemFood.addonsId) ? itemFood.addonsId : [];
        if (allowedAddonIds.length > 0) {
            for (const a of safeAddons) {
                if (!allowedAddonIds.includes(a.addonId)) {
                    throw new BadRequest_1.BadRequest(`Addon ${a.addonId} is not available for this food item`);
                }
            }
        }
        const requestedAddonIds = safeAddons.map((a) => a.addonId);
        const dbAddons = await connection_1.db
            .select()
            .from(schema_1.addons)
            .where((0, drizzle_orm_1.inArray)(schema_1.addons.id, requestedAddonIds));
        for (const a of safeAddons) {
            const dbAddon = dbAddons.find(d => d.id === a.addonId);
            if (!dbAddon)
                throw new BadRequest_1.BadRequest(`Addon not found: ${a.addonId}`);
            if (dbAddon.status === "inactive")
                throw new BadRequest_1.BadRequest(`Addon "${dbAddon.name}" is currently unavailable`);
            totalExtraPrice += Number(dbAddon.price || 0);
            addonSnapshot.push({
                addonId: dbAddon.id,
                name: dbAddon.name,
                nameAr: dbAddon.nameAr,
                price: dbAddon.price
            });
        }
    }
    else if (requestAddons === undefined) {
        // لو المستخدم ما بعتش addons في الريكويست، نحتفظ بالـ snapshot الموجود
        const { addons: existingAddonSnapshot } = parseCartSnapshot(cartItem.variations);
        addonSnapshot = existingAddonSnapshot.map((a) => ({
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
    await connection_1.db.update(schema_1.cartItems)
        .set({
        quantity: qty,
        unitPrice: unitPrice.toString(),
        totalPrice: (unitPrice * qty).toString(),
        variations: JSON.stringify(snapshot),
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
