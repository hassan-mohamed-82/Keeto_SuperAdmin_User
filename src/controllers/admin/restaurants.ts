import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurants, cuisines, zones, restaurantWallets, food, restrauntadmin, restaurantBusinessPlans, sales } from "../../models/schema";
import { eq, sql, inArray, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { saveBase64Image, handleImageUpdate } from "../../utils/handleImages";

// Helper: increment total_restaurants on a cuisine
const incrementCuisineCount = async (cuisineId: string) => {
    const cuisine = await db
        .select({ total_restaurants: cuisines.total_restaurants })
        .from(cuisines)
        .where(eq(cuisines.id, cuisineId))
        .limit(1);

    if (cuisine[0]) {
        const current = parseInt(cuisine[0].total_restaurants || "0", 10);
        await db
            .update(cuisines)
            .set({ total_restaurants: String(current + 1) })
            .where(eq(cuisines.id, cuisineId));
    }
};

// Helper: decrement total_restaurants on a cuisine
const decrementCuisineCount = async (cuisineId: string) => {
    const cuisine = await db
        .select({ total_restaurants: cuisines.total_restaurants })
        .from(cuisines)
        .where(eq(cuisines.id, cuisineId))
        .limit(1);

    if (cuisine[0]) {
        const current = parseInt(cuisine[0].total_restaurants || "0", 10);
        await db
            .update(cuisines)
            .set({ total_restaurants: String(Math.max(0, current - 1)) })
            .where(eq(cuisines.id, cuisineId));
    }
};

// Helper: Safely parse arrays and extract valid UUIDs only
const safeParseArray = (input: any): string[] => {
    if (!input) return [];
    const stringified = typeof input === "string" ? input : JSON.stringify(input);
    const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
    const matches = stringified.match(uuidRegex);
    return matches ? Array.from(new Set(matches)) : [];
};

// Helper: map restaurant type to sales points
const getRestaurantTypePoints = (restaurantType?: string | null): number => {
    const normalized = String(restaurantType ?? "").trim().toLowerCase();
    const pointsMap: Record<string, number> = {
        mega: 50,
        super: 25,
        a: 10,
        b: 5,
        c: 2,
        "c-": 1,
    };

    return pointsMap[normalized] ?? 0;
};

// Helper: adjust sales representative points inside a transaction
const adjustSalesRepPoints = async (tx: any, salesId: string | null | undefined, delta: number) => {
    if (!salesId || delta === 0) return;

    const [rep] = await tx
        .select({ points: sales.points })
        .from(sales)
        .where(eq(sales.id, salesId))
        .limit(1);

    if (!rep) return;

    const nextPoints = Math.max(0, Number(rep.points ?? 0) + delta);
    await tx.update(sales).set({ points: nextPoints }).where(eq(sales.id, salesId));
};

// ==========================================
// 1. CREATE RESTAURANT
// ==========================================
export const createRestaurant = async (req: Request, res: Response) => {
    const clean = (v: any) => (typeof v === "string" ? v.trim() : v);

    const {
        name, nameAr, nameFr, address, addressAr, addressFr,
        zoneId, logo, cover, minDeliveryTime, maxDeliveryTime,
        deliveryTimeUnit, ownerFirstName, ownerLastName, ownerPhone,
        tags, taxNumber, taxExpireDate, taxCertificate, email, password, status,
        lat, lng, deliveryRadiusKm, businessPlans,
        type, salesId, ownerposition, likes, facebookLink, orderLink // 👈 استلام الحقول الجديدة
    } = req.body;

    let cuisineId = req.body.cuisineId || req.body['cuisineId[]'] || req.body.cuisines || req.body['cuisines[]'];

    if (!name || !nameAr || !nameFr || !logo || !ownerFirstName || !ownerLastName || !ownerPhone || !email || !password) {
        throw new BadRequest("Missing required fields");
    }

    const restaurantType = (type && clean(type)) ? clean(type) : "C";
    const pointsToAward = getRestaurantTypePoints(restaurantType);

    const existingUser = await db
        .select()
        .from(restrauntadmin)
        .where(eq(restrauntadmin.email, clean(email)))
        .limit(1);

    if (existingUser[0]) throw new BadRequest("Email already exists for a restaurant user");

    let logoUrl: string | undefined = undefined;
    if (logo) logoUrl = (await saveBase64Image(req, logo, "restaurants")).url;

    let coverUrl: string | undefined = undefined;
    if (cover) coverUrl = (await saveBase64Image(req, cover, "restaurants_cover")).url;

    const hashedPassword = await bcrypt.hash(password, 10);
    const restaurantId = uuidv4();
    const ownerUserId = uuidv4();

    const parsedTags: string[] = safeParseArray(tags);
    const parsedCuisines: string[] = safeParseArray(cuisineId);

    let parsedBusinessPlans: any[] = [];
    if (businessPlans) {
        if (typeof businessPlans === "string") {
            try { parsedBusinessPlans = JSON.parse(businessPlans); } catch (e) { parsedBusinessPlans = []; }
        } else if (Array.isArray(businessPlans)) {
            parsedBusinessPlans = businessPlans;
        }
    }

    const plansToReturn: any[] = []; // 👈 مصفوفة لتجميع الخطط وإرجاعها

    await db.transaction(async (tx) => {
        // 1. إنشاء المطعم
        await tx.insert(restaurants).values({
            id: restaurantId,
            name: clean(name),
            nameAr: clean(nameAr),
            nameFr: clean(nameFr),
            address: clean(address),
            addressAr: clean(addressAr),
            addressFr: clean(addressFr),
            cuisineId: parsedCuisines,
            zoneId: zoneId ? clean(zoneId) : null,

            type: restaurantType, // 👈 حفظ نوع المطعم (Default C)
            salesId: salesId ? clean(salesId) : null, // 👈 حفظ الـ Sales ID
            ownerposition: ownerposition ? clean(ownerposition) : null, // 👈 حفظ منصب المالك

            logo: logoUrl || '',
            cover: coverUrl || '',
            lat: lat || '',
            lng: lng || '',
            deliveryRadiusKm: deliveryRadiusKm ? clean(deliveryRadiusKm) : null,
            minDeliveryTime: minDeliveryTime ? clean(minDeliveryTime) : null,
            maxDeliveryTime: maxDeliveryTime ? clean(maxDeliveryTime) : null,
            deliveryTimeUnit: deliveryTimeUnit || "Minutes",
            ownerFirstName: clean(ownerFirstName),
            ownerLastName: clean(ownerLastName),
            ownerPhone: clean(ownerPhone),
            tags: parsedTags,
            taxNumber: taxNumber ? clean(taxNumber) : null,
            taxExpireDate: taxExpireDate || null,
            taxCertificate: typeof taxCertificate === 'string' ? clean(taxCertificate) : null,
            status: status || "active",
            likes: likes || 0,
            facebookLink: facebookLink ? facebookLink.trim() : null,
            orderLink: orderLink ? orderLink.trim() : null,
        });

        // 2. إنشاء المالك
        await tx.insert(restrauntadmin).values({
            id: ownerUserId,
            restaurantId: restaurantId,
            name: `${clean(ownerFirstName)} ${clean(ownerLastName)}`,
            email: clean(email),
            password: hashedPassword,
            phoneNumber: clean(ownerPhone),
            type: "owner",
            status: "active",
        });

        // 3. محفظة المطعم
        await tx.insert(restaurantWallets).values({
            id: uuidv4(),
            restaurantId: restaurantId,
            balance: "0.00",
            collectedCash: "0.00",
            pendingWithdraw: "0.00",
            totalWithdrawn: "0.00",
            totalEarning: "0.00",
        });

        // 4. الـ Business Plans
        if (parsedBusinessPlans.length > 0) {
            for (const plan of parsedBusinessPlans) {
                if (!plan.platformType) continue;

                const newPlan = {
                    id: uuidv4(),
                    restaurantId: restaurantId,
                    platformType: plan.platformType,
                    isMonthlyActive: plan.isMonthlyActive === true || plan.isMonthlyActive === "true",
                    monthlyAmount: plan.monthlyAmount ? String(plan.monthlyAmount) : "0.00",
                    isQuarterlyActive: plan.isQuarterlyActive === true || plan.isQuarterlyActive === "true",
                    quarterlyAmount: plan.quarterlyAmount ? String(plan.quarterlyAmount) : "0.00",
                    isAnnuallyActive: plan.isAnnuallyActive === true || plan.isAnnuallyActive === "true",
                    annuallyAmount: plan.annuallyAmount ? String(plan.annuallyAmount) : "0.00",
                    commissionRate: plan.commissionRate ? String(plan.commissionRate) : "0.00",
                    serviceFee: plan.serviceFee ? String(plan.serviceFee) : "0.00",
                };

                await tx.insert(restaurantBusinessPlans).values(newPlan);
                plansToReturn.push(newPlan); // إضافة الخطة للمصفوفة الراجعة
            }
        }

        await adjustSalesRepPoints(tx, salesId ? clean(salesId) : null, pointsToAward);
    });

    for (const cid of parsedCuisines) await incrementCuisineCount(cid);

    return SuccessResponse(res, {
        message: "Restaurant, Owner account, and Business Plans created successfully",
        data: {
            restaurantId,
            ownerUserId,
            type: restaurantType,
            salesId: salesId || null,
            ownerposition: ownerposition || null,
            businessPlans: plansToReturn
        }
    }, 201);
};

// ==========================================
// 2. GET ALL RESTAURANTS
// ==========================================
export const getAllRestaurants = async (req: Request, res: Response) => {
    const raw = await db.select({
        id: restaurants.id,
        name: restaurants.name,
        nameAr: restaurants.nameAr,
        nameFr: restaurants.nameFr,
        address: restaurants.address,
        addressAr: restaurants.addressAr,
        addressFr: restaurants.addressFr,
        logo: restaurants.logo,
        deliveryRadiusKm: restaurants.deliveryRadiusKm,
        lat: restaurants.lat,
        lng: restaurants.lng,
        cover: restaurants.cover,
        status: restaurants.status,
        type: restaurants.type, // 👈 استرجاع النوع
        salesId: restaurants.salesId, // 👈 استرجاع المندوب
        ownerposition: restaurants.ownerposition, // 👈 استرجاع منصب المالك
        cuisineIds: restaurants.cuisineId,
        email: restrauntadmin.email,
        zone_id: zones.id,
        zone_name: zones.name,
        likes: restaurants.likes,
        facebookLink: restaurants.facebookLink,
        orderLink: restaurants.orderLink,
    })
        .from(restaurants)
        .leftJoin(zones, eq(restaurants.zoneId, zones.id))
        .leftJoin(
            restrauntadmin,
            and(
                eq(restaurants.id, restrauntadmin.restaurantId),
                eq(restrauntadmin.type, "owner")
            )
        );

    const allCuisinesList = await db.select({
        id: cuisines.id,
        name: cuisines.name,
        nameAr: cuisines.nameAr,
        nameFr: cuisines.nameFr
    }).from(cuisines);
    const cuisineMap = new Map(allCuisinesList.map(c => [String(c.id).toLowerCase(), c]));

    const allBusinessPlansList = await db.select().from(restaurantBusinessPlans);
    const plansMap = new Map();
    for (const plan of allBusinessPlansList) {
        if (!plansMap.has(plan.restaurantId)) plansMap.set(plan.restaurantId, []);
        plansMap.get(plan.restaurantId).push(plan);
    }

    const formatted = raw.map(r => {
        let parsedCuisines = safeParseArray(r.cuisineIds);
        return {
            id: r.id,
            name: r.name,
            nameAr: r.nameAr,
            nameFr: r.nameFr,
            address: r.address,
            addressAr: r.addressAr,
            addressFr: r.addressFr,
            logo: r.logo,
            cover: r.cover,
            status: r.status,
            type: r.type,
            salesId: r.salesId,
            ownerposition: r.ownerposition,
            email: r.email || null,
            deliveryRadiusKm: r.deliveryRadiusKm,
            lat: r.lat,
            lng: r.lng,
            cuisines: parsedCuisines.map((id: string) => cuisineMap.get(id.toLowerCase())).filter(Boolean),
            businessPlans: plansMap.get(r.id) || [],
            zone: r.zone_id ? { id: r.zone_id, name: r.zone_name } : null,
            likes: r.likes,
            facebookLink: r.facebookLink || null,
            orderLink: r.orderLink || null,
        };
    });

    return SuccessResponse(res, { message: "Get all restaurants success", data: formatted });
};

// ==========================================
// 3. GET RESTAURANT BY ID
// ==========================================
export const getRestaurantById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const rawRestaurants = await db
        .select({
            restaurantObj: restaurants,
            zoneObj: zones,
            salesObj: sales,
            ownerEmail: restrauntadmin.email,
        })
        .from(restaurants)
        .leftJoin(zones, eq(restaurants.zoneId, zones.id))
        .leftJoin(sales, eq(restaurants.salesId, sales.id))
        .leftJoin(
            restrauntadmin,
            and(eq(restaurants.id, restrauntadmin.restaurantId), eq(restrauntadmin.type, "owner"))
        )
        .where(eq(restaurants.id, id))
        .limit(1);

    if (!rawRestaurants[0]) throw new NotFound("Restaurant not found");

    const row = rawRestaurants[0];
    let parsedCuisines = safeParseArray(row.restaurantObj.cuisineId);

    let restaurantCuisines: any[] = [];
    if (parsedCuisines.length > 0) {
        restaurantCuisines = await db
            .select({ id: cuisines.id, name: cuisines.name, nameAr: cuisines.nameAr, nameFr: cuisines.nameFr })
            .from(cuisines)
            .where(inArray(cuisines.id, parsedCuisines));
    }

    const restaurantPlans = await db
        .select()
        .from(restaurantBusinessPlans)
        .where(eq(restaurantBusinessPlans.restaurantId, id));

    const formattedRestaurant = {
        ...row.restaurantObj,
        type: row.restaurantObj.type,
        ownerposition: row.restaurantObj.ownerposition,
        sales: row.salesObj ? { id: row.salesObj.id, name: row.salesObj.name } : null,
        email: row.ownerEmail || null,
        cuisines: restaurantCuisines,
        businessPlans: restaurantPlans,
        zone: row.zoneObj ? { id: row.zoneObj.id, name: row.zoneObj.name } : null,
    };
    delete (formattedRestaurant as any).cuisineId;

    return SuccessResponse(res, { message: "Get restaurant by id success", data: formattedRestaurant });
};

