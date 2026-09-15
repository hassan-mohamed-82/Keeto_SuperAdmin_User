import { Request, Response } from "express";
import { db } from "../../models/connection";
import { orderDelayAlertGroups, branches, restaurants } from "../../models/schema";
import { eq, desc, inArray, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";
import { v4 as uuidv4 } from "uuid";

function parseJsonField<T>(val: unknown, fallback: T): T {
    if (typeof val === "string") {
        try {
            const parsed = JSON.parse(val);
            return parsed !== null && parsed !== undefined ? parsed : fallback;
        } catch {
            return fallback;
        }
    }
    if (val !== undefined && val !== null) {
        return val as T;
    }
    return fallback;
}

async function enrichGroupsWithDetails(groups: (typeof orderDelayAlertGroups.$inferSelect)[]) {
    const allBranchIds = new Set<string>();
    const allRestaurantIds = new Set<string>();

    const normalizedGroups = groups.map((g) => {
        const emails = parseJsonField<string[]>(g.emails, []);
        const branchIds = parseJsonField<string[]>(g.branchIds, []);
        const restaurantIds = parseJsonField<string[]>(g.restaurantIds, []);
        const orderStatus = parseJsonField<string[]>(g.orderStatus, ["pending"]);
        const allBranches = g.allBranches !== false;
        const allRestaurants = g.allRestaurants !== false;
        const isActive = Boolean(g.isActive);
        const isSuperAdmin = Boolean(g.isSuperAdmin);

        if (!allBranches && Array.isArray(branchIds)) {
            for (const bId of branchIds) {
                if (bId) allBranchIds.add(bId);
            }
        }

        if (!allRestaurants && Array.isArray(restaurantIds)) {
            for (const rId of restaurantIds) {
                if (rId) allRestaurantIds.add(rId);
            }
        }

        return {
            ...g,
            emails,
            branchIds,
            restaurantIds,
            orderStatus,
            allBranches,
            allRestaurants,
            isActive,
            isSuperAdmin,
        };
    });

    // 1. Fetch Branches
    const branchMap = new Map<string, { id: string; name: string; nameAr?: string | null }>();
    if (allBranchIds.size > 0) {
        const branchList = await db
            .select({
                id: branches.id,
                name: branches.name,
                nameAr: branches.nameAr,
            })
            .from(branches)
            .where(inArray(branches.id, Array.from(allBranchIds)));

        for (const b of branchList) {
            branchMap.set(b.id, b);
        }
    }

    // 2. Fetch Restaurants
    const restaurantMap = new Map<string, { id: string; name: string; nameAr?: string | null; logo?: string | null }>();
    if (allRestaurantIds.size > 0) {
        const restList = await db
            .select({
                id: restaurants.id,
                name: restaurants.name,
                nameAr: restaurants.nameAr,
                logo: restaurants.logo,
            })
            .from(restaurants)
            .where(inArray(restaurants.id, Array.from(allRestaurantIds)));

        for (const r of restList) {
            restaurantMap.set(r.id, r);
        }
    }

    return normalizedGroups.map((g) => {
        const branchesInfo = (!g.allBranches && Array.isArray(g.branchIds))
            ? g.branchIds.map((id) => branchMap.get(id) || { id, name: "Unknown", nameAr: "غير معروف" })
            : [];

        const restaurantsInfo = (!g.allRestaurants && Array.isArray(g.restaurantIds))
            ? g.restaurantIds.map((id) => restaurantMap.get(id) || { id, name: "Unknown", nameAr: "غير معروف", logo: null })
            : [];

        return {
            ...g,
            branches: branchesInfo,
            restaurants: restaurantsInfo,
        };
    });
}

// 1. Create Alert Group
export const createAlertGroup = async (req: Request, res: Response) => {
    const { 
        restaurantId, 
        isSuperAdmin = false, 
        name, 
        emails, 
        allBranches = true, 
        branchIds = [], 
        allRestaurants = true,
        restaurantIds = [],
        maxDelayMinutes, 
        orderStatus = ["pending"], 
        isActive = true 
    } = req.body;

    const isSuper = Boolean(isSuperAdmin);

    if (!isSuper && !restaurantId) {
        throw new BadRequest("معرف المطعم (restaurantId) مطلوب للجروبات التابعة للمطاعم");
    }

    const id = uuidv4();

    await db.insert(orderDelayAlertGroups).values({
        id,
        restaurantId: isSuper ? null : restaurantId,
        isSuperAdmin: isSuper,
        name: name.trim(),
        emails: Array.isArray(emails) ? emails : [emails],
        allBranches: isSuper ? true : Boolean(allBranches),
        branchIds: isSuper ? [] : (allBranches ? [] : (Array.isArray(branchIds) ? branchIds : [])),
        allRestaurants: isSuper ? Boolean(allRestaurants) : true,
        restaurantIds: isSuper ? (allRestaurants ? [] : (Array.isArray(restaurantIds) ? restaurantIds : [])) : [],
        maxDelayMinutes: Number(maxDelayMinutes),
        orderStatus: Array.isArray(orderStatus) && orderStatus.length > 0 ? orderStatus : ["pending"],
        isActive: Boolean(isActive),
    });

    const [created] = await db
        .select()
        .from(orderDelayAlertGroups)
        .where(eq(orderDelayAlertGroups.id, id))
        .limit(1);

    const [enriched] = await enrichGroupsWithDetails([created]);

    return SuccessResponse(
        res,
        {
            message: "تم إنشاء مجموعة تنبيه التأخير بنجاح",
            data: enriched,
        },
        201
    );
};

// 2. Get All Alert Groups
export const getAllAlertGroups = async (req: Request, res: Response) => {
    const { restaurantId, isSuperAdmin } = req.query;

    let queryCondition;

    // إذا طلب جلب مجموعات السوبر أدمن الخاصة للنظام
    if (isSuperAdmin === "true") {
        queryCondition = eq(orderDelayAlertGroups.isSuperAdmin, true);
    } 
    // إذا طلب جلب مجموعات مطعم معين
    else if (restaurantId && typeof restaurantId === "string") {
        queryCondition = and(
            eq(orderDelayAlertGroups.restaurantId, restaurantId),
            eq(orderDelayAlertGroups.isSuperAdmin, false)
        );
    } 
    // إذا لم يحدد، افتراضياً السوبر أدمن dashboard يجلب مجموعات السوبر أدمن
    else {
        queryCondition = eq(orderDelayAlertGroups.isSuperAdmin, true);
    }

    const groups = await db
        .select()
        .from(orderDelayAlertGroups)
        .where(queryCondition)
        .orderBy(desc(orderDelayAlertGroups.createdAt));

    const enriched = await enrichGroupsWithDetails(groups);

    return SuccessResponse(res, {
        message: "تم جلب مجموعات تنبيه التأخير بنجاح",
        data: enriched,
    });
};

// 3. Get By ID
export const getAlertGroupById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [group] = await db
        .select()
        .from(orderDelayAlertGroups)
        .where(eq(orderDelayAlertGroups.id, id))
        .limit(1);

    if (!group) {
        throw new NotFound("مجموعة التنبيه غير موجودة");
    }

    const [enriched] = await enrichGroupsWithDetails([group]);

    return SuccessResponse(res, {
        message: "تم جلب تفاصيل مجموعة التنبيه بنجاح",
        data: enriched,
    });
};

