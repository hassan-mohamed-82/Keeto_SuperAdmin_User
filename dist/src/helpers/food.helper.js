"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUnavailableBranchesForFoods = void 0;
// src/helpers/food.helper.ts
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const connection_1 = require("../models/connection");
/**
 * تحدد الفروع غير المتاحة لكل وجبة من قائمة الوجبات الممررة.
 * تتم عملية الفحص بناءً على شرطين:
 * 1. حالة الوجبة بالفرع (غير نشطة inactive أو نفد مخزونها المحدود).
 * 2. إغلاق أحد المكونات الأساسية (essential) للوجبة على مستوى الفرع.
 *
 * @param foodIds قائمة معرفات الوجبات المراد فحصها
 * @returns Map تحتوي على foodId كمفتاح وقائمة بكائنات الفروع غير المتاحة له كقيمة
 */
const getUnavailableBranchesForFoods = async (foodIds) => {
    // تهيئة خريطة النتائج باستخدام Map داخلية لمنع تكرار الفروع (مفتاحها branchId)
    const unavailableBranchesMap = new Map();
    if (foodIds.length === 0)
        return new Map();
    foodIds.forEach((id) => unavailableBranchesMap.set(id, new Map()));
    // 1. فحص جدول إعدادات الوجبة بالفرع (branch_menu_items): إيجاد الفروع التي أوقفت الوجبة أو نفد مخزونها
    const disabledMenuItems = await connection_1.db
        .select({
        foodId: schema_1.branchMenuItems.foodId,
        branchId: schema_1.branchMenuItems.branchId,
        stockType: schema_1.branchMenuItems.stockType,
        stockQty: schema_1.branchMenuItems.stockQty,
        status: schema_1.branchMenuItems.status,
        branchName: schema_1.branches.name,
        branchNameAr: schema_1.branches.nameAr,
        branchNameFr: schema_1.branches.nameFr,
    })
        .from(schema_1.branchMenuItems)
        .leftJoin(schema_1.branches, (0, drizzle_orm_1.eq)(schema_1.branchMenuItems.branchId, schema_1.branches.id))
        .where((0, drizzle_orm_1.inArray)(schema_1.branchMenuItems.foodId, foodIds));
    for (const item of disabledMenuItems) {
        const isOutOfStock = item.stockType === "limited" && (item.stockQty ?? 0) <= 0;
        const isInactive = item.status === "inactive";
        // إذا كانت الوجبة غير نشطة أو نفد مخزونها، يُضاف الفرع لقائمة الفروع غير المتاحة لهذه الوجبة
        if (isInactive || isOutOfStock) {
            const branchInfo = {
                id: item.branchId,
                name: item.branchName ?? item.branchId,
                nameAr: item.branchNameAr ?? null,
                nameFr: item.branchNameFr ?? null,
            };
            unavailableBranchesMap.get(item.foodId)?.set(item.branchId, branchInfo);
        }
    }
    // 2. فحص المكونات: جلب معرفات المكونات الأساسية (isEssential = true) المرتبطة بهذه الوجبات
    const essentialIngredients = await connection_1.db
        .select({
        foodId: schema_1.foodIngredients.foodId,
        ingredientId: schema_1.foodIngredients.ingredientId,
    })
        .from(schema_1.foodIngredients)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.foodIngredients.foodId, foodIds), (0, drizzle_orm_1.eq)(schema_1.foodIngredients.isEssential, true)));
    if (essentialIngredients.length > 0) {
        const essentialIngredientIds = [...new Set(essentialIngredients.map((i) => i.ingredientId))];
        // 3. فحص أقفال المكونات (branch_ingredient_locks): جلب الأقفال النشطة للمكونات الأساسية
        // يشمل الأقفال العامة على المكون (null) أو الأقفال المخصصة لوجبة محددة
        const activeLocks = await connection_1.db
            .select({
            branchId: schema_1.branchIngredientLocks.branchId,
            foodId: schema_1.branchIngredientLocks.foodId,
            ingredientId: schema_1.branchIngredientLocks.ingredientId,
            branchName: schema_1.branches.name,
            branchNameAr: schema_1.branches.nameAr,
            branchNameFr: schema_1.branches.nameFr,
        })
            .from(schema_1.branchIngredientLocks)
            .leftJoin(schema_1.branches, (0, drizzle_orm_1.eq)(schema_1.branchIngredientLocks.branchId, schema_1.branches.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.branchIngredientLocks.ingredientId, essentialIngredientIds), (0, drizzle_orm_1.eq)(schema_1.branchIngredientLocks.isAvailable, false), (0, drizzle_orm_1.or)((0, drizzle_orm_1.inArray)(schema_1.branchIngredientLocks.foodId, foodIds), (0, drizzle_orm_1.isNull)(schema_1.branchIngredientLocks.foodId))));
        // مطابقة القفل بالوجبة والمكون الخاص بها لإضافة الفرع إلى القائمة عند التأثر
        for (const lock of activeLocks) {
            for (const item of essentialIngredients) {
                if (item.ingredientId === lock.ingredientId) {
                    // القفل يطبق إما على الوجبة المحددة أو على كل الوجبات التي تستخدم المكون إذا كان foodId خاليًا (null)
                    if (!lock.foodId || lock.foodId === item.foodId) {
                        const branchInfo = {
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
    const resultMap = new Map();
    unavailableBranchesMap.forEach((branchMap, foodId) => {
        resultMap.set(foodId, Array.from(branchMap.values()));
    });
    return resultMap;
};
exports.getUnavailableBranchesForFoods = getUnavailableBranchesForFoods;
