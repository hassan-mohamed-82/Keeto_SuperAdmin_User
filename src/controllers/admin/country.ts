import { Request, Response } from "express";
import { db } from "../../models/connection";
import { countries } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

export const createCountry = async (req: Request, res: Response) => {
    const { name, nameAr, nameFr } = req.body;

    if (!name || !nameAr || !nameFr) {
        throw new BadRequest("Country name, nameAr, and nameFr are required");
    }

    const existingCountry = await db
        .select()
        .from(countries)
        .where(eq(countries.name, name))
        .limit(1);

    if (existingCountry[0]) {
        throw new BadRequest("Country already exists");
    }

    const id = uuidv4();

    await db.insert(countries).values({
        id,
        name,
        nameAr,
        nameFr,
    });

    return SuccessResponse(res, { message: "Create country success", data: { id } }, 201);
};

export const getAllCountries = async (req: Request, res: Response) => {
    const allCountries = await db.select().from(countries);
    return SuccessResponse(res, { message: "Get all countries success", data: allCountries });
};

export const getCountryById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const country = await db
        .select()
        .from(countries)
        .where(eq(countries.id, id))
        .limit(1);

    if (!country[0]) {
        throw new NotFound("Country not found");
    }

    return SuccessResponse(res, { message: "Get country by id success", data: country[0] });
};

export const updateCountry = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, nameAr, nameFr, status } = req.body;

    const existingCountry = await db
        .select()
        .from(countries)
        .where(eq(countries.id, id))
        .limit(1);

    if (!existingCountry[0]) {
        throw new NotFound("Country not found");
    }

    const updateData: any = {
        updatedAt: new Date(),
    };

    if (name) updateData.name = name;
    if (nameAr) updateData.nameAr = nameAr;
    if (nameFr) updateData.nameFr = nameFr;
    if (status) updateData.status = status;

    if (Object.keys(updateData).length === 1) {
        throw new BadRequest("No data to update");
    }

    await db.update(countries).set(updateData).where(eq(countries.id, id));

    return SuccessResponse(res, { message: "Update country success" });
};

export const deleteCountry = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingCountry = await db
        .select()
        .from(countries)
        .where(eq(countries.id, id))
        .limit(1);

    if (!existingCountry[0]) {
        throw new NotFound("Country not found");
    }

    await db.delete(countries).where(eq(countries.id, id));

    return SuccessResponse(res, { message: "Delete country success" });
};