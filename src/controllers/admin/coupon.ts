import { Request, Response } from "express";
import { db } from "../../models/connection";
import { coupons, couponUsages, orders } from "../../models/schema";
import { eq, and, sql } from "drizzle-orm";
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

    // Check uniqueness of code (globally unique because of .unique() in schema)
    const [existing] = await db
        .select({ id: coupons.id })
        .from(coupons)
        .where(eq(coupons.code, code.toUpperCase()))
        .limit(1);

    if (existing) throw new BadRequest("Coupon code already exists, please choose another");

    const id = uuidv4();

    await db.insert(coupons).values({
        id,
        restaurantId: Array.isArray(restaurantId) ? restaurantId : restaurantId ? [restaurantId] : [],
        code: code.toUpperCase().trim(),
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

    return SuccessResponse(res, { message: "Coupon created successfully", data: { id } }, 201);
};

// ==========================================
// 2. Get All Coupons (for this restaurant)
// ==========================================
export const getAllCoupons = async (req: Request, res: Response) => {
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId) throw new BadRequest("Unauthorized");

    const allCoupons = await db
        .select()
        .from(coupons)
        .where(sql`JSON_CONTAINS(${coupons.restaurantId}, ${JSON.stringify(restaurantId)})`);

    return SuccessResponse(res, { message: "Get all coupons success", data: allCoupons });
};

// ==========================================
// 3. Get Coupon by ID
// ==========================================
export const getCouponById = async (req: Request, res: Response) => {
    const { id } = req.params;
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId) throw new BadRequest("Unauthorized");

    const [coupon] = await db
        .select()
        .from(coupons)
        .where(and(eq(coupons.id, id), sql`JSON_CONTAINS(${coupons.restaurantId}, ${JSON.stringify(restaurantId)})`))
        .limit(1);

    if (!coupon) throw new NotFound("Coupon not found");

    return SuccessResponse(res, { message: "Get coupon success", data: coupon });
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
        .where(and(eq(coupons.id, id), sql`JSON_CONTAINS(${coupons.restaurantId}, ${JSON.stringify(restaurantId)})`))
        .limit(1);

    if (!existing) throw new NotFound("Coupon not found");

    const {
        code, name, nameAr, nameFr,
        discountType, discountValue,
        maxDiscount, minOrderAmount,
        usageLimit, perUserLimit,
        startDate, endDate, isActive, restaurantId: updatedRestaurantId
    } = req.body;

    // If changing code, check uniqueness
    if (code && code.toUpperCase() !== existing.code) {
        const [duplicate] = await db
            .select({ id: coupons.id })
            .from(coupons)
            .where(eq(coupons.code, code.toUpperCase()))
            .limit(1);
        if (duplicate) throw new BadRequest("Coupon code already exists");
    }

    const updateData: any = { updatedAt: new Date() };

    if (code !== undefined) updateData.code = code.toUpperCase().trim();
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
    if (updatedRestaurantId !== undefined) updateData.restaurantId = Array.isArray(updatedRestaurantId) ? updatedRestaurantId : [updatedRestaurantId];

    await db.update(coupons).set(updateData).where(eq(coupons.id, id));

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
        .where(and(eq(coupons.id, id), sql`JSON_CONTAINS(${coupons.restaurantId}, ${JSON.stringify(restaurantId)})`))
        .limit(1);

    if (!existing) throw new NotFound("Coupon not found");

    // Delete usage records first
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

    const [existing] = await db
        .select()
        .from(coupons)
        .where(and(eq(coupons.id, id), sql`JSON_CONTAINS(${coupons.restaurantId}, ${JSON.stringify(restaurantId)})`))
        .limit(1);

    if (!existing) throw new NotFound("Coupon not found");

    await db.update(coupons)
        .set({ isActive: !existing.isActive, updatedAt: new Date() })
        .where(eq(coupons.id, id));

    return SuccessResponse(res, {
        message: `Coupon ${!existing.isActive ? "activated" : "deactivated"} successfully`,
        data: { isActive: !existing.isActive }
    });
};