// 4. Update
export const updateAlertGroup = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existing] = await db
        .select()
        .from(orderDelayAlertGroups)
        .where(eq(orderDelayAlertGroups.id, id))
        .limit(1);

    if (!existing) {
        throw new NotFound("مجموعة التنبيه غير موجودة");
    }

    const { 
        name, 
        emails, 
        allBranches, 
        branchIds, 
        allRestaurants, 
        restaurantIds, 
        maxDelayMinutes, 
        orderStatus, 
        isActive, 
        isSuperAdmin,
        restaurantId 
    } = req.body;

    const updateData: Partial<typeof orderDelayAlertGroups.$inferInsert> = {};

    if (name !== undefined) updateData.name = name.trim();
    if (emails !== undefined) updateData.emails = Array.isArray(emails) ? emails : [emails];
    if (isSuperAdmin !== undefined) {
        updateData.isSuperAdmin = Boolean(isSuperAdmin);
        if (updateData.isSuperAdmin) {
            updateData.restaurantId = null;
        }
    }
    if (restaurantId !== undefined) {
        updateData.restaurantId = restaurantId;
    }

    // فرعي / مطاعم
    if (allBranches !== undefined) {
        updateData.allBranches = Boolean(allBranches);
        if (updateData.allBranches === true) {
            updateData.branchIds = [];
        }
    }
    if (branchIds !== undefined && updateData.allBranches !== true) {
        updateData.branchIds = Array.isArray(branchIds) ? branchIds : [];
    }

    if (allRestaurants !== undefined) {
        updateData.allRestaurants = Boolean(allRestaurants);
        if (updateData.allRestaurants === true) {
            updateData.restaurantIds = [];
        }
    }
    if (restaurantIds !== undefined && updateData.allRestaurants !== true) {
        updateData.restaurantIds = Array.isArray(restaurantIds) ? restaurantIds : [];
    }

    if (maxDelayMinutes !== undefined) updateData.maxDelayMinutes = Number(maxDelayMinutes);
    if (orderStatus !== undefined) {
        updateData.orderStatus = Array.isArray(orderStatus) && orderStatus.length > 0 ? orderStatus : ["pending"];
    }
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    await db
        .update(orderDelayAlertGroups)
        .set(updateData)
        .where(eq(orderDelayAlertGroups.id, id));

    const [updated] = await db
        .select()
        .from(orderDelayAlertGroups)
        .where(eq(orderDelayAlertGroups.id, id))
        .limit(1);

    const [enriched] = await enrichGroupsWithDetails([updated]);

    return SuccessResponse(res, {
        message: "تم تحديث مجموعة التنبيه بنجاح",
        data: enriched,
    });
};

