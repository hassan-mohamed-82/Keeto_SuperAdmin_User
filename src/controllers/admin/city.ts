import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cities, countries } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

export const createCity = async (req: Request, res: Response) => {
    const { name, nameAr, nameFr, countryId } = req.body;

    if (!name || !nameAr || !nameFr || !countryId) {
        throw new BadRequest("City name, nameAr, nameFr, and country ID are required");
    }

    // Check if country exists
    const existingCountry = await db
        .select()
        .from(countries)
        .where(eq(countries.id, countryId))
        .limit(1);

    if (!existingCountry[0]) {
        throw new BadRequest("Country not found");
    }

    // Check if city already exists in the same country
    const existingCity = await db
        .select()
        .from(cities)
        .where(eq(cities.name, name))
        .limit(1);

    if (existingCity[0]) {
        throw new BadRequest("City already exists");
    }

    const id = uuidv4();

    await db.insert(cities).values({
        id,
        name,
        nameAr,
        nameFr,
        countryId,
    });

    return SuccessResponse(res, { message: "Create city success", data: { id } }, 201);
};

export const getAllCities = async (req: Request, res: Response) => {
    const allCities = await db
        .select({
            id: cities.id,
            name: cities.name,
            nameAr: cities.nameAr,
            nameFr: cities.nameFr,
            status: cities.status,
            countryId: cities.countryId,
            createdAt: cities.createdAt,
            updatedAt: cities.updatedAt,
            country: {
                id: countries.id,
                name: countries.name,
                nameAr: countries.nameAr,
                nameFr: countries.nameFr,
                status: countries.status,
            },
        })
        .from(cities)
        .leftJoin(countries, eq(cities.countryId, countries.id));

    return SuccessResponse(res, { message: "Get all cities success", data: allCities });
};

export const getCityById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const city = await db
        .select({
            id: cities.id,
            name: cities.name,
            nameAr: cities.nameAr,
            nameFr: cities.nameFr,
            status: cities.status,
            countryId: cities.countryId,
            createdAt: cities.createdAt,
            updatedAt: cities.updatedAt,
            country: {
                id: countries.id,
                name: countries.name,
                nameAr: countries.nameAr,
                nameFr: countries.nameFr,
                status: countries.status,
            },
        })
        .from(cities)
        .leftJoin(countries, eq(cities.countryId, countries.id))
        .where(eq(cities.id, id))
        .limit(1);

    if (!city[0]) {
        throw new NotFound("City not found");
    }

    return SuccessResponse(res, { message: "Get city by id success", data: city[0] });
};

export const updateCity = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, nameAr, nameFr, status, countryId } = req.body;

    const existingCity = await db
        .select()
        .from(cities)
        .where(eq(cities.id, id))
        .limit(1);

    if (!existingCity[0]) {
        throw new NotFound("City not found");
    }

    // Check if country exists if countryId is provided
    if (countryId) {
        const existingCountry = await db
            .select()
            .from(countries)
            .where(eq(countries.id, countryId))
            .limit(1);

        if (!existingCountry[0]) {
            throw new BadRequest("Country not found");
        }
    }

    const updateData: any = {
        updatedAt: new Date(),
    };

    if (name) updateData.name = name;
    if (nameAr) updateData.nameAr = nameAr;
    if (nameFr) updateData.nameFr = nameFr;
    if (status) updateData.status = status;
    if (countryId) updateData.countryId = countryId;

    if (Object.keys(updateData).length === 1) {
        throw new BadRequest("No data to update");
    }

    await db.update(cities).set(updateData).where(eq(cities.id, id));

    return SuccessResponse(res, { message: "Update city success" });
};

export const deleteCity = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingCity = await db
        .select()
        .from(cities)
        .where(eq(cities.id, id))
        .limit(1);

    if (!existingCity[0]) {
        throw new NotFound("City not found");
    }

    await db.delete(cities).where(eq(cities.id, id));

    return SuccessResponse(res, { message: "Delete city success" });
};

export const getAllCountries = async (req: Request, res: Response) => {
    const allCountries = await db
        .select()
        .from(countries)
        .where(eq(countries.status, "active"));
    return SuccessResponse(res, { message: "Get all active countries success", data: allCountries });
};