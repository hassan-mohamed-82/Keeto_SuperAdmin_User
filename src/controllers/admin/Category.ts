import { Request, Response } from "express";
import { db } from "../../models/connection";
import { categories } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

export const createCategory = async (req: Request, res: Response) => {
    const { name, Image, meta_image, title, meta_title, status } = req.body;

    if (!name || !Image) {
        throw new BadRequest("Category name and image are required");
    }

    // Check if category already exists
    const existingCategory = await db
        .select()
        .from(categories)
        .where(eq(categories.name, name))
        .limit(1);

    if (existingCategory[0]) {
        throw new BadRequest("Category already exists");
    }

    const id = uuidv4();

    await db.insert(categories).values({
        id,
        name,
        Image,
        meta_image: meta_image || null,
        title: title || null,
        meta_title: meta_title || null,
        status: status || "active",
    });

    return SuccessResponse(res, { message: "Create category success", data: { id } }, 201);
};

export const getAllCategories = async (req: Request, res: Response) => {
    const allCategories = await db
        .select({
            id: categories.id,
            name: categories.name,
            Image: categories.Image,
            meta_image: categories.meta_image,
            title: categories.title,
            meta_title: categories.meta_title,
            status: categories.status,
            createdAt: categories.createdAt,
            updatedAt: categories.updatedAt,
        })
        .from(categories);

    return SuccessResponse(res, { message: "Get all categories success", data: allCategories });
};

export const getCategoryById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const category = await db
        .select({
            id: categories.id,
            name: categories.name,
            Image: categories.Image,
            meta_image: categories.meta_image,
            title: categories.title,
            meta_title: categories.meta_title,
            status: categories.status,
            createdAt: categories.createdAt,
            updatedAt: categories.updatedAt,
        })
        .from(categories)
        .where(eq(categories.id, id))
        .limit(1);

    if (!category[0]) {
        throw new NotFound("Category not found");
    }

    return SuccessResponse(res, { message: "Get category by id success", data: category[0] });
};

export const updateCategory = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, Image, meta_image, title, meta_title, status } = req.body;

    const existingCategory = await db
        .select()
        .from(categories)
        .where(eq(categories.id, id))
        .limit(1);

    if (!existingCategory[0]) {
        throw new NotFound("Category not found");
    }

    const updateData: any = {
        updatedAt: new Date(),
    };

    if (name) updateData.name = name;
    if (Image) updateData.Image = Image;
    if (meta_image !== undefined) updateData.meta_image = meta_image;
    if (title !== undefined) updateData.title = title;
    if (meta_title !== undefined) updateData.meta_title = meta_title;
    if (status) updateData.status = status;

    if (Object.keys(updateData).length === 1) {
        throw new BadRequest("No data to update");
    }

    await db.update(categories).set(updateData).where(eq(categories.id, id));

    return SuccessResponse(res, { message: "Update category success" });
};

export const deleteCategory = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingCategory = await db
        .select()
        .from(categories)
        .where(eq(categories.id, id))
        .limit(1);

    if (!existingCategory[0]) {
        throw new NotFound("Category not found");
    }

    await db.delete(categories).where(eq(categories.id, id));

    return SuccessResponse(res, { message: "Delete category success" });
};
