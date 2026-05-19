import { Request, Response } from "express";
import { db } from "../../models/connection";
import { coupons, couponUsages, orders, couponRestaurants } from "../../models/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";

// ==========================================
// 1. Create Coupon
// ==========================================
export const createCoupon = async (req: Request, res: Response) => {
    const {
        code, name, nameAr, nameFr,
        discountType, discountValue,
        maxDiscount, minOrderAmount,
        usageLimit, perUserLimit,
        startDate, endDate, isActive, restaurantId
    } = req.body;

    if (!code) throw new BadRequest("Coupon code is required");
    if (!name) throw new BadRequest("Coupon name is required");
    if (!discountType) throw new BadRequest("Discount type is required (percentage | fixed_amount | free_delivery)");
    if (discountValue === undefined || discountValue === null) throw new BadRequest("Discount value is required");

    const normalizedCode = code.toUpperCase().trim();
    const rIds = restaurantId ? (Array.isArray(restaurantId) ? restaurantId : [restaurantId]) : [];

    // [تعديل مهم]: التأكد من عدم تكرار الكود لنفس المطاعم المحددة فقط
    if (rIds.length > 0) {
        const conflicts = await db
            .select({ id: coupons.id })
            .from(coupons)
            .innerJoin(couponRestaurants, eq(coupons.id, couponRestaurants.couponId))
            .where(
                and(
                    eq(coupons.code, normalizedCode),
                    eq(coupons.isActive, true), // الكوبونات النشطة فقط
                    inArray(couponRestaurants.restaurantId, rIds)
                )
            );

        if (conflicts.length > 0) {
            throw new BadRequest("Coupon code already exists in one of the selected restaurants");
        }
    }

    const id = uuidv4();

    await db.insert(coupons).values({
        id,
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
    });

    if (rIds.length > 0) {
        const crData = rIds.map((rId: string) => ({
            id: uuidv4(),
            couponId: id,
            restaurantId: rId,
        }));
        await db.insert(couponRestaurants).values(crData);
    }

    return SuccessResponse(res, { message: "Coupon created successfully", data: { id } }, 201);
};

// ==========================================
// 2. Get All Coupons (for this restaurant)
// ==========================================
export const getAllCoupons = async (req: Request, res: Response) => {
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId) throw new BadRequest("Unauthorized");

    const rawCoupons = await db
        .select()
        .from(coupons)
        .innerJoin(couponRestaurants, eq(coupons.id, couponRestaurants.couponId))
        .where(eq(couponRestaurants.restaurantId, restaurantId));

    const allCoupons = rawCoupons.map(r => r.coupons);

    return SuccessResponse(res, { message: "Get all coupons success", data: allCoupons });
};

// ==========================================
// 3. Get Coupon by ID
// ==========================================
export const getCouponById = async (req: Request, res: Response) => {
    const { id } = req.params;
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId) throw new BadRequest("Unauthorized");

    const [rawCoupon] = await db
        .select()
        .from(coupons)
        .innerJoin(couponRestaurants, eq(coupons.id, couponRestaurants.couponId))
        .where(and(eq(coupons.id, id), eq(couponRestaurants.restaurantId, restaurantId)))
        .limit(1);

    if (!rawCoupon) throw new NotFound("Coupon not found");

    return SuccessResponse(res, { message: "Get coupon success", data: rawCoupon.coupons });
};

