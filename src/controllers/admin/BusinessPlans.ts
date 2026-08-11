import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurantBusinessPlans, restaurants } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";
import { UnauthorizedError } from "../../Errors";

// ==========================================
// 1. إضافة خطط عمل (الـ pos مربوط بـ isOn وبدون عمولات)
// ==========================================
export const createBusinessPlan = async (req: Request, res: Response) => {
    const { restaurantId, platforms } = req.body;

    if (!restaurantId || !platforms || !Array.isArray(platforms)) {
        throw new BadRequest("Restaurant ID and a valid 'platforms' array are required");
    }

    // جلب البيانات القديمة للمطعم عشان نمنع التكرار
    const existingPlans = await db
        .select({ platformType: restaurantBusinessPlans.platformType })
        .from(restaurantBusinessPlans)
        .where(eq(restaurantBusinessPlans.restaurantId, restaurantId));

    const existingTypes = existingPlans.map(p => p.platformType);
    const valuesToInsert = [];

    for (const platform of platforms) {
        const isPos = platform.platformType === "pos";

        // 💡 لو المنصة POS والسويتش بتاعها مش true، نتجاهلها
        if (isPos && platform.isOn !== true) {
            continue; 
        }

        if (existingTypes.includes(platform.platformType)) {
            throw new BadRequest(`There is already a plan for this restaurant on platform: ${platform.platformType}`);
        }

        // 💡 Validation المبالغ للباقات (لو متفعلة)
        if (platform.isMonthlyActive && parseFloat(platform.monthlyAmount || "0") <= 0) {
            throw new BadRequest(`You can't activate the monthly plan with a zero amount for ${platform.platformType}`);
        }
        if (platform.isQuarterlyActive && parseFloat(platform.quarterlyAmount || "0") <= 0) {
            throw new BadRequest(`You can't activate the quarterly plan with a zero amount for ${platform.platformType}`);
        }
        if (platform.isAnnuallyActive && parseFloat(platform.annuallyAmount || "0") <= 0) {
            throw new BadRequest(`You can't activate the annually plan with a zero amount for ${platform.platformType}`);
        }

        // تجهيز الداتا للحفظ
        valuesToInsert.push({
            id: uuidv4(),
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
        throw new BadRequest("No valid platforms provided to be saved");
    }

    // الإضافة الجماعية في خطوة واحدة
    await db.insert(restaurantBusinessPlans).values(valuesToInsert);

    return SuccessResponse(res, { 
        message: "Business plans created successfully", 
        insertedCount: valuesToInsert.length 
    }, 201);
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

    const planDetails = await db
        .select({
            plan : restaurantBusinessPlans,
            restaurant: restaurants,
        })
        .from(restaurantBusinessPlans)
        .innerJoin(restaurants, eq(restaurantBusinessPlans.restaurantId, restaurants.id))
        .where(eq(restaurantBusinessPlans.id, id))
        .limit(1);

    if (!planDetails[0]) {
        throw new NotFound("there is no plan with this id");
    }

    const formattedPlans = planDetails.map((item)=>{
        return {
            ...item.plan,
            restaurantDetails: item.restaurant 
        }
    })

    return SuccessResponse(res, { message: "fetched business plan successfully", data: formattedPlans });
};

// ==========================================
// 4. تحديث خطة العمل (Update)
// ==========================================
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
    if (updateData.isMonthlyActive === true) {
        const amount = parseFloat(updateData.monthlyAmount || existingPlan[0].monthlyAmount);
        if (amount <= 0) throw new BadRequest("you can't activate the monthly plan with a zero amount");
    }
    if (updateData.isQuarterlyActive === true) {
        const amount = parseFloat(updateData.quarterlyAmount || existingPlan[0].quarterlyAmount);
        if (amount <= 0) throw new BadRequest("you can't activate the quarterly plan with a zero amount");
    }
    if (updateData.isAnnuallyActive === true) {
        const amount = parseFloat(updateData.annuallyAmount || existingPlan[0].annuallyAmount);
        if (amount <= 0) throw new BadRequest("you can't activate the annually plan with a zero amount");
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

// ==========================================
// 6. جلب كل خطط العمل للمطاعم (Admin)
// ==========================================
export const getallresstrauntplans = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const allPlansData = await db.select({
        plan: restaurantBusinessPlans,
        restaurant: restaurants
    })
    .from(restaurantBusinessPlans)
    .innerJoin(restaurants, eq(restaurantBusinessPlans.restaurantId, restaurants.id));

    const formattedPlans = allPlansData.map((item) => ({
        ...item.plan, 
        restaurantDetails: item.restaurant 
    }));

    return SuccessResponse(res, { 
        message: "Fetched all business plans successfully", 
        data: formattedPlans 
    });
};