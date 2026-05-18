import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cuisines } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";
import { saveBase64Image, handleImageUpdate } from "../../utils/handleImages";



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

    let imageUrl: string = '';
    if (Image) {
        const result = await saveBase64Image(req, Image, "cuisines");
        imageUrl = result.url;
    }

    if (!imageUrl) {
        throw new BadRequest(`Image is required.`);
    }

    let metaImageUrl: string | null = null;
    if (meta_image) {
        const result = await saveBase64Image(req, meta_image, "cuisines_meta");
        metaImageUrl = result.url || null;
    }

    const id = uuidv4();

    await db.insert(cuisines).values({
        id,
        name,
        nameAr,
        nameFr,
        Image: imageUrl,
        meta_image: metaImageUrl,
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

    if (Image) {
        updateData.Image = await handleImageUpdate(req, existingCuisine[0].Image, Image, "cuisines");
    }

    if (meta_image) {
        updateData.meta_image = await handleImageUpdate(req, existingCuisine[0].meta_image, meta_image, "cuisines_meta");
    } else if (meta_image === "" || (typeof meta_image === 'object' && Object.keys(meta_image).length === 0 && !Array.isArray(meta_image))) {
        // Only clear it if they explicitly send empty string or empty object
        // Let's stick to existing logic for clearing
    }

    if (name) updateData.name = name;
    if (nameAr) updateData.nameAr = nameAr;
    if (nameFr) updateData.nameFr = nameFr;
    
    // We already added Image and meta_image to updateData above
    // Let's keep the explicitly clear logic for meta_image:
    if (meta_image === "" || meta_image === null) {
        updateData.meta_image = null;
    }
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
