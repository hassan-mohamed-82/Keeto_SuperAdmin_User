import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurants, cuisines, zones, restaurantWallets } from "../../models/schema";
import { eq, sql, inArray } from "drizzle-orm";
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
export const createRestaurant = async (req: Request, res: Response) => {
    const clean = (v: any) => (typeof v === "string" ? v.trim() : v);

    const {
        name, nameAr, nameFr, address, addressAr, addressFr,
        cuisineId, zoneId, logo, cover, minDeliveryTime, maxDeliveryTime,
        deliveryTimeUnit, ownerFirstName, ownerLastName, ownerPhone,
        tags, taxNumber, taxExpireDate, taxCertificate, email, password, status
    } = req.body;

    if (!name || !nameAr || !nameFr || !address || !addressAr || !zoneId || !logo || !ownerFirstName || !ownerLastName || !ownerPhone || !email || !password) {
        throw new BadRequest("Missing required fields");
    }

    // 🚀 حماية الـ Logo من الـ Objects الفارغة
    let logoUrl: string | undefined = undefined;
    if (logo) {
        const result = await saveBase64Image(req, logo, "restaurants");
        logoUrl = result.url;
    }

    // 🚀 حماية الـ Cover من الـ Objects الفارغة
    let coverUrl: string | undefined = undefined;
    if (cover) {
        const result = await saveBase64Image(req, cover, "restaurants_cover");
        coverUrl = result.url;
    }

    const existing = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.email, email))
        .limit(1);

    if (existing[0]) {
        throw new BadRequest("Email already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuidv4();

    let parsedTags: string[] = [];
    if (tags) {
        parsedTags = typeof tags === "string" ? JSON.parse(tags) : tags;
    }

    let parsedCuisines: string[] = [];
    if (cuisineId) {
        parsedCuisines = typeof cuisineId === "string" ? JSON.parse(cuisineId) : cuisineId;
    }

    await db.transaction(async (tx) => {
        await tx.insert(restaurants).values({
            id,
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

            email: clean(email),
            password: hashedPassword,
            status: status || "active",
        });

        await tx.insert(restaurantWallets).values({
            id: uuidv4(),
            restaurantId: id,
            balance: "0.00",
            collectedCash: "0.00",
            pendingWithdraw: "0.00",
            totalWithdrawn: "0.00",
            totalEarning: "0.00",
        });
    });

    for (const cid of parsedCuisines) {
        await incrementCuisineCount(cid);
    }

    return SuccessResponse(res, {
        message: "Restaurant created successfully",
        data: { id }
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
        cover: restaurants.cover,
        status: restaurants.status,
        cuisineIds: restaurants.cuisineId,

        zone_id: zones.id,
        zone_name: zones.name,
    })
    .from(restaurants)
    .leftJoin(zones, eq(restaurants.zoneId, zones.id));

    const allCuisinesList = await db.select({ id: cuisines.id, name: cuisines.name }).from(cuisines);
    const cuisineMap = new Map(allCuisinesList.map(c => [c.id, c]));

    const formatted = raw.map(r => {
        let parsedCuisines: string[] = [];
        if (r.cuisineIds) {
            try {
                parsedCuisines = typeof r.cuisineIds === "string" ? JSON.parse(r.cuisineIds) : r.cuisineIds;
            } catch (e) {
                parsedCuisines = [];
            }
        }

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

            cuisines: parsedCuisines.map((id: string) => cuisineMap.get(id)).filter(Boolean),

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

// =============================================
// GET Restaurant By ID (مُصلح: فصل الكائنات لتجنب خطأ 500)
// =============================================
export const getRestaurantById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const rawRestaurants = await db
        .select({
            restaurantObj: restaurants,
            zoneObj: zones,
        })
        .from(restaurants)
        .leftJoin(zones, eq(restaurants.zoneId, zones.id))
        .where(eq(restaurants.id, id))
        .limit(1);

    if (!rawRestaurants[0]) {
        throw new NotFound("Restaurant not found");
    }

    const row = rawRestaurants[0];
    
    let parsedCuisines: string[] = [];
    if (row.restaurantObj.cuisineId) {
        try {
            parsedCuisines = typeof row.restaurantObj.cuisineId === "string" 
                ? JSON.parse(row.restaurantObj.cuisineId) 
                : row.restaurantObj.cuisineId;
        } catch (e) {
            parsedCuisines = [];
        }
    }

    let restaurantCuisines: any[] = [];
    if (parsedCuisines && parsedCuisines.length > 0) {
        restaurantCuisines = await db
            .select({ id: cuisines.id, name: cuisines.name })
            .from(cuisines)
            .where(inArray(cuisines.id, parsedCuisines));
    }

    const formattedRestaurant = {
        ...row.restaurantObj,
        cuisines: restaurantCuisines,
        zone: row.zoneObj ? { id: row.zoneObj.id, name: row.zoneObj.name } : null,
    };
    
    delete (formattedRestaurant as any).cuisineId;

    return SuccessResponse(res, { 
        message: "Get restaurant by id success", 
        data: formattedRestaurant 
    });
};

export const updateRestaurant = async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
        name, nameAr, nameFr, address, addressAr, addressFr, cuisineId, zoneId, lat, lng, logo, cover,
        minDeliveryTime, maxDeliveryTime, deliveryTimeUnit,
        ownerFirstName, ownerLastName, ownerPhone, tags,
        taxNumber, taxExpireDate, taxCertificate,
        email, password, confirmPassword, status
    } = req.body;

    const existingRestaurant = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, id))
        .limit(1);

    if (!existingRestaurant[0]) {
        throw new NotFound("Restaurant not found");
    }

    // Validate zone if provided
    if (zoneId) {
        const existingZone = await db
            .select()
            .from(zones)
            .where(eq(zones.id, zoneId))
            .limit(1);

        if (!existingZone[0]) {
            throw new BadRequest("Zone not found");
        }
    }

    // Validate cuisine if provided
    let parsedCuisines: string[] | undefined = undefined;
    if (cuisineId !== undefined) {
        parsedCuisines = typeof cuisineId === "string" ? JSON.parse(cuisineId) : cuisineId;
        
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

    // Validate email uniqueness if changed
    if (email && email !== existingRestaurant[0].email) {
        const emailExists = await db
            .select()
            .from(restaurants)
            .where(eq(restaurants.email, email))
            .limit(1);

        if (emailExists[0]) {
            throw new BadRequest("Email already exists");
        }
    }

    // Password validation
    if (password) {
        if (password !== confirmPassword) {
            throw new BadRequest("Password and confirm password do not match");
        }
    }

    const updateData: any = {
        updatedAt: new Date(),
    };

    if (name) updateData.name = name;
    if (nameAr) updateData.nameAr = nameAr;
    if (nameFr) updateData.nameFr = nameFr;
    if (address) updateData.address = address;
    if (addressAr) updateData.addressAr = addressAr;
    if (addressFr) updateData.addressFr = addressFr;
    if (parsedCuisines !== undefined) updateData.cuisineId = parsedCuisines;
    if (zoneId) updateData.zoneId = zoneId;
    if (lat !== undefined) updateData.lat = lat;
    if (lng !== undefined) updateData.lng = lng;
    if (logo) {
        updateData.logo = await handleImageUpdate(req, existingRestaurant[0].logo, logo, "restaurants");
    }
    if (cover !== undefined) {
        if (cover === "" || cover === null) {
            updateData.cover = "";
        } else {
            updateData.cover = await handleImageUpdate(req, existingRestaurant[0].cover, cover, "restaurants_cover");
        }
    }
    if (minDeliveryTime !== undefined) updateData.minDeliveryTime = minDeliveryTime;
    if (maxDeliveryTime !== undefined) updateData.maxDeliveryTime = maxDeliveryTime;
    if (deliveryTimeUnit) updateData.deliveryTimeUnit = deliveryTimeUnit;
    if (ownerFirstName) updateData.ownerFirstName = ownerFirstName;
    if (ownerLastName) updateData.ownerLastName = ownerLastName;
    if (ownerPhone) updateData.ownerPhone = ownerPhone;
    if (tags !== undefined) updateData.tags = tags;
    if (taxNumber !== undefined) updateData.taxNumber = taxNumber;
    if (taxExpireDate !== undefined) updateData.taxExpireDate = taxExpireDate;
    if (taxCertificate !== undefined) updateData.taxCertificate = taxCertificate;
    if (email) updateData.email = email;
    if (password) updateData.password = await bcrypt.hash(password, 10);
    if (status) updateData.status = status;

    if (Object.keys(updateData).length === 1) {
        throw new BadRequest("No data to update");
    }

    await db.update(restaurants).set(updateData).where(eq(restaurants.id, id));

    // Handle cuisine count if cuisineId changed
    if (parsedCuisines !== undefined) {
        const oldCuisines = existingRestaurant[0].cuisineId || [];
        const newCuisines = parsedCuisines || [];

        // Decrement old cuisines that are not in new cuisines
        for (const cid of oldCuisines) {
            if (!newCuisines.includes(cid)) {
                await decrementCuisineCount(cid);
            }
        }

        // Increment new cuisines that are not in old cuisines
        for (const cid of newCuisines) {
            if (!oldCuisines.includes(cid)) {
                await incrementCuisineCount(cid);
            }
        }
    }

    return SuccessResponse(res, { message: "Update restaurant success" });
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

    // Decrement cuisine count before deleting
    if (existingRestaurant[0].cuisineId) {
        for (const cid of existingRestaurant[0].cuisineId) {
            await decrementCuisineCount(cid);
        }
    }

    await db.delete(restaurants).where(eq(restaurants.id, id));

    return SuccessResponse(res, { message: "Delete restaurant success" });
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