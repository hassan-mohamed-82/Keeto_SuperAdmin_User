"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteBusinessPlan = exports.updateBusinessPlan = exports.getBusinessPlanById = exports.getBusinessPlansByRestaurant = exports.createBusinessPlan = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const uuid_1 = require("uuid");
// ==========================================
// 1. إضافة خطة عمل لمطعم (Create)
// ==========================================
const createBusinessPlan = async (req, res) => {
    const { restaurantId, platformType, isMonthlyActive, monthlyAmount, isQuarterlyActive, quarterlyAmount, isAnnuallyActive, annuallyAmount, commissionRate, serviceFee } = req.body;
    if (!restaurantId || !platformType) {
        throw new BadRequest_1.BadRequest("Restaurant ID and Platform Type are required");
    }
    // التأكد إن المطعم ملوش خطة مسجلة لنفس نوع المنصة قبل كده
    const existingPlan = await connection_1.db
        .select()
        .from(schema_1.restaurantBusinessPlans)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.platformType, platformType)))
        .limit(1);
    if (existingPlan[0]) {
        throw new BadRequest_1.BadRequest(`there is already a plan for this restaurant: ${platformType}`);
    }
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.restaurantBusinessPlans).values({
        id,
        restaurantId,
        platformType,
        isMonthlyActive: isMonthlyActive || false,
        monthlyAmount: monthlyAmount || "0.00",
        isQuarterlyActive: isQuarterlyActive || false,
        quarterlyAmount: quarterlyAmount || "0.00",
        isAnnuallyActive: isAnnuallyActive || false,
        annuallyAmount: annuallyAmount || "0.00",
        commissionRate: commissionRate || "0.00",
        serviceFee: serviceFee || "0.00"
    });
    return (0, response_1.SuccessResponse)(res, { message: "business plan created successfully", data: { id } }, 201);
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
    const plan = await connection_1.db
        .select()
        .from(schema_1.restaurantBusinessPlans)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.id, id))
        .limit(1);
    if (!plan[0]) {
        throw new NotFound_1.NotFound("there is no plan with this id");
    }
    return (0, response_1.SuccessResponse)(res, { message: "fetched business plan successfully", data: plan[0] });
};
exports.getBusinessPlanById = getBusinessPlanById;
// ==========================================
// 4. تحديث خطة العمل (Update)
// ==========================================
// تحديث خطة العمل (جوه ملف BusinessPlan.ts)
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
    // لو السويتش الشهري اتبعت بـ true، لازم نتأكد إن المبلغ أكبر من صفر
    if (updateData.isMonthlyActive === true) {
        const amount = parseFloat(updateData.monthlyAmount || existingPlan[0].monthlyAmount);
        if (amount <= 0)
            throw new BadRequest_1.BadRequest("you can't activate the monthly plan with a zero amount");
    }
    // لو السويتش الربع سنوي اتبعت بـ true
    if (updateData.isQuarterlyActive === true) {
        const amount = parseFloat(updateData.quarterlyAmount || existingPlan[0].quarterlyAmount);
        if (amount <= 0)
            throw new BadRequest_1.BadRequest("you can't activate the quarterly plan with a zero amount");
    }
    // لو السويتش السنوي اتبعت بـ true
    if (updateData.isAnnuallyActive === true) {
        const amount = parseFloat(updateData.annuallyAmount || existingPlan[0].annuallyAmount);
        if (amount <= 0)
            throw new BadRequest_1.BadRequest("you can't activate the annually plan with a zero amount");
    }
    // منع تعديل الثوابت
    delete updateData.restaurantId;
    delete updateData.platformType;
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
