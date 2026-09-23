"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatProductsWithDiscounts = exports.resolveProductDiscount = exports.getActiveGeneralDiscounts = exports.getBaseFoodsQuery = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
// ✅ الـ query الأساسية اللي بتجيب المنتج مع الخصم الفرعي والأساسي مربوطين مع بعض
const getBaseFoodsQuery = () => connection_1.db
    .select({ food: schema_1.food, discountGroup: schema_1.discountGroups, discount: schema_1.discounts })
    .from(schema_1.food)
    .leftJoin(schema_1.discountGroups, (0, drizzle_orm_1.eq)(schema_1.food.discountId, schema_1.discountGroups.id))
    .leftJoin(schema_1.discounts, (0, drizzle_orm_1.eq)(schema_1.discountGroups.discountId, schema_1.discounts.id));
exports.getBaseFoodsQuery = getBaseFoodsQuery;
/**
 * ⚠️ ملحوظة: الدالة دي بترجع صفوف من جدول discounts (الحملة الأساسية) بس،
 * وده الجدول اللي بقى مالوش discountType/discountValue/maxDiscount بعد التقسيم
 * (دول بقوا في discountGroups). الدالة دي مش مستخدمة في resolveProductDiscount
 * تحت (تم إلغاء الـ fallback للخصومات العامة بالكامل حسب الطلب)، فلو حابب
 * تستخدمها في مكان تاني (كوبونات مثلاً)، لازم تراجع الأعمدة اللي بترجعها.
 */
const getActiveGeneralDiscounts = async (restaurantId) => {
    const now = new Date();
    return connection_1.db
        .selectDistinct({ discount: schema_1.discounts })
        .from(schema_1.discounts)
        .leftJoin(schema_1.discountRestaurants, (0, drizzle_orm_1.eq)(schema_1.discounts.id, schema_1.discountRestaurants.discountId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true), (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.discounts.isGlobal, true), (0, drizzle_orm_1.eq)(schema_1.discountRestaurants.restaurantId, restaurantId)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.startDate), (0, drizzle_orm_1.lte)(schema_1.discounts.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.endDate), (0, drizzle_orm_1.gte)(schema_1.discounts.endDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.usageLimit), (0, drizzle_orm_1.sql) `${schema_1.discounts.usedCount} < ${schema_1.discounts.usageLimit}`)))
        .then(rows => rows.map(row => row.discount));
};
exports.getActiveGeneralDiscounts = getActiveGeneralDiscounts;
const isUsableDiscount = (discount) => {
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
const resolveProductDiscount = (foodItem) => {
    const originalPrice = Math.max(0, Number(foodItem.price ?? 0));
    const hasDirectProductDiscount = Boolean(foodItem.discountType
        && foodItem.discountValue !== null
        && foodItem.discountValue !== undefined
        && Number(foodItem.discountValue) > 0);
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
                type: foodItem.discountType,
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
    if (maxDiscount > 0)
        discountAmount = Math.min(discountAmount, maxDiscount);
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
exports.resolveProductDiscount = resolveProductDiscount;
const formatProductsWithDiscounts = async (rawFoods, restaurantId) => {
    if (rawFoods.length === 0)
        return [];
    // ✅ food.discountId بيشاور على discountGroups.id دلوقتي، فلازم نجيب الـ group
    //    مدموج مع بيانات الخصم الأساسي (discounts) في نفس الـ query
    const directIds = [...new Set(rawFoods.map(item => item.discountId).filter(Boolean))];
    const directGroups = directIds.length > 0
        ? await connection_1.db
            .select({
            id: schema_1.discountGroups.id,
            discountId: schema_1.discountGroups.discountId,
            discountType: schema_1.discountGroups.discountType,
            discountValue: schema_1.discountGroups.discountValue,
            maxDiscount: schema_1.discountGroups.maxDiscount,
            isActive: schema_1.discounts.isActive,
            startDate: schema_1.discounts.startDate,
            endDate: schema_1.discounts.endDate,
            usageLimit: schema_1.discounts.usageLimit,
            usedCount: schema_1.discounts.usedCount,
            isGlobal: schema_1.discounts.isGlobal,
            minOrderAmount: schema_1.discounts.minOrderAmount,
            name: schema_1.discounts.name,
            nameAr: schema_1.discounts.nameAr,
            nameFr: schema_1.discounts.nameFr,
            logo: schema_1.discounts.logo,
        })
            .from(schema_1.discountGroups)
            .innerJoin(schema_1.discounts, (0, drizzle_orm_1.eq)(schema_1.discountGroups.discountId, schema_1.discounts.id))
            .where((0, drizzle_orm_1.inArray)(schema_1.discountGroups.id, directIds))
        : [];
    const directDiscountMap = new Map(directGroups.map(group => [group.id, group]));
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
            ...(0, exports.resolveProductDiscount)(itemWithDiscount),
        };
    });
};
exports.formatProductsWithDiscounts = formatProductsWithDiscounts;
