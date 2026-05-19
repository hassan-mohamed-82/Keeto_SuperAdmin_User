"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCouponUsages = exports.validateCouponEndpoint = exports.validateCoupon = exports.toggleCouponStatus = exports.deleteCoupon = exports.updateCoupon = exports.getCouponById = exports.getAllCoupons = exports.createCoupon = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const uuid_1 = require("uuid");
// ==========================================
// 1. Create Coupon
// ==========================================
const createCoupon = async (req, res) => {
    const { code, name, nameAr, nameFr, discountType, discountValue, maxDiscount, minOrderAmount, usageLimit, perUserLimit, startDate, endDate, isActive, restaurantId } = req.body;
    if (!code)
        throw new BadRequest_1.BadRequest("Coupon code is required");
    if (!name)
        throw new BadRequest_1.BadRequest("Coupon name is required");
    if (!discountType)
        throw new BadRequest_1.BadRequest("Discount type is required (percentage | fixed_amount | free_delivery)");
    if (discountValue === undefined || discountValue === null)
        throw new BadRequest_1.BadRequest("Discount value is required");
    const normalizedCode = code.toUpperCase().trim();
    const rIds = restaurantId ? (Array.isArray(restaurantId) ? restaurantId : [restaurantId]) : [];
    // [تعديل مهم]: التأكد من عدم تكرار الكود لنفس المطاعم المحددة فقط
    if (rIds.length > 0) {
        const conflicts = await connection_1.db
            .select({ id: schema_1.coupons.id })
            .from(schema_1.coupons)
            .innerJoin(schema_1.couponRestaurants, (0, drizzle_orm_1.eq)(schema_1.coupons.id, schema_1.couponRestaurants.couponId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.coupons.code, normalizedCode), (0, drizzle_orm_1.eq)(schema_1.coupons.isActive, true), // الكوبونات النشطة فقط
        (0, drizzle_orm_1.inArray)(schema_1.couponRestaurants.restaurantId, rIds)));
        if (conflicts.length > 0) {
            throw new BadRequest_1.BadRequest("Coupon code already exists in one of the selected restaurants");
        }
    }
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.coupons).values({
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
        const crData = rIds.map((rId) => ({
            id: (0, uuid_1.v4)(),
            couponId: id,
            restaurantId: rId,
        }));
        await connection_1.db.insert(schema_1.couponRestaurants).values(crData);
    }
    return (0, response_1.SuccessResponse)(res, { message: "Coupon created successfully", data: { id } }, 201);
};
exports.createCoupon = createCoupon;
// ==========================================
// 2. Get All Coupons (for this restaurant)
// ==========================================
const getAllCoupons = async (req, res) => {
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Unauthorized");
    const rawCoupons = await connection_1.db
        .select()
        .from(schema_1.coupons)
        .innerJoin(schema_1.couponRestaurants, (0, drizzle_orm_1.eq)(schema_1.coupons.id, schema_1.couponRestaurants.couponId))
        .where((0, drizzle_orm_1.eq)(schema_1.couponRestaurants.restaurantId, restaurantId));
    const allCoupons = rawCoupons.map(r => r.coupons);
    return (0, response_1.SuccessResponse)(res, { message: "Get all coupons success", data: allCoupons });
};
exports.getAllCoupons = getAllCoupons;
// ==========================================
// 3. Get Coupon by ID
// ==========================================
const getCouponById = async (req, res) => {
    const { id } = req.params;
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Unauthorized");
    const [rawCoupon] = await connection_1.db
        .select()
        .from(schema_1.coupons)
        .innerJoin(schema_1.couponRestaurants, (0, drizzle_orm_1.eq)(schema_1.coupons.id, schema_1.couponRestaurants.couponId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.coupons.id, id), (0, drizzle_orm_1.eq)(schema_1.couponRestaurants.restaurantId, restaurantId)))
        .limit(1);
    if (!rawCoupon)
        throw new NotFound_1.NotFound("Coupon not found");
    return (0, response_1.SuccessResponse)(res, { message: "Get coupon success", data: rawCoupon.coupons });
};
exports.getCouponById = getCouponById;
// ==========================================
// 4. Update Coupon
// ==========================================
const updateCoupon = async (req, res) => {
    const { id } = req.params;
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Unauthorized");
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.coupons)
        .innerJoin(schema_1.couponRestaurants, (0, drizzle_orm_1.eq)(schema_1.coupons.id, schema_1.couponRestaurants.couponId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.coupons.id, id), (0, drizzle_orm_1.eq)(schema_1.couponRestaurants.restaurantId, restaurantId)))
        .limit(1);
    if (!existing)
        throw new NotFound_1.NotFound("Coupon not found");
    const { code, name, nameAr, nameFr, discountType, discountValue, maxDiscount, minOrderAmount, usageLimit, perUserLimit, startDate, endDate, isActive, restaurantId: updatedRestaurantId } = req.body;
    const normalizedCode = code ? code.toUpperCase().trim() : existing.coupons.code;
    const targetRestaurants = updatedRestaurantId ? (Array.isArray(updatedRestaurantId) ? updatedRestaurantId : [updatedRestaurantId]) : [restaurantId];
    // [تعديل مهم]: تشيك الـ Duplicate يبحث فقط في المطاعم المرتبطة بالكوبون
    if (code && normalizedCode !== existing.coupons.code) {
        const [duplicate] = await connection_1.db
            .select({ id: schema_1.coupons.id })
            .from(schema_1.coupons)
            .innerJoin(schema_1.couponRestaurants, (0, drizzle_orm_1.eq)(schema_1.coupons.id, schema_1.couponRestaurants.couponId))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.coupons.code, normalizedCode), (0, drizzle_orm_1.inArray)(schema_1.couponRestaurants.restaurantId, targetRestaurants)))
            .limit(1);
        if (duplicate)
            throw new BadRequest_1.BadRequest("Coupon code already exists for this restaurant");
    }
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
    await connection_1.db.update(schema_1.coupons).set(updateData).where((0, drizzle_orm_1.eq)(schema_1.coupons.id, id));
    if (updatedRestaurantId !== undefined) {
        await connection_1.db.delete(schema_1.couponRestaurants).where((0, drizzle_orm_1.eq)(schema_1.couponRestaurants.couponId, id));
        if (targetRestaurants.length > 0) {
            const crData = targetRestaurants.map((rId) => ({
                id: (0, uuid_1.v4)(),
                couponId: id,
                restaurantId: rId,
            }));
            await connection_1.db.insert(schema_1.couponRestaurants).values(crData);
        }
    }
    return (0, response_1.SuccessResponse)(res, { message: "Coupon updated successfully" });
};
exports.updateCoupon = updateCoupon;
// ==========================================
// 5. Delete Coupon
// ==========================================
const deleteCoupon = async (req, res) => {
    const { id } = req.params;
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Unauthorized");
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.coupons)
        .innerJoin(schema_1.couponRestaurants, (0, drizzle_orm_1.eq)(schema_1.coupons.id, schema_1.couponRestaurants.couponId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.coupons.id, id), (0, drizzle_orm_1.eq)(schema_1.couponRestaurants.restaurantId, restaurantId)))
        .limit(1);
    if (!existing)
        throw new NotFound_1.NotFound("Coupon not found");
    // بفضل الـ onDelete: "cascade" في الاسكيما، مسح الكوبون الأساسي هيمسح الروابط في couponRestaurants تلقائياً
    await connection_1.db.delete(schema_1.couponUsages).where((0, drizzle_orm_1.eq)(schema_1.couponUsages.couponId, id));
    await connection_1.db.delete(schema_1.coupons).where((0, drizzle_orm_1.eq)(schema_1.coupons.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Coupon deleted successfully" });
};
exports.deleteCoupon = deleteCoupon;
// ==========================================
// 6. Toggle Coupon Active Status
// ==========================================
const toggleCouponStatus = async (req, res) => {
    const { id } = req.params;
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Unauthorized");
    const [rawExisting] = await connection_1.db
        .select()
        .from(schema_1.coupons)
        .innerJoin(schema_1.couponRestaurants, (0, drizzle_orm_1.eq)(schema_1.coupons.id, schema_1.couponRestaurants.couponId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.coupons.id, id), (0, drizzle_orm_1.eq)(schema_1.couponRestaurants.restaurantId, restaurantId)))
        .limit(1);
    if (!rawExisting)
        throw new NotFound_1.NotFound("Coupon not found");
    const existingCoupon = rawExisting.coupons;
    await connection_1.db.update(schema_1.coupons)
        .set({ isActive: !existingCoupon.isActive, updatedAt: new Date() })
        .where((0, drizzle_orm_1.eq)(schema_1.coupons.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: `Coupon ${!existingCoupon.isActive ? "activated" : "deactivated"} successfully`,
        data: { isActive: !existingCoupon.isActive }
    });
};
exports.toggleCouponStatus = toggleCouponStatus;
// ==========================================
// 7. Validate & Apply Coupon (Internal Function)
// ==========================================
const validateCoupon = async (couponCode, userId, restaurantId, subtotal) => {
    const now = new Date();
    const [rawCoupon] = await connection_1.db
        .select()
        .from(schema_1.coupons)
        .innerJoin(schema_1.couponRestaurants, (0, drizzle_orm_1.eq)(schema_1.coupons.id, schema_1.couponRestaurants.couponId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.coupons.code, couponCode.toUpperCase().trim()), (0, drizzle_orm_1.eq)(schema_1.couponRestaurants.restaurantId, restaurantId)))
        .limit(1);
    if (!rawCoupon)
        throw new BadRequest_1.BadRequest("Invalid coupon code");
    const coupon = rawCoupon.coupons;
    if (!coupon.isActive)
        throw new BadRequest_1.BadRequest("This coupon is no longer active");
    if (coupon.startDate && now < coupon.startDate)
        throw new BadRequest_1.BadRequest("This coupon is not yet valid");
    if (coupon.endDate && now > coupon.endDate)
        throw new BadRequest_1.BadRequest("This coupon has expired");
    const minOrder = parseFloat(coupon.minOrderAmount);
    if (subtotal < minOrder)
        throw new BadRequest_1.BadRequest(`Minimum order amount to use this coupon is ${minOrder}`);
    if (coupon.usageLimit !== null && (coupon.usedCount ?? 0) >= coupon.usageLimit)
        throw new BadRequest_1.BadRequest("This coupon has reached its usage limit");
    if (coupon.perUserLimit !== null) {
        const rows = await connection_1.db
            .select({ count: (0, drizzle_orm_1.sql) `COUNT(*)` })
            .from(schema_1.couponUsages)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.couponUsages.couponId, coupon.id), (0, drizzle_orm_1.eq)(schema_1.couponUsages.userId, userId)));
        const userUsageCount = Number(rows[0]?.count ?? 0);
        if (userUsageCount >= coupon.perUserLimit)
            throw new BadRequest_1.BadRequest("You have already used this coupon the maximum number of times");
    }
    let discountAmount = 0;
    if (coupon.discountType === "free_delivery") {
        discountAmount = 0;
    }
    else if (coupon.discountType === "percentage") {
        const pct = parseFloat(coupon.discountValue);
        discountAmount = (subtotal * pct) / 100;
        const maxD = coupon.maxDiscount ? parseFloat(coupon.maxDiscount) : null;
        if (maxD !== null && discountAmount > maxD)
            discountAmount = maxD;
    }
    else {
        discountAmount = parseFloat(coupon.discountValue);
        if (discountAmount > subtotal)
            discountAmount = subtotal;
    }
    return { discountAmount: parseFloat(discountAmount.toFixed(2)), coupon };
};
exports.validateCoupon = validateCoupon;
// ==========================================
// 8. Validate Coupon Endpoint (for Frontend Check)
// ==========================================
const validateCouponEndpoint = async (req, res) => {
    // [تعديل جوهري]: الـ restaurantId هنا لازم يجي من الـ body لأن العميل هو اللي بيطلب
    const { code, subtotal, restaurantId } = req.body;
    const userId = req.user?.id; // الـ ID بتاع العميل اللي مسجل دخول
    if (!code)
        throw new BadRequest_1.BadRequest("Coupon code is required");
    if (!subtotal)
        throw new BadRequest_1.BadRequest("Subtotal is required");
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Restaurant ID is required");
    if (!userId)
        throw new BadRequest_1.BadRequest("Unauthorized");
    const { discountAmount, coupon } = await (0, exports.validateCoupon)(code, userId, restaurantId, parseFloat(subtotal));
    return (0, response_1.SuccessResponse)(res, {
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
exports.validateCouponEndpoint = validateCouponEndpoint;
// ==========================================
// 9. Get Coupon Usage History
// ==========================================
const getCouponUsages = async (req, res) => {
    const { id } = req.params;
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Unauthorized");
    const [rawCoupon] = await connection_1.db
        .select({ id: schema_1.coupons.id })
        .from(schema_1.coupons)
        .innerJoin(schema_1.couponRestaurants, (0, drizzle_orm_1.eq)(schema_1.coupons.id, schema_1.couponRestaurants.couponId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.coupons.id, id), (0, drizzle_orm_1.eq)(schema_1.couponRestaurants.restaurantId, restaurantId)))
        .limit(1);
    if (!rawCoupon)
        throw new NotFound_1.NotFound("Coupon not found");
    const usages = await connection_1.db
        .select()
        .from(schema_1.couponUsages)
        .where((0, drizzle_orm_1.eq)(schema_1.couponUsages.couponId, id));
    return (0, response_1.SuccessResponse)(res, { message: "Coupon usage history fetched", data: usages });
};
exports.getCouponUsages = getCouponUsages;
