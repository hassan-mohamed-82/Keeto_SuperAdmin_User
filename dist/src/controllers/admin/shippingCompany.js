"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEligibleRestaurants = getEligibleRestaurants;
exports.createShippingCompany = createShippingCompany;
exports.getShippingCompanies = getShippingCompanies;
exports.getShippingCompanyById = getShippingCompanyById;
exports.updateShippingCompany = updateShippingCompany;
exports.deleteShippingCompany = deleteShippingCompany;
exports.assignRestaurantsToCompany = assignRestaurantsToCompany;
exports.removeRestaurantFromCompany = removeRestaurantFromCompany;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const bcrypt_1 = __importDefault(require("bcrypt"));
const uuid_1 = require("uuid");
// =========================================================================
// Helpers: التحقق من أهلية المطاعم وتحديث الربط
// =========================================================================
async function validateEligibleRestaurants(restaurantIds) {
    if (!restaurantIds || restaurantIds.length === 0)
        return;
    // التحقق من إعدادات المطاعم المطلوبة (homeDelivery = true & selfDelivery = false)
    const settingsList = await connection_1.db
        .select({
        restaurantId: schema_1.restaurantSettings.restaurantId,
        homeDelivery: schema_1.restaurantSettings.homeDelivery,
        selfDelivery: schema_1.restaurantSettings.selfDelivery,
        restaurantName: schema_1.restaurants.name,
    })
        .from(schema_1.restaurantSettings)
        .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.inArray)(schema_1.restaurantSettings.restaurantId, restaurantIds));
    // فحص المطاعم التي لا تستوفي الشرط
    const invalidRestaurants = settingsList.filter((item) => !(item.homeDelivery === true && item.selfDelivery === false));
    if (invalidRestaurants.length > 0) {
        const invalidNames = invalidRestaurants.map((r) => r.restaurantName).join(", ");
        throw new Errors_1.BadRequest(`Cannot assign restaurants [${invalidNames}]. Restaurant settings must satisfy: homeDelivery = true and selfDelivery = false.`);
    }
    // التحقق لو بعض المطاعم غير موجودة في الـ settings أصلاً أو غير موجودة
    const foundIds = new Set(settingsList.map((item) => item.restaurantId));
    const missingIds = restaurantIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
        throw new Errors_1.BadRequest(`Some restaurants have no settings configured or do not exist`);
    }
}
async function syncCompanyRestaurants(companyId, restaurantIds) {
    // جلب المطاعم الحالية المرتبطة بالشركة
    const currentRelations = await connection_1.db
        .select({ id: schema_1.shippingCompanyRestaurants.id, restaurantId: schema_1.shippingCompanyRestaurants.restaurantId })
        .from(schema_1.shippingCompanyRestaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, companyId));
    const currentMap = new Map(currentRelations.map((r) => [r.restaurantId, r.id]));
    const targetSet = new Set(restaurantIds);
    // حذف المطاعم التي لم تعد موجودة في القائمة الجديدة وتصفير shippingCompanyId
    for (const [restId, relId] of currentMap.entries()) {
        if (!targetSet.has(restId)) {
            await connection_1.db
                .delete(schema_1.shippingCompanyRestaurants)
                .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.id, relId));
            await connection_1.db
                .update(schema_1.restaurantSettings)
                .set({ shippingCompanyId: null })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restId), (0, drizzle_orm_1.eq)(schema_1.restaurantSettings.shippingCompanyId, companyId)));
        }
    }
    // إضافة أو تفعيل المطاعم المطلوبة وتحديث shippingCompanyId
    for (const restId of restaurantIds) {
        if (currentMap.has(restId)) {
            await connection_1.db
                .update(schema_1.shippingCompanyRestaurants)
                .set({ status: "active" })
                .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.id, currentMap.get(restId)));
        }
        else {
            await connection_1.db.insert(schema_1.shippingCompanyRestaurants).values({
                shippingCompanyId: companyId,
                restaurantId: restId,
                status: "active",
            });
        }
        await connection_1.db
            .update(schema_1.restaurantSettings)
            .set({ shippingCompanyId: companyId })
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restId));
    }
}
// =========================================================================
// 1. جلب المطاعم المؤهلة للربط بشركة الشحن (homeDelivery = true & selfDelivery = false)
// =========================================================================
async function getEligibleRestaurants(req, res) {
    const eligible = await connection_1.db
        .select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        nameAr: schema_1.restaurants.nameAr,
        logo: schema_1.restaurants.logo,
        phone: schema_1.restaurants.ownerPhone,
        status: schema_1.restaurants.status,
        homeDelivery: schema_1.restaurantSettings.homeDelivery,
        selfDelivery: schema_1.restaurantSettings.selfDelivery,
    })
        .from(schema_1.restaurants)
        .innerJoin(schema_1.restaurantSettings, (0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.restaurantSettings.restaurantId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.homeDelivery, true), (0, drizzle_orm_1.eq)(schema_1.restaurantSettings.selfDelivery, false)));
    return (0, response_1.SuccessResponse)(res, {
        message: "Eligible restaurants retrieved successfully",
        data: eligible,
    });
}
// =========================================================================
// 2. إنشاء شركة شحن جديدة (Create Shipping Company) مع إمكانية ربط المطاعم
// =========================================================================
async function createShippingCompany(req, res) {
    const { name, nameAr, email, password, phone, address, logo, status, restaurantIds } = req.body;
    const existing = await connection_1.db
        .select({ id: schema_1.shippingCompanies.id })
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.email, email))
        .limit(1);
    if (existing.length > 0) {
        throw new Errors_1.BadRequest("Email is already registered for another shipping company");
    }
    // التحقق من أهلية المطاعم إذا تم إرسالها
    if (restaurantIds && Array.isArray(restaurantIds) && restaurantIds.length > 0) {
        await validateEligibleRestaurants(restaurantIds);
    }
    const companyId = (0, uuid_1.v4)();
    const hashedPassword = await bcrypt_1.default.hash(password, 10);
    await connection_1.db.insert(schema_1.shippingCompanies).values({
        id: companyId,
        name,
        nameAr,
        email,
        password: hashedPassword,
        phone,
        address,
        logo,
        status: status || "active",
    });
    // ربط المطاعم المحددة بشركة الشحن وتحديث إعداداتها
    if (restaurantIds && Array.isArray(restaurantIds) && restaurantIds.length > 0) {
        for (const restId of restaurantIds) {
            await connection_1.db.insert(schema_1.shippingCompanyRestaurants).values({
                shippingCompanyId: companyId,
                restaurantId: restId,
                status: "active",
            });
            await connection_1.db
                .update(schema_1.restaurantSettings)
                .set({ shippingCompanyId: companyId })
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restId));
        }
    }
    // جلب الشركة بعد الإضافة
    const createdCompany = await connection_1.db
        .select({
        id: schema_1.shippingCompanies.id,
        name: schema_1.shippingCompanies.name,
        nameAr: schema_1.shippingCompanies.nameAr,
        email: schema_1.shippingCompanies.email,
        phone: schema_1.shippingCompanies.phone,
        address: schema_1.shippingCompanies.address,
        logo: schema_1.shippingCompanies.logo,
        status: schema_1.shippingCompanies.status,
        createdAt: schema_1.shippingCompanies.createdAt,
    })
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, companyId))
        .limit(1);
    // جلب المطاعم المسندة
    const assignedRestaurants = await connection_1.db
        .select({
        relationId: schema_1.shippingCompanyRestaurants.id,
        restaurantId: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        nameAr: schema_1.restaurants.nameAr,
        logo: schema_1.restaurants.logo,
        phone: schema_1.restaurants.ownerPhone,
        status: schema_1.shippingCompanyRestaurants.status,
        assignedAt: schema_1.shippingCompanyRestaurants.createdAt,
    })
        .from(schema_1.shippingCompanyRestaurants)
        .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, companyId));
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping company created successfully",
        data: {
            ...createdCompany[0],
            restaurants: assignedRestaurants,
        },
    }, 201);
}
// =========================================================================
// 3. عرض قائمة شركات الشحن (Get All Shipping Companies)
// =========================================================================
async function getShippingCompanies(req, res) {
    const { search, status, page = "1", limit = "10" } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const offset = (pageNum - 1) * limitNum;
    const conditions = [];
    if (status) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.status, status));
    }
    if (search) {
        conditions.push((0, drizzle_orm_1.sql) `(${schema_1.shippingCompanies.name} LIKE ${`%${search}%`} OR ${schema_1.shippingCompanies.email} LIKE ${`%${search}%`} OR ${schema_1.shippingCompanies.phone} LIKE ${`%${search}%`})`);
    }
    const whereClause = conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined;
    const list = await connection_1.db
        .select({
        id: schema_1.shippingCompanies.id,
        name: schema_1.shippingCompanies.name,
        nameAr: schema_1.shippingCompanies.nameAr,
        email: schema_1.shippingCompanies.email,
        phone: schema_1.shippingCompanies.phone,
        address: schema_1.shippingCompanies.address,
        logo: schema_1.shippingCompanies.logo,
        status: schema_1.shippingCompanies.status,
        createdAt: schema_1.shippingCompanies.createdAt,
        assignedRestaurantsCount: (0, drizzle_orm_1.sql) `COALESCE((
            SELECT COUNT(*) FROM shipping_company_restaurants scr 
            WHERE scr.shipping_company_id = ${schema_1.shippingCompanies.id} AND scr.status = 'active'
        ), 0)`,
        deliveryMenCount: (0, drizzle_orm_1.sql) `COALESCE((
            SELECT COUNT(*) FROM delivery_men dm 
            WHERE dm.shipping_company_id = ${schema_1.shippingCompanies.id} AND dm.is_deleted = 0
        ), 0)`,
        zonesCount: (0, drizzle_orm_1.sql) `COALESCE((
            SELECT COUNT(*) FROM shipping_zones sz 
            WHERE sz.shipping_company_id = ${schema_1.shippingCompanies.id}
        ), 0)`,
    })
        .from(schema_1.shippingCompanies)
        .where(whereClause)
        .limit(limitNum)
        .offset(offset);
    const [totalCount] = await connection_1.db
        .select({ count: (0, drizzle_orm_1.sql) `count(*)` })
        .from(schema_1.shippingCompanies)
        .where(whereClause);
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping companies retrieved successfully",
        data: list,
        pagination: {
            page: pageNum,
            limit: limitNum,
            total: Number(totalCount?.count || 0),
            totalPages: Math.ceil(Number(totalCount?.count || 0) / limitNum),
        },
    });
}
// =========================================================================
// 4. عرض تفاصيل شركة شحن محددة (Get Shipping Company By ID)
// =========================================================================
async function getShippingCompanyById(req, res) {
    const { id } = req.params;
    const company = await connection_1.db
        .select({
        id: schema_1.shippingCompanies.id,
        name: schema_1.shippingCompanies.name,
        nameAr: schema_1.shippingCompanies.nameAr,
        email: schema_1.shippingCompanies.email,
        phone: schema_1.shippingCompanies.phone,
        address: schema_1.shippingCompanies.address,
        logo: schema_1.shippingCompanies.logo,
        status: schema_1.shippingCompanies.status,
        createdAt: schema_1.shippingCompanies.createdAt,
    })
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, id))
        .limit(1);
    if (company.length === 0) {
        throw new Errors_1.NotFound("Shipping company not found");
    }
    // جلب المطاعم المسندة للشركة
    const assignedRestaurants = await connection_1.db
        .select({
        relationId: schema_1.shippingCompanyRestaurants.id,
        restaurantId: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        nameAr: schema_1.restaurants.nameAr,
        logo: schema_1.restaurants.logo,
        phone: schema_1.restaurants.ownerPhone,
        status: schema_1.shippingCompanyRestaurants.status,
        assignedAt: schema_1.shippingCompanyRestaurants.createdAt,
    })
        .from(schema_1.shippingCompanyRestaurants)
        .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, id));
    // جلب مناطق الشركة
    const zones = await connection_1.db
        .select()
        .from(schema_1.shippingCompanyZones)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyZones.shippingCompanyId, id));
    // جلب مناديب التوصيل
    const deliveryMenList = await connection_1.db
        .select({
        id: schema_1.deliveryMen.id,
        name: schema_1.deliveryMen.name,
        phone: schema_1.deliveryMen.phone,
        email: schema_1.deliveryMen.email,
        image: schema_1.deliveryMen.image,
        deliveryType: schema_1.deliveryMen.deliveryType,
        shiftStatus: schema_1.deliveryMen.shiftStatus,
        isOnline: schema_1.deliveryMen.isOnline,
        isAvailable: schema_1.deliveryMen.isAvailable,
        isActive: schema_1.deliveryMen.isActive,
    })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, id), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false)));
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping company details retrieved successfully",
        data: {
            ...company[0],
            restaurants: assignedRestaurants,
            zones,
            deliveryMen: deliveryMenList,
        },
    });
}
// =========================================================================
// 5. تعديل بيانات شركة الشحن ومطاعمها (Update Shipping Company)
// =========================================================================
async function updateShippingCompany(req, res) {
    const { id } = req.params;
    const { name, nameAr, email, password, phone, address, logo, status, restaurantIds } = req.body;
    const company = await connection_1.db
        .select({ id: schema_1.shippingCompanies.id })
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, id))
        .limit(1);
    if (company.length === 0) {
        throw new Errors_1.NotFound("Shipping company not found");
    }
    if (email) {
        const existingEmail = await connection_1.db
            .select({ id: schema_1.shippingCompanies.id })
            .from(schema_1.shippingCompanies)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.email, email), (0, drizzle_orm_1.sql) `${schema_1.shippingCompanies.id} != ${id}`))
            .limit(1);
        if (existingEmail.length > 0) {
            throw new Errors_1.BadRequest("Email is already registered for another shipping company");
        }
    }
    const updateData = {};
    if (name !== undefined)
        updateData.name = name;
    if (nameAr !== undefined)
        updateData.nameAr = nameAr;
    if (email !== undefined)
        updateData.email = email;
    if (phone !== undefined)
        updateData.phone = phone;
    if (address !== undefined)
        updateData.address = address;
    if (logo !== undefined)
        updateData.logo = logo;
    if (status !== undefined)
        updateData.status = status;
    if (password) {
        updateData.password = await bcrypt_1.default.hash(password, 10);
    }
    if (Object.keys(updateData).length > 0) {
        await connection_1.db
            .update(schema_1.shippingCompanies)
            .set(updateData)
            .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, id));
    }
    // تحديث المطاعم المرتبطة بالشركة إن تم إرسال restaurantIds
    if (restaurantIds !== undefined && Array.isArray(restaurantIds)) {
        if (restaurantIds.length > 0) {
            await validateEligibleRestaurants(restaurantIds);
        }
        await syncCompanyRestaurants(id, restaurantIds);
    }
    // جلب المطاعم المسندة بعد التعديل
    const assignedRestaurants = await connection_1.db
        .select({
        relationId: schema_1.shippingCompanyRestaurants.id,
        restaurantId: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        nameAr: schema_1.restaurants.nameAr,
        logo: schema_1.restaurants.logo,
        phone: schema_1.restaurants.ownerPhone,
        status: schema_1.shippingCompanyRestaurants.status,
        assignedAt: schema_1.shippingCompanyRestaurants.createdAt,
    })
        .from(schema_1.shippingCompanyRestaurants)
        .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping company updated successfully",
        data: {
            restaurants: assignedRestaurants,
        },
    });
}
// =========================================================================
// 6. حذف شركة الشحن (Delete Shipping Company)
// =========================================================================
async function deleteShippingCompany(req, res) {
    const { id } = req.params;
    const company = await connection_1.db
        .select({ id: schema_1.shippingCompanies.id })
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, id))
        .limit(1);
    if (company.length === 0) {
        throw new Errors_1.NotFound("Shipping company not found");
    }
    // تصفير إعدادات المطاعم المرتبطة بهذه الشركة قبل الحذف
    await connection_1.db
        .update(schema_1.restaurantSettings)
        .set({ shippingCompanyId: null })
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.shippingCompanyId, id));
    await connection_1.db.delete(schema_1.shippingCompanies).where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping company deleted successfully",
    });
}
// =========================================================================
// 7. ربط مطاعم إضافية بشركة الشحن بعد التحقق من الشرط الإلزامي:
// (restaurantSettings.homeDelivery = true AND restaurantSettings.selfDelivery = false)
// =========================================================================
async function assignRestaurantsToCompany(req, res) {
    const { id } = req.params; // shippingCompanyId
    const { restaurantIds } = req.body;
    const company = await connection_1.db
        .select({ id: schema_1.shippingCompanies.id })
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, id))
        .limit(1);
    if (company.length === 0) {
        throw new Errors_1.NotFound("Shipping company not found");
    }
    // التحقق من أهلية المطاعم
    await validateEligibleRestaurants(restaurantIds);
    // إضافة المطاعم مع تجنب التكرار وتحديث إعدادات المطعم
    for (const restId of restaurantIds) {
        const exists = await connection_1.db
            .select({ id: schema_1.shippingCompanyRestaurants.id })
            .from(schema_1.shippingCompanyRestaurants)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, id), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.restaurantId, restId)))
            .limit(1);
        if (exists.length > 0) {
            await connection_1.db
                .update(schema_1.shippingCompanyRestaurants)
                .set({ status: "active" })
                .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.id, exists[0].id));
        }
        else {
            await connection_1.db.insert(schema_1.shippingCompanyRestaurants).values({
                shippingCompanyId: id,
                restaurantId: restId,
                status: "active",
            });
        }
        await connection_1.db
            .update(schema_1.restaurantSettings)
            .set({ shippingCompanyId: id })
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restId));
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Restaurants successfully assigned to shipping company",
    });
}
// =========================================================================
// 8. فك ربط مطعم من شركة الشحن
// =========================================================================
async function removeRestaurantFromCompany(req, res) {
    const { id, restaurantId } = req.params;
    const relation = await connection_1.db
        .select({ id: schema_1.shippingCompanyRestaurants.id })
        .from(schema_1.shippingCompanyRestaurants)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, id), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.restaurantId, restaurantId)))
        .limit(1);
    if (relation.length === 0) {
        throw new Errors_1.NotFound("Restaurant is not assigned to this shipping company");
    }
    await connection_1.db
        .delete(schema_1.shippingCompanyRestaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.id, relation[0].id));
    // تصفير إعدادات المطعم إذا كان مربوطاً بهذه الشركة
    await connection_1.db
        .update(schema_1.restaurantSettings)
        .set({ shippingCompanyId: null })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantSettings.shippingCompanyId, id)));
    return (0, response_1.SuccessResponse)(res, {
        message: "Restaurant removed from shipping company successfully",
    });
}
