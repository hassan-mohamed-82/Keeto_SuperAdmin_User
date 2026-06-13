import { Request, Response } from "express";
import { db } from "../../models/connection";
import { coupons, couponUsages, couponRestaurants } from "../../models/schema";
import { eq, and, sql, inArray, or } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";

// ========================================================
// 1. Create Coupon (Global or Linked to Selected Restaurants)
// ========================================================
export const createCoupon = async (req: Request, res: Response) => {
    const {
        code, name, nameAr, nameFr,
        discountType, discountValue,
        maxDiscount, minOrderAmount,
        usageLimit, perUserLimit,
        startDate, endDate, isActive,
        restaurantIds // مصفوفة اختيارية الآن لتحديد المطاعم
    } = req.body;

    // التحققات الأساسية
    if (!code) throw new BadRequest("Coupon code is required");
    if (!name) throw new BadRequest("Coupon name is required");
    if (!discountType) throw new BadRequest("Discount type is required (percentage | fixed_amount | free_delivery)");
    if (discountValue === undefined || discountValue === null) throw new BadRequest("Discount value is required");

    const normalizedCode = code.toUpperCase().trim();

    // تحديد هل الكوبون عام لكل السيستم أم محدد لمطاعم معينة
    const isGlobal = !restaurantIds || !Array.isArray(restaurantIds) || restaurantIds.length === 0;

    // [منع التكرار الذكي]: التحقق من عدم وجود نفس الكود نشط
    if (isGlobal) {
        // إذا كان عاماً، نتحقق هل هناك كوبون عام آخر بنفس الكود ونشط؟
        const [conflict] = await db
            .select({ id: coupons.id })
            .from(coupons)
            .where(and(eq(coupons.code, normalizedCode), eq(coupons.isActive, true), eq(coupons.isGlobal, true)))
            .limit(1);
        if (conflict) throw new BadRequest("A global active coupon with this code already exists");
    } else {
        // إذا كان مخصصاً، نتحقق من عدم تكراره في المطاعم المحددة أو وجود كوبون عام يغطيهم
        const conflicts = await db
            .select({ id: coupons.id })
            .from(coupons)
            .leftJoin(couponRestaurants, eq(coupons.id, couponRestaurants.couponId))
            .where(
                and(
                    eq(coupons.code, normalizedCode),
                    eq(coupons.isActive, true),
                    or(
                        eq(coupons.isGlobal, true),
                        inArray(couponRestaurants.restaurantId, restaurantIds)
                    )
                )
            );
        if (conflicts.length > 0) throw new BadRequest("Coupon code conflicts with an active global or restaurant-specific coupon");
    }

    const couponId = uuidv4();

    // 1. إدخال الكوبون في الجدول الرئيسي
    await db.insert(coupons).values({
        id: couponId,
        code: normalizedCode,
        name,
        nameAr: nameAr || null,
        nameFr: nameFr || null,
        discountType,
        discountValue: discountValue.toString(),
        maxDiscount: maxDiscount ? maxDiscount.toString() : null,
        minOrderAmount: minOrderAmount ? minOrderAmount.toString() : "0.00",
        usageLimit: usageLimit || null,
        perUserLimit: perUserLimit !== undefined ? perUserLimit : 1,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        isActive: isActive !== undefined ? isActive : true,
        isGlobal: isGlobal, // ضبط حقل العالمية
    });

    // 2. بناء سجلات الربط فقط إذا لم يكن الكوبون عاماً
    if (!isGlobal) {
        const crData = restaurantIds.map((rId: string) => ({
            id: uuidv4(),
            couponId: couponId,
            restaurantId: rId,
        }));
        await db.insert(couponRestaurants).values(crData);
    }

    return SuccessResponse(res, {
        message: isGlobal
            ? "Global coupon created successfully for all restaurants"
            : "Coupon created and linked to selected restaurants successfully",
        data: { id: couponId, isGlobal }
    }, 201);
};

// ========================================================
// 2. Get All Coupons (Supports Global & Filtering by Restaurant)
// ========================================================
export const getAllCoupons = async (req: Request, res: Response) => {
    const { restaurantId } = req.query;

    let allCoupons;

    if (restaurantId) {
        // جلب الكوبونات العامة أَوْ المرتبطة بالمطعم الممرر في الـ Query
        const rawData = await db
            .selectDistinct({ coupons: coupons })
            .from(coupons)
            .leftJoin(couponRestaurants, eq(coupons.id, couponRestaurants.couponId))
            .where(
                or(
                    eq(coupons.isGlobal, true),
                    eq(couponRestaurants.restaurantId, restaurantId as string)
                )
            );

        allCoupons = rawData.map(row => row.coupons);
    } else {
        // جلب كافة الكوبونات في السيستم بالكامل
        allCoupons = await db.select().from(coupons);
    }

    return SuccessResponse(res, { message: "Get coupons success", data: allCoupons });
};

