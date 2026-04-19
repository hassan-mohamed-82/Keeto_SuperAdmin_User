import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cuisines } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

export const createCuisine = async (req: Request, res: Response) => {
    const { name, nameAr, nameFr, Image, meta_image, description, descriptionAr, descriptionFr, meta_description, meta_descriptionAr, meta_descriptionFr, status } = req.body;

    if (!name || !nameAr || !nameFr || !Image || !descriptionAr || !descriptionFr || !meta_descriptionAr || !meta_descriptionFr) {
        throw new BadRequest("Missing required fields: name, nameAr, nameFr, Image, descriptionAr, descriptionFr, meta_descriptionAr, meta_descriptionFr");
    }

    // Check if cuisine already exists
    const existingCuisine = await db
        .select()
        .from(cuisines)
        .where(eq(cuisines.name, name))
        .limit(1);

    if (existingCuisine[0]) {
        throw new BadRequest("Cuisine already exists");
    }

    const id = uuidv4();

    await db.insert(cuisines).values({
        id,
        name,
        nameAr,
        nameFr,
        Image,
        meta_image: meta_image || null,
        description: description || null,
        descriptionAr,
        descriptionFr,
        meta_description: meta_description || null,
        meta_descriptionAr,
        meta_descriptionFr,
        status: status || "active",
    });

    return SuccessResponse(res, { message: "Create cuisine success", data: { id } }, 201);
};

export const getAllCuisines = async (req: Request, res: Response) => {
    const allCuisines = await db
        .select({
            id: cuisines.id,
            name: cuisines.name,
            nameAr: cuisines.nameAr,
            nameFr: cuisines.nameFr,
            Image: cuisines.Image,
            meta_image: cuisines.meta_image,
            description: cuisines.description,
            descriptionAr: cuisines.descriptionAr,
            descriptionFr: cuisines.descriptionFr,
            meta_description: cuisines.meta_description,
            meta_descriptionAr: cuisines.meta_descriptionAr,
            meta_descriptionFr: cuisines.meta_descriptionFr,
            status: cuisines.status,
            total_restaurants: cuisines.total_restaurants,
            createdAt: cuisines.createdAt,
            updatedAt: cuisines.updatedAt,
        })
        .from(cuisines);

    return SuccessResponse(res, { message: "Get all cuisines success", data: allCuisines });
};

export const getCuisineById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const cuisine = await db
        .select({
            id: cuisines.id,
            name: cuisines.name,
            nameAr: cuisines.nameAr,
            nameFr: cuisines.nameFr,
            Image: cuisines.Image,
            meta_image: cuisines.meta_image,
            description: cuisines.description,
            descriptionAr: cuisines.descriptionAr,
            descriptionFr: cuisines.descriptionFr,
            meta_description: cuisines.meta_description,
            meta_descriptionAr: cuisines.meta_descriptionAr,
            meta_descriptionFr: cuisines.meta_descriptionFr,
            status: cuisines.status,
            total_restaurants: cuisines.total_restaurants,
            createdAt: cuisines.createdAt,
            updatedAt: cuisines.updatedAt,
        })
        .from(cuisines)
        .where(eq(cuisines.id, id))
        .limit(1);

    if (!cuisine[0]) {
        throw new NotFound("Cuisine not found");
    }

    return SuccessResponse(res, { message: "Get cuisine by id success", data: cuisine[0] });
};

export const updateCuisine = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, nameAr, nameFr, Image, meta_image, description, descriptionAr, descriptionFr, meta_description, meta_descriptionAr, meta_descriptionFr, status } = req.body;

    const existingCuisine = await db
        .select()
        .from(cuisines)
        .where(eq(cuisines.id, id))
        .limit(1);

    if (!existingCuisine[0]) {
        throw new NotFound("Cuisine not found");
    }

    const updateData: any = {
        updatedAt: new Date(),
    };

    if (name) updateData.name = name;
    if (nameAr) updateData.nameAr = nameAr;
    if (nameFr) updateData.nameFr = nameFr;
    if (Image) updateData.Image = Image;
    if (meta_image !== undefined) updateData.meta_image = meta_image;
    if (description !== undefined) updateData.description = description;
    if (descriptionAr) updateData.descriptionAr = descriptionAr;
    if (descriptionFr) updateData.descriptionFr = descriptionFr;
    if (meta_description !== undefined) updateData.meta_description = meta_description;
    if (meta_descriptionAr) updateData.meta_descriptionAr = meta_descriptionAr;
    if (meta_descriptionFr) updateData.meta_descriptionFr = meta_descriptionFr;
    if (status) updateData.status = status;

    if (Object.keys(updateData).length === 1) {
        throw new BadRequest("No data to update");
    }

    await db.update(cuisines).set(updateData).where(eq(cuisines.id, id));

    return SuccessResponse(res, { message: "Update cuisine success" });
};

export const deleteCuisine = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingCuisine = await db
        .select()
        .from(cuisines)
        .where(eq(cuisines.id, id))
        .limit(1);

    if (!existingCuisine[0]) {
        throw new NotFound("Cuisine not found");
    }

    await db.delete(cuisines).where(eq(cuisines.id, id));

    return SuccessResponse(res, { message: "Delete cuisine success" });
};
