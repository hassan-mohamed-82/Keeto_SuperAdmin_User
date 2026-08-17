// src/helpers/food.helper.ts
import { branchIngredientLocks, branchMenuItems, foodIngredients, branches } from "../models/schema";
import { eq, and, inArray, or, isNull } from "drizzle-orm";
import { db } from "../models/connection";

// ==========================================
// نوع بيانات الفرع المُعاد
// ==========================================
export type BranchInfo = {
    id: string;
    name: string;
    nameAr: string | null;
    nameFr: string | null;
};

/**
 * تحدد الفروع غير المتاحة لكل وجبة من قائمة الوجبات الممررة.
 * تتم عملية الفحص بناءً على شرطين:
 * 1. حالة الوجبة بالفرع (غير نشطة inactive أو نفد مخزونها المحدود).
 * 2. إغلاق أحد المكونات الأساسية (essential) للوجبة على مستوى الفرع.
 *
 * @param foodIds قائمة معرفات الوجبات المراد فحصها
 * @returns Map تحتوي على foodId كمفتاح وقائمة بكائنات الفروع غير المتاحة له كقيمة
 */
export const getUnavailableBranchesForFoods = async (
    foodIds: string[]
): Promise<Map<string, BranchInfo[]>> => {
    // تهيئة خريطة النتائج باستخدام Map داخلية لمنع تكرار الفروع (مفتاحها branchId)
    const unavailableBranchesMap = new Map<string, Map<string, BranchInfo>>();

    if (foodIds.length === 0) return new Map();

    foodIds.forEach((id) => unavailableBranchesMap.set(id, new Map()));

    // 1. فحص جدول إعدادات الوجبة بالفرع (branch_menu_items): إيجاد الفروع التي أوقفت الوجبة أو نفد مخزونها
    const disabledMenuItems = await db
        .select({
            foodId: branchMenuItems.foodId,
            branchId: branchMenuItems.branchId,
            stockType: branchMenuItems.stockType,
            stockQty: branchMenuItems.stockQty,
            status: branchMenuItems.status,
            branchName: branches.name,
            branchNameAr: branches.nameAr,
            branchNameFr: branches.nameFr,
        })
        .from(branchMenuItems)
        .leftJoin(branches, eq(branchMenuItems.branchId, branches.id))
        .where(inArray(branchMenuItems.foodId, foodIds));

    for (const item of disabledMenuItems) {
        const isOutOfStock = item.stockType === "limited" && (item.stockQty ?? 0) <= 0;
        const isInactive = item.status === "inactive";

        // إذا كانت الوجبة غير نشطة أو نفد مخزونها، يُضاف الفرع لقائمة الفروع غير المتاحة لهذه الوجبة
        if (isInactive || isOutOfStock) {
            const branchInfo: BranchInfo = {
                id: item.branchId,
                name: item.branchName ?? item.branchId,
                nameAr: item.branchNameAr ?? null,
                nameFr: item.branchNameFr ?? null,
            };
            unavailableBranchesMap.get(item.foodId)?.set(item.branchId, branchInfo);
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
                branchName: branches.name,
                branchNameAr: branches.nameAr,
                branchNameFr: branches.nameFr,
            })
            .from(branchIngredientLocks)
            .leftJoin(branches, eq(branchIngredientLocks.branchId, branches.id))
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
                        const branchInfo: BranchInfo = {
                            id: lock.branchId,
                            name: lock.branchName ?? lock.branchId,
                            nameAr: lock.branchNameAr ?? null,
                            nameFr: lock.branchNameFr ?? null,
                        };
                        unavailableBranchesMap.get(item.foodId)?.set(lock.branchId, branchInfo);
                    }
                }
            }
        }
    }

    // 4. تحويل نتائج الـ Map الداخلية إلى Array وتنسيق البنية النهائية للـ Map
    const resultMap = new Map<string, BranchInfo[]>();
    unavailableBranchesMap.forEach((branchMap, foodId) => {
        resultMap.set(foodId, Array.from(branchMap.values()));
    });

    return resultMap;
};