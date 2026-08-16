// src/helpers/food.helper.ts
import { branchIngredientLocks, branchMenuItems, foodIngredients } from "../models/schema";
import { eq, and, inArray, or, isNull } from "drizzle-orm";
import { db } from "../models/connection";

/**
 * تحدد الفروع غير المتاحة لكل وجبة من قائمة الوجبات الممررة.
 * تتم عملية الفحص بناءً على شرطين:
 * 1. حالة الوجبة بالفرع (غير نشطة inactive أو نفد مخزونها المحدود).
 * 2. إغلاق أحد المكونات الأساسية (essential) للوجبة على مستوى الفرع.
 *
 * @param foodIds قائمة معرفات الوجبات المراد فحصها
 * @returns Map تحتوي على foodId كمفتاح وقائمة بـ branchIds غير المتاحة له كقيمة
 */
export const getUnavailableBranchesForFoods = async (foodIds: string[]): Promise<Map<string, string[]>> => {
    // تهيئة خريطة النتائج باستخدام Set لمنع تكرار الفروع لكل وجبة
    const unavailableBranchesMap = new Map<string, Set<string>>();

    if (foodIds.length === 0) return new Map();

    foodIds.forEach((id) => unavailableBranchesMap.set(id, new Set()));

    // 1. فحص جدول إعدادات الوجبة بالفرع (branch_menu_items): إيجاد الفروع التي أوقفت الوجبة أو نفد مخزونها
    const disabledMenuItems = await db
        .select({
            foodId: branchMenuItems.foodId,
            branchId: branchMenuItems.branchId,
            stockType: branchMenuItems.stockType,
            stockQty: branchMenuItems.stockQty,
            status: branchMenuItems.status,
        })
        .from(branchMenuItems)
        .where(inArray(branchMenuItems.foodId, foodIds));

    for (const item of disabledMenuItems) {
        const isOutOfStock = item.stockType === "limited" && (item.stockQty ?? 0) <= 0;
        const isInactive = item.status === "inactive";

        // إذا كانت الوجبة غير نشطة أو نفد مخزونها، يُضاف الفرع لقائمة الفروع غير المتاحة لهذه الوجبة
        if (isInactive || isOutOfStock) {
            unavailableBranchesMap.get(item.foodId)?.add(item.branchId);
        }
    }

    // 2. فحص المكونات: جلب معرفات المكونات الأساسية (isEssential = true) المرتبطة بهذه الوجبات
    const essentialIngredients = await db
        .select({
            foodId: foodIngredients.foodId,
            ingredientId: foodIngredients.ingredientId,
        })
        .from(foodIngredients)
        .where(and(
            inArray(foodIngredients.foodId, foodIds),
            eq(foodIngredients.isEssential, true)
        ));

    if (essentialIngredients.length > 0) {
        const essentialIngredientIds = [...new Set(essentialIngredients.map((i) => i.ingredientId))];

        // 3. فحص أقفال المكونات (branch_ingredient_locks): جلب الأقفال النشطة للمكونات الأساسية
        // يشمل الأقفال العامة على المكون (null) أو الأقفال المخصصة لوجبة محددة
        const activeLocks = await db
            .select({
                branchId: branchIngredientLocks.branchId,
                foodId: branchIngredientLocks.foodId,
                ingredientId: branchIngredientLocks.ingredientId,
            })
            .from(branchIngredientLocks)
            .where(and(
                inArray(branchIngredientLocks.ingredientId, essentialIngredientIds),
                eq(branchIngredientLocks.isAvailable, false),
                or(
                    inArray(branchIngredientLocks.foodId, foodIds),
                    isNull(branchIngredientLocks.foodId)
                )
            ));

        // مطابقة القفل بالوجبة والمكون الخاص بها لإضافة الفرع إلى القائمة عند التأثر
        for (const lock of activeLocks) {
            for (const item of essentialIngredients) {
                if (item.ingredientId === lock.ingredientId) {
                    // القفل يطبق إما على الوجبة المحددة أو على كل الوجبات التي تستخدم المكون إذا كان foodId خاليًا (null)
                    if (!lock.foodId || lock.foodId === item.foodId) {
                        unavailableBranchesMap.get(item.foodId)?.add(lock.branchId);
                    }
                }
            }
        }
    }

    // 4. تحويل نتائج الـ Set إلى Array وتنسيق البنية النهائية للـ Map
    const resultMap = new Map<string, string[]>();
    unavailableBranchesMap.forEach((branchSet, foodId) => {
        resultMap.set(foodId, Array.from(branchSet));
    });

    return resultMap;
};