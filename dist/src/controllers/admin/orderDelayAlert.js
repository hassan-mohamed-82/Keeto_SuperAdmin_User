"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRestaurantsLookup = exports.deleteAlertGroup = exports.toggleAlertGroupStatus = exports.updateAlertGroup = exports.getAlertGroupById = exports.getAllAlertGroups = exports.createAlertGroup = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const uuid_1 = require("uuid");
function parseJsonField(val, fallback) {
    if (typeof val === "string") {
        try {
            const parsed = JSON.parse(val);
            return parsed !== null && parsed !== undefined ? parsed : fallback;
        }
        catch {
            return fallback;
        }
    }
    if (val !== undefined && val !== null) {
        return val;
    }
    return fallback;
}
async function enrichGroupsWithDetails(groups) {
    const allBranchIds = new Set();
    const allRestaurantIds = new Set();
    const normalizedGroups = groups.map((g) => {
        const emails = parseJsonField(g.emails, []);
        const branchIds = parseJsonField(g.branchIds, []);
        const restaurantIds = parseJsonField(g.restaurantIds, []);
        const orderStatus = parseJsonField(g.orderStatus, ["pending"]);
        const allBranches = g.allBranches !== false;
        const allRestaurants = g.allRestaurants !== false;
        const isActive = Boolean(g.isActive);
        const isSuperAdmin = Boolean(g.isSuperAdmin);
        if (!allBranches && Array.isArray(branchIds)) {
            for (const bId of branchIds) {
                if (bId)
                    allBranchIds.add(bId);
            }
        }
        if (!allRestaurants && Array.isArray(restaurantIds)) {
            for (const rId of restaurantIds) {
                if (rId)
                    allRestaurantIds.add(rId);
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
    const branchMap = new Map();
    if (allBranchIds.size > 0) {
        const branchList = await connection_1.db
            .select({
            id: schema_1.branches.id,
            name: schema_1.branches.name,
            nameAr: schema_1.branches.nameAr,
        })
            .from(schema_1.branches)
            .where((0, drizzle_orm_1.inArray)(schema_1.branches.id, Array.from(allBranchIds)));
        for (const b of branchList) {
            branchMap.set(b.id, b);
        }
    }
    // 2. Fetch Restaurants
    const restaurantMap = new Map();
    if (allRestaurantIds.size > 0) {
        const restList = await connection_1.db
            .select({
            id: schema_1.restaurants.id,
            name: schema_1.restaurants.name,
            nameAr: schema_1.restaurants.nameAr,
            logo: schema_1.restaurants.logo,
        })
            .from(schema_1.restaurants)
            .where((0, drizzle_orm_1.inArray)(schema_1.restaurants.id, Array.from(allRestaurantIds)));
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
const createAlertGroup = async (req, res) => {
    const { restaurantId, isSuperAdmin = false, name, emails, allBranches = true, branchIds = [], allRestaurants = true, restaurantIds = [], maxDelayMinutes, orderStatus = ["pending"], isActive = true } = req.body;
    const isSuper = Boolean(isSuperAdmin);
    if (!isSuper && !restaurantId) {
        throw new Errors_1.BadRequest("معرف المطعم (restaurantId) مطلوب للجروبات التابعة للمطاعم");
    }
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.orderDelayAlertGroups).values({
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
    const [created] = await connection_1.db
        .select()
        .from(schema_1.orderDelayAlertGroups)
        .where((0, drizzle_orm_1.eq)(schema_1.orderDelayAlertGroups.id, id))
        .limit(1);
    const [enriched] = await enrichGroupsWithDetails([created]);
    return (0, response_1.SuccessResponse)(res, {
        message: "تم إنشاء مجموعة تنبيه التأخير بنجاح",
        data: enriched,
    }, 201);
};
exports.createAlertGroup = createAlertGroup;
// 2. Get All Alert Groups
const getAllAlertGroups = async (req, res) => {
    const { restaurantId, isSuperAdmin } = req.query;
    let queryCondition;
    // إذا طلب جلب مجموعات السوبر أدمن الخاصة للنظام
    if (isSuperAdmin === "true") {
        queryCondition = (0, drizzle_orm_1.eq)(schema_1.orderDelayAlertGroups.isSuperAdmin, true);
    }
    // إذا طلب جلب مجموعات مطعم معين
    else if (restaurantId && typeof restaurantId === "string") {
        queryCondition = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orderDelayAlertGroups.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.orderDelayAlertGroups.isSuperAdmin, false));
    }
    // إذا لم يحدد، افتراضياً السوبر أدمن dashboard يجلب مجموعات السوبر أدمن
    else {
        queryCondition = (0, drizzle_orm_1.eq)(schema_1.orderDelayAlertGroups.isSuperAdmin, true);
    }
    const groups = await connection_1.db
        .select()
        .from(schema_1.orderDelayAlertGroups)
        .where(queryCondition)
        .orderBy((0, drizzle_orm_1.desc)(schema_1.orderDelayAlertGroups.createdAt));
    const enriched = await enrichGroupsWithDetails(groups);
    return (0, response_1.SuccessResponse)(res, {
        message: "تم جلب مجموعات تنبيه التأخير بنجاح",
        data: enriched,
    });
};
exports.getAllAlertGroups = getAllAlertGroups;
// 3. Get By ID
const getAlertGroupById = async (req, res) => {
    const { id } = req.params;
    const [group] = await connection_1.db
        .select()
        .from(schema_1.orderDelayAlertGroups)
        .where((0, drizzle_orm_1.eq)(schema_1.orderDelayAlertGroups.id, id))
        .limit(1);
    if (!group) {
        throw new Errors_1.NotFound("مجموعة التنبيه غير موجودة");
    }
    const [enriched] = await enrichGroupsWithDetails([group]);
    return (0, response_1.SuccessResponse)(res, {
        message: "تم جلب تفاصيل مجموعة التنبيه بنجاح",
        data: enriched,
    });
};
exports.getAlertGroupById = getAlertGroupById;
// 4. Update
const updateAlertGroup = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.orderDelayAlertGroups)
        .where((0, drizzle_orm_1.eq)(schema_1.orderDelayAlertGroups.id, id))
        .limit(1);
    if (!existing) {
        throw new Errors_1.NotFound("مجموعة التنبيه غير موجودة");
    }
    const { name, emails, allBranches, branchIds, allRestaurants, restaurantIds, maxDelayMinutes, orderStatus, isActive, isSuperAdmin, restaurantId } = req.body;
    const updateData = {};
    if (name !== undefined)
        updateData.name = name.trim();
    if (emails !== undefined)
        updateData.emails = Array.isArray(emails) ? emails : [emails];
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
    if (maxDelayMinutes !== undefined)
        updateData.maxDelayMinutes = Number(maxDelayMinutes);
    if (orderStatus !== undefined) {
        updateData.orderStatus = Array.isArray(orderStatus) && orderStatus.length > 0 ? orderStatus : ["pending"];
    }
    if (isActive !== undefined)
        updateData.isActive = Boolean(isActive);
    await connection_1.db
        .update(schema_1.orderDelayAlertGroups)
        .set(updateData)
        .where((0, drizzle_orm_1.eq)(schema_1.orderDelayAlertGroups.id, id));
    const [updated] = await connection_1.db
        .select()
        .from(schema_1.orderDelayAlertGroups)
        .where((0, drizzle_orm_1.eq)(schema_1.orderDelayAlertGroups.id, id))
        .limit(1);
    const [enriched] = await enrichGroupsWithDetails([updated]);
    return (0, response_1.SuccessResponse)(res, {
        message: "تم تحديث مجموعة التنبيه بنجاح",
        data: enriched,
    });
};
exports.updateAlertGroup = updateAlertGroup;
// 5. Toggle Status
const toggleAlertGroupStatus = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.orderDelayAlertGroups)
        .where((0, drizzle_orm_1.eq)(schema_1.orderDelayAlertGroups.id, id))
        .limit(1);
    if (!existing) {
        throw new Errors_1.NotFound("مجموعة التنبيه غير موجودة");
    }
    const newStatus = !existing.isActive;
    await connection_1.db
        .update(schema_1.orderDelayAlertGroups)
        .set({ isActive: newStatus })
        .where((0, drizzle_orm_1.eq)(schema_1.orderDelayAlertGroups.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: newStatus ? "تم تفعيل مجموعة التنبيه" : "تم تعطيل مجموعة التنبيه",
        data: { id, isActive: newStatus },
    });
};
exports.toggleAlertGroupStatus = toggleAlertGroupStatus;
// 6. Delete
const deleteAlertGroup = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.orderDelayAlertGroups)
        .where((0, drizzle_orm_1.eq)(schema_1.orderDelayAlertGroups.id, id))
        .limit(1);
    if (!existing) {
        throw new Errors_1.NotFound("مجموعة التنبيه غير موجودة");
    }
    await connection_1.db
        .delete(schema_1.orderDelayAlertGroups)
        .where((0, drizzle_orm_1.eq)(schema_1.orderDelayAlertGroups.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "تم حذف مجموعة التنبيه بنجاح",
        data: { id },
    });
};
exports.deleteAlertGroup = deleteAlertGroup;
// 7. Restaurants Lookup for Multi-select Dropdown
const getRestaurantsLookup = async (req, res) => {
    const list = await connection_1.db
        .select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        nameAr: schema_1.restaurants.nameAr,
        logo: schema_1.restaurants.logo,
        status: schema_1.restaurants.status,
    })
        .from(schema_1.restaurants)
        .orderBy((0, drizzle_orm_1.desc)(schema_1.restaurants.createdAt));
    return (0, response_1.SuccessResponse)(res, {
        message: "تم جلب قائمة المطاعم بنجاح",
        data: list,
    });
};
exports.getRestaurantsLookup = getRestaurantsLookup;
