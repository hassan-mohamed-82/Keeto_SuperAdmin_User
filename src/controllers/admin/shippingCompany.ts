import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    shippingCompanies,
    shippingCompanyRestaurants,
    shippingCompanyZones,
    restaurants,
    restaurantSettings,
    deliveryMen,
} from "../../models/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";

// =========================================================================
// Helpers: التحقق من أهلية المطاعم وتحديث الربط
// =========================================================================
async function validateEligibleRestaurants(restaurantIds: string[]) {
    if (!restaurantIds || restaurantIds.length === 0) return;

    // التحقق من إعدادات المطاعم المطلوبة (homeDelivery = true & selfDelivery = false)
    const settingsList = await db
        .select({
            restaurantId: restaurantSettings.restaurantId,
            homeDelivery: restaurantSettings.homeDelivery,
            selfDelivery: restaurantSettings.selfDelivery,
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

    // التحقق لو بعض المطاعم غير موجودة في الـ settings أصلاً أو غير موجودة
    const foundIds = new Set(settingsList.map((item) => item.restaurantId));
    const missingIds = restaurantIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
        throw new BadRequest(`Some restaurants have no settings configured or do not exist`);
    }
}

async function syncCompanyRestaurants(companyId: string, restaurantIds: string[]) {
    // جلب المطاعم الحالية المرتبطة بالشركة
    const currentRelations = await db
        .select({ id: shippingCompanyRestaurants.id, restaurantId: shippingCompanyRestaurants.restaurantId })
        .from(shippingCompanyRestaurants)
        .where(eq(shippingCompanyRestaurants.shippingCompanyId, companyId));

    const currentMap = new Map(currentRelations.map((r) => [r.restaurantId, r.id]));
    const targetSet = new Set(restaurantIds);

    // حذف المطاعم التي لم تعد موجودة في القائمة الجديدة وتصفير shippingCompanyId
    for (const [restId, relId] of currentMap.entries()) {
        if (!targetSet.has(restId)) {
            await db
                .delete(shippingCompanyRestaurants)
                .where(eq(shippingCompanyRestaurants.id, relId));

            await db
                .update(restaurantSettings)
                .set({ shippingCompanyId: null })
                .where(
                    and(
                        eq(restaurantSettings.restaurantId, restId),
                        eq(restaurantSettings.shippingCompanyId, companyId)
                    )
                );
        }
    }

    // إضافة أو تفعيل المطاعم المطلوبة وتحديث shippingCompanyId
    for (const restId of restaurantIds) {
        if (currentMap.has(restId)) {
            await db
                .update(shippingCompanyRestaurants)
                .set({ status: "active" })
                .where(eq(shippingCompanyRestaurants.id, currentMap.get(restId)!));
        } else {
            await db.insert(shippingCompanyRestaurants).values({
                shippingCompanyId: companyId,
                restaurantId: restId,
                status: "active",
            });
        }

        await db
            .update(restaurantSettings)
            .set({ shippingCompanyId: companyId })
            .where(eq(restaurantSettings.restaurantId, restId));
    }
}

// =========================================================================
// 1. جلب المطاعم المؤهلة للربط بشركة الشحن (homeDelivery = true & selfDelivery = false)
// =========================================================================
export async function getEligibleRestaurants(req: Request, res: Response) {
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
        })
        .from(restaurants)
        .innerJoin(restaurantSettings, eq(restaurants.id, restaurantSettings.restaurantId))
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
}