// ==========================================
// 4. Update Coupon
// ==========================================
export const updateCoupon = async (req: Request, res: Response) => {
    const { id } = req.params;
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId) throw new BadRequest("Unauthorized");

    const [existing] = await db
        .select()
        .from(coupons)
        .innerJoin(couponRestaurants, eq(coupons.id, couponRestaurants.couponId))
        .where(and(eq(coupons.id, id), eq(couponRestaurants.restaurantId, restaurantId)))
        .limit(1);

    if (!existing) throw new NotFound("Coupon not found");

    const {
        code, name, nameAr, nameFr,
        discountType, discountValue,
        maxDiscount, minOrderAmount,
        usageLimit, perUserLimit,
        startDate, endDate, isActive, restaurantId: updatedRestaurantId
    } = req.body;

    const normalizedCode = code ? code.toUpperCase().trim() : existing.coupons.code;
    const targetRestaurants = updatedRestaurantId ? (Array.isArray(updatedRestaurantId) ? updatedRestaurantId : [updatedRestaurantId]) : [restaurantId];

    // [تعديل مهم]: تشيك الـ Duplicate يبحث فقط في المطاعم المرتبطة بالكوبون
    if (code && normalizedCode !== existing.coupons.code) {
        const [duplicate] = await db
            .select({ id: coupons.id })
            .from(coupons)
            .innerJoin(couponRestaurants, eq(coupons.id, couponRestaurants.couponId))
            .where(
                and(
                    eq(coupons.code, normalizedCode),
                    inArray(couponRestaurants.restaurantId, targetRestaurants)
                )
            )
            .limit(1);
        if (duplicate) throw new BadRequest("Coupon code already exists for this restaurant");
    }

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

    await db.update(coupons).set(updateData).where(eq(coupons.id, id));

    if (updatedRestaurantId !== undefined) {
        await db.delete(couponRestaurants).where(eq(couponRestaurants.couponId, id));
        if (targetRestaurants.length > 0) {
            const crData = targetRestaurants.map((rId: string) => ({
                id: uuidv4(),
                couponId: id,
                restaurantId: rId,
            }));
            await db.insert(couponRestaurants).values(crData);
        }
    }

    return SuccessResponse(res, { message: "Coupon updated successfully" });
};

// ==========================================
// 5. Delete Coupon
// ==========================================
export const deleteCoupon = async (req: Request, res: Response) => {
    const { id } = req.params;
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId) throw new BadRequest("Unauthorized");

    const [existing] = await db
        .select()
        .from(coupons)
        .innerJoin(couponRestaurants, eq(coupons.id, couponRestaurants.couponId))
        .where(and(eq(coupons.id, id), eq(couponRestaurants.restaurantId, restaurantId)))
        .limit(1);

    if (!existing) throw new NotFound("Coupon not found");

    // بفضل الـ onDelete: "cascade" في الاسكيما، مسح الكوبون الأساسي هيمسح الروابط في couponRestaurants تلقائياً
    await db.delete(couponUsages).where(eq(couponUsages.couponId, id));
    await db.delete(coupons).where(eq(coupons.id, id));

    return SuccessResponse(res, { message: "Coupon deleted successfully" });
};

// ==========================================
// 6. Toggle Coupon Active Status
// ==========================================
export const toggleCouponStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId) throw new BadRequest("Unauthorized");

    const [rawExisting] = await db
        .select()
        .from(coupons)
        .innerJoin(couponRestaurants, eq(coupons.id, couponRestaurants.couponId))
        .where(and(eq(coupons.id, id), eq(couponRestaurants.restaurantId, restaurantId)))
        .limit(1);

    if (!rawExisting) throw new NotFound("Coupon not found");
    const existingCoupon = rawExisting.coupons;

    await db.update(coupons)
        .set({ isActive: !existingCoupon.isActive, updatedAt: new Date() })
        .where(eq(coupons.id, id));

    return SuccessResponse(res, {
        message: `Coupon ${!existingCoupon.isActive ? "activated" : "deactivated"} successfully`,
        data: { isActive: !existingCoupon.isActive }
    });
};

