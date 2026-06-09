import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurants, cuisines, zones, restaurantWallets, food, restrauntadmin } from "../../models/schema";
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
    
    // تحويل المدخل إلى نص سواء كان Array أو Object
    const stringified = typeof input === "string" ? input : JSON.stringify(input);
    
    // Regex لاستخراج الـ UUIDs النظيفة فقط وتجاهل أي أقواس أو علامات تنصيص زائدة
    const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
    
    const matches = stringified.match(uuidRegex);
    
    // إرجاع الـ IDs بدون تكرار
    return matches ? Array.from(new Set(matches)) : [];
};

export const createRestaurant = async (req: Request, res: Response) => {
    const clean = (v: any) => (typeof v === "string" ? v.trim() : v);

    const {
        name, nameAr, nameFr, address, addressAr, addressFr,
        zoneId, logo, cover, minDeliveryTime, maxDeliveryTime,
        deliveryTimeUnit, ownerFirstName, ownerLastName, ownerPhone,
        tags, taxNumber, taxExpireDate, taxCertificate, email, password, status,
        lat,lng,deliveryRadiusKm
    } = req.body;

    let cuisineId = req.body.cuisineId;
    if (cuisineId === undefined) cuisineId = req.body['cuisineId[]'];
    if (cuisineId === undefined) cuisineId = req.body.cuisines;
    if (cuisineId === undefined) cuisineId = req.body['cuisines[]'];

    if (!name || !nameAr || !nameFr || !address || !addressAr || !zoneId || !logo || !ownerFirstName || !ownerLastName || !ownerPhone || !email || !password) {
        throw new BadRequest("Missing required fields");
    }

    // التحقق من تكرار الإيميل في جدول حسابات مديري المطاعم
    const existingUser = await db
        .select()
        .from(restrauntadmin)
        .where(eq(restrauntadmin.email, clean(email)))
        .limit(1);

    if (existingUser[0]) {
        throw new BadRequest("Email already exists for a restaurant user");
    }

    // حماية الـ Logo وحفظ الصورة
    let logoUrl: string | undefined = undefined;
    if (logo) {
        const result = await saveBase64Image(req, logo, "restaurants");
        logoUrl = result.url;
    }

    // حماية الـ Cover وحفظ الصورة
    let coverUrl: string | undefined = undefined;
    if (cover) {
        const result = await saveBase64Image(req, cover, "restaurants_cover");
        coverUrl = result.url;
    }

    // تشفير الباسورد الخاص بمالك المطعم
    const hashedPassword = await bcrypt.hash(password, 10);
    const restaurantId = uuidv4(); 
    const ownerUserId = uuidv4();  

    // تجهيز الـ Tags والـ Cuisines
    const parsedTags: string[] = safeParseArray(tags);
    const parsedCuisines: string[] = safeParseArray(cuisineId);

    // بدء الـ Transaction لحفظ البيانات
    await db.transaction(async (tx) => {
        
        // 1. حفظ بيانات المطعم
        await tx.insert(restaurants).values({
            id: restaurantId,
            name: clean(name),
            nameAr: clean(nameAr),
            nameFr: clean(nameFr),
            address: clean(address),
            addressAr: clean(addressAr),
            addressFr: clean(addressFr),
            cuisineId: parsedCuisines, 
            zoneId: clean(zoneId),

            logo: logoUrl || '',
            cover: coverUrl || '',
            lat:lat || '',
            lng:lng || '',
            deliveryRadiusKm:deliveryRadiusKm ? clean(deliveryRadiusKm) : null,
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
        });

        // 2. إنشاء حساب المالك
        await tx.insert(restrauntadmin).values({
            id: ownerUserId,
            restaurantId: restaurantId, 
            branchId: null,             
            name: `${clean(ownerFirstName)} ${clean(ownerLastName)}`,
            email: clean(email),
            password: hashedPassword,
            phoneNumber: clean(ownerPhone),
            type: "owner",              
            status: "active",
        });

        // 3. إنشاء محفظة المطعم
        await tx.insert(restaurantWallets).values({
            id: uuidv4(),
            restaurantId: restaurantId,
            balance: "0.00",
            collectedCash: "0.00",
            pendingWithdraw: "0.00",
            totalWithdrawn: "0.00",
            totalEarning: "0.00",
        });
    });

    // زيادة عداد المطبخ للمطابخ المختارة
    for (const cid of parsedCuisines) {
        await incrementCuisineCount(cid);
    }

    return SuccessResponse(res, {
        message: "Restaurant and Owner account created successfully",
        data: { 
            restaurantId,
            ownerUserId
        }
    }, 201);
};

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
        cuisineIds: restaurants.cuisineId,
        email: restrauntadmin.email, 
        zone_id: zones.id,
        zone_name: zones.name,
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

    // تحديد الـ 4 حقول فقط للـ cuisines
    const allCuisinesList = await db.select({
        id: cuisines.id,
        name: cuisines.name,
        nameAr: cuisines.nameAr,
        nameFr: cuisines.nameFr
    }).from(cuisines);

    const cuisineMap = new Map(allCuisinesList.map(c => [String(c.id).toLowerCase(), c]));

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
            email: r.email || null, 
            deliveryRadiusKm: r.deliveryRadiusKm,
            lat: r.lat,
            lng: r.lng,
            cuisines: parsedCuisines.map((id: string) => cuisineMap.get(id.toLowerCase())).filter(Boolean),
            zone: r.zone_id
                ? { id: r.zone_id, name: r.zone_name }
                : null,
        };
    });

    return SuccessResponse(res, {
        message: "Get all restaurants success",
        data: formatted
    });
};

