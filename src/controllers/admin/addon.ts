import { Request, Response } from "express";
import { db } from "../../models/connection";
import { addons, adonescategory, restaurants } from "../../models/schema";
import { eq, sql } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

export const createAddon = async (req: Request, res: Response) => {
    const { name, nameAr, nameFr, price, stock_type, adonescategoryid, restaurantid } = req.body;

    // Required fields validation
    if (!name || !nameAr || !nameFr || !price || !stock_type || !adonescategoryid || !restaurantid) {
        throw new BadRequest("Missing required fields: name, nameAr, nameFr, price, stock_type, adonescategoryid, restaurantid");
    }

    // Validate adonescategory exists
    const existingAdonesCategory = await db
        .select()
        .from(adonescategory)
        .where(eq(adonescategory.id, adonescategoryid))
        .limit(1);

    if (!existingAdonesCategory[0]) {
        throw new BadRequest("Adones category not found");
    }

    // Validate restaurant exists
    const existingRestaurant = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, restaurantid))
        .limit(1);

    if (!existingRestaurant[0]) {
        throw new BadRequest("Restaurant not found");
    }

    const id = uuidv4();

    await db.insert(addons).values({
        id,
        name,
        nameAr,
        nameFr,
        price,
        stock_type,
        adonescategoryid,
        restaurantid,
    });

    return SuccessResponse(res, { message: "Create addon success", data: { id } }, 201);
};

export const getAllAddons = async (req: Request, res: Response) => {
    const allAddons = await db
        .select({
            id: addons.id,
            name: addons.name,
            nameAr: addons.nameAr,
            nameFr: addons.nameFr,
            price: addons.price,
            stock_type: addons.stock_type,
            adonescategoryid: addons.adonescategoryid,
            restaurantid: addons.restaurantid,
            createdAt: addons.createdAt,
            updatedAt: addons.updatedAt,
            adonescategory: {
                id: adonescategory.id,
                name: adonescategory.name,
                nameAr: adonescategory.nameAr,
                nameFr: adonescategory.nameFr,
            },
            restaurant: {
                id: restaurants.id,
                name: restaurants.name,
                nameAr: restaurants.nameAr,
                nameFr: restaurants.nameFr,
            },
        })
        .from(addons)
        .leftJoin(adonescategory, eq(addons.adonescategoryid, adonescategory.id))
        .leftJoin(restaurants, eq(addons.restaurantid, restaurants.id));

    return SuccessResponse(res, { message: "Get all addons success", data: allAddons });
};

export const getAddonById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const addon = await db
        .select({
            id: addons.id,
            name: addons.name,
            nameAr: addons.nameAr,
            nameFr: addons.nameFr,
            price: addons.price,
            stock_type: addons.stock_type,
            adonescategoryid: addons.adonescategoryid,
            restaurantid: addons.restaurantid,
            createdAt: addons.createdAt,
            updatedAt: addons.updatedAt,
            adonescategory: {
                id: adonescategory.id,
                name: adonescategory.name,
                nameAr: adonescategory.nameAr,
                nameFr: adonescategory.nameFr,
            },
            restaurant: {
                id: restaurants.id,
                name: restaurants.name,
                nameAr: restaurants.nameAr,
                nameFr: restaurants.nameFr,
            },
        })
        .from(addons)
        .leftJoin(adonescategory, eq(addons.adonescategoryid, adonescategory.id))
        .leftJoin(restaurants, eq(addons.restaurantid, restaurants.id))
        .where(eq(addons.id, id))
        .limit(1);

    if (!addon[0]) {
        throw new NotFound("Addon not found");
    }

    return SuccessResponse(res, { message: "Get addon success", data: addon[0] });
};

export const updateAddon = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, nameAr, nameFr, price, stock_type, stock, adonescategoryid, restaurantid } = req.body;

    // Validate addon exists
    const existingAddon = await db
        .select()
        .from(addons)
        .where(eq(addons.id, id))
        .limit(1);

    if (!existingAddon[0]) {
        throw new NotFound("Addon not found");
    }

    // Validate adonescategory exists if provided
    if (adonescategoryid) {
        const existingAdonesCategory = await db
            .select()
            .from(adonescategory)
            .where(eq(adonescategory.id, adonescategoryid))
            .limit(1);

        if (!existingAdonesCategory[0]) {
            throw new BadRequest("Adones category not found");
        }
    }

    // Validate restaurant exists if provided
    if (restaurantid) {
        const existingRestaurant = await db
            .select()
            .from(restaurants)
            .where(eq(restaurants.id, restaurantid))
            .limit(1);

        if (!existingRestaurant[0]) {
            throw new BadRequest("Restaurant not found");
        }
    }

    await db
        .update(addons)
        .set({
            name: name || existingAddon[0].name,
            nameAr: nameAr || existingAddon[0].nameAr,
            nameFr: nameFr || existingAddon[0].nameFr,
            price: price || existingAddon[0].price,
            stock_type: stock_type || existingAddon[0].stock_type,
            adonescategoryid: adonescategoryid || existingAddon[0].adonescategoryid,
            restaurantid: restaurantid || existingAddon[0].restaurantid,
        })
        .where(eq(addons.id, id));

    return SuccessResponse(res, { message: "Update addon success", data: { id } });
};

export const deleteAddon = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingAddon = await db
        .select()
        .from(addons)
        .where(eq(addons.id, id))
        .limit(1);

    if (!existingAddon[0]) {
        throw new NotFound("Addon not found");
    }

    await db.delete(addons).where(eq(addons.id, id));

    return SuccessResponse(res, { message: "Delete addon success", data: { id } });
};

export const getAllRestaurantsandaddonscategory = async (req: Request, res: Response) => {

    const allRestaurants = await db
        .select({
            id: restaurants.id,
            name: restaurants.name,
            status: restaurants.status,
        })
        .from(restaurants);

    const allAddons = await db
        .select({
            id: adonescategory.id,
            name: adonescategory.name
        })
        .from(adonescategory);

    return SuccessResponse(res, {
        message: "Get restaurants and addons success",
        data: {
            allRestaurants,
            allAddons
        }
    }, 200);
};