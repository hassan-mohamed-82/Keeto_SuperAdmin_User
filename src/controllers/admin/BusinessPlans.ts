import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurantBusinessPlans, restaurants, restaurantWallets, restaurantWalletTransactions } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";
import { UnauthorizedError } from "../../Errors";

// ==========================================
// Helper: تسجيل الاشتراكات الفعّالة في محفظة المطعم
// ==========================================
const recordPlanSubscriptionsInWallet = async (
    tx: any,
    restaurantId: string,
    plan: {
        isMonthlyActive?: boolean;
        monthlyAmount?: string;
        isQuarterlyActive?: boolean;
        quarterlyAmount?: string;
        isAnnuallyActive?: boolean;
        annuallyAmount?: string;
        subscriptionStartDate?: string;
    },
    chargeNow: boolean = true
) => {
    // جلب بيانات المحفظة
    const wallet = await tx
        .select()
        .from(restaurantWallets)
        .where(eq(restaurantWallets.restaurantId, restaurantId))
        .limit(1);

    if (!wallet[0]) return; // لو مفيش محفظة، نتجاهل

    const currentBalance = parseFloat(wallet[0].balance as string || "0");
    let currentTotalSubs = parseFloat(wallet[0].totalSubscriptions as string || "0");
    let newBalance = currentBalance;

    const startDate = plan.subscriptionStartDate || new Date().toISOString().split("T")[0];
    const walletUpdate: Record<string, string> = {};
    const subscriptionRecords: any[] = [];

    const handleCycle = (cycleName: string, amountStr?: string, lastField?: string) => {
        const amount = parseFloat(amountStr || "0");
        if (amount <= 0) return;

        currentTotalSubs = Math.round((currentTotalSubs + amount + Number.EPSILON) * 100) / 100;
        walletUpdate.totalSubscriptions = currentTotalSubs.toFixed(2);
        if (lastField) walletUpdate[lastField] = amount.toFixed(2);

        // إذا كان مطلوب الخصم الآن (الافتراضي عند بداية التسجيل)
        if (chargeNow) {
            const prevBalance = newBalance;
            newBalance = Math.round((newBalance - amount + Number.EPSILON) * 100) / 100;
            walletUpdate.balance = newBalance.toFixed(2);

            subscriptionRecords.push({
                id: uuidv4(),
                restaurantId,
                type: "subscription",
                amount: `-${amount.toFixed(2)}`,
                balanceBefore: prevBalance.toFixed(2),
                balanceAfter: newBalance.toFixed(2),
                method: "system",
                note: `${cycleName} subscription charged to wallet (Start Date: ${startDate}): ${amount.toFixed(2)}`,
                createdAt: new Date(),
            });
        }
    };

    if (plan.isMonthlyActive) {
        handleCycle("Monthly", plan.monthlyAmount, "lastMonthlySubscription");
    }
    if (plan.isQuarterlyActive) {
        handleCycle("Quarterly", plan.quarterlyAmount, "lastQuarterlySubscription");
    }
    if (plan.isAnnuallyActive) {
        handleCycle("Annually", plan.annuallyAmount, "lastAnnuallySubscription");
    }

    if (Object.keys(walletUpdate).length > 0) {
        await tx.update(restaurantWallets)
            .set(walletUpdate)
            .where(eq(restaurantWallets.restaurantId, restaurantId));
    }

    for (const record of subscriptionRecords) {
        await tx.insert(restaurantWalletTransactions).values(record);
    }
};

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
    const valuesToInsert: any[] = [];
    const todayStr = new Date().toISOString().split("T")[0];

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

        // تاريخ بدء الاشتراك: الافتراضي اليوم أو يحدده المستخدم
        const startDate = platform.subscriptionStartDate || todayStr;

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
            subscriptionStartDate: startDate,
            
            // العمولات: لو المنصة pos بنجبرها تبقى 0.00، لو غير كده بناخد القيمة المبعوتة
            commissionRate: isPos ? "0.00" : (platform.commissionRate || "0.00"),
            serviceFee: isPos ? "0.00" : (platform.serviceFee || "0.00")
        });
    }

    // لو مفيش أي بيانات صالحة للإضافة
    if (valuesToInsert.length === 0) {
        throw new BadRequest("No valid platforms provided to be saved");
    }

    // الإضافة الجماعية داخل transaction مع تسجيل الاشتراكات في المحفظة
    await db.transaction(async (tx) => {
        await tx.insert(restaurantBusinessPlans).values(valuesToInsert);

        // تسجيل وخصم الاشتراكات الفعّالة في محفظة المطعم
        for (const plan of valuesToInsert) {
            const rawPlatform = platforms.find((p: any) => p.platformType === plan.platformType);
            const shouldCharge = rawPlatform?.chargeSubscriptionNow !== undefined
                ? Boolean(rawPlatform.chargeSubscriptionNow)
                : ((plan.subscriptionStartDate || todayStr) <= todayStr);

            await recordPlanSubscriptionsInWallet(
                tx,
                restaurantId,
                {
                    isMonthlyActive: plan.isMonthlyActive,
                    monthlyAmount: plan.monthlyAmount,
                    isQuarterlyActive: plan.isQuarterlyActive,
                    quarterlyAmount: plan.quarterlyAmount,
                    isAnnuallyActive: plan.isAnnuallyActive,
                    annuallyAmount: plan.annuallyAmount,
                    subscriptionStartDate: plan.subscriptionStartDate,
                },
                shouldCharge
            );
        }
    });

    return SuccessResponse(res, { 
        message: "Business plans created successfully and subscriptions recorded", 
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