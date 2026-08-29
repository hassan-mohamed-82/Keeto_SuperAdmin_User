import { db } from "../models/connection";
import { discounts, discountRestaurants, discountFoods } from "../models/schema/admin/discount";
import { eq, and } from "drizzle-orm";

export const getAvailableDiscounts = async (restaurantId: string) => {
    const now = new Date();

    // 1. Fetch restaurant-specific discounts
    const restDiscounts = await db.select({
        discount: discounts,
        foodId: discountFoods.foodId
    })
        .from(discounts)
        .innerJoin(discountRestaurants, eq(discounts.id, discountRestaurants.discountId))
        .leftJoin(discountFoods, eq(discounts.id, discountFoods.discountId))
        .where(
            and(
                eq(discountRestaurants.restaurantId, restaurantId),
                eq(discounts.isActive, true),
                eq(discounts.isGlobal, false)
            )
        );

    // 2. Fetch global discounts
    const globalDiscountsRows = await db.select({
        discount: discounts,
        foodId: discountFoods.foodId
    })
        .from(discounts)
        .leftJoin(discountFoods, eq(discounts.id, discountFoods.discountId))
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



// import { db } from "../models/connection";
// import { discounts, discountRestaurants, discountFoods } from "../models/schema/admin/discount";
// import { eq, and } from "drizzle-orm";

// export const getAvailableDiscounts = async (restaurantId: string) => {
//     const now = new Date();
    
//     // Fetch restaurant specific discounts
//     const restDiscounts = await db.select({
//         discount: discounts,
//         foodId: discountFoods.foodId
//     })
//     .from(discounts)
//     .innerJoin(discountRestaurants, eq(discounts.id, discountRestaurants.discountId))
//     .leftJoin(discountFoods, eq(discounts.id, discountFoods.discountId))
//     .where(
//         and(
//             eq(discountRestaurants.restaurantId, restaurantId),
//             eq(discounts.isActive, true),
//             eq(discounts.isGlobal, false)
//         )
//     );

//     // Fetch global discounts
//     const globalDiscountsRows = await db.select({
//         discount: discounts,
//         foodId: discountFoods.foodId
//     })
//     .from(discounts)
//     .leftJoin(discountFoods, eq(discounts.id, discountFoods.discountId))
//     .where(
//         and(
//             eq(discounts.isGlobal, true),
//             eq(discounts.isActive, true)
//         )
//     );

//     const allDiscounts = [...restDiscounts, ...globalDiscountsRows].filter(d => {
//         if (d.discount.startDate && new Date(d.discount.startDate) > now) return false;
//         if (d.discount.endDate && new Date(d.discount.endDate) < now) return false;
//         if (d.discount.usageLimit && d.discount.usedCount! >= d.discount.usageLimit) return false;
//         return true;
//     });

//     return allDiscounts;
// };

// export const applyPriorityDiscount = (
//     foodItem: { id: string, discountType: string | null, discountValue: string | number | null },
//     basePrice: number,
//     cartSubtotal: number,
//     availableDiscounts: any[],
//     state: { remainingMaxDiscounts: Map<string, number>, appliedDiscounts: Set<string> },
//     enforceLimits: boolean = true
// ) => {
//     // 1. Priority 1: Food's own discount
//     if (foodItem.discountValue && Number(foodItem.discountValue) > 0) {
//         if (foodItem.discountType === "percentage") {
//             const discount = (basePrice * Number(foodItem.discountValue)) / 100;
//             return { price: Math.max(0, basePrice - discount), appliedDiscount: null, discountNote: null };
//         } else if (foodItem.discountType === "amount" || foodItem.discountType === "fixed") {
//             return { price: Math.max(0, basePrice - Number(foodItem.discountValue)), appliedDiscount: null, discountNote: null };
//         }
//     }

//     // Filter by minOrderAmount if required
//     const validDiscounts = availableDiscounts.filter(d => {
//         if (enforceLimits) {
//             const minOrder = parseFloat(d.discount.minOrderAmount as string || "0");
//             if (cartSubtotal < minOrder) return false;
//         }
//         return true;
//     });

//     let selectedDiscount: any = null;

//     // 2. Priority 2: Restaurant specific discount on this food
//     selectedDiscount = validDiscounts.find(d => !d.discount.isGlobal && d.foodId === foodItem.id);
    
//     // 3. Priority 3: Restaurant general discount
//     if (!selectedDiscount) {
//         selectedDiscount = validDiscounts.find(d => !d.discount.isGlobal && !d.foodId);
//     }

//     // 4. Priority 4: Global specific discount
//     if (!selectedDiscount) {
//         selectedDiscount = validDiscounts.find(d => d.discount.isGlobal && d.foodId === foodItem.id);
//     }

//     // 5. Priority 5: Global general discount
//     if (!selectedDiscount) {
//         selectedDiscount = validDiscounts.find(d => d.discount.isGlobal && !d.foodId);
//     }

//     if (selectedDiscount) {
//         const discountPrice = calculateAppliedDiscount(basePrice, selectedDiscount.discount, state);
//         if (discountPrice < basePrice) {
//             state.appliedDiscounts.add(selectedDiscount.discount.id);
//         }

//         let discountNote = null;
//         if (!enforceLimits) {
//             const minOrder = parseFloat(selectedDiscount.discount.minOrderAmount as string || "0");
//             const maxDisc = parseFloat(selectedDiscount.discount.maxDiscount as string || "0");
            
//             const notes = [];
//             if (minOrder > 0) notes.push(`متاح للطلبات فوق ${minOrder} ج.م`);
//             if (maxDisc > 0) notes.push(`بحد أقصى ${maxDisc} ج.م`);
            
//             if (notes.length > 0) {
//                 discountNote = notes.join(" و ");
//             }
//         }

//         return { price: discountPrice, appliedDiscount: selectedDiscount.discount, discountNote };
//     }

//     return { price: basePrice, appliedDiscount: null, discountNote: null };
// };

// const calculateAppliedDiscount = (basePrice: number, discount: any, state: { remainingMaxDiscounts: Map<string, number> }) => {
//     const value = parseFloat(discount.discountValue as string);
//     let discountAmount = 0;

//     if (discount.discountType === "percentage") {
//         discountAmount = basePrice * (value / 100);
//     } else if (discount.discountType === "fixed_amount" || discount.discountType === "amount" || discount.discountType === "fixed") {
//         discountAmount = value;
//     }

//     // Cap at max discount
//     if (discount.maxDiscount && parseFloat(discount.maxDiscount as string) > 0) {
//         const maxLimit = parseFloat(discount.maxDiscount as string);
//         if (!state.remainingMaxDiscounts.has(discount.id)) {
//             state.remainingMaxDiscounts.set(discount.id, maxLimit);
//         }
        
//         const remaining = state.remainingMaxDiscounts.get(discount.id)!;
//         if (discountAmount > remaining) {
//             discountAmount = remaining;
//         }
//         state.remainingMaxDiscounts.set(discount.id, remaining - discountAmount);
//     }

//     return Math.max(0, basePrice - discountAmount);
// };