// ========================================================
// 3. Get Coupon by ID (With its linked restaurants)
// ========================================================
export const getCouponById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [coupon] = await db
        .select()
        .from(coupons)
        .where(eq(coupons.id, id))
        .limit(1);

    if (!coupon) throw new NotFound("Coupon not found");

    let restaurantIds: string[] = [];

    // جلب المطاعم المرتبطة في حال لم يكن الكوبون عاماً
    if (!coupon.isGlobal) {
        const linkedRestaurants = await db
            .select({ restaurantId: couponRestaurants.restaurantId })
            .from(couponRestaurants)
            .where(eq(couponRestaurants.couponId, id));

        restaurantIds = linkedRestaurants.map(r => r.restaurantId);
    }

    return SuccessResponse(res, {
        message: "Get coupon success",
        data: { ...coupon, restaurantIds }
    });
};

// ========================================================
// 4. Update Coupon & Refresh Linked Restaurants
// ========================================================
export const updateCoupon = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existing] = await db
        .select()
        .from(coupons)
        .where(eq(coupons.id, id))
        .limit(1);

    if (!existing) throw new NotFound("Coupon not found");

    const {
        code, name, nameAr, nameFr,
        discountType, discountValue,
        maxDiscount, minOrderAmount,
        usageLimit, perUserLimit,
        startDate, endDate, isActive,
        restaurantIds
    } = req.body;

    const normalizedCode = code ? code.toUpperCase().trim() : existing.code;
    const updateData: any = { updatedAt: new Date() };

    if (code !== undefined) updateData.code = normalizedCode;
    if (name !== undefined) updateData.name = name;
    if (nameAr !== undefined) updateData.nameAr = nameAr;
    if (nameFr !== undefined) updateData.nameFr = nameFr;
    if (discountType !== undefined) updateData.discountType = discountType;
    if (discountValue !== undefined) updateData.discountValue = discountValue.toString();
    if (maxDiscount !== undefined) updateData.maxDiscount = maxDiscount ? maxDiscount.toString() : null;
    if (minOrderAmount !== undefined) updateData.minOrderAmount = minOrderAmount.toString();
    if (usageLimit !== undefined) updateData.usageLimit = usageLimit;
    if (perUserLimit !== undefined) updateData.perUserLimit = perUserLimit;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (isActive !== undefined) updateData.isActive = isActive;

    // إذا تم تمرير مصفوفة المطاعم، نعيد هيكلة الربط والعالمية تماماً مثل الـ Discounts
    if (restaurantIds !== undefined && Array.isArray(restaurantIds)) {
        const isGlobal = restaurantIds.length === 0;
        updateData.isGlobal = isGlobal;

        // مسح العلاقات القديمة
        await db.delete(couponRestaurants).where(eq(couponRestaurants.couponId, id));

        // إدخال العلاقات الجديدة لو مش جلوبال
        if (!isGlobal) {
            const crData = restaurantIds.map((rId: string) => ({
                id: uuidv4(),
                couponId: id,
                restaurantId: rId,
            }));
            await db.insert(couponRestaurants).values(crData);
        }
    }

    await db.update(coupons).set(updateData).where(eq(coupons.id, id));

    return SuccessResponse(res, { message: "Coupon updated successfully" });
};

// ========================================================
// 5. Delete Coupon
// ========================================================
export const deleteCoupon = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existing] = await db
        .select()
        .from(coupons)
        .where(eq(coupons.id, id))
        .limit(1);

    if (!existing) throw new NotFound("Coupon not found");

    // مسح سجلات الاستخدام أولاً منعاً لخطأ الـ Foreign Key
    await db.delete(couponUsages).where(eq(couponUsages.couponId, id));
    // مسح الكوبون (وسيتم مسح علاقات المطاعم تلقائياً إذا كانت الاسكيما cascade)
    await db.delete(coupons).where(eq(coupons.id, id));

    return SuccessResponse(res, { message: "Coupon deleted successfully from the entire system" });
};

// ========================================================
// 6. Toggle Coupon Active Status
// ========================================================
export const toggleCouponStatus = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existing] = await db
        .select()
        .from(coupons)
        .where(eq(coupons.id, id))
        .limit(1);

    if (!existing) throw new NotFound("Coupon not found");

    const newStatus = !existing.isActive;

    await db.update(coupons)
        .set({ isActive: newStatus, updatedAt: new Date() })
        .where(eq(coupons.id, id));

    return SuccessResponse(res, {
        message: `Coupon ${newStatus ? "activated" : "deactivated"} successfully`,
        data: { isActive: newStatus }
    });
};

