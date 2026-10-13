import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    shippingCompanies,
    shippingCompanyRestaurants,
    restaurantSettings,
    restaurants,
    shippingCompanyUsers,
    shippingZones,
    deliveryMen,
} from "../../models/schema";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound, ConflictError } from "../../Errors";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { catchAsync } from "../../utils/catchAsync";

// =========================================================================
// Helpers: التحقق من أهلية المطاعم وتحديث الربط
// =========================================================================
async function validateEligibleRestaurants(restaurantIds: string[], targetCompanyId?: string) {
    if (!restaurantIds || restaurantIds.length === 0) return;

    // التحقق من إعدادات المطاعم المطلوبة (homeDelivery = true & selfDelivery = false)
    const settingsList = await db
        .select({
            restaurantId: restaurantSettings.restaurantId,
            homeDelivery: restaurantSettings.homeDelivery,
            selfDelivery: restaurantSettings.selfDelivery,
            shippingCompanyId: restaurantSettings.shippingCompanyId,
            restaurantName: restaurants.name,
        })
        .from(restaurantSettings)
        .innerJoin(restaurants, eq(restaurantSettings.restaurantId, restaurants.id))
        .where(inArray(restaurantSettings.restaurantId, restaurantIds));

    // فحص المطاعم التي لا تستوفي الشرط
    const invalidRestaurants = settingsList.filter(
        (item) => !(item.homeDelivery === true && item.selfDelivery === false)
    );

    if (invalidRestaurants.length > 0) {
        const invalidNames = invalidRestaurants.map((r) => r.restaurantName).join(", ");
        throw new BadRequest(
            `Cannot assign restaurants [${invalidNames}]. Restaurant settings must satisfy: homeDelivery = true and selfDelivery = false.`
        );
    }

    // Phase 3: فحص المطاعم المرتبطة مسبقاً بشركة شحن أخرى
    const alreadyLinked = settingsList.filter(
        (item) => item.shippingCompanyId && item.shippingCompanyId !== targetCompanyId
    );
    if (alreadyLinked.length > 0) {
        const names = alreadyLinked.map((r) => r.restaurantName).join(", ");
        throw new BadRequest(`Restaurants [${names}] are already linked to another shipping company.`);
    }

    // التحقق لو بعض المطاعم غير موجودة
    const foundIds = new Set(settingsList.map((item) => item.restaurantId));
    const missingIds = restaurantIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
        throw new BadRequest(`Some restaurants have no settings configured or do not exist`);
    }
}

// Transactional link helper (D3)
export async function linkRestaurantsToCompany(companyId: string, restaurantIds: string[], tx: any = db) {
    for (const restId of restaurantIds) {
        // 1. Update single source of truth
        await tx
            .update(restaurantSettings)
            .set({ shippingCompanyId: companyId })
            .where(eq(restaurantSettings.restaurantId, restId));

        // 2. Maintain junction mirror
        const existing = await tx
            .select({ id: shippingCompanyRestaurants.id })
            .from(shippingCompanyRestaurants)
            .where(
                and(
                    eq(shippingCompanyRestaurants.shippingCompanyId, companyId),
                    eq(shippingCompanyRestaurants.restaurantId, restId)
                )
            )
            .limit(1);

        if (existing.length > 0) {
            await tx
                .update(shippingCompanyRestaurants)
                .set({ status: "active" })
                .where(eq(shippingCompanyRestaurants.id, existing[0].id));
        } else {
            await tx.insert(shippingCompanyRestaurants).values({
                shippingCompanyId: companyId,
                restaurantId: restId,
                status: "active",
            });
        }
    }
}

// Transactional unlink helper (D3)
export async function unlinkRestaurantFromCompany(companyId: string, restaurantId: string, tx: any = db) {
    await tx
        .update(restaurantSettings)
        .set({ shippingCompanyId: null })
        .where(
            and(
                eq(restaurantSettings.restaurantId, restaurantId),
                eq(restaurantSettings.shippingCompanyId, companyId)
            )
        );

    await tx
        .update(shippingCompanyRestaurants)
        .set({ status: "inactive" })
        .where(
            and(
                eq(shippingCompanyRestaurants.shippingCompanyId, companyId),
                eq(shippingCompanyRestaurants.restaurantId, restaurantId)
            )
        );
}