// =========================================================================
// 2. إنشاء شركة شحن جديدة (Create Shipping Company) مع إمكانية ربط المطاعم
// =========================================================================
export async function createShippingCompany(req: Request, res: Response) {
    const { name, nameAr, email, password, phone, address, logo, status, restaurantIds } = req.body;

    const existing = await db
        .select({ id: shippingCompanies.id })
        .from(shippingCompanies)
        .where(eq(shippingCompanies.email, email))
        .limit(1);

    if (existing.length > 0) {
        throw new BadRequest("Email is already registered for another shipping company");
    }

    // التحقق من أهلية المطاعم إذا تم إرسالها
    if (restaurantIds && Array.isArray(restaurantIds) && restaurantIds.length > 0) {
        await validateEligibleRestaurants(restaurantIds);
    }

    const companyId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);

    await db.insert(shippingCompanies).values({
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
            await db.insert(shippingCompanyRestaurants).values({
                shippingCompanyId: companyId,
                restaurantId: restId,
                status: "active",
            });

            await db
                .update(restaurantSettings)
                .set({ shippingCompanyId: companyId })
                .where(eq(restaurantSettings.restaurantId, restId));
        }
    }

    // جلب الشركة بعد الإضافة
    const createdCompany = await db
        .select({
            id: shippingCompanies.id,
            name: shippingCompanies.name,
            nameAr: shippingCompanies.nameAr,
            email: shippingCompanies.email,
            phone: shippingCompanies.phone,
            address: shippingCompanies.address,
            logo: shippingCompanies.logo,
            status: shippingCompanies.status,
            createdAt: shippingCompanies.createdAt,
        })
        .from(shippingCompanies)
        .where(eq(shippingCompanies.id, companyId))
        .limit(1);

    // جلب المطاعم المسندة
    const assignedRestaurants = await db
        .select({
            relationId: shippingCompanyRestaurants.id,
            restaurantId: restaurants.id,
            name: restaurants.name,
            nameAr: restaurants.nameAr,
            logo: restaurants.logo,
            phone: restaurants.ownerPhone,
            status: shippingCompanyRestaurants.status,
            assignedAt: shippingCompanyRestaurants.createdAt,
        })
        .from(shippingCompanyRestaurants)
        .innerJoin(restaurants, eq(shippingCompanyRestaurants.restaurantId, restaurants.id))
        .where(eq(shippingCompanyRestaurants.shippingCompanyId, companyId));

    return SuccessResponse(res, {
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
export async function getShippingCompanies(req: Request, res: Response) {
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
            createdAt: shippingCompanies.createdAt,
            assignedRestaurantsCount: sql<number>`COALESCE((
            SELECT COUNT(*) FROM shipping_company_restaurants scr 
            WHERE scr.shipping_company_id = ${shippingCompanies.id} AND scr.status = 'active'
        ), 0)`,
            deliveryMenCount: sql<number>`COALESCE((
            SELECT COUNT(*) FROM delivery_men dm 
            WHERE dm.shipping_company_id = ${shippingCompanies.id} AND dm.is_deleted = 0
        ), 0)`,
            zonesCount: sql<number>`COALESCE((
            SELECT COUNT(*) FROM shipping_zones sz 
            WHERE sz.shipping_company_id = ${shippingCompanies.id}
        ), 0)`,
        })
        .from(shippingCompanies)
        .where(whereClause)
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
}