// ==========================================
// 7. Validate & Apply Coupon (Internal Function)
// ==========================================
export const validateCoupon = async (
    couponCode: string,
    userId: string,
    restaurantId: string,
    subtotal: number
): Promise<{ discountAmount: number; coupon: typeof coupons.$inferSelect }> => {
    const now = new Date();

    const [rawCoupon] = await db
        .select()
        .from(coupons)
        .innerJoin(couponRestaurants, eq(coupons.id, couponRestaurants.couponId))
        .where(and(
            eq(coupons.code, couponCode.toUpperCase().trim()),
            eq(couponRestaurants.restaurantId, restaurantId)
        ))
        .limit(1);

    if (!rawCoupon) throw new BadRequest("Invalid coupon code");
    const coupon = rawCoupon.coupons;
    if (!coupon.isActive) throw new BadRequest("This coupon is no longer active");

    if (coupon.startDate && now < coupon.startDate)
        throw new BadRequest("This coupon is not yet valid");
    if (coupon.endDate && now > coupon.endDate)
        throw new BadRequest("This coupon has expired");

    const minOrder = parseFloat(coupon.minOrderAmount as string);
    if (subtotal < minOrder)
        throw new BadRequest(`Minimum order amount to use this coupon is ${minOrder}`);

    if (coupon.usageLimit !== null && (coupon.usedCount ?? 0) >= coupon.usageLimit)
        throw new BadRequest("This coupon has reached its usage limit");

    if (coupon.perUserLimit !== null) {
        const rows = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(couponUsages)
            .where(and(
                eq(couponUsages.couponId, coupon.id),
                eq(couponUsages.userId, userId)
            ));
        
        const userUsageCount = Number(rows[0]?.count ?? 0);
        if (userUsageCount >= coupon.perUserLimit)
            throw new BadRequest("You have already used this coupon the maximum number of times");
    }

    let discountAmount = 0;
    if (coupon.discountType === "free_delivery") {
        discountAmount = 0;
    } else if (coupon.discountType === "percentage") {
        const pct = parseFloat(coupon.discountValue as string);
        discountAmount = (subtotal * pct) / 100;
        const maxD = coupon.maxDiscount ? parseFloat(coupon.maxDiscount as string) : null;
        if (maxD !== null && discountAmount > maxD) discountAmount = maxD;
    } else {
        discountAmount = parseFloat(coupon.discountValue as string);
        if (discountAmount > subtotal) discountAmount = subtotal;
    }

    return { discountAmount: parseFloat(discountAmount.toFixed(2)), coupon };
};

// ==========================================
// 8. Validate Coupon Endpoint (for Frontend Check)
// ==========================================
export const validateCouponEndpoint = async (req: Request, res: Response) => {
    // [تعديل جوهري]: الـ restaurantId هنا لازم يجي من الـ body لأن العميل هو اللي بيطلب
    const { code, subtotal, restaurantId } = req.body;
    const userId = req.user?.id; // الـ ID بتاع العميل اللي مسجل دخول

    if (!code) throw new BadRequest("Coupon code is required");
    if (!subtotal) throw new BadRequest("Subtotal is required");
    if (!restaurantId) throw new BadRequest("Restaurant ID is required");
    if (!userId) throw new BadRequest("Unauthorized");

    const { discountAmount, coupon } = await validateCoupon(
        code,
        userId,
        restaurantId,
        parseFloat(subtotal)
    );

    return SuccessResponse(res, {
        message: "Coupon is valid",
        data: {
            code: coupon.code,
            name: coupon.name,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
            discountAmount,
        }
    });
};

// ==========================================
// 9. Get Coupon Usage History
// ==========================================
export const getCouponUsages = async (req: Request, res: Response) => {
    const { id } = req.params;
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId) throw new BadRequest("Unauthorized");

    const [rawCoupon] = await db
        .select({ id: coupons.id })
        .from(coupons)
        .innerJoin(couponRestaurants, eq(coupons.id, couponRestaurants.couponId))
        .where(and(eq(coupons.id, id), eq(couponRestaurants.restaurantId, restaurantId)))
        .limit(1);

    if (!rawCoupon) throw new NotFound("Coupon not found");

    const usages = await db
        .select()
        .from(couponUsages)
        .where(eq(couponUsages.couponId, id));

    return SuccessResponse(res, { message: "Coupon usage history fetched", data: usages });
};