// ==========================================
// 4. UPDATE RESTAURANT
// ==========================================
export const updateRestaurant = async (req: Request, res: Response) => {
    const clean = (v: any) => (typeof v === "string" ? v.trim() : v);
    const { id } = req.params;
    const {
        name, nameAr, nameFr, address, addressAr, addressFr, lat, lng, logo, cover,
        minDeliveryTime, maxDeliveryTime, deliveryTimeUnit,
        ownerFirstName, ownerLastName, ownerPhone, tags,
        taxNumber, taxExpireDate, taxCertificate,
        email, password, confirmPassword, status, deliveryRadiusKm,
        type, salesId, ownerposition, businessPlans, likes, facebookLink, orderLink // 👈 استلام الحقول الجديدة في الـ Update
    } = req.body;

    let cuisineId = req.body.cuisineId || req.body['cuisineId[]'] || req.body.cuisines || req.body['cuisines[]'];

    const [existingRestaurant] = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
    if (!existingRestaurant) throw new NotFound("Restaurant not found");

    const [existingOwner] = await db.select().from(restrauntadmin).where(and(eq(restrauntadmin.restaurantId, id), eq(restrauntadmin.type, "owner"))).limit(1);

    const resolvedType = type !== undefined ? (clean(type) || "C") : (existingRestaurant.type || "C");
    const resolvedSalesId = salesId !== undefined ? (salesId === "" || salesId === null ? null : clean(salesId)) : existingRestaurant.salesId;
    const previousType = existingRestaurant.type || "C";
    const previousSalesId = existingRestaurant.salesId || null;
    const shouldAdjustSalesPoints = previousSalesId !== resolvedSalesId || previousType !== resolvedType;

    const restaurantUpdateData: any = { updatedAt: new Date() };
    const ownerUpdateData: any = { updatedAt: new Date() };

    let parsedCuisines: string[] | undefined = undefined;
    if (cuisineId !== undefined) {
        parsedCuisines = safeParseArray(cuisineId);
        if (parsedCuisines && parsedCuisines.length > 0) {
            const existingCuisines = await db.select().from(cuisines).where(inArray(cuisines.id, parsedCuisines));
            if (existingCuisines.length !== parsedCuisines.length) throw new BadRequest("One or more Cuisines not found");
        }
    }

    let parsedBusinessPlans: any[] | undefined = undefined;
    if (businessPlans !== undefined) {
        if (typeof businessPlans === "string") {
            try { parsedBusinessPlans = JSON.parse(businessPlans); } catch (e) { parsedBusinessPlans = []; }
        } else if (Array.isArray(businessPlans)) {
            parsedBusinessPlans = businessPlans;
        }
    }

    if (email && existingOwner && email !== existingOwner.email) {
        const [emailExists] = await db.select().from(restrauntadmin).where(eq(restrauntadmin.email, email.trim())).limit(1);
        if (emailExists) throw new BadRequest("Email already exists for another user");
    }

    if (password && password !== confirmPassword) throw new BadRequest("Password and confirm password do not match");

    if (name) restaurantUpdateData.name = name;
    if (nameAr) restaurantUpdateData.nameAr = nameAr;
    if (nameFr) restaurantUpdateData.nameFr = nameFr;
    if (address) restaurantUpdateData.address = address;
    if (addressAr) restaurantUpdateData.addressAr = addressAr;
    if (addressFr) restaurantUpdateData.addressFr = addressFr;
    if (parsedCuisines !== undefined) restaurantUpdateData.cuisineId = parsedCuisines;

    if (lat !== undefined) restaurantUpdateData.lat = lat;
    if (lng !== undefined) restaurantUpdateData.lng = lng;
    if (deliveryRadiusKm !== undefined) restaurantUpdateData.deliveryRadiusKm = deliveryRadiusKm;

    if (type !== undefined) restaurantUpdateData.type = resolvedType; // 👈 تحديث النوع
    if (salesId !== undefined) restaurantUpdateData.salesId = resolvedSalesId; // 👈 تحديث المندوب
    if (ownerposition !== undefined) restaurantUpdateData.ownerposition = (ownerposition === "" || ownerposition === null) ? null : ownerposition; // 👈 تحديث منصب المالك

    if (logo) restaurantUpdateData.logo = await handleImageUpdate(req, existingRestaurant.logo, logo, "restaurants");
    if (cover !== undefined) {
        restaurantUpdateData.cover = (cover === "" || cover === null) ? "" : await handleImageUpdate(req, existingRestaurant.cover, cover, "restaurants_cover");
    }

    if (minDeliveryTime !== undefined) restaurantUpdateData.minDeliveryTime = minDeliveryTime;
    if (maxDeliveryTime !== undefined) restaurantUpdateData.maxDeliveryTime = maxDeliveryTime;
    if (deliveryTimeUnit) restaurantUpdateData.deliveryTimeUnit = deliveryTimeUnit;

    if (ownerFirstName) restaurantUpdateData.ownerFirstName = ownerFirstName;
    if (ownerLastName) restaurantUpdateData.ownerLastName = ownerLastName;
    if (ownerPhone) restaurantUpdateData.ownerPhone = ownerPhone;

    if (tags !== undefined) restaurantUpdateData.tags = safeParseArray(tags);
    if (taxNumber !== undefined) restaurantUpdateData.taxNumber = taxNumber;
    if (taxExpireDate !== undefined) restaurantUpdateData.taxExpireDate = taxExpireDate;
    if (taxCertificate !== undefined) restaurantUpdateData.taxCertificate = taxCertificate;
    if (status) restaurantUpdateData.status = status;
    if (likes !== undefined) restaurantUpdateData.likes = Number(likes);
    if (facebookLink !== undefined) restaurantUpdateData.facebookLink = (facebookLink === "" || facebookLink === null) ? null : facebookLink.trim();
    if (orderLink !== undefined) restaurantUpdateData.orderLink = (orderLink === "" || orderLink === null) ? null : orderLink.trim();

    if (email) ownerUpdateData.email = email.trim();
    if (password) ownerUpdateData.password = await bcrypt.hash(password, 10);
    if (status) ownerUpdateData.status = status;

    if (ownerFirstName || ownerLastName) {
        const fName = ownerFirstName || existingRestaurant.ownerFirstName;
        const lName = ownerLastName || existingRestaurant.ownerLastName;
        ownerUpdateData.name = `${fName} ${lName}`;
    }
    if (ownerPhone) ownerUpdateData.phoneNumber = ownerPhone;

    await db.transaction(async (tx) => {
        if (Object.keys(restaurantUpdateData).length > 1) {
            await tx.update(restaurants).set(restaurantUpdateData).where(eq(restaurants.id, id));
        }

        if (existingOwner && Object.keys(ownerUpdateData).length > 1) {
            await tx.update(restrauntadmin).set(ownerUpdateData).where(eq(restrauntadmin.id, existingOwner.id));
        }

        // 👈 تحديث خطط البيزنس (مسح القديم وإدخال الجديد لتجنب التعقيد)
        if (parsedBusinessPlans !== undefined) {
            await tx.delete(restaurantBusinessPlans).where(eq(restaurantBusinessPlans.restaurantId, id));

            if (parsedBusinessPlans.length > 0) {
                for (const plan of parsedBusinessPlans) {
                    if (!plan.platformType) continue;
                    await tx.insert(restaurantBusinessPlans).values({
                        id: uuidv4(),
                        restaurantId: id,
                        platformType: plan.platformType,
                        isMonthlyActive: plan.isMonthlyActive === true || plan.isMonthlyActive === "true",
                        monthlyAmount: plan.monthlyAmount ? String(plan.monthlyAmount) : "0.00",
                        isQuarterlyActive: plan.isQuarterlyActive === true || plan.isQuarterlyActive === "true",
                        quarterlyAmount: plan.quarterlyAmount ? String(plan.quarterlyAmount) : "0.00",
                        isAnnuallyActive: plan.isAnnuallyActive === true || plan.isAnnuallyActive === "true",
                        annuallyAmount: plan.annuallyAmount ? String(plan.annuallyAmount) : "0.00",
                        commissionRate: plan.commissionRate ? String(plan.commissionRate) : "0.00",
                        serviceFee: plan.serviceFee ? String(plan.serviceFee) : "0.00",
                    });
                }
            }
        }

        if (shouldAdjustSalesPoints) {
            const previousPoints = getRestaurantTypePoints(previousType);
            const nextPoints = getRestaurantTypePoints(resolvedType);

            if (previousSalesId && previousPoints > 0) {
                await adjustSalesRepPoints(tx, previousSalesId, -previousPoints);
            }

            if (resolvedSalesId && nextPoints > 0) {
                await adjustSalesRepPoints(tx, resolvedSalesId, nextPoints);
            }
        }
    });

    if (parsedCuisines !== undefined) {
        const oldCuisines = safeParseArray(existingRestaurant.cuisineId);
        const newCuisines = parsedCuisines || [];
        for (const cid of oldCuisines) if (!newCuisines.includes(cid)) await decrementCuisineCount(cid);
        for (const cid of newCuisines) if (!oldCuisines.includes(cid)) await incrementCuisineCount(cid);
    }

    return SuccessResponse(res, { message: "Update restaurant, owner account, and plans success" });
};