// 5. Toggle Status
export const toggleAlertGroupStatus = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existing] = await db
        .select()
        .from(orderDelayAlertGroups)
        .where(eq(orderDelayAlertGroups.id, id))
        .limit(1);

    if (!existing) {
        throw new NotFound("مجموعة التنبيه غير موجودة");
    }

    const newStatus = !existing.isActive;

    await db
        .update(orderDelayAlertGroups)
        .set({ isActive: newStatus })
        .where(eq(orderDelayAlertGroups.id, id));

    return SuccessResponse(res, {
        message: newStatus ? "تم تفعيل مجموعة التنبيه" : "تم تعطيل مجموعة التنبيه",
        data: { id, isActive: newStatus },
    });
};

// 6. Delete
export const deleteAlertGroup = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existing] = await db
        .select()
        .from(orderDelayAlertGroups)
        .where(eq(orderDelayAlertGroups.id, id))
        .limit(1);

    if (!existing) {
        throw new NotFound("مجموعة التنبيه غير موجودة");
    }

    await db
        .delete(orderDelayAlertGroups)
        .where(eq(orderDelayAlertGroups.id, id));

    return SuccessResponse(res, {
        message: "تم حذف مجموعة التنبيه بنجاح",
        data: { id },
    });
};

// 7. Restaurants Lookup for Multi-select Dropdown
export const getRestaurantsLookup = async (req: Request, res: Response) => {
    const list = await db
        .select({
            id: restaurants.id,
            name: restaurants.name,
            nameAr: restaurants.nameAr,
            logo: restaurants.logo,
            status: restaurants.status,
        })
        .from(restaurants)
        .orderBy(desc(restaurants.createdAt));

    return SuccessResponse(res, {
        message: "تم جلب قائمة المطاعم بنجاح",
        data: list,
    });
};