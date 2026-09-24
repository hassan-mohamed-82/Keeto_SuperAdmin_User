"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyPriorityDiscount = exports.getAvailableDiscounts = void 0;
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const getAvailableDiscounts = async (restaurantId) => {
    const now = new Date();
    // 1. Fetch restaurant-specific discounts
    const restDiscounts = await connection_1.db.select({
        discount: {
            id: schema_1.discounts.id,
            name: schema_1.discounts.name,
            minOrderAmount: schema_1.discounts.minOrderAmount,
            usageLimit: schema_1.discounts.usageLimit,
            usedCount: schema_1.discounts.usedCount,
            startDate: schema_1.discounts.startDate,
            endDate: schema_1.discounts.endDate,
            isActive: schema_1.discounts.isActive,
            isGlobal: schema_1.discounts.isGlobal,
            discountType: schema_1.discountGroups.discountType,
            discountValue: schema_1.discountGroups.discountValue,
            maxDiscount: schema_1.discountGroups.maxDiscount,
        },
        foodId: schema_1.food.id
    })
        .from(schema_1.discounts)
        .innerJoin(schema_1.discountRestaurants, (0, drizzle_orm_1.eq)(schema_1.discounts.id, schema_1.discountRestaurants.discountId))
        .leftJoin(schema_1.discountGroups, (0, drizzle_orm_1.eq)(schema_1.discounts.id, schema_1.discountGroups.discountId))
        .leftJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.discountGroups.id, schema_1.food.discountId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discountRestaurants.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true), (0, drizzle_orm_1.eq)(schema_1.discounts.isGlobal, false)));
    // 2. Fetch global discounts
    const globalDiscountsRows = await connection_1.db.select({
        discount: {
            id: schema_1.discounts.id,
            name: schema_1.discounts.name,
            minOrderAmount: schema_1.discounts.minOrderAmount,
            usageLimit: schema_1.discounts.usageLimit,
            usedCount: schema_1.discounts.usedCount,
            startDate: schema_1.discounts.startDate,
            endDate: schema_1.discounts.endDate,
            isActive: schema_1.discounts.isActive,
            isGlobal: schema_1.discounts.isGlobal,
            discountType: schema_1.discountGroups.discountType,
            discountValue: schema_1.discountGroups.discountValue,
            maxDiscount: schema_1.discountGroups.maxDiscount,
        },
        foodId: schema_1.food.id
    })
        .from(schema_1.discounts)
        .leftJoin(schema_1.discountGroups, (0, drizzle_orm_1.eq)(schema_1.discounts.id, schema_1.discountGroups.discountId))
        .leftJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.discountGroups.id, schema_1.food.discountId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discounts.isGlobal, true), (0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true)));
    const allDiscounts = [...restDiscounts, ...globalDiscountsRows].filter(d => {
        if (d.discount.startDate && new Date(d.discount.startDate) > now)
            return false;
        if (d.discount.endDate && new Date(d.discount.endDate) < now)
            return false;
        if (d.discount.usageLimit && (d.discount.usedCount ?? 0) >= d.discount.usageLimit)
            return false;
        return true;
    });
    return allDiscounts;
};
exports.getAvailableDiscounts = getAvailableDiscounts;
const applyPriorityDiscount = (foodItem, basePrice, cartSubtotal, availableDiscounts, state, enforceLimits = true) => {
    // Priority 1: Direct Item Discount (خصم الصنف المباشر من المنيو)
    if (foodItem.discountValue && Number(foodItem.discountValue) > 0) {
        let discount = 0;
        const val = Number(foodItem.discountValue);
        if (foodItem.discountType === "percentage") {
            discount = (basePrice * val) / 100;
        }
        else if (["amount", "fixed", "fixed_amount"].includes(foodItem.discountType || "")) {
            discount = val;
        }
        const finalPrice = Math.max(0, basePrice - discount);
        return {
            price: finalPrice,
            appliedDiscount: {
                id: null,
                discountType: foodItem.discountType,
                discountValue: foodItem.discountValue,
                isGlobal: false
            },
            discountNote: null
        };
    }
    // Filter discounts by minOrderAmount
    const validDiscounts = availableDiscounts.filter(d => {
        if (enforceLimits) {
            const minOrder = parseFloat(d.discount.minOrderAmount || "0");
            if (cartSubtotal < minOrder)
                return false;
        }
        return true;
    });
    // Cascade Priority Checks (الأولوية للخصومات المخصصة ثم العامة)
    let selectedDiscount = validDiscounts.find(d => !d.discount.isGlobal && d.foodId === foodItem.id);
    if (!selectedDiscount) {
        selectedDiscount = validDiscounts.find(d => !d.discount.isGlobal && !d.foodId);
    }
    if (!selectedDiscount) {
        selectedDiscount = validDiscounts.find(d => d.discount.isGlobal && d.foodId === foodItem.id);
    }
    if (!selectedDiscount) {
        selectedDiscount = validDiscounts.find(d => d.discount.isGlobal && !d.foodId);
    }
    if (selectedDiscount) {
        const discountPrice = calculateAppliedDiscount(basePrice, selectedDiscount.discount, state);
        if (discountPrice < basePrice) {
            state.appliedDiscounts.add(selectedDiscount.discount.id);
        }
        let discountNote = null;
        if (!enforceLimits) {
            const minOrder = parseFloat(selectedDiscount.discount.minOrderAmount || "0");
            const maxDisc = parseFloat(selectedDiscount.discount.maxDiscount || "0");
            const notes = [];
            if (minOrder > 0)
                notes.push(`متاح للطلبات فوق ${minOrder} ج.م`);
            if (maxDisc > 0)
                notes.push(`بحد أقصى ${maxDisc} ج.م`);
            if (notes.length > 0) {
                discountNote = notes.join(" و ");
            }
        }
        return { price: discountPrice, appliedDiscount: selectedDiscount.discount, discountNote };
    }
    return { price: basePrice, appliedDiscount: null, discountNote: null };
};
exports.applyPriorityDiscount = applyPriorityDiscount;
const calculateAppliedDiscount = (basePrice, discount, state) => {
    const value = parseFloat(discount.discountValue || "0");
    let discountAmount = 0;
    const discountType = discount.discountType || discount.type;
    if (discountType === "percentage") {
        discountAmount = basePrice * (value / 100);
    }
    else if (["fixed_amount", "amount", "fixed"].includes(discountType)) {
        // للخصم الثابت: نضمن عدم تطبيق الخصم الثابت بالكامل أكثر من مرة إذا تم تتبعه عبر الـ Map
        if (!state.remainingMaxDiscounts.has(discount.id)) {
            state.remainingMaxDiscounts.set(discount.id, value);
        }
        const remainingFixed = state.remainingMaxDiscounts.get(discount.id);
        discountAmount = Math.min(basePrice, remainingFixed);
        state.remainingMaxDiscounts.set(discount.id, remainingFixed - discountAmount);
        return Math.max(0, basePrice - discountAmount);
    }
    // Cap Percentage Discount by maxDiscount
    if (discount.maxDiscount && parseFloat(discount.maxDiscount) > 0) {
        const maxLimit = parseFloat(discount.maxDiscount);
        if (!state.remainingMaxDiscounts.has(discount.id)) {
            state.remainingMaxDiscounts.set(discount.id, maxLimit);
        }
        const remainingMax = state.remainingMaxDiscounts.get(discount.id);
        if (discountAmount > remainingMax) {
            discountAmount = remainingMax;
        }
        state.remainingMaxDiscounts.set(discount.id, remainingMax - discountAmount);
    }
    return Math.max(0, basePrice - discountAmount);
};