// ==========================================
// 5. DELETE RESTAURANT
// ==========================================
export const deleteRestaurant = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingRestaurant = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
    if (!existingRestaurant[0]) throw new NotFound("Restaurant not found");

    const oldCuisines = safeParseArray(existingRestaurant[0].cuisineId);
    for (const cid of oldCuisines) await decrementCuisineCount(cid);

    await db.transaction(async (tx) => {
        await tx.delete(food).where(eq(food.restaurantid, id));
        await tx.delete(restaurantBusinessPlans).where(eq(restaurantBusinessPlans.restaurantId, id)); // 👈 حذف الخطط
        await tx.delete(restaurantWallets).where(eq(restaurantWallets.restaurantId, id));
        await tx.delete(restrauntadmin).where(eq(restrauntadmin.restaurantId, id));
        await tx.delete(restaurants).where(eq(restaurants.id, id));
    });

    return SuccessResponse(res, { message: "Delete restaurant and all related data success" });
};

// ==========================================
// 6. GET CUISINES AND ZONES
// ==========================================
export const getallcousinesandzones = async (req: Request, res: Response) => {
    const allCuisines = await db.select({ id: cuisines.id, name: cuisines.name }).from(cuisines).where(eq(cuisines.status, "active"));
    const allZones = await db.select({ id: zones.id, name: zones.name }).from(zones).where(eq(zones.status, "active"));
    return SuccessResponse(res, { message: "Get all cuisines and zones success", data: { allCuisines, allZones } });
}

// ==========================================
// 7. GET ALL ACTIVE SALES
// ==========================================
export const getActiveSales = async (req: Request, res: Response) => {
    const activeSales = await db
        .select({ id: sales.id, name: sales.name })
        .from(sales)
        .where(eq(sales.status, "active"));

    return SuccessResponse(res, { message: "Get all active sales success", data: activeSales });
};