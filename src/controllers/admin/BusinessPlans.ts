import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurantBusinessPlans } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";

// ==========================================
// 1. إضافة خطة عمل لمطعم (Create)
// ==========================================
export const createBusinessPlan = async (req: Request, res: Response) => {
    const { 
        restaurantId, platformType, 
        isMonthlyActive, monthlyAmount, 
        isQuarterlyActive, quarterlyAmount, 
        isAnnuallyActive, annuallyAmount, 
        commissionRate, serviceFee 
    } = req.body;

    if (!restaurantId || !platformType) {
        throw new BadRequest("Restaurant ID and Platform Type are required");
    }

    // التأكد إن المطعم ملوش خطة مسجلة لنفس نوع المنصة قبل كده
    const existingPlan = await db
        .select()
        .from(restaurantBusinessPlans)
        .where(
            and(
                eq(restaurantBusinessPlans.restaurantId, restaurantId),
                eq(restaurantBusinessPlans.platformType, platformType)
            )
        )
        .limit(1);

    if (existingPlan[0]) {
        throw new BadRequest(`there is already a plan for this restaurant: ${platformType}`);
    }

    const id = uuidv4();

    await db.insert(restaurantBusinessPlans).values({
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

    return SuccessResponse(res, { message: "business plan created successfully", data: { id } }, 201);
};

// ==========================================
// 2. جلب خطط العمل الخاصة بمطعم معين (Read All for a Restaurant)
// ==========================================
export const getBusinessPlansByRestaurant = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;

    const plans = await db
        .select()
        .from(restaurantBusinessPlans)
        .where(eq(restaurantBusinessPlans.restaurantId, restaurantId));

    return SuccessResponse(res, { message: "fetched business plans successfully", data: plans });
};

// ==========================================
// 3. جلب تفاصيل خطة عمل معينة بالـ ID (Read One)
// ==========================================
export const getBusinessPlanById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const plan = await db
        .select()
        .from(restaurantBusinessPlans)
        .where(eq(restaurantBusinessPlans.id, id))
        .limit(1);

    if (!plan[0]) {
        throw new NotFound("there is no plan with this id");
    }

    return SuccessResponse(res, { message: "fetched business plan successfully", data: plan[0] });
};

// ==========================================
// 4. تحديث خطة العمل (Update)
// ==========================================
// تحديث خطة العمل (جوه ملف BusinessPlan.ts)
export const updateBusinessPlan = async (req: Request, res: Response) => {
    const { id } = req.params;
    const updateData = req.body;

    const existingPlan = await db
        .select()
        .from(restaurantBusinessPlans)
        .where(eq(restaurantBusinessPlans.id, id))
        .limit(1);

    if (!existingPlan[0]) {
        throw new NotFound("there is no plan with this id");
    }

    // 💡 الـ Validation الذكي للسويتشات:
    // لو السويتش الشهري اتبعت بـ true، لازم نتأكد إن المبلغ أكبر من صفر
    if (updateData.isMonthlyActive === true) {
        const amount = parseFloat(updateData.monthlyAmount || existingPlan[0].monthlyAmount);
        if (amount <= 0) throw new BadRequest("you can't activate the monthly plan with a zero amount");
    }

    // لو السويتش الربع سنوي اتبعت بـ true
    if (updateData.isQuarterlyActive === true) {
        const amount = parseFloat(updateData.quarterlyAmount || existingPlan[0].quarterlyAmount);
        if (amount <= 0) throw new BadRequest("you can't activate the quarterly plan with a zero amount");
    }

    // لو السويتش السنوي اتبعت بـ true
    if (updateData.isAnnuallyActive === true) {
        const amount = parseFloat(updateData.annuallyAmount || existingPlan[0].annuallyAmount);
        if (amount <= 0) throw new BadRequest("you can't activate the annually plan with a zero amount");
    }

    // منع تعديل الثوابت
    delete updateData.restaurantId;
    delete updateData.platformType;

    if (Object.keys(updateData).length === 0) {
        throw new BadRequest("no valid fields provided for update");
    }

    await db.update(restaurantBusinessPlans)
        .set(updateData)
        .where(eq(restaurantBusinessPlans.id, id));

    return SuccessResponse(res, { message: "business plan updated successfully" });
};
// ==========================================
// 5. حذف خطة العمل (Delete)
// ==========================================
export const deleteBusinessPlan = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingPlan = await db
        .select()
        .from(restaurantBusinessPlans)
        .where(eq(restaurantBusinessPlans.id, id))
        .limit(1);

    if (!existingPlan[0]) {
        throw new NotFound("there is no plan with this id");
    }

    await db.delete(restaurantBusinessPlans).where(eq(restaurantBusinessPlans.id, id));

    return SuccessResponse(res, { message: "business plan deleted successfully" });
};