// // ========================================================
// // 7. Validate & Apply Coupon (Internal Core Function)
// // ========================================================
// export const validateCoupon = async (
//     couponCode: string,
//     userId: string,
//     restaurantId: string,
//     subtotal: number
// ): Promise<{ discountAmount: number; coupon: typeof coupons.$inferSelect }> => {
//     const now = new Date();

//     // [تعديل جوهري]: البحث عن الكوبون إذا كان عاماً (isGlobal = true) أَوْ يخص هذا المطعم في جدول الربط
//     const [rawCoupon] = await db
//         .selectDistinct({ coupons: coupons })
//         .from(coupons)
//         .leftJoin(couponRestaurants, eq(coupons.id, couponRestaurants.couponId))
//         .where(
//             and(
//                 eq(coupons.code, couponCode.toUpperCase().trim()),
//                 or(
//                     eq(coupons.isGlobal, true),
//                     eq(couponRestaurants.restaurantId, restaurantId)
//                 )
//             )
//         )
//         .limit(1);

//     if (!rawCoupon) throw new BadRequest("Invalid coupon code for this restaurant");
//     const coupon = rawCoupon.coupons;
    
//     if (!coupon.isActive) throw new BadRequest("This coupon is no longer active");
//     if (coupon.startDate && now < coupon.startDate) throw new BadRequest("This coupon is not yet valid");
//     if (coupon.endDate && now > coupon.endDate) throw new BadRequest("This coupon has expired");

//     const minOrder = parseFloat(coupon.minOrderAmount as string);
//     if (subtotal < minOrder) throw new BadRequest(`Minimum order amount to use this coupon is ${minOrder}`);

//     if (coupon.usageLimit !== null && (coupon.usedCount ?? 0) >= coupon.usageLimit)
//         throw new BadRequest("This coupon has reached its total usage limit");

//     // التحقق من حد الاستخدام لكل مستخدم فردي
//     if (coupon.perUserLimit !== null) {
//         const rows = await db
//             .select({ count: sql<number>`COUNT(*)` })
//             .from(couponUsages)
//             .where(and(
//                 eq(couponUsages.couponId, coupon.id),
//                 eq(couponUsages.userId, userId)
//             ));
        
//         const userUsageCount = Number(rows[0]?.count ?? 0);
//         if (userUsageCount >= coupon.perUserLimit)
//             throw new BadRequest("You have already used this coupon the maximum number of times");
//     }

//     // حساب قيمة الخصم بناءً على النوع
//     let discountAmount = 0;
//     if (coupon.discountType === "free_delivery") {
//         discountAmount = 0; // يتم معالجتها بحذف رسوم التوصيل في الباك إند الخاص بالطلبات
//     } else if (coupon.discountType === "percentage") {
//         const pct = parseFloat(coupon.discountValue as string);
//         discountAmount = (subtotal * pct) / 100;
//         const maxD = coupon.maxDiscount ? parseFloat(coupon.maxDiscount as string) : null;
//         if (maxD !== null && discountAmount > maxD) discountAmount = maxD;
//     } else {
//         discountAmount = parseFloat(coupon.discountValue as string);
//         if (discountAmount > subtotal) discountAmount = subtotal;
//     }

//     return { discountAmount: parseFloat(discountAmount.toFixed(2)), coupon };
// };

// // ========================================================
// // 8. Validate Coupon Endpoint (For Frontend / Checkout Check)
// // ========================================================
// export const validateCouponEndpoint = async (req: Request, res: Response) => {
//     const { code, subtotal, restaurantId } = req.body;
//     const userId = req.user?.id; 

//     if (!code) throw new BadRequest("Coupon code is required");
//     if (!subtotal) throw new BadRequest("Subtotal is required");
//     if (!restaurantId) throw new BadRequest("Restaurant ID is required");
//     if (!userId) throw new BadRequest("Unauthorized");

//     const { discountAmount, coupon } = await validateCoupon(
//         code,
//         userId,
//         restaurantId,
//         parseFloat(subtotal)
//     );

//     return SuccessResponse(res, {
//         message: "Coupon is valid",
//         data: {
//             code: coupon.code,
//             name: coupon.name,
//             discountType: coupon.discountType,
//             discountValue: coupon.discountValue,
//             discountAmount,
//         }
//     });
// };

// ========================================================
// 9. Get Coupon Usage History
// ========================================================
export const getCouponUsages = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existing] = await db
        .select()
        .from(coupons)
        .where(eq(coupons.id, id))
        .limit(1);

    if (!existing) throw new NotFound("Coupon not found");

    const usages = await db
        .select()
        .from(couponUsages)
        .where(eq(couponUsages.couponId, id));

    return SuccessResponse(res, { message: "Coupon usage history fetched", data: usages });
};