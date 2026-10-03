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
// Helper: تسجيل الاشتراكات الفعّالة في محفظة المطعم
// ==========================================
const recordPlanSubscriptionsInWallet = async (tx, restaurantId, plan, chargeNow = true) => {
    // جلب بيانات المحفظة
    const wallet = await tx
        .select()
        .from(schema_1.restaurantWallets)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId))
        .limit(1);
    if (!wallet[0])
        return; // لو مفيش محفظة، نتجاهل
    const currentBalance = parseFloat(wallet[0].balance || "0");
    let currentTotalSubs = parseFloat(wallet[0].totalSubscriptions || "0");
    let newBalance = currentBalance;
    const startDate = plan.subscriptionStartDate || new Date().toISOString().split("T")[0];
    const walletUpdate = {};
    const subscriptionRecords = [];
    const handleCycle = (cycleName, amountStr, lastField) => {
        const amount = parseFloat(amountStr || "0");
        if (amount <= 0)
            return;
        currentTotalSubs = Math.round((currentTotalSubs + amount + Number.EPSILON) * 100) / 100;
        walletUpdate.totalSubscriptions = currentTotalSubs.toFixed(2);
        if (lastField)
            walletUpdate[lastField] = amount.toFixed(2);
        // إذا كان مطلوب الخصم الآن (الافتراضي عند بداية التسجيل)
        if (chargeNow) {
            const prevBalance = newBalance;
            newBalance = Math.round((newBalance - amount + Number.EPSILON) * 100) / 100;
            walletUpdate.balance = newBalance.toFixed(2);
            subscriptionRecords.push({
                id: (0, uuid_1.v4)(),
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
        await tx.update(schema_1.restaurantWallets)
            .set(walletUpdate)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId));
    }
    for (const record of subscriptionRecords) {
        await tx.insert(schema_1.restaurantWalletTransactions).values(record);
    }
};
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
    const todayStr = new Date().toISOString().split("T")[0];
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
        // تاريخ بدء الاشتراك: الافتراضي اليوم أو يحدده المستخدم
        const startDate = platform.subscriptionStartDate || todayStr;
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
            subscriptionStartDate: startDate,
            // العمولات: لو المنصة pos بنجبرها تبقى 0.00، لو غير كده بناخد القيمة المبعوتة
            commissionRate: isPos ? "0.00" : (platform.commissionRate || "0.00"),
            serviceFee: isPos ? "0.00" : (platform.serviceFee || "0.00")
        });
    }
    // لو مفيش أي بيانات صالحة للإضافة
    if (valuesToInsert.length === 0) {
        throw new BadRequest_1.BadRequest("No valid platforms provided to be saved");
    }
    // الإضافة الجماعية داخل transaction مع تسجيل الاشتراكات في المحفظة
    await connection_1.db.transaction(async (tx) => {
        await tx.insert(schema_1.restaurantBusinessPlans).values(valuesToInsert);
        // تسجيل وخصم الاشتراكات الفعّالة في محفظة المطعم
        for (const plan of valuesToInsert) {
            const rawPlatform = platforms.find((p) => p.platformType === plan.platformType);
            const shouldCharge = rawPlatform?.chargeSubscriptionNow !== undefined
                ? Boolean(rawPlatform.chargeSubscriptionNow)
                : ((plan.subscriptionStartDate || todayStr) <= todayStr);
            await recordPlanSubscriptionsInWallet(tx, restaurantId, {
                isMonthlyActive: plan.isMonthlyActive,
                monthlyAmount: plan.monthlyAmount,
                isQuarterlyActive: plan.isQuarterlyActive,
                quarterlyAmount: plan.quarterlyAmount,
                isAnnuallyActive: plan.isAnnuallyActive,
                annuallyAmount: plan.annuallyAmount,
                subscriptionStartDate: plan.subscriptionStartDate,
            }, shouldCharge);
        }
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Business plans created successfully and subscriptions recorded",
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
