import { Request, Response } from "express";
import { db } from "../../models/connection";
import { discounts, discountRestaurants } from "../../models/schema";
import { eq, or } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";

// ==========================================
// 1. Create Discount (Global or Linked to Selected)
// ==========================================
export const createDiscountByAdmin = async (req: Request, res: Response) => {
    const {
        name, nameAr, nameFr,
        discountType, discountValue,
        maxDiscount, minOrderAmount,
        usageLimit, startDate, endDate, isActive,
        restaurantIds // اختياري الآن
    } = req.body;

    // التحققات الأساسية
    if (!name) throw new BadRequest("Discount name is required");
    if (!discountType) throw new BadRequest("Discount type is required (percentage | fixed_amount)");
    if (discountValue === undefined || discountValue === null) throw new BadRequest("Discount value is required");

    // تحديد هل الخصم عام لكل المطاعم أم محدد
    const isGlobal = !restaurantIds || !Array.isArray(restaurantIds) || restaurantIds.length === 0;

    const discountId = uuidv4();

    // 1. إدخال البيانات في جدول الخصومات الرئيسي (مع ضبط قيمة isGlobal)
    await db.insert(discounts).values({
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
        const drData = restaurantIds.map((rId: string) => ({
            id: uuidv4(),
            discountId: discountId,
            restaurantId: rId,
        }));
        await db.insert(discountRestaurants).values(drData);
    }

    return SuccessResponse(res, { 
        message: isGlobal 
            ? "Global discount created successfully for all restaurants" 
            : "Discount created and linked to selected restaurants successfully", 
        data: { id: discountId, isGlobal } 
    }, 201);
};

// ==========================================
// 2. Get All Discounts (With Global Support)
// ==========================================
export const getAllDiscountsByAdmin = async (req: Request, res: Response) => {
    const { restaurantId } = req.query; 

    let allDiscounts;

    if (restaurantId) {
        // جلب الخصومات العامة (isGlobal = true) أَوْ الخصومات المرتبطة بهذا المطعم تحديداً في جدول الربط
        const rawData = await db
            .selectDistinct({ discounts: discounts }) // تجنب التكرار بـ selectDistinct
            .from(discounts)
            .leftJoin(discountRestaurants, eq(discounts.id, discountRestaurants.discountId))
            .where(
                or(
                    eq(discounts.isGlobal, true),
                    eq(discountRestaurants.restaurantId, restaurantId as string)
                )
            );
        
        allDiscounts = rawData.map(row => row.discounts);
    } else {
        // جلب كافة الخصومات في السيستم بأكمله بدون شروط
        allDiscounts = await db.select().from(discounts);
    }

    return SuccessResponse(res, { message: "Get discounts success", data: allDiscounts });
};

// ==========================================
// 3. Get Discount by ID (With its linked restaurants)
// ==========================================
export const getDiscountByIdByAdmin = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [discount] = await db
        .select()
        .from(discounts)
        .where(eq(discounts.id, id))
        .limit(1);

    if (!discount) throw new NotFound("Discount not found");

    let restaurantIds: string[] = [];

    // نجلب المطاعم فقط إذا لم يكن الخصم شاملاً لكل المطاعم
    if (!discount.isGlobal) {
        const linkedRestaurants = await db
            .select({ restaurantId: discountRestaurants.restaurantId })
            .from(discountRestaurants)
            .where(eq(discountRestaurants.discountId, id));

        restaurantIds = linkedRestaurants.map(r => r.restaurantId);
    }

    return SuccessResponse(res, { 
        message: "Get discount success", 
        data: { ...discount, restaurantIds } 
    });
};

// ==========================================
// 4. Update Discount & Refresh Linked Restaurants
// ==========================================
export const updateDiscountByAdmin = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existing] = await db
        .select()
        .from(discounts)
        .where(eq(discounts.id, id))
        .limit(1);

    if (!existing) throw new NotFound("Discount not found");

    const {
        name, nameAr, nameFr,
        discountType, discountValue,
        maxDiscount, minOrderAmount,
        usageLimit, startDate, endDate, isActive,
        restaurantIds 
    } = req.body;

    const updateData: any = { updatedAt: new Date() };

    if (name !== undefined) updateData.name = name;
    if (nameAr !== undefined) updateData.nameAr = nameAr;
    if (nameFr !== undefined) updateData.nameFr = nameFr;
    if (discountType !== undefined) updateData.discountType = discountType;
    if (discountValue !== undefined) updateData.discountValue = discountValue.toString();
    if (maxDiscount !== undefined) updateData.maxDiscount = maxDiscount ? maxDiscount.toString() : null;
    if (minOrderAmount !== undefined) updateData.minOrderAmount = minOrderAmount.toString();
    if (usageLimit !== undefined) updateData.usageLimit = usageLimit;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (isActive !== undefined) updateData.isActive = isActive;

    // إذا قام الأدمن بتمرير مصفوفة المطاعم (حتى لو فارغة)، نقوم بتحديث حالة الـ isGlobal وحذف/تحديث جدول الربط
    if (restaurantIds !== undefined && Array.isArray(restaurantIds)) {
        const isGlobal = restaurantIds.length === 0;
        updateData.isGlobal = isGlobal;

        // دائماً نمسح العلاقات القديمة لكي نحدثها بشكل صحيح
        await db.delete(discountRestaurants).where(eq(discountRestaurants.discountId, id));

        // إذا لم يكن عالمياً، ننشئ العلاقات الجديدة
        if (!isGlobal) {
            const drData = restaurantIds.map((rId: string) => ({
                id: uuidv4(),
                discountId: id,
                restaurantId: rId,
            }));
            await db.insert(discountRestaurants).values(drData);
        }
    }

    // تحديث جدول الخصومات الرئيسي بجميع التغييرات بما فيها الـ isGlobal إن وُجدت
    await db.update(discounts).set(updateData).where(eq(discounts.id, id));

    return SuccessResponse(res, { message: "Discount updated successfully" });
};

// ==========================================
// 5. Delete Discount (Global)
// ==========================================
export const deleteDiscountByAdmin = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existing] = await db
        .select()
        .from(discounts)
        .where(eq(discounts.id, id))
        .limit(1);

    if (!existing) throw new NotFound("Discount not found");

    await db.delete(discounts).where(eq(discounts.id, id));

    return SuccessResponse(res, { message: "Discount deleted successfully from the entire system" });
};

// ==========================================
// 6. Toggle Discount Status 
// ==========================================
export const toggleDiscountStatusByAdmin = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existing] = await db
        .select()
        .from(discounts)
        .where(eq(discounts.id, id))
        .limit(1);

    if (!existing) throw new NotFound("Discount not found");

    const newStatus = !existing.isActive;

    await db.update(discounts)
        .set({ isActive: newStatus, updatedAt: new Date() })
        .where(eq(discounts.id, id));

    return SuccessResponse(res, {
        message: `Discount ${newStatus ? "activated" : "deactivated"} successfully`,
        data: { isActive: newStatus }
    });
};