// ==========================================
// 7. Validate & Apply Coupon (used from order flow)
// ==========================================
/**
 * Returns the calculated discount amount if the coupon is valid.
 * Throws a BadRequest with a descriptive message if invalid.
 */
export const validateCoupon = async (
    couponCode: string,
    userId: string,
    restaurantId: string,
    subtotal: number
): Promise<{ discountAmount: number; coupon: typeof coupons.$inferSelect }> => {
    const now = new Date();

    const [coupon] = await db
        .select()
        .from(coupons)
        .where(and(
            eq(coupons.code, couponCode.toUpperCase()),
            sql`JSON_CONTAINS(${coupons.restaurantId}, ${JSON.stringify(restaurantId)})`
        ))
        .limit(1);

    if (!coupon) throw new BadRequest("Invalid coupon code");
    if (!coupon.isActive) throw new BadRequest("This coupon is no longer active");

    // Date range check
    if (coupon.startDate && now < coupon.startDate)
        throw new BadRequest("This coupon is not yet valid");
    if (coupon.endDate && now > coupon.endDate)
        throw new BadRequest("This coupon has expired");

    // Minimum order check
    const minOrder = parseFloat(coupon.minOrderAmount as string);
    if (subtotal < minOrder)
        throw new BadRequest(`Minimum order amount to use this coupon is ${minOrder}`);

    // Global usage limit
    if (coupon.usageLimit !== null && (coupon.usedCount ?? 0) >= coupon.usageLimit)
        throw new BadRequest("This coupon has reached its usage limit");

    // Per-user usage limit
    if (coupon.perUserLimit !== null) {
        const userUsageCount = await db
            .select({ count: sql<number>`COUNT(*)` })
            .from(couponUsages)
            .where(and(
                eq(couponUsages.couponId, coupon.id),
                eq(couponUsages.userId, userId)
            ))
            .then(rows => Number(rows[0]?.count ?? 0));

        if (userUsageCount >= coupon.perUserLimit)
            throw new BadRequest("You have already used this coupon the maximum number of times");
    }

    // Calculate discount amount
    let discountAmount = 0;

    if (coupon.discountType === "free_delivery") {
        // Handled at order level (deliveryFee = 0)
        discountAmount = 0;
    } else if (coupon.discountType === "percentage") {
        const pct = parseFloat(coupon.discountValue as string);
        discountAmount = (subtotal * pct) / 100;
        const maxD = coupon.maxDiscount ? parseFloat(coupon.maxDiscount as string) : null;
        if (maxD !== null && discountAmount > maxD) discountAmount = maxD;
    } else {
        // fixed_amount
        discountAmount = parseFloat(coupon.discountValue as string);
        if (discountAmount > subtotal) discountAmount = subtotal;
    }

    return { discountAmount: parseFloat(discountAmount.toFixed(2)), coupon };
};

// ==========================================
// 8. Validate Coupon Endpoint (for frontend check before order)
// ==========================================
export const validateCouponEndpoint = async (req: Request, res: Response) => {
    const { code, subtotal } = req.body;
    const userId = req.user?.id;
    const restaurantId = req.user?.restaurantId || req.user?.id;

    if (!code) throw new BadRequest("Coupon code is required");
    if (!subtotal) throw new BadRequest("Subtotal is required");
    if (!userId) throw new BadRequest("Unauthorized");
    if (!restaurantId) throw new BadRequest("Unauthorized");

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

    const [coupon] = await db
        .select({ id: coupons.id })
        .from(coupons)
        .where(and(eq(coupons.id, id), sql`JSON_CONTAINS(${coupons.restaurantId}, ${JSON.stringify(restaurantId)})`))
        .limit(1);

    if (!coupon) throw new NotFound("Coupon not found");

    const usages = await db
        .select()
        .from(couponUsages)
        .where(eq(couponUsages.couponId, id));

    return SuccessResponse(res, { message: "Coupon usage history fetched", data: usages });
};