export const getRestaurantById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const rawRestaurants = await db
        .select({
            restaurantObj: restaurants,
            zoneObj: zones,
            ownerEmail: restrauntadmin.email,
        })
        .from(restaurants)
        .leftJoin(zones, eq(restaurants.zoneId, zones.id))
        .leftJoin(
            restrauntadmin,
            and(
                eq(restaurants.id, restrauntadmin.restaurantId),
                eq(restrauntadmin.type, "owner")
            )
        )
        .where(eq(restaurants.id, id))
        .limit(1);

    if (!rawRestaurants[0]) {
        throw new NotFound("Restaurant not found");
    }

    const row = rawRestaurants[0];
    
    let parsedCuisines = safeParseArray(row.restaurantObj.cuisineId);

    let restaurantCuisines: any[] = [];
    if (parsedCuisines && parsedCuisines.length > 0) {
        // تحديد الـ 4 حقول فقط للـ cuisines
        restaurantCuisines = await db
            .select({
                id: cuisines.id,
                name: cuisines.name,
                nameAr: cuisines.nameAr,
                nameFr: cuisines.nameFr
            })
            .from(cuisines)
            .where(inArray(cuisines.id, parsedCuisines));
    }

    const formattedRestaurant = {
        ...row.restaurantObj,
        email: row.ownerEmail || null, 
        cuisines: restaurantCuisines,
        zone: row.zoneObj ? { id: row.zoneObj.id, name: row.zoneObj.name } : null,
    };
    
    // إزالة حقل الـ IDs الخام حتى لا يظهر في الـ JSON النهائي
    delete (formattedRestaurant as any).cuisineId;

    return SuccessResponse(res, { 
        message: "Get restaurant by id success", 
        data: formattedRestaurant 
    });
};

