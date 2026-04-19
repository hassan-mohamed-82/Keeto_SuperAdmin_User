
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { adonescategory } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";


export const createAdone = async (req: Request, res: Response) => {
    const { name, nameAr, nameFr, status } = req.body;

    if (!name || !nameAr || !nameFr) {
        throw new BadRequest("Adone name, nameAr, and nameFr are required");
    }

    const existingAdone = await db
        .select()
        .from(adonescategory)
        .where(eq(adonescategory.name, name));

    if (existingAdone.length > 0) {
        throw new BadRequest("Adone already exists");
    }

    const id = uuidv4();

    await db.insert(adonescategory).values({
        id,
        name,
        nameAr,
        nameFr,
        status: status || "active",
    });

    return SuccessResponse(res, { message: "create adone success", data: { id } });
};

export const getAllAdones = async (req: Request, res: Response) => {
    const allAdones = await db
        .select({
            id: adonescategory.id,
            name: adonescategory.name,
            nameAr: adonescategory.nameAr,
            nameFr: adonescategory.nameFr,
            status: adonescategory.status,
            createdAt: adonescategory.createdAt,
            updatedAt: adonescategory.updatedAt,
        })
        .from(adonescategory);

    return SuccessResponse(res, { message: "get all adones success", data: allAdones });
};

export const getAdoneById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const adone = await db
        .select({
            id: adonescategory.id,
            name: adonescategory.name,
            nameAr: adonescategory.nameAr,
            nameFr: adonescategory.nameFr,
            status: adonescategory.status,
            createdAt: adonescategory.createdAt,
            updatedAt: adonescategory.updatedAt,
        })
        .from(adonescategory)
        .where(eq(adonescategory.id, id));

    if (adone.length === 0) {
        throw new NotFound("Adone not found");
    }

    return SuccessResponse(res, { message: "get adone by id success", data: adone[0] });
};

export const updateAdone = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, nameAr, nameFr, status } = req.body;

    const existingAdone = await db
        .select()
        .from(adonescategory)
        .where(eq(adonescategory.id, id));

    if (existingAdone.length === 0) {
        throw new NotFound("Adone not found");
    }

    const updateData: any = {
        updatedAt: new Date()
    };

    if (name) updateData.name = name;
    if (nameAr) updateData.nameAr = nameAr;
    if (nameFr) updateData.nameFr = nameFr;
    if (status) updateData.status = status;

    if (Object.keys(updateData).length === 1) {
        throw new BadRequest("no data to update");
    }

    await db
        .update(adonescategory)
        .set(updateData)
        .where(eq(adonescategory.id, id));

    return SuccessResponse(res, { message: "update adone success" });
};

export const deleteAdone = async (req: Request, res: Response) => {
    const { id } = req.params;

    const adone = await db
        .select()
        .from(adonescategory)
        .where(eq(adonescategory.id, id));

    if (adone.length === 0) {
        throw new NotFound("Adone not found");
    }

    await db.delete(adonescategory).where(eq(adonescategory.id, id));

    return SuccessResponse(res, { message: "delete adone success" });
};

export const toggleAdoneStatus = async (req: Request, res: Response) => {
    const { id } = req.params;

    const adone = await db
        .select()
        .from(adonescategory)
        .where(eq(adonescategory.id, id));

    if (adone.length === 0) {
        throw new NotFound("Adone not found");
    }

    const newStatus = adone[0].status === "active" ? "inactive" : "active";

    await db
        .update(adonescategory)
        .set({
            status: newStatus,
            updatedAt: new Date()
        })
        .where(eq(adonescategory.id, id));

    return SuccessResponse(res, { message: `toggle adone status success` });
};


