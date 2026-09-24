import { db } from "../models/connection";
import { discounts, discountRestaurants, discountGroups, food } from "../models/schema";
import { eq, and } from "drizzle-orm";

export const getAvailableDiscounts = async (restaurantId: string) => {
    const now = new Date();

    // 1. Fetch restaurant-specific discounts
    const restDiscounts = await db.select({
        discount: {
            id: discounts.id,
            name: discounts.name,
            minOrderAmount: discounts.minOrderAmount,
            usageLimit: discounts.usageLimit,
            usedCount: discounts.usedCount,
            startDate: discounts.startDate,
            endDate: discounts.endDate,
            isActive: discounts.isActive,
            isGlobal: discounts.isGlobal,
            discountType: discountGroups.discountType,
            discountValue: discountGroups.discountValue,
            maxDiscount: discountGroups.maxDiscount,
        },
        foodId: food.id
    })
        .from(discounts)
        .innerJoin(discountRestaurants, eq(discounts.id, discountRestaurants.discountId))
        .leftJoin(discountGroups, eq(discounts.id, discountGroups.discountId))
        .leftJoin(food, eq(discountGroups.id, food.discountId))
        .where(
            and(
                eq(discountRestaurants.restaurantId, restaurantId),
                eq(discounts.isActive, true),
                eq(discounts.isGlobal, false)
            )
        );

    // 2. Fetch global discounts
    const globalDiscountsRows = await db.select({
        discount: {
            id: discounts.id,
            name: discounts.name,
            minOrderAmount: discounts.minOrderAmount,
            usageLimit: discounts.usageLimit,
            usedCount: discounts.usedCount,
            startDate: discounts.startDate,
            endDate: discounts.endDate,
            isActive: discounts.isActive,
            isGlobal: discounts.isGlobal,
            discountType: discountGroups.discountType,
            discountValue: discountGroups.discountValue,
            maxDiscount: discountGroups.maxDiscount,
        },
        foodId: food.id
    })
        .from(discounts)
        .leftJoin(discountGroups, eq(discounts.id, discountGroups.discountId))
        .leftJoin(food, eq(discountGroups.id, food.discountId))
        .where(
            and(
                eq(discounts.isGlobal, true),
                eq(discounts.isActive, true)
            )
        );

    const allDiscounts = [...restDiscounts, ...globalDiscountsRows].filter(d => {
        if (d.discount.startDate && new Date(d.discount.startDate) > now) return false;
        if (d.discount.endDate && new Date(d.discount.endDate) < now) return false;
        if (d.discount.usageLimit && (d.discount.usedCount ?? 0) >= d.discount.usageLimit) return false;
        return true;
    });

    return allDiscounts;
};

export const applyPriorityDiscount = (
    foodItem: { id: string; discountType: string | null; discountValue: string | number | null },
    basePrice: number,
    cartSubtotal: number,
    availableDiscounts: any[],
    state: { remainingMaxDiscounts: Map<string, number>; appliedDiscounts: Set<string> },
    enforceLimits: boolean = true
) => {
    // Priority 1: Direct Item Discount (خصم الصنف المباشر من المنيو)
    if (foodItem.discountValue && Number(foodItem.discountValue) > 0) {
        let discount = 0;
        const val = Number(foodItem.discountValue);

        if (foodItem.discountType === "percentage") {
            discount = (basePrice * val) / 100;
        } else if (["amount", "fixed", "fixed_amount"].includes(foodItem.discountType || "")) {
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
            const minOrder = parseFloat((d.discount.minOrderAmount as string) || "0");
            if (cartSubtotal < minOrder) return false;
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
            const minOrder = parseFloat((selectedDiscount.discount.minOrderAmount as string) || "0");
            const maxDisc = parseFloat((selectedDiscount.discount.maxDiscount as string) || "0");

            const notes: string[] = [];
            if (minOrder > 0) notes.push(`متاح للطلبات فوق ${minOrder} ج.م`);
            if (maxDisc > 0) notes.push(`بحد أقصى ${maxDisc} ج.م`);

            if (notes.length > 0) {
                discountNote = notes.join(" و ");
            }
        }

        return { price: discountPrice, appliedDiscount: selectedDiscount.discount, discountNote };
    }

    return { price: basePrice, appliedDiscount: null, discountNote: null };
};

const calculateAppliedDiscount = (
    basePrice: number,
    discount: any,
    state: { remainingMaxDiscounts: Map<string, number> }
) => {
    const value = parseFloat(discount.discountValue as string || "0");
    let discountAmount = 0;
    const discountType = discount.discountType || discount.type;

    if (discountType === "percentage") {
        discountAmount = basePrice * (value / 100);
    } else if (["fixed_amount", "amount", "fixed"].includes(discountType)) {
        // للخصم الثابت: نضمن عدم تطبيق الخصم الثابت بالكامل أكثر من مرة إذا تم تتبعه عبر الـ Map
        if (!state.remainingMaxDiscounts.has(discount.id)) {
            state.remainingMaxDiscounts.set(discount.id, value);
        }
        const remainingFixed = state.remainingMaxDiscounts.get(discount.id)!;
        discountAmount = Math.min(basePrice, remainingFixed);
        state.remainingMaxDiscounts.set(discount.id, remainingFixed - discountAmount);

        return Math.max(0, basePrice - discountAmount);
    }

    // Cap Percentage Discount by maxDiscount
    if (discount.maxDiscount && parseFloat(discount.maxDiscount as string) > 0) {
        const maxLimit = parseFloat(discount.maxDiscount as string);
        if (!state.remainingMaxDiscounts.has(discount.id)) {
            state.remainingMaxDiscounts.set(discount.id, maxLimit);
        }

        const remainingMax = state.remainingMaxDiscounts.get(discount.id)!;
        if (discountAmount > remainingMax) {
            discountAmount = remainingMax;
        }
        state.remainingMaxDiscounts.set(discount.id, remainingMax - discountAmount);
    }

    return Math.max(0, basePrice - discountAmount);
};