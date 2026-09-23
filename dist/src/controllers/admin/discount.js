"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toggleDiscountStatusByAdmin = exports.deleteDiscountByAdmin = exports.updateDiscountByAdmin = exports.getDiscountByIdByAdmin = exports.getAllDiscountsByAdmin = exports.createDiscountByAdmin = exports.toggleDiscountStatus = exports.deleteDiscount = exports.updateDiscount = exports.getDiscountById = exports.getAllDiscounts = exports.createDiscount = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const uuid_1 = require("uuid");
const handleImages_1 = require("../../utils/handleImages");
// ==========================================
// 1. Create Discount (with Groups)
// ==========================================
const createDiscount = async (req, res) => {
    const authenticatedRestaurantId = req.user?.restaurantId || req.user?.id;
    const restaurantId = req.body.restaurantId || authenticatedRestaurantId;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Unauthorized");
    const { name, nameAr, nameFr, foodGroups, startDate, endDate, isActive, minOrderAmount, usageLimit, logo } = req.body;
    if (!name)
        throw new BadRequest_1.BadRequest("Discount name is required");
    if (!Array.isArray(foodGroups) || foodGroups.length === 0) {
        throw new BadRequest_1.BadRequest("foodGroups must contain at least one group");
    }
    const assignedFoodIds = new Set();
    const groups = foodGroups.map((group) => {
        if (!group || !group.discountType) {
            throw new BadRequest_1.BadRequest("Each food group requires discountType");
        }
        const value = Number(group.discountValue);
        if (!Number.isFinite(value) || value < 0) {
            throw new BadRequest_1.BadRequest("Each food group requires a valid discountValue");
        }
        const discountType = group.discountType === "fixed" ? "fixed_amount" : group.discountType;
        if (!["percentage", "fixed_amount"].includes(discountType)) {
            throw new BadRequest_1.BadRequest("discountType must be percentage or fixed_amount");
        }
        if (!Array.isArray(group.foodIds) || group.foodIds.length === 0) {
            throw new BadRequest_1.BadRequest("Each food group must contain foodIds");
        }
        const foodIds = [...new Set(group.foodIds.filter((foodId) => typeof foodId === "string" && foodId.length > 0))];
        if (foodIds.length !== group.foodIds.length) {
            throw new BadRequest_1.BadRequest("foodIds must contain unique non-empty strings");
        }
        for (const foodId of foodIds) {
            if (assignedFoodIds.has(foodId)) {
                throw new BadRequest_1.BadRequest(`Food ${foodId} cannot belong to more than one discount group`);
            }
            assignedFoodIds.add(foodId);
        }
        return {
            discountType,
            discountValue: value,
            maxDiscount: group.maxDiscount,
            foodIds,
        };
    });
    const shouldBeActive = isActive !== undefined ? isActive : true;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) {
        throw new BadRequest_1.BadRequest("Invalid discount dates");
    }
    if (start && end && start > end)
        throw new BadRequest_1.BadRequest("startDate must be before endDate");
    const existingFoods = await connection_1.db.select({ id: schema_1.food.id })
        .from(schema_1.food)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, restaurantId), (0, drizzle_orm_1.inArray)(schema_1.food.id, [...assignedFoodIds])));
    if (existingFoods.length !== assignedFoodIds.size) {
        throw new BadRequest_1.BadRequest("One or more foodIds do not belong to this restaurant");
    }
    const discountId = await connection_1.db.transaction(async (tx) => {
        // إيقاف أي خصم نشط تاني لنفس المطعم لو ده هيتفعل
        if (shouldBeActive) {
            const existing = await tx.select({ id: schema_1.discounts.id })
                .from(schema_1.discounts)
                .innerJoin(schema_1.discountRestaurants, (0, drizzle_orm_1.eq)(schema_1.discounts.id, schema_1.discountRestaurants.discountId))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discountRestaurants.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true)));
            if (existing.length > 0) {
                await tx.update(schema_1.discounts).set({ isActive: false, updatedAt: new Date() })
                    .where((0, drizzle_orm_1.inArray)(schema_1.discounts.id, existing.map(item => item.id)));
            }
        }
        let campaignLogo = logo || null;
        if (campaignLogo?.startsWith("data:image")) {
            campaignLogo = await (0, handleImages_1.saveBase64Image)(campaignLogo, req, "discounts");
        }
        // 1. إنشاء الخصم الأساسي (صف واحد بس)
        const newDiscountId = (0, uuid_1.v4)();
        await tx.insert(schema_1.discounts).values({
            id: newDiscountId,
            name,
            nameAr: nameAr || null,
            nameFr: nameFr || null,
            minOrderAmount: minOrderAmount ? String(minOrderAmount) : "0.00",
            usageLimit: usageLimit || null,
            startDate: start,
            endDate: end,
            isActive: shouldBeActive,
            isGlobal: false,
            logo: campaignLogo,
        });
        await tx.insert(schema_1.discountRestaurants).values({ id: (0, uuid_1.v4)(), discountId: newDiscountId, restaurantId });
        // 2. إنشاء كل الخصومات الفرعية (groups) تحت نفس الخصم الأساسي
        for (const group of groups) {
            const groupId = (0, uuid_1.v4)();
            await tx.insert(schema_1.discountGroups).values({
                id: groupId,
                discountId: newDiscountId,
                discountType: group.discountType,
                discountValue: String(group.discountValue),
                maxDiscount: group.maxDiscount === undefined || group.maxDiscount === null ? null : String(Number(group.maxDiscount)),
            });
            if (group.foodIds.length > 0) {
                await tx.update(schema_1.food).set({ discountId: groupId }).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, restaurantId), (0, drizzle_orm_1.inArray)(schema_1.food.id, group.foodIds)));
            }
        }
        return newDiscountId;
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Discount created successfully",
        data: { restaurantId, discountId },
    }, 201);
};
exports.createDiscount = createDiscount;
// ==========================================
// 2. Get All Discounts (with their Groups)
// ==========================================
const getAllDiscounts = async (req, res) => {
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Unauthorized");
    const rawDiscounts = await connection_1.db
        .selectDistinct({ discount: schema_1.discounts })
        .from(schema_1.discounts)
        .leftJoin(schema_1.discountRestaurants, (0, drizzle_orm_1.eq)(schema_1.discounts.id, schema_1.discountRestaurants.discountId))
        .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.discounts.isGlobal, true), (0, drizzle_orm_1.eq)(schema_1.discountRestaurants.restaurantId, restaurantId)));
    const data = await Promise.all(rawDiscounts.map(async ({ discount }) => {
        const groups = await connection_1.db.select().from(schema_1.discountGroups).where((0, drizzle_orm_1.eq)(schema_1.discountGroups.discountId, discount.id));
        const enrichedGroups = await Promise.all(groups.map(async (group) => {
            const foodsData = await connection_1.db.select({
                id: schema_1.food.id,
                name: schema_1.food.name,
                nameAr: schema_1.food.nameAr,
                nameFr: schema_1.food.nameFr,
            }).from(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.discountId, group.id));
            return {
                id: group.id,
                discountType: group.discountType,
                discountValue: group.discountValue,
                maxDiscount: group.maxDiscount,
                foodIds: foodsData.map(f => f.id),
                foods: foodsData,
            };
        }));
        return {
            id: discount.id,
            name: discount.name,
            nameAr: discount.nameAr,
            nameFr: discount.nameFr,
            isActive: discount.isActive,
            isGlobal: discount.isGlobal,
            startDate: discount.startDate,
            endDate: discount.endDate,
            minOrderAmount: discount.minOrderAmount,
            usageLimit: discount.usageLimit,
            logo: discount.logo,
            createdAt: discount.createdAt,
            updatedAt: discount.updatedAt,
            groups: enrichedGroups,
        };
    }));
    return (0, response_1.SuccessResponse)(res, { message: "Get all discounts success", data });
};
exports.getAllDiscounts = getAllDiscounts;
// ==========================================
// 3. Get Discount by ID (with its Groups)
// ==========================================
const getDiscountById = async (req, res) => {
    const { id } = req.params; // discountId
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Unauthorized");
    const [rawDiscount] = await connection_1.db
        .selectDistinct({ discount: schema_1.discounts })
        .from(schema_1.discounts)
        .leftJoin(schema_1.discountRestaurants, (0, drizzle_orm_1.eq)(schema_1.discounts.id, schema_1.discountRestaurants.discountId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discounts.id, id), (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.discounts.isGlobal, true), (0, drizzle_orm_1.eq)(schema_1.discountRestaurants.restaurantId, restaurantId))))
        .limit(1);
    if (!rawDiscount)
        throw new NotFound_1.NotFound("Discount not found");
    const groups = await connection_1.db.select().from(schema_1.discountGroups).where((0, drizzle_orm_1.eq)(schema_1.discountGroups.discountId, id));
    const enrichedGroups = await Promise.all(groups.map(async (group) => {
        const foodsData = await connection_1.db.select({
            id: schema_1.food.id,
            name: schema_1.food.name,
            nameAr: schema_1.food.nameAr,
            nameFr: schema_1.food.nameFr,
        }).from(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.discountId, group.id));
        return {
            id: group.id,
            discountType: group.discountType,
            discountValue: group.discountValue,
            maxDiscount: group.maxDiscount,
            foodIds: foodsData.map(f => f.id),
            foods: foodsData,
        };
    }));
    const discount = rawDiscount.discount;
    const data = {
        id: discount.id,
        name: discount.name,
        nameAr: discount.nameAr,
        nameFr: discount.nameFr,
        isActive: discount.isActive,
        isGlobal: discount.isGlobal,
        startDate: discount.startDate,
        endDate: discount.endDate,
        minOrderAmount: discount.minOrderAmount,
        usageLimit: discount.usageLimit,
        logo: discount.logo,
        createdAt: discount.createdAt,
        updatedAt: discount.updatedAt,
        groups: enrichedGroups,
    };
    return (0, response_1.SuccessResponse)(res, { message: "Get discount success", data });
};
exports.getDiscountById = getDiscountById;
// ==========================================
// 4. Update Discount (+ Groups)
// ==========================================
const updateDiscount = async (req, res) => {
    const { id } = req.params; // discountId
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Unauthorized");
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.discounts)
        .innerJoin(schema_1.discountRestaurants, (0, drizzle_orm_1.eq)(schema_1.discounts.id, schema_1.discountRestaurants.discountId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discounts.id, id), (0, drizzle_orm_1.eq)(schema_1.discountRestaurants.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.discounts.isGlobal, false)))
        .limit(1);
    if (!existing)
        throw new NotFound_1.NotFound("Discount not found or cannot be modified");
    const { name, nameAr, nameFr, minOrderAmount, usageLimit, startDate, endDate, isActive, logo, foodGroups, // ✅ لو عايز تحدّث الخصومات الفرعية في نفس الطلب
     } = req.body;
    let FinalLogo = logo;
    if (logo && logo.startsWith("data:image")) {
        FinalLogo = await (0, handleImages_1.saveBase64Image)(logo, req, "discounts");
    }
    // لو هيتفعل، اطفي باقي خصومات المطعم
    if (isActive === true && !existing.discounts.isActive) {
        const myDiscounts = await connection_1.db
            .select({ id: schema_1.discounts.id })
            .from(schema_1.discounts)
            .innerJoin(schema_1.discountRestaurants, (0, drizzle_orm_1.eq)(schema_1.discounts.id, schema_1.discountRestaurants.discountId))
            .where((0, drizzle_orm_1.eq)(schema_1.discountRestaurants.restaurantId, restaurantId));
        const myDiscountIds = myDiscounts.map(d => d.id);
        if (myDiscountIds.length > 0) {
            await connection_1.db
                .update(schema_1.discounts)
                .set({ isActive: false, updatedAt: new Date() })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.discounts.id, myDiscountIds), (0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true)));
        }
    }
    const updateData = { updatedAt: new Date() };
    if (name !== undefined)
        updateData.name = name;
    if (nameAr !== undefined)
        updateData.nameAr = nameAr;
    if (nameFr !== undefined)
        updateData.nameFr = nameFr;
    if (minOrderAmount !== undefined)
        updateData.minOrderAmount = minOrderAmount.toString();
    if (usageLimit !== undefined)
        updateData.usageLimit = usageLimit;
    if (startDate !== undefined)
        updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined)
        updateData.endDate = endDate ? new Date(endDate) : null;
    if (isActive !== undefined)
        updateData.isActive = isActive;
    if (logo !== undefined)
        updateData.logo = FinalLogo;
    await connection_1.db.update(schema_1.discounts).set(updateData).where((0, drizzle_orm_1.eq)(schema_1.discounts.id, id));
    // ✅ تحديث الخصومات الفرعية: لو الفرونت بعت foodGroups جديدة، امسح القديمة واعمل جديدة
    if (Array.isArray(foodGroups)) {
        const oldGroups = await connection_1.db.select({ id: schema_1.discountGroups.id }).from(schema_1.discountGroups).where((0, drizzle_orm_1.eq)(schema_1.discountGroups.discountId, id));
        const oldGroupIds = oldGroups.map(g => g.id);
        if (oldGroupIds.length > 0) {
            await connection_1.db.update(schema_1.food).set({ discountId: null }).where((0, drizzle_orm_1.inArray)(schema_1.food.discountId, oldGroupIds));
            await connection_1.db.delete(schema_1.discountGroups).where((0, drizzle_orm_1.inArray)(schema_1.discountGroups.id, oldGroupIds));
        }
        for (const group of foodGroups) {
            const discountType = group.discountType === "fixed" ? "fixed_amount" : group.discountType;
            const groupId = (0, uuid_1.v4)();
            await connection_1.db.insert(schema_1.discountGroups).values({
                id: groupId,
                discountId: id,
                discountType,
                discountValue: String(group.discountValue),
                maxDiscount: group.maxDiscount === undefined || group.maxDiscount === null ? null : String(Number(group.maxDiscount)),
            });
            if (Array.isArray(group.foodIds) && group.foodIds.length > 0) {
                await connection_1.db.update(schema_1.food).set({ discountId: groupId }).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, restaurantId), (0, drizzle_orm_1.inArray)(schema_1.food.id, group.foodIds)));
            }
        }
    }
    return (0, response_1.SuccessResponse)(res, { message: "Discount updated successfully" });
};
exports.updateDiscount = updateDiscount;
// ==========================================
// 5. Delete Discount
// ==========================================
const deleteDiscount = async (req, res) => {
    const { id } = req.params; // discountId
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Unauthorized");
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.discounts)
        .innerJoin(schema_1.discountRestaurants, (0, drizzle_orm_1.eq)(schema_1.discounts.id, schema_1.discountRestaurants.discountId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discounts.id, id), (0, drizzle_orm_1.eq)(schema_1.discountRestaurants.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.discounts.isGlobal, false)))
        .limit(1);
    if (!existing)
        throw new NotFound_1.NotFound("Discount not found or cannot be deleted");
    // discountGroups هتتمسح تلقائي بالـ ON DELETE CASCADE، لكن food.discountId
    // مش cascade (set null بس)، فلازم نفك ربط الأطعمة يدوي الأول
    const groupsToDelete = await connection_1.db.select({ id: schema_1.discountGroups.id }).from(schema_1.discountGroups).where((0, drizzle_orm_1.eq)(schema_1.discountGroups.discountId, id));
    const groupIds = groupsToDelete.map(g => g.id);
    if (groupIds.length > 0) {
        await connection_1.db.update(schema_1.food).set({ discountId: null }).where((0, drizzle_orm_1.inArray)(schema_1.food.discountId, groupIds));
    }
    await connection_1.db.delete(schema_1.discounts).where((0, drizzle_orm_1.eq)(schema_1.discounts.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Discount deleted successfully" });
};
exports.deleteDiscount = deleteDiscount;
// ==========================================
// 6. Toggle Discount Status
// ==========================================
const toggleDiscountStatus = async (req, res) => {
    const { id } = req.params; // discountId
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Unauthorized");
    const [rawData] = await connection_1.db
        .select()
        .from(schema_1.discounts)
        .innerJoin(schema_1.discountRestaurants, (0, drizzle_orm_1.eq)(schema_1.discounts.id, schema_1.discountRestaurants.discountId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discounts.id, id), (0, drizzle_orm_1.eq)(schema_1.discountRestaurants.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.discounts.isGlobal, false)))
        .limit(1);
    if (!rawData)
        throw new NotFound_1.NotFound("Discount not found or cannot be modified");
    const existingDiscount = rawData.discounts;
    const currentStatus = existingDiscount.isActive === true || existingDiscount.isActive === 1;
    const nextStatus = !currentStatus;
    await connection_1.db.transaction(async (tx) => {
        if (nextStatus === true) {
            const activeDiscounts = await tx
                .select({ id: schema_1.discounts.id })
                .from(schema_1.discounts)
                .innerJoin(schema_1.discountRestaurants, (0, drizzle_orm_1.eq)(schema_1.discounts.id, schema_1.discountRestaurants.discountId))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discountRestaurants.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true)));
            const activeIdsToDeactivate = activeDiscounts
                .map(d => d.id)
                .filter(dId => dId !== id);
            if (activeIdsToDeactivate.length > 0) {
                await tx
                    .update(schema_1.discounts)
                    .set({ isActive: false })
                    .where((0, drizzle_orm_1.inArray)(schema_1.discounts.id, activeIdsToDeactivate));
            }
        }
        await tx
            .update(schema_1.discounts)
            .set({ isActive: nextStatus })
            .where((0, drizzle_orm_1.eq)(schema_1.discounts.id, id));
    });
    return (0, response_1.SuccessResponse)(res, {
        message: `Discount ${nextStatus ? "activated" : "deactivated"} successfully.`,
        data: { isActive: nextStatus }
    });
};
exports.toggleDiscountStatus = toggleDiscountStatus;
// Aliases for admin routes compatibility
exports.createDiscountByAdmin = exports.createDiscount;
exports.getAllDiscountsByAdmin = exports.getAllDiscounts;
exports.getDiscountByIdByAdmin = exports.getDiscountById;
exports.updateDiscountByAdmin = exports.updateDiscount;
exports.deleteDiscountByAdmin = exports.deleteDiscount;
exports.toggleDiscountStatusByAdmin = exports.toggleDiscountStatus;
