import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurants, cuisines, zones, restaurantWallets } from "../../models/schema";
import { eq, sql } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";

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
    const {
        name, address, cuisineId, zoneId, logo, cover,
        minDeliveryTime, maxDeliveryTime, deliveryTimeUnit,
        ownerFirstName, ownerLastName, ownerPhone, tags,
        taxNumber, taxExpireDate, taxCertificate,
        email, password, status
    } = req.body;

    if (!name || !address || !zoneId || !logo || !ownerFirstName || !ownerLastName || !ownerPhone || !email || !password) {
        throw new BadRequest("Missing required fields");
    }

    const existingRestaurant = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.email, email))
        .limit(1);

    if (existingRestaurant[0]) {
        throw new BadRequest("Email already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuidv4();

    await db.transaction(async (tx) => {

        // 1️⃣ Create Restaurant
        await tx.insert(restaurants).values({
            id,
            name,
            address,
            cuisineId: cuisineId || null,
            zoneId,
            logo,
            cover: cover || null,
           
            minDeliveryTime: minDeliveryTime || null,
            maxDeliveryTime: maxDeliveryTime || null,
            deliveryTimeUnit: deliveryTimeUnit || "Minutes",
            ownerFirstName,
            ownerLastName,
            ownerPhone,
            tags: tags || [],
            taxNumber: taxNumber || null,
            taxExpireDate: taxExpireDate || null,
            taxCertificate: taxCertificate || null,
            email,
            password: hashedPassword,
            status: status || "pending",
        });

        // 2️⃣ Auto Create Wallet 🔥
        await tx.insert(restaurantWallets).values({
            id: uuidv4(),
            restaurantId: id,
            balance: "0.00",
            collectedCash: "0.00",
            pendingWithdraw: "0.00",
            totalWithdrawn: "0.00",
            totalEarning: "0.00",
        });

        // 3️⃣ Increment cuisine if exists
        if (cuisineId) {
            const cuisine = await tx
                .select({ total: cuisines.total_restaurants })
                .from(cuisines)
                .where(eq(cuisines.id, cuisineId))
                .limit(1);

            if (cuisine[0]) {
                const current = parseInt(cuisine[0].total || "0");
                await tx
                    .update(cuisines)
                    .set({ total_restaurants: String(current + 1) })
                    .where(eq(cuisines.id, cuisineId));
            }
        }
    });

    return SuccessResponse(res, {
        message: "Restaurant created successfully with wallet",
        data: { id }
    }, 201);
};

export const getAllRestaurants = async (req: Request, res: Response) => {
    const raw = await db.select({
        id: restaurants.id,
        name: restaurants.name,
        address: restaurants.address,
        logo: restaurants.logo,
        cover: restaurants.cover,
        status: restaurants.status,

        cuisine_id: cuisines.id,
        cuisine_name: cuisines.name,

        zone_id: zones.id,
        zone_name: zones.name,
    })
    .from(restaurants)
    .leftJoin(cuisines, eq(restaurants.cuisineId, cuisines.id))
    .leftJoin(zones, eq(restaurants.zoneId, zones.id));

    const formatted = raw.map(r => ({
        id: r.id,
        name: r.name,
        address: r.address,
        logo: r.logo,
        cover: r.cover,
        status: r.status,

        cuisine: r.cuisine_id
            ? { id: r.cuisine_id, name: r.cuisine_name }
            : null,

        zone: r.zone_id
            ? { id: r.zone_id, name: r.zone_name }
            : null,
    }));

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
            cuisineObj: cuisines,
            zoneObj: zones,
        })
        .from(restaurants)
        .leftJoin(cuisines, eq(restaurants.cuisineId, cuisines.id))
        .leftJoin(zones, eq(restaurants.zoneId, zones.id))
        .where(eq(restaurants.id, id))
        .limit(1);

    if (!rawRestaurants[0]) {
        throw new NotFound("Restaurant not found");
    }

    // استخراج الصف الأول وتهيئته
    const row = rawRestaurants[0];
    const formattedRestaurant = {
        ...row.restaurantObj,
        cuisine: row.cuisineObj ? { id: row.cuisineObj.id, name: row.cuisineObj.name } : null,
        zone: row.zoneObj ? { id: row.zoneObj.id, name: row.zoneObj.name } : null,
    };

    return SuccessResponse(res, { 
        message: "Get restaurant by id success", 
        data: formattedRestaurant 
    });
};

export const updateRestaurant = async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
        name, address, cuisineId, zoneId, lat, lng, logo, cover,
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
    if (cuisineId) {
        const existingCuisine = await db
            .select()
            .from(cuisines)
            .where(eq(cuisines.id, cuisineId))
            .limit(1);

        if (!existingCuisine[0]) {
            throw new BadRequest("Cuisine not found");
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
    if (address) updateData.address = address;
    if (cuisineId !== undefined) updateData.cuisineId = cuisineId || null;
    if (zoneId) updateData.zoneId = zoneId;
    if (lat !== undefined) updateData.lat = lat;
    if (lng !== undefined) updateData.lng = lng;
    if (logo) updateData.logo = logo;
    if (cover !== undefined) updateData.cover = cover;
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
    if (cuisineId !== undefined && cuisineId !== existingRestaurant[0].cuisineId) {
        // Decrement old cuisine count
        if (existingRestaurant[0].cuisineId) {
            await decrementCuisineCount(existingRestaurant[0].cuisineId);
        }
        // Increment new cuisine count
        if (cuisineId) {
            await incrementCuisineCount(cuisineId);
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
        await decrementCuisineCount(existingRestaurant[0].cuisineId);
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