// =========================================================================
// 4. عرض تفاصيل شركة شحن محددة (Get Shipping Company By ID)
// =========================================================================
export async function getShippingCompanyById(req: Request, res: Response) {
    const { id } = req.params;

    const company = await db
        .select({
            id: shippingCompanies.id,
            name: shippingCompanies.name,
            nameAr: shippingCompanies.nameAr,
            email: shippingCompanies.email,
            phone: shippingCompanies.phone,
            address: shippingCompanies.address,
            logo: shippingCompanies.logo,
            status: shippingCompanies.status,
            createdAt: shippingCompanies.createdAt,
        })
        .from(shippingCompanies)
        .where(eq(shippingCompanies.id, id))
        .limit(1);

    if (company.length === 0) {
        throw new NotFound("Shipping company not found");
    }

    // جلب المطاعم المسندة للشركة
    const assignedRestaurants = await db
        .select({
            relationId: shippingCompanyRestaurants.id,
            restaurantId: restaurants.id,
            name: restaurants.name,
            nameAr: restaurants.nameAr,
            logo: restaurants.logo,
            phone: restaurants.ownerPhone,
            status: shippingCompanyRestaurants.status,
            assignedAt: shippingCompanyRestaurants.createdAt,
        })
        .from(shippingCompanyRestaurants)
        .innerJoin(restaurants, eq(shippingCompanyRestaurants.restaurantId, restaurants.id))
        .where(eq(shippingCompanyRestaurants.shippingCompanyId, id));

    // جلب مناطق الشركة
    const zones = await db
        .select()
        .from(shippingCompanyZones)
        .where(eq(shippingCompanyZones.shippingCompanyId, id));

    // جلب مناديب التوصيل
    const deliveryMenList = await db
        .select({
            id: deliveryMen.id,
            name: deliveryMen.name,
            phone: deliveryMen.phone,
            email: deliveryMen.email,
            image: deliveryMen.image,
            deliveryType: deliveryMen.deliveryType,
            shiftStatus: deliveryMen.shiftStatus,
            isOnline: deliveryMen.isOnline,
            isAvailable: deliveryMen.isAvailable,
            isActive: deliveryMen.isActive,
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
export async function updateShippingCompany(req: Request, res: Response) {
    const { id } = req.params;
    const { name, nameAr, email, password, phone, address, logo, status, restaurantIds } = req.body;

    const company = await db
        .select({ id: shippingCompanies.id })
        .from(shippingCompanies)
        .where(eq(shippingCompanies.id, id))
        .limit(1);

    if (company.length === 0) {
        throw new NotFound("Shipping company not found");
    }

    if (email) {
        const existingEmail = await db
            .select({ id: shippingCompanies.id })
            .from(shippingCompanies)
            .where(and(eq(shippingCompanies.email, email), sql`${shippingCompanies.id} != ${id}`))
            .limit(1);

        if (existingEmail.length > 0) {
            throw new BadRequest("Email is already registered for another shipping company");
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

    if (password) {
        updateData.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updateData).length > 0) {
        await db
            .update(shippingCompanies)
            .set(updateData)
            .where(eq(shippingCompanies.id, id));
    }

    // تحديث المطاعم المرتبطة بالشركة إن تم إرسال restaurantIds
    if (restaurantIds !== undefined && Array.isArray(restaurantIds)) {
        if (restaurantIds.length > 0) {
            await validateEligibleRestaurants(restaurantIds);
        }
        await syncCompanyRestaurants(id, restaurantIds);
    }

    // جلب المطاعم المسندة بعد التعديل
    const assignedRestaurants = await db
        .select({
            relationId: shippingCompanyRestaurants.id,
            restaurantId: restaurants.id,
            name: restaurants.name,
            nameAr: restaurants.nameAr,
            logo: restaurants.logo,
            phone: restaurants.ownerPhone,
            status: shippingCompanyRestaurants.status,
            assignedAt: shippingCompanyRestaurants.createdAt,
        })
        .from(shippingCompanyRestaurants)
        .innerJoin(restaurants, eq(shippingCompanyRestaurants.restaurantId, restaurants.id))
        .where(eq(shippingCompanyRestaurants.shippingCompanyId, id));

    return SuccessResponse(res, {
        message: "Shipping company updated successfully",
        data: {
            restaurants: assignedRestaurants,
        },
    });
}

// =========================================================================
// 6. حذف شركة الشحن (Delete Shipping Company)
// =========================================================================
export async function deleteShippingCompany(req: Request, res: Response) {
    const { id } = req.params;

    const company = await db
        .select({ id: shippingCompanies.id })
        .from(shippingCompanies)
        .where(eq(shippingCompanies.id, id))
        .limit(1);

    if (company.length === 0) {
        throw new NotFound("Shipping company not found");
    }

    // تصفير إعدادات المطاعم المرتبطة بهذه الشركة قبل الحذف
    await db
        .update(restaurantSettings)
        .set({ shippingCompanyId: null })
        .where(eq(restaurantSettings.shippingCompanyId, id));

    await db.delete(shippingCompanies).where(eq(shippingCompanies.id, id));

    return SuccessResponse(res, {
        message: "Shipping company deleted successfully",
    });
}

// =========================================================================
// 7. ربط مطاعم إضافية بشركة الشحن بعد التحقق من الشرط الإلزامي:
// (restaurantSettings.homeDelivery = true AND restaurantSettings.selfDelivery = false)
// =========================================================================
export async function assignRestaurantsToCompany(req: Request, res: Response) {
    const { id } = req.params; // shippingCompanyId
    const { restaurantIds } = req.body as { restaurantIds: string[] };

    const company = await db
        .select({ id: shippingCompanies.id })
        .from(shippingCompanies)
        .where(eq(shippingCompanies.id, id))
        .limit(1);

    if (company.length === 0) {
        throw new NotFound("Shipping company not found");
    }

    // التحقق من أهلية المطاعم
    await validateEligibleRestaurants(restaurantIds);

    // إضافة المطاعم مع تجنب التكرار وتحديث إعدادات المطعم
    for (const restId of restaurantIds) {
        const exists = await db
            .select({ id: shippingCompanyRestaurants.id })
            .from(shippingCompanyRestaurants)
            .where(
                and(
                    eq(shippingCompanyRestaurants.shippingCompanyId, id),
                    eq(shippingCompanyRestaurants.restaurantId, restId)
                )
            )
            .limit(1);

        if (exists.length > 0) {
            await db
                .update(shippingCompanyRestaurants)
                .set({ status: "active" })
                .where(eq(shippingCompanyRestaurants.id, exists[0].id));
        } else {
            await db.insert(shippingCompanyRestaurants).values({
                shippingCompanyId: id,
                restaurantId: restId,
                status: "active",
            });
        }

        await db
            .update(restaurantSettings)
            .set({ shippingCompanyId: id })
            .where(eq(restaurantSettings.restaurantId, restId));
    }

    return SuccessResponse(res, {
        message: "Restaurants successfully assigned to shipping company",
    });
}

// =========================================================================
// 8. فك ربط مطعم من شركة الشحن
// =========================================================================
export async function removeRestaurantFromCompany(req: Request, res: Response) {
    const { id, restaurantId } = req.params;

    const relation = await db
        .select({ id: shippingCompanyRestaurants.id })
        .from(shippingCompanyRestaurants)
        .where(
            and(
                eq(shippingCompanyRestaurants.shippingCompanyId, id),
                eq(shippingCompanyRestaurants.restaurantId, restaurantId)
            )
        )
        .limit(1);

    if (relation.length === 0) {
        throw new NotFound("Restaurant is not assigned to this shipping company");
    }

    await db
        .delete(shippingCompanyRestaurants)
        .where(eq(shippingCompanyRestaurants.id, relation[0].id));

    // تصفير إعدادات المطعم إذا كان مربوطاً بهذه الشركة
    await db
        .update(restaurantSettings)
        .set({ shippingCompanyId: null })
        .where(
            and(
                eq(restaurantSettings.restaurantId, restaurantId),
                eq(restaurantSettings.shippingCompanyId, id)
            )
        );

    return SuccessResponse(res, {
        message: "Restaurant removed from shipping company successfully",
    });
}
