import { and, eq, inArray, isNull, lte, gte, or, sql } from "drizzle-orm";
import { db } from "../models/connection";
import { discounts, discountRestaurants, food } from "../models/schema";

export type DiscountRecord = typeof discounts.$inferSelect;

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

export const getBaseFoodsQuery = () => db
    .select({ food, discount: discounts })
    .from(food)
    .leftJoin(discounts, eq(food.discountId, discounts.id));

export const getActiveGeneralDiscounts = async (restaurantId: string): Promise<DiscountRecord[]> => {
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
 * 2. المنتج مربوط بـ discountId (food.discount_id) وده الخصم "usable" (active + داخل التاريخ + تحت الـ usage limit)
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
        appliedDiscountId: discount.id,
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

    const directIds = [...new Set(rawFoods.map(item => item.discountId).filter(Boolean))] as string[];
    const directDiscounts = directIds.length > 0
        ? await db.select().from(discounts).where(inArray(discounts.id, directIds))
        : [];
    const directDiscountMap = new Map(directDiscounts.map(discount => [discount.id, discount]));

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