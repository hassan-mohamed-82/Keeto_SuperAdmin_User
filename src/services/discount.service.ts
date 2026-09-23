import { and, eq, inArray, isNull, lte, gte, or, sql } from "drizzle-orm";
import { db } from "../models/connection";
import { discounts, discountGroups, discountRestaurants, food } from "../models/schema";

// ✅ دلوقتي بيمثل صف الخصم الفرعي (Group) مدموج ببيانات الخصم الأساسي (Campaign)
export type DiscountRecord = {
    id: string;                 // discountGroups.id — ده اللي food.discountId بيشاور عليه
    discountId: string;         // discounts.id (الخصم الأساسي)
    discountType: "percentage" | "fixed_amount";
    discountValue: string;
    maxDiscount: string | null;
    isActive: boolean | null;
    startDate: Date | null;
    endDate: Date | null;
    usageLimit: number | null;
    usedCount: number | null;
    isGlobal: boolean | null;
    minOrderAmount: string | null;
    name: string;
    nameAr: string | null;
    nameFr: string | null;
    logo: string | null;
};

export type ResolvedProduct = {
    originalPrice: number;
    finalPrice: number;
    discountAmount: number;
    discountNote: string | null;
    appliedDiscountId: string | null;
    discountSource: "product" | "restaurant" | "global" | null;
    discountDetails: {
        id: string | null;
        name: string | null;
        nameAr: string | null;
        nameFr: string | null;
        type: string;
        value: number;
        maxDiscount: number | null;
        minOrderAmount: number;
        isGlobal: boolean;
        startDate: Date | null;
        endDate: Date | null;
        logo: string | null;
        source: "product" | "restaurant" | "global";
    } | null;
};

type ProductDiscountInput = {
    price: string | number | null;
    discountType?: string | null;
    discountValue?: string | number | null;
    discount?: DiscountRecord | null;
};

// ✅ الـ query الأساسية اللي بتجيب المنتج مع الخصم الفرعي والأساسي مربوطين مع بعض
export const getBaseFoodsQuery = () => db
    .select({ food, discountGroup: discountGroups, discount: discounts })
    .from(food)
    .leftJoin(discountGroups, eq(food.discountId, discountGroups.id))
    .leftJoin(discounts, eq(discountGroups.discountId, discounts.id));

/**
 * ⚠️ ملحوظة: الدالة دي بترجع صفوف من جدول discounts (الحملة الأساسية) بس،
 * وده الجدول اللي بقى مالوش discountType/discountValue/maxDiscount بعد التقسيم
 * (دول بقوا في discountGroups). الدالة دي مش مستخدمة في resolveProductDiscount
 * تحت (تم إلغاء الـ fallback للخصومات العامة بالكامل حسب الطلب)، فلو حابب
 * تستخدمها في مكان تاني (كوبونات مثلاً)، لازم تراجع الأعمدة اللي بترجعها.
 */
export const getActiveGeneralDiscounts = async (restaurantId: string) => {
    const now = new Date();

    return db
        .selectDistinct({ discount: discounts })
        .from(discounts)
        .leftJoin(discountRestaurants, eq(discounts.id, discountRestaurants.discountId))
        .where(and(
            eq(discounts.isActive, true),
            or(eq(discounts.isGlobal, true), eq(discountRestaurants.restaurantId, restaurantId)),
            or(isNull(discounts.startDate), lte(discounts.startDate, now)),
            or(isNull(discounts.endDate), gte(discounts.endDate, now)),
            or(isNull(discounts.usageLimit), sql`${discounts.usedCount} < ${discounts.usageLimit}`),
        ))
        .then(rows => rows.map(row => row.discount));
};

const isUsableDiscount = (discount: DiscountRecord) => {
    const now = new Date();
    return Boolean(discount.isActive)
        && (!discount.startDate || new Date(discount.startDate) <= now)
        && (!discount.endDate || new Date(discount.endDate) >= now)
        && (discount.usageLimit === null || (discount.usedCount ?? 0) < discount.usageLimit);
};

/**
 * الخصم بيتطبق فقط لو:
 * 1. المنتج عنده discountType + discountValue مباشرين (خصم يدوي على المنتج نفسه)، أو
 * 2. المنتج مربوط بـ discountId (food.discount_id → discountGroups.id) وده الخصم
 *    "usable" (الحملة الأساسية active + داخل التاريخ + تحت الـ usage limit)
 *
 * لا يوجد fallback لأي خصم عام (Global) أو خصم مطعم — أي منتج من غير الحالتين دول
 * بيرجع من غير خصم خالص، حتى لو فيه خصومات عامة شغالة في النظام.
 */
