"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeRestaurantFromCompany = exports.assignRestaurantsToCompany = exports.deleteShippingCompany = exports.updateShippingCompany = exports.getShippingCompanyById = exports.getShippingCompanies = exports.createShippingCompany = exports.getEligibleRestaurants = void 0;
exports.linkRestaurantsToCompany = linkRestaurantsToCompany;
exports.unlinkRestaurantFromCompany = unlinkRestaurantFromCompany;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const bcrypt_1 = __importDefault(require("bcrypt"));
const uuid_1 = require("uuid");
const catchAsync_1 = require("../../utils/catchAsync");
// =========================================================================
// Helpers: التحقق من أهلية المطاعم وتحديث الربط
// =========================================================================
async function validateEligibleRestaurants(restaurantIds, targetCompanyId) {
    if (!restaurantIds || restaurantIds.length === 0)
        return;
    // التحقق من إعدادات المطاعم المطلوبة (homeDelivery = true & selfDelivery = false)
    const settingsList = await connection_1.db
        .select({
        restaurantId: schema_1.restaurantSettings.restaurantId,
        homeDelivery: schema_1.restaurantSettings.homeDelivery,
        selfDelivery: schema_1.restaurantSettings.selfDelivery,
        shippingCompanyId: schema_1.restaurantSettings.shippingCompanyId,
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
    // Phase 3: فحص المطاعم المرتبطة مسبقاً بشركة شحن أخرى
    const alreadyLinked = settingsList.filter((item) => item.shippingCompanyId && item.shippingCompanyId !== targetCompanyId);
    if (alreadyLinked.length > 0) {
        const names = alreadyLinked.map((r) => r.restaurantName).join(", ");
        throw new Errors_1.BadRequest(`Restaurants [${names}] are already linked to another shipping company.`);
    }
    // التحقق لو بعض المطاعم غير موجودة
    const foundIds = new Set(settingsList.map((item) => item.restaurantId));
    const missingIds = restaurantIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
        throw new Errors_1.BadRequest(`Some restaurants have no settings configured or do not exist`);
    }
}
// Transactional link helper (D3)
async function linkRestaurantsToCompany(companyId, restaurantIds, tx = connection_1.db) {
    for (const restId of restaurantIds) {
        // 1. Update single source of truth
        await tx
            .update(schema_1.restaurantSettings)
            .set({ shippingCompanyId: companyId })
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restId));
        // 2. Maintain junction mirror
        const existing = await tx
            .select({ id: schema_1.shippingCompanyRestaurants.id })
            .from(schema_1.shippingCompanyRestaurants)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.restaurantId, restId)))
            .limit(1);
        if (existing.length > 0) {
            await tx
                .update(schema_1.shippingCompanyRestaurants)
                .set({ status: "active" })
                .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.id, existing[0].id));
        }
        else {
            await tx.insert(schema_1.shippingCompanyRestaurants).values({
                shippingCompanyId: companyId,
                restaurantId: restId,
                status: "active",
            });
        }
    }
}
// Transactional unlink helper (D3)
async function unlinkRestaurantFromCompany(companyId, restaurantId, tx = connection_1.db) {
    await tx
        .update(schema_1.restaurantSettings)
        .set({ shippingCompanyId: null })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantSettings.shippingCompanyId, companyId)));
    await tx
        .update(schema_1.shippingCompanyRestaurants)
        .set({ status: "inactive" })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.restaurantId, restaurantId)));
}
// =========================================================================
// 1. جلب المطاعم المؤهلة للربط بشركة الشحن (homeDelivery = true & selfDelivery = false)
// =========================================================================
exports.getEligibleRestaurants = (0, catchAsync_1.catchAsync)(async (req, res) => {
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
        shippingCompanyId: schema_1.restaurantSettings.shippingCompanyId,
        linkedCompanyName: schema_1.shippingCompanies.name,
    })
        .from(schema_1.restaurants)
        .innerJoin(schema_1.restaurantSettings, (0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.restaurantSettings.restaurantId))
        .leftJoin(schema_1.shippingCompanies, (0, drizzle_orm_1.eq)(schema_1.restaurantSettings.shippingCompanyId, schema_1.shippingCompanies.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.homeDelivery, true), (0, drizzle_orm_1.eq)(schema_1.restaurantSettings.selfDelivery, false)));
    return (0, response_1.SuccessResponse)(res, {
        message: "Eligible restaurants retrieved successfully",
        data: eligible,
    });
});
// =========================================================================
// 2. إنشاء شركة شحن جديدة + إنشاء أول مستخدم Admin لها (Transactional & D6)
// =========================================================================
exports.createShippingCompany = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const { name, nameAr, email, password, phone, address, logo, status = "active", maxSearchRadius = 10, maxActiveOrders = 3, maxAttempts = 3, commissionType = "percentage", commissionValue = 0, restaurantIds, } = req.body;
    // Check duplicate email across both companies and company users
    const [existingCompany] = await connection_1.db
        .select({ id: schema_1.shippingCompanies.id })
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.email, email))
        .limit(1);
    if (existingCompany) {
        throw new Errors_1.ConflictError("Email is already registered for another shipping company");
    }
    const [existingUser] = await connection_1.db
        .select({ id: schema_1.shippingCompanyUsers.id })
        .from(schema_1.shippingCompanyUsers)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.email, email))
        .limit(1);
    if (existingUser) {
        throw new Errors_1.ConflictError("Email is already registered for a shipping company user");
    }
    // Validate restaurants
    if (restaurantIds && Array.isArray(restaurantIds) && restaurantIds.length > 0) {
        await validateEligibleRestaurants(restaurantIds);
    }
    const companyId = (0, uuid_1.v4)();
    const hashedPassword = await bcrypt_1.default.hash(password, 10);
    await connection_1.db.transaction(async (tx) => {
        // 1. Create company with all dispatch settings
        await tx.insert(schema_1.shippingCompanies).values({
            id: companyId,
            name,
            nameAr,
            email,
            password: hashedPassword,
            phone,
            address,
            logo,
            status,
            maxSearchRadius,
            maxActiveOrders,
            maxAttempts,
            commissionType,
            commissionValue: String(commissionValue),
        });
        // 2. Create the first admin user in shipping_company_users (D6)
        await tx.insert(schema_1.shippingCompanyUsers).values({
            shippingCompanyId: companyId,
            name: `${name} Admin`,
            email,
            password: hashedPassword,
            phone,
            role: "admin",
            status: "active",
            tokenVersion: 0,
        });
        // 3. Link restaurants
        if (restaurantIds && Array.isArray(restaurantIds) && restaurantIds.length > 0) {
            await linkRestaurantsToCompany(companyId, restaurantIds, tx);
        }
    });
    const [createdCompany] = await connection_1.db
        .select()
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, companyId))
        .limit(1);
    const { password: _, ...companyData } = createdCompany;
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping company created successfully",
        data: companyData,
    }, 201);
});
// =========================================================================
// 3. عرض قائمة شركات الشحن (Get All Shipping Companies)
// =========================================================================
exports.getShippingCompanies = (0, catchAsync_1.catchAsync)(async (req, res) => {
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
        maxSearchRadius: schema_1.shippingCompanies.maxSearchRadius,
        maxActiveOrders: schema_1.shippingCompanies.maxActiveOrders,
        maxAttempts: schema_1.shippingCompanies.maxAttempts,
        commissionType: schema_1.shippingCompanies.commissionType,
        commissionValue: schema_1.shippingCompanies.commissionValue,
        createdAt: schema_1.shippingCompanies.createdAt,
        assignedRestaurantsCount: (0, drizzle_orm_1.sql) `COALESCE((
                SELECT COUNT(*) FROM restaurant_settings rs 
                WHERE rs.shipping_company_id = ${schema_1.shippingCompanies.id}
            ), 0)`,
        deliveryMenCount: (0, drizzle_orm_1.sql) `COALESCE((
                SELECT COUNT(*) FROM delivery_men dm 
                WHERE dm.shipping_company_id = ${schema_1.shippingCompanies.id} AND dm.is_deleted = 0
            ), 0)`,
        zonesCount: (0, drizzle_orm_1.sql) `COALESCE((
                SELECT COUNT(*) FROM shipping_zones sz 
                WHERE sz.shipping_company_id = ${schema_1.shippingCompanies.id} AND sz.status = 'active'
            ), 0)`,
    })
        .from(schema_1.shippingCompanies)
        .where(whereClause)
        .orderBy((0, drizzle_orm_1.desc)(schema_1.shippingCompanies.createdAt))
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
});
// =========================================================================
// 4. عرض تفاصيل شركة شحن محددة (Get Shipping Company By ID)
// =========================================================================
exports.getShippingCompanyById = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const { id } = req.params;
    const [company] = await connection_1.db
        .select()
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, id))
        .limit(1);
    if (!company) {
        throw new Errors_1.NotFound("Shipping company not found");
    }
    const { password: _, ...companyData } = company;
    // Assigned restaurants via single source of truth (restaurantSettings)
    const assignedRestaurants = await connection_1.db
        .select({
        restaurantId: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        nameAr: schema_1.restaurants.nameAr,
        logo: schema_1.restaurants.logo,
        phone: schema_1.restaurants.ownerPhone,
        status: schema_1.restaurants.status,
    })
        .from(schema_1.restaurantSettings)
        .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.shippingCompanyId, id));
    // Zones
    const zones = await connection_1.db
        .select()
        .from(schema_1.shippingZones)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingZones.shippingCompanyId, id));
    // Couriers with deliveryType and allZones (Phase 3 requirements)
    const couriers = await connection_1.db
        .select({
        id: schema_1.deliveryMen.id,
        name: schema_1.deliveryMen.name,
        phone: schema_1.deliveryMen.phone,
        email: schema_1.deliveryMen.email,
        image: schema_1.deliveryMen.image,
        deliveryType: schema_1.deliveryMen.deliveryType,
        allZones: schema_1.deliveryMen.allZones,
        shiftStatus: schema_1.deliveryMen.shiftStatus,
        isOnline: schema_1.deliveryMen.isOnline,
        isActive: schema_1.deliveryMen.isActive,
        activeOrdersCount: schema_1.deliveryMen.activeOrdersCount,
        currentLat: schema_1.deliveryMen.currentLat,
        currentLng: schema_1.deliveryMen.currentLng,
    })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.deliveryMen.shippingCompanyId, id), (0, drizzle_orm_1.eq)(schema_1.deliveryMen.isDeleted, false)));
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping company details retrieved successfully",
        data: {
            ...companyData,
            restaurants: assignedRestaurants,
            zones,
            deliveryMen: couriers,
        },
    });
});
// =========================================================================
// 5. تعديل بيانات شركة الشحن ومطاعمها (Update Shipping Company)
// =========================================================================
exports.updateShippingCompany = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const { id } = req.params;
    const { name, nameAr, email, password, phone, address, logo, status, maxSearchRadius, maxActiveOrders, maxAttempts, commissionType, commissionValue, restaurantIds, } = req.body;
    const [company] = await connection_1.db
        .select({ id: schema_1.shippingCompanies.id })
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, id))
        .limit(1);
    if (!company) {
        throw new Errors_1.NotFound("Shipping company not found");
    }
    if (email) {
        const [existingEmail] = await connection_1.db
            .select({ id: schema_1.shippingCompanies.id })
            .from(schema_1.shippingCompanies)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.email, email), (0, drizzle_orm_1.sql) `${schema_1.shippingCompanies.id} != ${id}`))
            .limit(1);
        if (existingEmail) {
            throw new Errors_1.ConflictError("Email is already registered for another shipping company");
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
    if (maxSearchRadius !== undefined)
        updateData.maxSearchRadius = maxSearchRadius;
    if (maxActiveOrders !== undefined)
        updateData.maxActiveOrders = maxActiveOrders;
    if (maxAttempts !== undefined)
        updateData.maxAttempts = maxAttempts;
    if (commissionType !== undefined)
        updateData.commissionType = commissionType;
    if (commissionValue !== undefined)
        updateData.commissionValue = String(commissionValue);
    if (password) {
        updateData.password = await bcrypt_1.default.hash(password, 10);
    }
    if (restaurantIds !== undefined && Array.isArray(restaurantIds)) {
        if (restaurantIds.length > 0) {
            await validateEligibleRestaurants(restaurantIds, id);
        }
    }
    await connection_1.db.transaction(async (tx) => {
        if (Object.keys(updateData).length > 0) {
            await tx
                .update(schema_1.shippingCompanies)
                .set(updateData)
                .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, id));
        }
        // Sync restaurants
        if (restaurantIds !== undefined && Array.isArray(restaurantIds)) {
            // Get currently assigned restaurants
            const currentList = await tx
                .select({ restaurantId: schema_1.restaurantSettings.restaurantId })
                .from(schema_1.restaurantSettings)
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.shippingCompanyId, id));
            const currentSet = new Set(currentList.map((r) => r.restaurantId));
            const targetSet = new Set(restaurantIds);
            // Unlink removed ones
            for (const restId of currentSet) {
                if (!targetSet.has(restId)) {
                    await unlinkRestaurantFromCompany(id, restId, tx);
                }
            }
            // Link new ones
            const toAdd = restaurantIds.filter((restId) => !currentSet.has(restId));
            if (toAdd.length > 0) {
                await linkRestaurantsToCompany(id, toAdd, tx);
            }
        }
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping company updated successfully",
    });
});
// =========================================================================
// 6. حذف ناعم لشركة الشحن (Soft delete: status='inactive' + unlinks restaurants)
// =========================================================================
exports.deleteShippingCompany = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const { id } = req.params;
    const [company] = await connection_1.db
        .select({ id: schema_1.shippingCompanies.id })
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, id))
        .limit(1);
    if (!company) {
        throw new Errors_1.NotFound("Shipping company not found");
    }
    await connection_1.db.transaction(async (tx) => {
        // Soft-delete company
        await tx
            .update(schema_1.shippingCompanies)
            .set({ status: "inactive" })
            .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, id));
        // Deactivate all its users
        await tx
            .update(schema_1.shippingCompanyUsers)
            .set({ status: "inactive" })
            .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.shippingCompanyId, id));
        // Unlink restaurants
        await tx
            .update(schema_1.restaurantSettings)
            .set({ shippingCompanyId: null })
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.shippingCompanyId, id));
        await tx
            .update(schema_1.shippingCompanyRestaurants)
            .set({ status: "inactive" })
            .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, id));
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping company deactivated and unlinked successfully",
    });
});
// =========================================================================
// 7. ربط مطاعم إضافية بشركة الشحن
// =========================================================================
exports.assignRestaurantsToCompany = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const { id } = req.params;
    const { restaurantIds } = req.body;
    const [company] = await connection_1.db
        .select({ id: schema_1.shippingCompanies.id })
        .from(schema_1.shippingCompanies)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, id))
        .limit(1);
    if (!company) {
        throw new Errors_1.NotFound("Shipping company not found");
    }
    await validateEligibleRestaurants(restaurantIds, id);
    await connection_1.db.transaction(async (tx) => {
        await linkRestaurantsToCompany(id, restaurantIds, tx);
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Restaurants successfully assigned to shipping company",
    });
});
// =========================================================================
// 8. فك ربط مطعم من شركة الشحن
// =========================================================================
exports.removeRestaurantFromCompany = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const { id, restaurantId } = req.params;
    await connection_1.db.transaction(async (tx) => {
        await unlinkRestaurantFromCompany(id, restaurantId, tx);
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Restaurant removed from shipping company successfully",
    });
});
