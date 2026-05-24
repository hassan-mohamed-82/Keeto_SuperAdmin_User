"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toggleDiscountStatusByAdmin = exports.deleteDiscountByAdmin = exports.updateDiscountByAdmin = exports.getDiscountByIdByAdmin = exports.getAllDiscountsByAdmin = exports.createDiscountByAdmin = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const uuid_1 = require("uuid");
// ==========================================
// 1. Create Discount (Global or Linked to Selected)
// ==========================================
const createDiscountByAdmin = async (req, res) => {
    const { name, nameAr, nameFr, discountType, discountValue, maxDiscount, minOrderAmount, usageLimit, startDate, endDate, isActive, restaurantIds // اختياري الآن
     } = req.body;
    // التحققات الأساسية
    if (!name)
        throw new BadRequest_1.BadRequest("Discount name is required");
    if (!discountType)
        throw new BadRequest_1.BadRequest("Discount type is required (percentage | fixed_amount)");
    if (discountValue === undefined || discountValue === null)
        throw new BadRequest_1.BadRequest("Discount value is required");
    // تحديد هل الخصم عام لكل المطاعم أم محدد
    const isGlobal = !restaurantIds || !Array.isArray(restaurantIds) || restaurantIds.length === 0;
    const discountId = (0, uuid_1.v4)();
    // 1. إدخال البيانات في جدول الخصومات الرئيسي (مع ضبط قيمة isGlobal)
    await connection_1.db.insert(schema_1.discounts).values({
        id: discountId,
        name,
        nameAr: nameAr || null,
        nameFr: nameFr || null,
        discountType,
        discountValue: discountValue.toString(),
        maxDiscount: maxDiscount ? maxDiscount.toString() : null,
        minOrderAmount: minOrderAmount ? minOrderAmount.toString() : "0.00",
        usageLimit: usageLimit || null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        isActive: isActive !== undefined ? isActive : true,
        isGlobal: isGlobal, // true لو مصفوفة المطاعم فارغة أو غير موجودة
    });
    // 2. بناء سجلات الربط فقط إذا لم يكن الخصم عاماً (isGlobal === false)
    if (!isGlobal) {
        const drData = restaurantIds.map((rId) => ({
            id: (0, uuid_1.v4)(),
            discountId: discountId,
            restaurantId: rId,
        }));
        await connection_1.db.insert(schema_1.discountRestaurants).values(drData);
    }
    return (0, response_1.SuccessResponse)(res, {
        message: isGlobal
            ? "Global discount created successfully for all restaurants"
            : "Discount created and linked to selected restaurants successfully",
        data: { id: discountId, isGlobal }
    }, 201);
};
exports.createDiscountByAdmin = createDiscountByAdmin;
// ==========================================
// 2. Get All Discounts (With Global Support)
// ==========================================
const getAllDiscountsByAdmin = async (req, res) => {
    const { restaurantId } = req.query;
    let allDiscounts;
    if (restaurantId) {
        // جلب الخصومات العامة (isGlobal = true) أَوْ الخصومات المرتبطة بهذا المطعم تحديداً في جدول الربط
        const rawData = await connection_1.db
            .selectDistinct({ discounts: schema_1.discounts }) // تجنب التكرار بـ selectDistinct
            .from(schema_1.discounts)
            .leftJoin(schema_1.discountRestaurants, (0, drizzle_orm_1.eq)(schema_1.discounts.id, schema_1.discountRestaurants.discountId))
            .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.discounts.isGlobal, true), (0, drizzle_orm_1.eq)(schema_1.discountRestaurants.restaurantId, restaurantId)));
        allDiscounts = rawData.map(row => row.discounts);
    }
    else {
        // جلب كافة الخصومات في السيستم بأكمله بدون شروط
        allDiscounts = await connection_1.db.select().from(schema_1.discounts);
    }
    return (0, response_1.SuccessResponse)(res, { message: "Get discounts success", data: allDiscounts });
};
exports.getAllDiscountsByAdmin = getAllDiscountsByAdmin;
// ==========================================
// 3. Get Discount by ID (With its linked restaurants)
// ==========================================
const getDiscountByIdByAdmin = async (req, res) => {
    const { id } = req.params;
    const [discount] = await connection_1.db
        .select()
        .from(schema_1.discounts)
        .where((0, drizzle_orm_1.eq)(schema_1.discounts.id, id))
        .limit(1);
    if (!discount)
        throw new NotFound_1.NotFound("Discount not found");
    let restaurantIds = [];
    // نجلب المطاعم فقط إذا لم يكن الخصم شاملاً لكل المطاعم
    if (!discount.isGlobal) {
        const linkedRestaurants = await connection_1.db
            .select({ restaurantId: schema_1.discountRestaurants.restaurantId })
            .from(schema_1.discountRestaurants)
            .where((0, drizzle_orm_1.eq)(schema_1.discountRestaurants.discountId, id));
        restaurantIds = linkedRestaurants.map(r => r.restaurantId);
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Get discount success",
        data: { ...discount, restaurantIds }
    });
};
exports.getDiscountByIdByAdmin = getDiscountByIdByAdmin;
// ==========================================
// 4. Update Discount & Refresh Linked Restaurants
// ==========================================
const updateDiscountByAdmin = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.discounts)
        .where((0, drizzle_orm_1.eq)(schema_1.discounts.id, id))
        .limit(1);
    if (!existing)
        throw new NotFound_1.NotFound("Discount not found");
    const { name, nameAr, nameFr, discountType, discountValue, maxDiscount, minOrderAmount, usageLimit, startDate, endDate, isActive, restaurantIds } = req.body;
    const updateData = { updatedAt: new Date() };
    if (name !== undefined)
        updateData.name = name;
    if (nameAr !== undefined)
        updateData.nameAr = nameAr;
    if (nameFr !== undefined)
        updateData.nameFr = nameFr;
    if (discountType !== undefined)
        updateData.discountType = discountType;
    if (discountValue !== undefined)
        updateData.discountValue = discountValue.toString();
    if (maxDiscount !== undefined)
        updateData.maxDiscount = maxDiscount ? maxDiscount.toString() : null;
    if (minOrderAmount !== undefined)
        updateData.minOrderAmount = minOrderAmount.toString();
    if (usageLimit !== undefined)
        updateData.usageLimit = usageLimit;
    if (startDate !== undefined)
        updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined)
        updateData.endDate = endDate ? new Date(endDate) : null;
    if (isActive !== undefined)
        updateData.isActive = isActive;
    // إذا قام الأدمن بتمرير مصفوفة المطاعم (حتى لو فارغة)، نقوم بتحديث حالة الـ isGlobal وحذف/تحديث جدول الربط
    if (restaurantIds !== undefined && Array.isArray(restaurantIds)) {
        const isGlobal = restaurantIds.length === 0;
        updateData.isGlobal = isGlobal;
        // دائماً نمسح العلاقات القديمة لكي نحدثها بشكل صحيح
        await connection_1.db.delete(schema_1.discountRestaurants).where((0, drizzle_orm_1.eq)(schema_1.discountRestaurants.discountId, id));
        // إذا لم يكن عالمياً، ننشئ العلاقات الجديدة
        if (!isGlobal) {
            const drData = restaurantIds.map((rId) => ({
                id: (0, uuid_1.v4)(),
                discountId: id,
                restaurantId: rId,
            }));
            await connection_1.db.insert(schema_1.discountRestaurants).values(drData);
        }
    }
    // تحديث جدول الخصومات الرئيسي بجميع التغييرات بما فيها الـ isGlobal إن وُجدت
    await connection_1.db.update(schema_1.discounts).set(updateData).where((0, drizzle_orm_1.eq)(schema_1.discounts.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Discount updated successfully" });
};
exports.updateDiscountByAdmin = updateDiscountByAdmin;
// ==========================================
// 5. Delete Discount (Global)
// ==========================================
const deleteDiscountByAdmin = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.discounts)
        .where((0, drizzle_orm_1.eq)(schema_1.discounts.id, id))
        .limit(1);
    if (!existing)
        throw new NotFound_1.NotFound("Discount not found");
    await connection_1.db.delete(schema_1.discounts).where((0, drizzle_orm_1.eq)(schema_1.discounts.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Discount deleted successfully from the entire system" });
};
exports.deleteDiscountByAdmin = deleteDiscountByAdmin;
// ==========================================
// 6. Toggle Discount Status 
// ==========================================
const toggleDiscountStatusByAdmin = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.discounts)
        .where((0, drizzle_orm_1.eq)(schema_1.discounts.id, id))
        .limit(1);
    if (!existing)
        throw new NotFound_1.NotFound("Discount not found");
    const newStatus = !existing.isActive;
    await connection_1.db.update(schema_1.discounts)
        .set({ isActive: newStatus, updatedAt: new Date() })
        .where((0, drizzle_orm_1.eq)(schema_1.discounts.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: `Discount ${newStatus ? "activated" : "deactivated"} successfully`,
        data: { isActive: newStatus }
    });
};
exports.toggleDiscountStatusByAdmin = toggleDiscountStatusByAdmin;