// =========================================================================
// 1. جلب المطاعم المؤهلة للربط بشركة الشحن (homeDelivery = true & selfDelivery = false)
// =========================================================================
export const getEligibleRestaurants = catchAsync(async (req: Request, res: Response) => {
    const eligible = await db
        .select({
            id: restaurants.id,
            name: restaurants.name,
            nameAr: restaurants.nameAr,
            logo: restaurants.logo,
            phone: restaurants.ownerPhone,
            status: restaurants.status,
            homeDelivery: restaurantSettings.homeDelivery,
            selfDelivery: restaurantSettings.selfDelivery,
            shippingCompanyId: restaurantSettings.shippingCompanyId,
            linkedCompanyName: shippingCompanies.name,
        })
        .from(restaurants)
        .innerJoin(restaurantSettings, eq(restaurants.id, restaurantSettings.restaurantId))
        .leftJoin(shippingCompanies, eq(restaurantSettings.shippingCompanyId, shippingCompanies.id))
        .where(
            and(
                eq(restaurantSettings.homeDelivery, true),
                eq(restaurantSettings.selfDelivery, false)
            )
        );

    return SuccessResponse(res, {
        message: "Eligible restaurants retrieved successfully",
        data: eligible,
    });
});

// =========================================================================
// 2. إنشاء شركة شحن جديدة + إنشاء أول مستخدم Admin لها (Transactional & D6)
// =========================================================================
export const createShippingCompany = catchAsync(async (req: Request, res: Response) => {
    const {
        name,
        nameAr,
        email,
        password,
        phone,
        address,
        logo,
        status = "active",
        maxSearchRadius = 10,
        maxActiveOrders = 3,
        maxAttempts = 3,
        commissionType = "percentage",
        commissionValue = 0,
        restaurantIds,
    } = req.body;

    // Check duplicate email across both companies and company users
    const [existingCompany] = await db
        .select({ id: shippingCompanies.id })
        .from(shippingCompanies)
        .where(eq(shippingCompanies.email, email))
        .limit(1);

    if (existingCompany) {
        throw new ConflictError("Email is already registered for another shipping company");
    }

    const [existingUser] = await db
        .select({ id: shippingCompanyUsers.id })
        .from(shippingCompanyUsers)
        .where(eq(shippingCompanyUsers.email, email))
        .limit(1);

    if (existingUser) {
        throw new ConflictError("Email is already registered for a shipping company user");
    }

    // Validate restaurants
    if (restaurantIds && Array.isArray(restaurantIds) && restaurantIds.length > 0) {
        await validateEligibleRestaurants(restaurantIds);
    }

    const companyId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);

    await db.transaction(async (tx) => {
        // 1. Create company with all dispatch settings
        await tx.insert(shippingCompanies).values({
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
        await tx.insert(shippingCompanyUsers).values({
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

    const [createdCompany] = await db
        .select()
        .from(shippingCompanies)
        .where(eq(shippingCompanies.id, companyId))
        .limit(1);

    const { password: _, ...companyData } = createdCompany;

    return SuccessResponse(res, {
        message: "Shipping company created successfully",
        data: companyData,
    }, 201);
});

// =========================================================================
// 3. عرض قائمة شركات الشحن (Get All Shipping Companies)
// =========================================================================
export const getShippingCompanies = catchAsync(async (req: Request, res: Response) => {
    const { search, status, page = "1", limit = "10" } = req.query;
    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 10;
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];

    if (status) {
        conditions.push(eq(shippingCompanies.status, status as "active" | "inactive"));
    }

    if (search) {
        conditions.push(
            sql`(${shippingCompanies.name} LIKE ${`%${search}%`} OR ${shippingCompanies.email} LIKE ${`%${search}%`} OR ${shippingCompanies.phone} LIKE ${`%${search}%`})`
        );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const list = await db
        .select({
            id: shippingCompanies.id,
            name: shippingCompanies.name,
            nameAr: shippingCompanies.nameAr,
            email: shippingCompanies.email,
            phone: shippingCompanies.phone,
            address: shippingCompanies.address,
            logo: shippingCompanies.logo,
            status: shippingCompanies.status,
            maxSearchRadius: shippingCompanies.maxSearchRadius,
            maxActiveOrders: shippingCompanies.maxActiveOrders,
            maxAttempts: shippingCompanies.maxAttempts,
            commissionType: shippingCompanies.commissionType,
            commissionValue: shippingCompanies.commissionValue,
            createdAt: shippingCompanies.createdAt,
            assignedRestaurantsCount: sql<number>`COALESCE((
                SELECT COUNT(*) FROM restaurant_settings rs 
                WHERE rs.shipping_company_id = ${shippingCompanies.id}
            ), 0)`,
            deliveryMenCount: sql<number>`COALESCE((
                SELECT COUNT(*) FROM delivery_men dm 
                WHERE dm.shipping_company_id = ${shippingCompanies.id} AND dm.is_deleted = 0
            ), 0)`,
            zonesCount: sql<number>`COALESCE((
                SELECT COUNT(*) FROM shipping_zones sz 
                WHERE sz.shipping_company_id = ${shippingCompanies.id} AND sz.status = 'active'
            ), 0)`,
        })
        .from(shippingCompanies)
        .where(whereClause)
        .orderBy(desc(shippingCompanies.createdAt))
        .limit(limitNum)
        .offset(offset);

    const [totalCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(shippingCompanies)
        .where(whereClause);

    return SuccessResponse(res, {
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
export const getShippingCompanyById = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;

    const [company] = await db
        .select()
        .from(shippingCompanies)
        .where(eq(shippingCompanies.id, id))
        .limit(1);

    if (!company) {
        throw new NotFound("Shipping company not found");
    }

    const { password: _, ...companyData } = company;

    // Assigned restaurants via single source of truth (restaurantSettings)
    const assignedRestaurants = await db
        .select({
            restaurantId: restaurants.id,
            name: restaurants.name,
            nameAr: restaurants.nameAr,
            logo: restaurants.logo,
            phone: restaurants.ownerPhone,
            status: restaurants.status,
        })
        .from(restaurantSettings)
        .innerJoin(restaurants, eq(restaurantSettings.restaurantId, restaurants.id))
        .where(eq(restaurantSettings.shippingCompanyId, id));

    // Zones
    const zones = await db
        .select()
        .from(shippingZones)
        .where(eq(shippingZones.shippingCompanyId, id));

    // Couriers with workType and allZones (Phase 3 requirements)
    const couriers = await db
        .select({
            id: deliveryMen.id,
            name: deliveryMen.name,
            phone: deliveryMen.phone,
            email: deliveryMen.email,
            image: deliveryMen.image,
            workType: deliveryMen.workType,
            allZones: deliveryMen.allZones,
            shiftStatus: deliveryMen.shiftStatus,
            isOnline: deliveryMen.isOnline,
            isActive: deliveryMen.isActive,
            activeOrdersCount: deliveryMen.activeOrdersCount,
            currentLat: deliveryMen.currentLat,
            currentLng: deliveryMen.currentLng,
        })
        .from(deliveryMen)
        .where(
            and(
                eq(deliveryMen.shippingCompanyId, id),
                eq(deliveryMen.isDeleted, false)
            )
        );

    return SuccessResponse(res, {
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
export const updateShippingCompany = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
        name,
        nameAr,
        email,
        password,
        phone,
        address,
        logo,
        status,
        maxSearchRadius,
        maxActiveOrders,
        maxAttempts,
        commissionType,
        commissionValue,
        restaurantIds,
    } = req.body;

    const [company] = await db
        .select({ id: shippingCompanies.id })
        .from(shippingCompanies)
        .where(eq(shippingCompanies.id, id))
        .limit(1);

    if (!company) {
        throw new NotFound("Shipping company not found");
    }

    if (email) {
        const [existingEmail] = await db
            .select({ id: shippingCompanies.id })
            .from(shippingCompanies)
            .where(and(eq(shippingCompanies.email, email), sql`${shippingCompanies.id} != ${id}`))
            .limit(1);

        if (existingEmail) {
            throw new ConflictError("Email is already registered for another shipping company");
        }
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (nameAr !== undefined) updateData.nameAr = nameAr;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (address !== undefined) updateData.address = address;
    if (logo !== undefined) updateData.logo = logo;
    if (status !== undefined) updateData.status = status;
    if (maxSearchRadius !== undefined) updateData.maxSearchRadius = maxSearchRadius;
    if (maxActiveOrders !== undefined) updateData.maxActiveOrders = maxActiveOrders;
    if (maxAttempts !== undefined) updateData.maxAttempts = maxAttempts;
    if (commissionType !== undefined) updateData.commissionType = commissionType;
    if (commissionValue !== undefined) updateData.commissionValue = String(commissionValue);

    if (password) {
        updateData.password = await bcrypt.hash(password, 10);
    }

    if (restaurantIds !== undefined && Array.isArray(restaurantIds)) {
        if (restaurantIds.length > 0) {
            await validateEligibleRestaurants(restaurantIds, id);
        }
    }

    await db.transaction(async (tx) => {
        if (Object.keys(updateData).length > 0) {
            await tx
                .update(shippingCompanies)
                .set(updateData)
                .where(eq(shippingCompanies.id, id));
        }

        // Sync restaurants
        if (restaurantIds !== undefined && Array.isArray(restaurantIds)) {
            // Get currently assigned restaurants
            const currentList = await tx
                .select({ restaurantId: restaurantSettings.restaurantId })
                .from(restaurantSettings)
                .where(eq(restaurantSettings.shippingCompanyId, id));

            const currentSet = new Set(currentList.map((r: any) => r.restaurantId));
            const targetSet = new Set(restaurantIds);

            // Unlink removed ones
            for (const restId of currentSet) {
                if (!targetSet.has(restId)) {
                    await unlinkRestaurantFromCompany(id, restId, tx);
                }
            }

            // Link new ones
            const toAdd = restaurantIds.filter((restId: string) => !currentSet.has(restId));
            if (toAdd.length > 0) {
                await linkRestaurantsToCompany(id, toAdd, tx);
            }
        }
    });

    return SuccessResponse(res, {
        message: "Shipping company updated successfully",
    });
});

// =========================================================================
// 6. حذف ناعم لشركة الشحن (Soft delete: status='inactive' + unlinks restaurants)
// =========================================================================
export const deleteShippingCompany = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;

    const [company] = await db
        .select({ id: shippingCompanies.id })
        .from(shippingCompanies)
        .where(eq(shippingCompanies.id, id))
        .limit(1);

    if (!company) {
        throw new NotFound("Shipping company not found");
    }

    await db.transaction(async (tx) => {
        // Soft-delete company
        await tx
            .update(shippingCompanies)
            .set({ status: "inactive" })
            .where(eq(shippingCompanies.id, id));

        // Deactivate all its users
        await tx
            .update(shippingCompanyUsers)
            .set({ status: "inactive" })
            .where(eq(shippingCompanyUsers.shippingCompanyId, id));

        // Unlink restaurants
        await tx
            .update(restaurantSettings)
            .set({ shippingCompanyId: null })
            .where(eq(restaurantSettings.shippingCompanyId, id));

        await tx
            .update(shippingCompanyRestaurants)
            .set({ status: "inactive" })
            .where(eq(shippingCompanyRestaurants.shippingCompanyId, id));
    });

    return SuccessResponse(res, {
        message: "Shipping company deactivated and unlinked successfully",
    });
});

// =========================================================================
// 7. ربط مطاعم إضافية بشركة الشحن
// =========================================================================
export const assignRestaurantsToCompany = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { restaurantIds } = req.body as { restaurantIds: string[] };

    const [company] = await db
        .select({ id: shippingCompanies.id })
        .from(shippingCompanies)
        .where(eq(shippingCompanies.id, id))
        .limit(1);

    if (!company) {
        throw new NotFound("Shipping company not found");
    }

    await validateEligibleRestaurants(restaurantIds, id);

    await db.transaction(async (tx) => {
        await linkRestaurantsToCompany(id, restaurantIds, tx);
    });

    return SuccessResponse(res, {
        message: "Restaurants successfully assigned to shipping company",
    });
});

// =========================================================================
// 8. فك ربط مطعم من شركة الشحن
// =========================================================================
export const removeRestaurantFromCompany = catchAsync(async (req: Request, res: Response) => {
    const { id, restaurantId } = req.params;

    await db.transaction(async (tx) => {
        await unlinkRestaurantFromCompany(id, restaurantId, tx);
    });

    return SuccessResponse(res, {
        message: "Restaurant removed from shipping company successfully",
    });
});
