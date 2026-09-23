import { Request, Response } from "express";
import { db } from "../../models/connection";
import { discounts, discountGroups, discountRestaurants, food } from "../../models/schema";
import { eq, and, or, inArray } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";
import { saveBase64Image } from "../../utils/handleImages";

// ==========================================
// 1. Create Discount (with Groups)
// ==========================================
export const createDiscount = async (req: Request, res: Response) => {
    const authenticatedRestaurantId = req.user?.restaurantId || req.user?.id;
    const restaurantId = req.body.restaurantId || authenticatedRestaurantId;
    if (!restaurantId) throw new BadRequest("Unauthorized");

    const {
        name, nameAr, nameFr,
        foodGroups, startDate, endDate, isActive,
        minOrderAmount, usageLimit, logo
    } = req.body;

    if (!name) throw new BadRequest("Discount name is required");
    if (!Array.isArray(foodGroups) || foodGroups.length === 0) {
        throw new BadRequest("foodGroups must contain at least one group");
    }

    const assignedFoodIds = new Set<string>();
    const groups = foodGroups.map((group: any) => {
        if (!group || !group.discountType) {
            throw new BadRequest("Each food group requires discountType");
        }

        const value = Number(group.discountValue);
        if (!Number.isFinite(value) || value < 0) {
            throw new BadRequest("Each food group requires a valid discountValue");
        }

        const discountType = group.discountType === "fixed" ? "fixed_amount" : group.discountType;
        if (!["percentage", "fixed_amount"].includes(discountType)) {
            throw new BadRequest("discountType must be percentage or fixed_amount");
        }

        if (!Array.isArray(group.foodIds) || group.foodIds.length === 0) {
            throw new BadRequest("Each food group must contain foodIds");
        }

        const foodIds: string[] = [...new Set(group.foodIds.filter(
            (foodId: unknown): foodId is string => typeof foodId === "string" && foodId.length > 0
        ))] as string[];
        if (foodIds.length !== group.foodIds.length) {
            throw new BadRequest("foodIds must contain unique non-empty strings");
        }

        for (const foodId of foodIds) {
            if (assignedFoodIds.has(foodId)) {
                throw new BadRequest(`Food ${foodId} cannot belong to more than one discount group`);
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
        throw new BadRequest("Invalid discount dates");
    }
    if (start && end && start > end) throw new BadRequest("startDate must be before endDate");

    const existingFoods = await db.select({ id: food.id })
        .from(food)
        .where(and(eq(food.restaurantid, restaurantId), inArray(food.id, [...assignedFoodIds])));
    if (existingFoods.length !== assignedFoodIds.size) {
        throw new BadRequest("One or more foodIds do not belong to this restaurant");
    }

    const discountId = await db.transaction(async (tx) => {
        // إيقاف أي خصم نشط تاني لنفس المطعم لو ده هيتفعل
        if (shouldBeActive) {
            const existing = await tx.select({ id: discounts.id })
                .from(discounts)
                .innerJoin(discountRestaurants, eq(discounts.id, discountRestaurants.discountId))
                .where(and(eq(discountRestaurants.restaurantId, restaurantId), eq(discounts.isActive, true)));
            if (existing.length > 0) {
                await tx.update(discounts).set({ isActive: false, updatedAt: new Date() })
                    .where(inArray(discounts.id, existing.map(item => item.id)));
            }
        }

        let campaignLogo = logo || null;
        if (campaignLogo?.startsWith("data:image")) {
            campaignLogo = await saveBase64Image(campaignLogo, req, "discounts");
        }

        // 1. إنشاء الخصم الأساسي (صف واحد بس)
        const newDiscountId = uuidv4();
        await tx.insert(discounts).values({
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
        await tx.insert(discountRestaurants).values({ id: uuidv4(), discountId: newDiscountId, restaurantId });

        // 2. إنشاء كل الخصومات الفرعية (groups) تحت نفس الخصم الأساسي
        for (const group of groups) {
            const groupId = uuidv4();
            await tx.insert(discountGroups).values({
                id: groupId,
                discountId: newDiscountId,
                discountType: group.discountType as "percentage" | "fixed_amount",
                discountValue: String(group.discountValue),
                maxDiscount: group.maxDiscount === undefined || group.maxDiscount === null ? null : String(Number(group.maxDiscount)),
            });

            if (group.foodIds.length > 0) {
                await tx.update(food).set({ discountId: groupId }).where(and(
                    eq(food.restaurantid, restaurantId),
                    inArray(food.id, group.foodIds),
                ));
            }
        }

        return newDiscountId;
    });

    return SuccessResponse(res, {
        message: "Discount created successfully",
        data: { restaurantId, discountId },
    }, 201);
};

// ==========================================
// 2. Get All Discounts (with their Groups)
// ==========================================
export const getAllDiscounts = async (req: Request, res: Response) => {
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId) throw new BadRequest("Unauthorized");

    const rawDiscounts = await db
        .selectDistinct({ discount: discounts })
        .from(discounts)
        .leftJoin(discountRestaurants, eq(discounts.id, discountRestaurants.discountId))
        .where(
            or(
                eq(discounts.isGlobal, true),
                eq(discountRestaurants.restaurantId, restaurantId)
            )
        );

    const data = await Promise.all(rawDiscounts.map(async ({ discount }) => {
        const groups = await db.select().from(discountGroups).where(eq(discountGroups.discountId, discount.id));

        const enrichedGroups = await Promise.all(groups.map(async (group) => {
            const foodsData = await db.select({
                id: food.id,
                name: food.name,
                nameAr: food.nameAr,
                nameFr: food.nameFr,
            }).from(food).where(eq(food.discountId, group.id));

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

    return SuccessResponse(res, { message: "Get all discounts success", data });
};

// ==========================================
// 3. Get Discount by ID (with its Groups)
// ==========================================
export const getDiscountById = async (req: Request, res: Response) => {
    const { id } = req.params; // discountId
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId) throw new BadRequest("Unauthorized");

    const [rawDiscount] = await db
        .selectDistinct({ discount: discounts })
        .from(discounts)
        .leftJoin(discountRestaurants, eq(discounts.id, discountRestaurants.discountId))
        .where(
            and(
                eq(discounts.id, id),
                or(
                    eq(discounts.isGlobal, true),
                    eq(discountRestaurants.restaurantId, restaurantId)
                )
            )
        )
        .limit(1);

    if (!rawDiscount) throw new NotFound("Discount not found");

    const groups = await db.select().from(discountGroups).where(eq(discountGroups.discountId, id));

    const enrichedGroups = await Promise.all(groups.map(async (group) => {
        const foodsData = await db.select({
            id: food.id,
            name: food.name,
            nameAr: food.nameAr,
            nameFr: food.nameFr,
        }).from(food).where(eq(food.discountId, group.id));

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

    return SuccessResponse(res, { message: "Get discount success", data });
};

// ==========================================
// 4. Update Discount (+ Groups)
// ==========================================
export const updateDiscount = async (req: Request, res: Response) => {
    const { id } = req.params; // discountId
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId) throw new BadRequest("Unauthorized");

    const [existing] = await db
        .select()
        .from(discounts)
        .innerJoin(discountRestaurants, eq(discounts.id, discountRestaurants.discountId))
        .where(
            and(
                eq(discounts.id, id),
                eq(discountRestaurants.restaurantId, restaurantId),
                eq(discounts.isGlobal, false)
            )
        )
        .limit(1);

    if (!existing) throw new NotFound("Discount not found or cannot be modified");

    const {
        name, nameAr, nameFr,
        minOrderAmount, usageLimit, startDate, endDate, isActive, logo,
        foodGroups, // ✅ لو عايز تحدّث الخصومات الفرعية في نفس الطلب
    } = req.body;

    let FinalLogo = logo;
    if (logo && logo.startsWith("data:image")) {
        FinalLogo = await saveBase64Image(logo, req, "discounts");
    }

    // لو هيتفعل، اطفي باقي خصومات المطعم
    if (isActive === true && !existing.discounts.isActive) {
        const myDiscounts = await db
            .select({ id: discounts.id })
            .from(discounts)
            .innerJoin(discountRestaurants, eq(discounts.id, discountRestaurants.discountId))
            .where(eq(discountRestaurants.restaurantId, restaurantId));

        const myDiscountIds = myDiscounts.map(d => d.id);

        if (myDiscountIds.length > 0) {
            await db
                .update(discounts)
                .set({ isActive: false, updatedAt: new Date() })
                .where(and(inArray(discounts.id, myDiscountIds), eq(discounts.isActive, true)));
        }
    }

    const updateData: any = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (nameAr !== undefined) updateData.nameAr = nameAr;
    if (nameFr !== undefined) updateData.nameFr = nameFr;
    if (minOrderAmount !== undefined) updateData.minOrderAmount = minOrderAmount.toString();
    if (usageLimit !== undefined) updateData.usageLimit = usageLimit;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (logo !== undefined) updateData.logo = FinalLogo;

    await db.update(discounts).set(updateData).where(eq(discounts.id, id));

    // ✅ تحديث الخصومات الفرعية: لو الفرونت بعت foodGroups جديدة، امسح القديمة واعمل جديدة
    if (Array.isArray(foodGroups)) {
        const oldGroups = await db.select({ id: discountGroups.id }).from(discountGroups).where(eq(discountGroups.discountId, id));
        const oldGroupIds = oldGroups.map(g => g.id);

        if (oldGroupIds.length > 0) {
            await db.update(food).set({ discountId: null }).where(inArray(food.discountId, oldGroupIds));
            await db.delete(discountGroups).where(inArray(discountGroups.id, oldGroupIds));
        }

        for (const group of foodGroups) {
            const discountType = group.discountType === "fixed" ? "fixed_amount" : group.discountType;
            const groupId = uuidv4();
            await db.insert(discountGroups).values({
                id: groupId,
                discountId: id,
                discountType,
                discountValue: String(group.discountValue),
                maxDiscount: group.maxDiscount === undefined || group.maxDiscount === null ? null : String(Number(group.maxDiscount)),
            });

            if (Array.isArray(group.foodIds) && group.foodIds.length > 0) {
                await db.update(food).set({ discountId: groupId }).where(and(
                    eq(food.restaurantid, restaurantId),
                    inArray(food.id, group.foodIds),
                ));
            }
        }
    }

    return SuccessResponse(res, { message: "Discount updated successfully" });
};

// ==========================================
// 5. Delete Discount
// ==========================================
export const deleteDiscount = async (req: Request, res: Response) => {
    const { id } = req.params; // discountId
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId) throw new BadRequest("Unauthorized");

    const [existing] = await db
        .select()
        .from(discounts)
        .innerJoin(discountRestaurants, eq(discounts.id, discountRestaurants.discountId))
        .where(
            and(
                eq(discounts.id, id),
                eq(discountRestaurants.restaurantId, restaurantId),
                eq(discounts.isGlobal, false)
            )
        )
        .limit(1);

    if (!existing) throw new NotFound("Discount not found or cannot be deleted");

    // discountGroups هتتمسح تلقائي بالـ ON DELETE CASCADE، لكن food.discountId
    // مش cascade (set null بس)، فلازم نفك ربط الأطعمة يدوي الأول
    const groupsToDelete = await db.select({ id: discountGroups.id }).from(discountGroups).where(eq(discountGroups.discountId, id));
    const groupIds = groupsToDelete.map(g => g.id);
    if (groupIds.length > 0) {
        await db.update(food).set({ discountId: null }).where(inArray(food.discountId, groupIds));
    }

    await db.delete(discounts).where(eq(discounts.id, id));

    return SuccessResponse(res, { message: "Discount deleted successfully" });
};

// ==========================================
// 6. Toggle Discount Status
// ==========================================
export const toggleDiscountStatus = async (req: Request, res: Response) => {
    const { id } = req.params; // discountId
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId) throw new BadRequest("Unauthorized");

    const [rawData] = await db
        .select()
        .from(discounts)
        .innerJoin(discountRestaurants, eq(discounts.id, discountRestaurants.discountId))
        .where(
            and(
                eq(discounts.id, id),
                eq(discountRestaurants.restaurantId, restaurantId),
                eq(discounts.isGlobal, false)
            )
        )
        .limit(1);

    if (!rawData) throw new NotFound("Discount not found or cannot be modified");
    const existingDiscount = rawData.discounts;

    const currentStatus = existingDiscount.isActive === true || existingDiscount.isActive === 1 as any;
    const nextStatus = !currentStatus;

    await db.transaction(async (tx) => {
        if (nextStatus === true) {
            const activeDiscounts = await tx
                .select({ id: discounts.id })
                .from(discounts)
                .innerJoin(discountRestaurants, eq(discounts.id, discountRestaurants.discountId))
                .where(
                    and(
                        eq(discountRestaurants.restaurantId, restaurantId),
                        eq(discounts.isActive, true)
                    )
                );

            const activeIdsToDeactivate = activeDiscounts
                .map(d => d.id)
                .filter(dId => dId !== id);

            if (activeIdsToDeactivate.length > 0) {
                await tx
                    .update(discounts)
                    .set({ isActive: false })
                    .where(inArray(discounts.id, activeIdsToDeactivate));
            }
        }

        await tx
            .update(discounts)
            .set({ isActive: nextStatus })
            .where(eq(discounts.id, id));
    });

    return SuccessResponse(res, {
        message: `Discount ${nextStatus ? "activated" : "deactivated"} successfully.`,
        data: { isActive: nextStatus }
    });
};

// Aliases for admin routes compatibility
export const createDiscountByAdmin = createDiscount;
export const getAllDiscountsByAdmin = getAllDiscounts;
export const getDiscountByIdByAdmin = getDiscountById;
export const updateDiscountByAdmin = updateDiscount;
export const deleteDiscountByAdmin = deleteDiscount;
export const toggleDiscountStatusByAdmin = toggleDiscountStatus;