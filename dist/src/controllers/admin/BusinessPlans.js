"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getallresstrauntplans = exports.deleteBusinessPlan = exports.updateBusinessPlan = exports.getBusinessPlanById = exports.getBusinessPlansByRestaurant = exports.createBusinessPlan = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const uuid_1 = require("uuid");
const Errors_1 = require("../../Errors");
// ==========================================
// 1. إضافة خطط عمل (الـ pos مربوط بـ isOn وبدون عمولات)
// ==========================================
const createBusinessPlan = async (req, res) => {
    const { restaurantId, platforms } = req.body;
    if (!restaurantId || !platforms || !Array.isArray(platforms)) {
        throw new BadRequest_1.BadRequest("Restaurant ID and a valid 'platforms' array are required");
    }
    // جلب البيانات القديمة للمطعم عشان نمنع التكرار
    const existingPlans = await connection_1.db
        .select({ platformType: schema_1.restaurantBusinessPlans.platformType })
        .from(schema_1.restaurantBusinessPlans)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, restaurantId));
    const existingTypes = existingPlans.map(p => p.platformType);
    const valuesToInsert = [];
    for (const platform of platforms) {
        const isPos = platform.platformType === "pos";
        // 💡 لو المنصة POS والسويتش بتاعها مش true، نتجاهلها
        if (isPos && platform.isOn !== true) {
            continue;
        }
        if (existingTypes.includes(platform.platformType)) {
            throw new BadRequest_1.BadRequest(`There is already a plan for this restaurant on platform: ${platform.platformType}`);
        }
        // 💡 Validation المبالغ للباقات (لو متفعلة)
        if (platform.isMonthlyActive && parseFloat(platform.monthlyAmount || "0") <= 0) {
            throw new BadRequest_1.BadRequest(`You can't activate the monthly plan with a zero amount for ${platform.platformType}`);
        }
        if (platform.isQuarterlyActive && parseFloat(platform.quarterlyAmount || "0") <= 0) {
            throw new BadRequest_1.BadRequest(`You can't activate the quarterly plan with a zero amount for ${platform.platformType}`);
        }
        if (platform.isAnnuallyActive && parseFloat(platform.annuallyAmount || "0") <= 0) {
            throw new BadRequest_1.BadRequest(`You can't activate the annually plan with a zero amount for ${platform.platformType}`);
        }
        // تجهيز الداتا للحفظ
        valuesToInsert.push({
            id: (0, uuid_1.v4)(),
            restaurantId,
            platformType: platform.platformType,
            // الباقات
            isMonthlyActive: platform.isMonthlyActive || false,
            monthlyAmount: platform.monthlyAmount || "0.00",
            isQuarterlyActive: platform.isQuarterlyActive || false,
            quarterlyAmount: platform.quarterlyAmount || "0.00",
            isAnnuallyActive: platform.isAnnuallyActive || false,
            annuallyAmount: platform.annuallyAmount || "0.00",
            // العمولات: لو المنصة pos بنجبرها تبقى 0.00، لو غير كده بناخد القيمة المبعوتة
            commissionRate: isPos ? "0.00" : (platform.commissionRate || "0.00"),
            serviceFee: isPos ? "0.00" : (platform.serviceFee || "0.00")
        });
    }
    // لو مفيش أي بيانات صالحة للإضافة
    if (valuesToInsert.length === 0) {
        throw new BadRequest_1.BadRequest("No valid platforms provided to be saved");
    }
    // الإضافة الجماعية في خطوة واحدة
    await connection_1.db.insert(schema_1.restaurantBusinessPlans).values(valuesToInsert);
    return (0, response_1.SuccessResponse)(res, {
        message: "Business plans created successfully",
        insertedCount: valuesToInsert.length
    }, 201);
};
exports.createBusinessPlan = createBusinessPlan;
// ==========================================
// 2. جلب خطط العمل الخاصة بمطعم معين (Read All for a Restaurant)
// ==========================================
const getBusinessPlansByRestaurant = async (req, res) => {
    const { restaurantId } = req.params;
    const plans = await connection_1.db
        .select()
        .from(schema_1.restaurantBusinessPlans)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, restaurantId));
    return (0, response_1.SuccessResponse)(res, { message: "fetched business plans successfully", data: plans });
};
exports.getBusinessPlansByRestaurant = getBusinessPlansByRestaurant;
// ==========================================
// 3. جلب تفاصيل خطة عمل معينة بالـ ID (Read One)
// ==========================================
const getBusinessPlanById = async (req, res) => {
    const { id } = req.params;
    const planDetails = await connection_1.db
        .select({
        plan: schema_1.restaurantBusinessPlans,
        restaurant: schema_1.restaurants,
    })
        .from(schema_1.restaurantBusinessPlans)
        .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.id, id))
        .limit(1);
    if (!planDetails[0]) {
        throw new NotFound_1.NotFound("there is no plan with this id");
    }
    const formattedPlans = planDetails.map((item) => {
        return {
            ...item.plan,
            restaurantDetails: item.restaurant
        };
    });
    return (0, response_1.SuccessResponse)(res, { message: "fetched business plan successfully", data: formattedPlans });
};
exports.getBusinessPlanById = getBusinessPlanById;
// ==========================================
// 4. تحديث خطة العمل (Update)
// ==========================================
const updateBusinessPlan = async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const existingPlan = await connection_1.db
        .select()
        .from(schema_1.restaurantBusinessPlans)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.id, id))
        .limit(1);
    if (!existingPlan[0]) {
        throw new NotFound_1.NotFound("there is no plan with this id");
    }
    // 💡 الـ Validation الذكي للسويتشات:
    if (updateData.isMonthlyActive === true) {
        const amount = parseFloat(updateData.monthlyAmount || existingPlan[0].monthlyAmount);
        if (amount <= 0)
            throw new BadRequest_1.BadRequest("you can't activate the monthly plan with a zero amount");
    }
    if (updateData.isQuarterlyActive === true) {
        const amount = parseFloat(updateData.quarterlyAmount || existingPlan[0].quarterlyAmount);
        if (amount <= 0)
            throw new BadRequest_1.BadRequest("you can't activate the quarterly plan with a zero amount");
    }
    if (updateData.isAnnuallyActive === true) {
        const amount = parseFloat(updateData.annuallyAmount || existingPlan[0].annuallyAmount);
        if (amount <= 0)
            throw new BadRequest_1.BadRequest("you can't activate the annually plan with a zero amount");
    }
    // 💡 تأكيد إضافي: لو المنصة pos نمنع تحديث العمولات لأي رقم غير صفر
    if (existingPlan[0].platformType === "pos") {
        updateData.commissionRate = "0.00";
        updateData.serviceFee = "0.00";
    }
    // منع تعديل الثوابت
    delete updateData.id;
    delete updateData.restaurantId;
    delete updateData.platformType;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    if (Object.keys(updateData).length === 0) {
        throw new BadRequest_1.BadRequest("no valid fields provided for update");
    }
    await connection_1.db.update(schema_1.restaurantBusinessPlans)
        .set(updateData)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "business plan updated successfully" });
};
exports.updateBusinessPlan = updateBusinessPlan;
// ==========================================
// 5. حذف خطة العمل (Delete)
// ==========================================
const deleteBusinessPlan = async (req, res) => {
    const { id } = req.params;
    const existingPlan = await connection_1.db
        .select()
        .from(schema_1.restaurantBusinessPlans)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.id, id))
        .limit(1);
    if (!existingPlan[0]) {
        throw new NotFound_1.NotFound("there is no plan with this id");
    }
    await connection_1.db.delete(schema_1.restaurantBusinessPlans).where((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "business plan deleted successfully" });
};
exports.deleteBusinessPlan = deleteBusinessPlan;
// ==========================================
// 6. جلب كل خطط العمل للمطاعم (Admin)
// ==========================================
const getallresstrauntplans = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const allPlansData = await connection_1.db.select({
        plan: schema_1.restaurantBusinessPlans,
        restaurant: schema_1.restaurants
    })
        .from(schema_1.restaurantBusinessPlans)
        .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, schema_1.restaurants.id));
    const formattedPlans = allPlansData.map((item) => ({
        ...item.plan,
        restaurantDetails: item.restaurant
    }));
    return (0, response_1.SuccessResponse)(res, {
        message: "Fetched all business plans successfully",
        data: formattedPlans
    });
};
exports.getallresstrauntplans = getallresstrauntplans;
