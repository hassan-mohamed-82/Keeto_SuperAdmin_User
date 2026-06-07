"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCouponUsages = exports.toggleCouponStatus = exports.deleteCoupon = exports.updateCoupon = exports.getCouponById = exports.getAllCoupons = exports.createCoupon = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const uuid_1 = require("uuid");
// ========================================================
// 1. Create Coupon (Global or Linked to Selected Restaurants)
// ========================================================
const createCoupon = async (req, res) => {
    const { code, name, nameAr, nameFr, discountType, discountValue, maxDiscount, minOrderAmount, usageLimit, perUserLimit, startDate, endDate, isActive, restaurantIds // مصفوفة اختيارية الآن لتحديد المطاعم
     } = req.body;
    // التحققات الأساسية
    if (!code)
        throw new BadRequest_1.BadRequest("Coupon code is required");
    if (!name)
        throw new BadRequest_1.BadRequest("Coupon name is required");
    if (!discountType)
        throw new BadRequest_1.BadRequest("Discount type is required (percentage | fixed_amount | free_delivery)");
    if (discountValue === undefined || discountValue === null)
        throw new BadRequest_1.BadRequest("Discount value is required");
    const normalizedCode = code.toUpperCase().trim();
    // تحديد هل الكوبون عام لكل السيستم أم محدد لمطاعم معينة
    const isGlobal = !restaurantIds || !Array.isArray(restaurantIds) || restaurantIds.length === 0;
    // [منع التكرار الذكي]: التحقق من عدم وجود نفس الكود نشط
    if (isGlobal) {
        // إذا كان عاماً، نتحقق هل هناك كوبون عام آخر بنفس الكود ونشط؟
        const [conflict] = await connection_1.db
            .select({ id: schema_1.coupons.id })
            .from(schema_1.coupons)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.coupons.code, normalizedCode), (0, drizzle_orm_1.eq)(schema_1.coupons.isActive, true), (0, drizzle_orm_1.eq)(schema_1.coupons.isGlobal, true)))
            .limit(1);
        if (conflict)
            throw new BadRequest_1.BadRequest("A global active coupon with this code already exists");
    }
    else {
        // إذا كان مخصصاً، نتحقق من عدم تكراره في المطاعم المحددة أو وجود كوبون عام يغطيهم
        const conflicts = await connection_1.db
            .select({ id: schema_1.coupons.id })
            .from(schema_1.coupons)
            .leftJoin(schema_1.couponRestaurants, (0, drizzle_orm_1.eq)(schema_1.coupons.id, schema_1.couponRestaurants.couponId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.coupons.code, normalizedCode), (0, drizzle_orm_1.eq)(schema_1.coupons.isActive, true), (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.coupons.isGlobal, true), (0, drizzle_orm_1.inArray)(schema_1.couponRestaurants.restaurantId, restaurantIds))));
        if (conflicts.length > 0)
            throw new BadRequest_1.BadRequest("Coupon code conflicts with an active global or restaurant-specific coupon");
    }
    const couponId = (0, uuid_1.v4)();
    // 1. إدخال الكوبون في الجدول الرئيسي
    await connection_1.db.insert(schema_1.coupons).values({
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
        const crData = restaurantIds.map((rId) => ({
            id: (0, uuid_1.v4)(),
            couponId: couponId,
            restaurantId: rId,
        }));
        await connection_1.db.insert(schema_1.couponRestaurants).values(crData);
    }
    return (0, response_1.SuccessResponse)(res, {
        message: isGlobal
            ? "Global coupon created successfully for all restaurants"
            : "Coupon created and linked to selected restaurants successfully",
        data: { id: couponId, isGlobal }
    }, 201);
};
exports.createCoupon = createCoupon;
// ========================================================
// 2. Get All Coupons (Supports Global & Filtering by Restaurant)
// ========================================================
const getAllCoupons = async (req, res) => {
    const { restaurantId } = req.query;
    let allCoupons;
    if (restaurantId) {
        // جلب الكوبونات العامة أَوْ المرتبطة بالمطعم الممرر في الـ Query
        const rawData = await connection_1.db
            .selectDistinct({ coupons: schema_1.coupons })
            .from(schema_1.coupons)
            .leftJoin(schema_1.couponRestaurants, (0, drizzle_orm_1.eq)(schema_1.coupons.id, schema_1.couponRestaurants.couponId))
            .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.coupons.isGlobal, true), (0, drizzle_orm_1.eq)(schema_1.couponRestaurants.restaurantId, restaurantId)));
        allCoupons = rawData.map(row => row.coupons);
    }
    else {
        // جلب كافة الكوبونات في السيستم بالكامل
        allCoupons = await connection_1.db.select().from(schema_1.coupons);
    }
    return (0, response_1.SuccessResponse)(res, { message: "Get coupons success", data: allCoupons });
};
exports.getAllCoupons = getAllCoupons;
// ========================================================
// 3. Get Coupon by ID (With its linked restaurants)
// ========================================================
const getCouponById = async (req, res) => {
    const { id } = req.params;
    const [coupon] = await connection_1.db
        .select()
        .from(schema_1.coupons)
        .where((0, drizzle_orm_1.eq)(schema_1.coupons.id, id))
        .limit(1);
    if (!coupon)
        throw new NotFound_1.NotFound("Coupon not found");
    let restaurantIds = [];
    // جلب المطاعم المرتبطة في حال لم يكن الكوبون عاماً
    if (!coupon.isGlobal) {
        const linkedRestaurants = await connection_1.db
            .select({ restaurantId: schema_1.couponRestaurants.restaurantId })
            .from(schema_1.couponRestaurants)
            .where((0, drizzle_orm_1.eq)(schema_1.couponRestaurants.couponId, id));
        restaurantIds = linkedRestaurants.map(r => r.restaurantId);
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Get coupon success",
        data: { ...coupon, restaurantIds }
    });
};
exports.getCouponById = getCouponById;
// ========================================================
// 4. Update Coupon & Refresh Linked Restaurants
// ========================================================
const updateCoupon = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.coupons)
        .where((0, drizzle_orm_1.eq)(schema_1.coupons.id, id))
        .limit(1);
    if (!existing)
        throw new NotFound_1.NotFound("Coupon not found");
    const { code, name, nameAr, nameFr, discountType, discountValue, maxDiscount, minOrderAmount, usageLimit, perUserLimit, startDate, endDate, isActive, restaurantIds } = req.body;
    const normalizedCode = code ? code.toUpperCase().trim() : existing.code;
    const updateData = { updatedAt: new Date() };
    if (code !== undefined)
        updateData.code = normalizedCode;
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
    if (perUserLimit !== undefined)
        updateData.perUserLimit = perUserLimit;
    if (startDate !== undefined)
        updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined)
        updateData.endDate = endDate ? new Date(endDate) : null;
    if (isActive !== undefined)
        updateData.isActive = isActive;
    // إذا تم تمرير مصفوفة المطاعم، نعيد هيكلة الربط والعالمية تماماً مثل الـ Discounts
    if (restaurantIds !== undefined && Array.isArray(restaurantIds)) {
        const isGlobal = restaurantIds.length === 0;
        updateData.isGlobal = isGlobal;
        // مسح العلاقات القديمة
        await connection_1.db.delete(schema_1.couponRestaurants).where((0, drizzle_orm_1.eq)(schema_1.couponRestaurants.couponId, id));
        // إدخال العلاقات الجديدة لو مش جلوبال
        if (!isGlobal) {
            const crData = restaurantIds.map((rId) => ({
                id: (0, uuid_1.v4)(),
                couponId: id,
                restaurantId: rId,
            }));
            await connection_1.db.insert(schema_1.couponRestaurants).values(crData);
        }
    }
    await connection_1.db.update(schema_1.coupons).set(updateData).where((0, drizzle_orm_1.eq)(schema_1.coupons.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Coupon updated successfully" });
};
exports.updateCoupon = updateCoupon;
// ========================================================
// 5. Delete Coupon
// ========================================================
const deleteCoupon = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.coupons)
        .where((0, drizzle_orm_1.eq)(schema_1.coupons.id, id))
        .limit(1);
    if (!existing)
        throw new NotFound_1.NotFound("Coupon not found");
    // مسح سجلات الاستخدام أولاً منعاً لخطأ الـ Foreign Key
    await connection_1.db.delete(schema_1.couponUsages).where((0, drizzle_orm_1.eq)(schema_1.couponUsages.couponId, id));
    // مسح الكوبون (وسيتم مسح علاقات المطاعم تلقائياً إذا كانت الاسكيما cascade)
    await connection_1.db.delete(schema_1.coupons).where((0, drizzle_orm_1.eq)(schema_1.coupons.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Coupon deleted successfully from the entire system" });
};
exports.deleteCoupon = deleteCoupon;
// ========================================================
// 6. Toggle Coupon Active Status
// ========================================================
const toggleCouponStatus = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.coupons)
        .where((0, drizzle_orm_1.eq)(schema_1.coupons.id, id))
        .limit(1);
    if (!existing)
        throw new NotFound_1.NotFound("Coupon not found");
    const newStatus = !existing.isActive;
    await connection_1.db.update(schema_1.coupons)
        .set({ isActive: newStatus, updatedAt: new Date() })
        .where((0, drizzle_orm_1.eq)(schema_1.coupons.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: `Coupon ${newStatus ? "activated" : "deactivated"} successfully`,
        data: { isActive: newStatus }
    });
};
exports.toggleCouponStatus = toggleCouponStatus;
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
const getCouponUsages = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.coupons)
        .where((0, drizzle_orm_1.eq)(schema_1.coupons.id, id))
        .limit(1);
    if (!existing)
        throw new NotFound_1.NotFound("Coupon not found");
    const usages = await connection_1.db
        .select()
        .from(schema_1.couponUsages)
        .where((0, drizzle_orm_1.eq)(schema_1.couponUsages.couponId, id));
    return (0, response_1.SuccessResponse)(res, { message: "Coupon usage history fetched", data: usages });
};
exports.getCouponUsages = getCouponUsages;