export const updateRestaurant = async (req: Request, res: Response) => {
    const { id } = req.params; 
    const {
        name, nameAr, nameFr, address, addressAr, addressFr, zoneId, lat, lng, logo, cover,
        minDeliveryTime, maxDeliveryTime, deliveryTimeUnit,
        ownerFirstName, ownerLastName, ownerPhone, tags,
        taxNumber, taxExpireDate, taxCertificate,
        email, password, confirmPassword, status,deliveryRadiusKm
    } = req.body;

    let cuisineId = req.body.cuisineId;
    if (cuisineId === undefined) cuisineId = req.body['cuisineId[]'];
    if (cuisineId === undefined) cuisineId = req.body.cuisines;
    if (cuisineId === undefined) cuisineId = req.body['cuisines[]'];

    const [existingRestaurant] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, id))
        .limit(1);

    if (!existingRestaurant) {
        throw new NotFound("Restaurant not found");
    }

    const [existingOwner] = await db
        .select()
        .from(restrauntadmin)
        .where(
            and(
                eq(restrauntadmin.restaurantId, id),
                eq(restrauntadmin.type, "owner")
            )
        )
        .limit(1);

    if (zoneId) {
        const [existingZone] = await db.select().from(zones).where(eq(zones.id, zoneId)).limit(1);
        if (!existingZone) throw new BadRequest("Zone not found");
    }

    let parsedCuisines: string[] | undefined = undefined;
    if (cuisineId !== undefined) {
        parsedCuisines = safeParseArray(cuisineId);
        
        if (parsedCuisines && parsedCuisines.length > 0) {
            const existingCuisines = await db
                .select()
                .from(cuisines)
                .where(inArray(cuisines.id, parsedCuisines));

            if (existingCuisines.length !== parsedCuisines.length) {
                throw new BadRequest("One or more Cuisines not found");
            }
        }
    }

    if (email && existingOwner && email !== existingOwner.email) {
        const [emailExists] = await db
            .select()
            .from(restrauntadmin)
            .where(eq(restrauntadmin.email, email.trim()))
            .limit(1);

        if (emailExists) {
            throw new BadRequest("Email already exists for another user");
        }
    }

    if (password) {
        if (password !== confirmPassword) {
            throw new BadRequest("Password and confirm password do not match");
        }
    }

    const restaurantUpdateData: any = { updatedAt: new Date() };
    const ownerUpdateData: any = { updatedAt: new Date() };

    if (name) restaurantUpdateData.name = name;
    if (nameAr) restaurantUpdateData.nameAr = nameAr;
    if (nameFr) restaurantUpdateData.nameFr = nameFr;
    if (address) restaurantUpdateData.address = address;
    if (addressAr) restaurantUpdateData.addressAr = addressAr;
    if (addressFr) restaurantUpdateData.addressFr = addressFr;
    if (parsedCuisines !== undefined) restaurantUpdateData.cuisineId = parsedCuisines;
    if (zoneId) restaurantUpdateData.zoneId = zoneId;
    if (lat !== undefined) restaurantUpdateData.lat = lat;
    if (lng !== undefined) restaurantUpdateData.lng = lng;
    if (deliveryRadiusKm !== undefined) restaurantUpdateData.deliveryRadiusKm = deliveryRadiusKm;
    if (logo) {
        restaurantUpdateData.logo = await handleImageUpdate(req, existingRestaurant.logo, logo, "restaurants");
    }
    if (cover !== undefined) {
        if (cover === "" || cover === null) {
            restaurantUpdateData.cover = "";
        } else {
            restaurantUpdateData.cover = await handleImageUpdate(req, existingRestaurant.cover, cover, "restaurants_cover");
        }
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
            await tx.update(restrauntadmin)
                .set(ownerUpdateData)
                .where(eq(restrauntadmin.id, existingOwner.id));
        }
    });

    if (parsedCuisines !== undefined) {
        const oldCuisines = safeParseArray(existingRestaurant.cuisineId);
        const newCuisines = parsedCuisines || [];

        for (const cid of oldCuisines) {
            if (!newCuisines.includes(cid)) {
                await decrementCuisineCount(cid);
            }
        }

        for (const cid of newCuisines) {
            if (!oldCuisines.includes(cid)) {
                await incrementCuisineCount(cid);
            }
        }
    }

    return SuccessResponse(res, { message: "Update restaurant and owner account success" });
};

export const deleteRestaurant = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingRestaurant = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, id))
        .limit(1);

    if (!existingRestaurant[0]) {
        throw new NotFound("Restaurant not found");
    }

    const oldCuisines = safeParseArray(existingRestaurant[0].cuisineId);
    for (const cid of oldCuisines) {
        await decrementCuisineCount(cid);
    }

    await db.transaction(async (tx) => {
        await tx.delete(food).where(eq(food.restaurantid, id));
        await tx.delete(restaurantWallets).where(eq(restaurantWallets.restaurantId, id));
        await tx.delete(restrauntadmin).where(eq(restrauntadmin.restaurantId, id));
        await tx.delete(restaurants).where(eq(restaurants.id, id));
    });

    return SuccessResponse(res, { message: "Delete restaurant and all related users/wallets success" });
};

export const getallcousinesandzones = async (req: Request, res: Response) => {
    const allCuisines = await db.select({
        id: cuisines.id,
        name: cuisines.name,
    }).from(cuisines)
      .where(eq(cuisines.status, "active"));
    const allZones = await db.select({
        id: zones.id,
        name: zones.name,
    }).from(zones)
      .where(eq(zones.status, "active"));
    return SuccessResponse(res, { message: "Get all cuisines and zones success", data: { allCuisines, allZones } });
}