export const resolveProductDiscount = (
    foodItem: ProductDiscountInput,
): ResolvedProduct => {
    const originalPrice = Math.max(0, Number(foodItem.price ?? 0));
    const hasDirectProductDiscount = Boolean(
        foodItem.discountType
        && foodItem.discountValue !== null
        && foodItem.discountValue !== undefined
        && Number(foodItem.discountValue) > 0
    );

    const discount = !hasDirectProductDiscount && foodItem.discount && isUsableDiscount(foodItem.discount)
        ? foodItem.discount
        : null;

    if (hasDirectProductDiscount) {
        const value = Math.max(0, Number(foodItem.discountValue));
        const discountAmount = foodItem.discountType === "percentage"
            ? Math.min(originalPrice, originalPrice * value / 100)
            : Math.min(originalPrice, value);
        return {
            originalPrice,
            finalPrice: Math.max(0, originalPrice - discountAmount),
            discountAmount,
            discountNote: foodItem.discountType === "percentage" ? `${value}% off` : `${value} off`,
            appliedDiscountId: null,
            discountSource: "product",
            discountDetails: {
                id: null,
                name: "Product discount",
                nameAr: null,
                nameFr: null,
                type: foodItem.discountType!,
                value,
                maxDiscount: null,
                minOrderAmount: 0,
                isGlobal: false,
                startDate: null,
                endDate: null,
                logo: null,
                source: "product",
            },
        };
    }

    if (!discount) {
        return {
            originalPrice,
            finalPrice: originalPrice,
            discountAmount: 0,
            discountNote: null,
            appliedDiscountId: null,
            discountSource: null,
            discountDetails: null,
        };
    }

    const value = Math.max(0, Number(discount.discountValue ?? 0));
    let discountAmount = discount.discountType === "percentage"
        ? originalPrice * value / 100
        : value;

    const maxDiscount = Number(discount.maxDiscount ?? 0);
    if (maxDiscount > 0) discountAmount = Math.min(discountAmount, maxDiscount);
    discountAmount = Math.min(originalPrice, Math.max(0, discountAmount));

    return {
        originalPrice,
        finalPrice: Math.max(0, originalPrice - discountAmount),
        discountAmount,
        discountNote: discount.discountType === "percentage"
            ? `${value}% off`
            : `${value} off`,
        appliedDiscountId: discount.id, // ✅ ده الـ discountGroups.id (نفس food.discountId)
        discountSource: discount.isGlobal ? "global" : "restaurant",
        discountDetails: {
            id: discount.id,
            name: discount.name,
            nameAr: discount.nameAr,
            nameFr: discount.nameFr,
            type: discount.discountType,
            value,
            maxDiscount: discount.maxDiscount ? Number(discount.maxDiscount) : null,
            minOrderAmount: Number(discount.minOrderAmount ?? 0),
            isGlobal: Boolean(discount.isGlobal),
            startDate: discount.startDate,
            endDate: discount.endDate,
            logo: discount.logo,
            source: discount.isGlobal ? "global" : "restaurant",
        },
    };
};

export const formatProductsWithDiscounts = async <T extends { id?: string | null; foodId?: string | null; price: string | number | null; discountId?: string | null; discount_type?: string | null; discount_value?: string | number | null; discountType?: string | null; discountValue?: string | number | null; foodDiscountType?: string | null; foodDiscountValue?: string | number | null }>(
    rawFoods: T[],
    restaurantId: string,
): Promise<Array<T & ResolvedProduct>> => {
    if (rawFoods.length === 0) return [];

    // ✅ food.discountId بيشاور على discountGroups.id دلوقتي، فلازم نجيب الـ group
    //    مدموج مع بيانات الخصم الأساسي (discounts) في نفس الـ query
    const directIds = [...new Set(rawFoods.map(item => item.discountId).filter(Boolean))] as string[];

    const directGroups = directIds.length > 0
        ? await db
            .select({
                id: discountGroups.id,
                discountId: discountGroups.discountId,
                discountType: discountGroups.discountType,
                discountValue: discountGroups.discountValue,
                maxDiscount: discountGroups.maxDiscount,
                isActive: discounts.isActive,
                startDate: discounts.startDate,
                endDate: discounts.endDate,
                usageLimit: discounts.usageLimit,
                usedCount: discounts.usedCount,
                isGlobal: discounts.isGlobal,
                minOrderAmount: discounts.minOrderAmount,
                name: discounts.name,
                nameAr: discounts.nameAr,
                nameFr: discounts.nameFr,
                logo: discounts.logo,
            })
            .from(discountGroups)
            .innerJoin(discounts, eq(discountGroups.discountId, discounts.id))
            .where(inArray(discountGroups.id, directIds))
        : [];

    const directDiscountMap = new Map<string, DiscountRecord>(
        directGroups.map(group => [group.id, group as DiscountRecord])
    );

    return rawFoods.map(item => {
        const itemWithDiscount = {
            ...item,
            discountType: item.discountType ?? item.discount_type ?? item.foodDiscountType,
            discountValue: item.discountValue ?? item.discount_value ?? item.foodDiscountValue,
            discount: item.discountId ? directDiscountMap.get(item.discountId) ?? null : null,
        };
        return {
            ...item,
            // Expose normalized names so offers and checkout share one contract.
            discountType: itemWithDiscount.discountType ?? null,
            discountValue: itemWithDiscount.discountValue ?? null,
            ...resolveProductDiscount(itemWithDiscount),
        };
    });
};