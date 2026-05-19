import { Request, Response } from "express";
import { db } from "../../models/connection";
import { discounts, discountRestaurants } from "../../models/schema";
import { eq, and, inArray } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";

// ==========================================
// 1. Create Discount & Link to Selected Restaurants
// ==========================================
export const createDiscountByAdmin = async (req: Request, res: Response) => {
    const {
        name, nameAr, nameFr,
        discountType, discountValue,
        maxDiscount, minOrderAmount,
        usageLimit, startDate, endDate, isActive,
        restaurantIds // يتوقع استقبال Array من المعرفات: ["id1", "id2"]
    } = req.body;

    // التحققات الأساسية
    if (!name) throw new BadRequest("Discount name is required");
    if (!discountType) throw new BadRequest("Discount type is required (percentage | fixed_amount)");
    if (discountValue === undefined || discountValue === null) throw new BadRequest("Discount value is required");
    if (!restaurantIds || !Array.isArray(restaurantIds) || restaurantIds.length === 0) {
        throw new BadRequest("Please select at least one restaurant for this discount");
    }

    const discountId = uuidv4();

    // 1. إدخال البيانات في جدول الخصومات الرئيسي
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
    });

    // 2. بناء سجلات الربط لجدول الـ Many-to-Many
    const drData = restaurantIds.map((rId: string) => ({
        id: uuidv4(),
        discountId: discountId,
        restaurantId: rId,
    }));

    await db.insert(discountRestaurants).values(drData);

    return SuccessResponse(res, { message: "Discount created and linked to selected restaurants successfully", data: { id: discountId } }, 201);
};

// ==========================================
// 2. Get All Discounts (With optional filter by restaurantId)
// ==========================================
export const getAllDiscountsByAdmin = async (req: Request, res: Response) => {
    const { restaurantId } = req.query; // اختياري: إذا أراد الأدمن عرض عروض مطعم معين فقط

    let allDiscounts;

    if (restaurantId) {
        // جلب الخصومات المرتبطة بمطعم محدد فقط عن طريق الـ Join
        const rawData = await db
            .select()
            .from(discounts)
            .innerJoin(discountRestaurants, eq(discounts.id, discountRestaurants.discountId))
            .where(eq(discountRestaurants.restaurantId, restaurantId as string));
        
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

    // 1. جلب بيانات الخصم الأساسية
    const [discount] = await db
        .select()
        .from(discounts)
        .where(eq(discounts.id, id))
        .limit(1);

    if (!discount) throw new NotFound("Discount not found");

    // 2. جلب معرفات المطاعم المرتبطة بهذا الخصم لتسهيل عرضها في الـ Frontend بالأدمن
    const linkedRestaurants = await db
        .select({ restaurantId: discountRestaurants.restaurantId })
        .from(discountRestaurants)
        .where(eq(discountRestaurants.discountId, id));

    const restaurantIds = linkedRestaurants.map(r => r.restaurantId);

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
        restaurantIds // اختياري: إذا قام بتحديث المطاعم المشغلة للعرض
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

    // 1. تحديث الجدول الرئيسي
    await db.update(discounts).set(updateData).where(eq(discounts.id, id));

    // 2. تحديث جدول الربط في حال تم إرسال مصفوفة مطاعم جديدة
    if (restaurantIds !== undefined && Array.isArray(restaurantIds)) {
        if (restaurantIds.length === 0) {
            throw new BadRequest("Discount must be linked to at least one restaurant");
        }

        // مسح العلاقات القديمة أولاً
        await db.delete(discountRestaurants).where(eq(discountRestaurants.discountId, id));

        // إدخال العلاقات الجديدة المحدثة
        const drData = restaurantIds.map((rId: string) => ({
            id: uuidv4(),
            discountId: id,
            restaurantId: rId,
        }));
        await db.insert(discountRestaurants).values(drData);
    }

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

    // سيتم حذف السجلات المرتبطة تلقائياً بجدول الـ discountRestaurants بفضل الـ Cascade في السكيما
    await db.delete(discounts).where(eq(discounts.id, id));

    return SuccessResponse(res, { message: "Discount deleted successfully from the entire system" });
};

// ==========================================
// 6. Toggle Discount Status Across Selected Restaurants
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