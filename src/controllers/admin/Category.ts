import { Request, Response } from "express";
import { db } from "../../models/connection";
import { categories } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

export const createCategory = async (req: Request, res: Response) => {
    const { name, nameAr, nameFr, Image, priority, meta_image, title, titleAr, titleFr, meta_title, meta_titleAr, meta_titleFr, status } = req.body;

    if (!name || !nameAr || !nameFr || !Image || !titleAr || !titleFr || !meta_titleAr || !meta_titleFr) {
        throw new BadRequest("Missing required fields (name, nameAr, nameFr, Image, titleAr, titleFr, meta_titleAr, meta_titleFr)");
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
        nameAr,
        nameFr,
        Image,
        meta_image: meta_image || null,
        title: title || null,
        titleAr,
        titleFr,
        meta_title: meta_title || null,
        meta_titleAr,
        meta_titleFr,
        status: status || "active",
        priority: priority || "medium",
    });

    return SuccessResponse(res, { message: "Create category success", data: { id } }, 201);
};

export const getAllCategories = async (req: Request, res: Response) => {
    const allCategories = await db
        .select({
            id: categories.id,
            name: categories.name,
            nameAr: categories.nameAr,
            nameFr: categories.nameFr,
            Image: categories.Image,
            meta_image: categories.meta_image,
            title: categories.title,
            titleAr: categories.titleAr,
            titleFr: categories.titleFr,
            priority: categories.priority,
            meta_title: categories.meta_title,
            meta_titleAr: categories.meta_titleAr,
            meta_titleFr: categories.meta_titleFr,
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
            nameAr: categories.nameAr,
            nameFr: categories.nameFr,
            Image: categories.Image,
            priority: categories.priority,
            meta_image: categories.meta_image,
            title: categories.title,
            titleAr: categories.titleAr,
            titleFr: categories.titleFr,
            meta_title: categories.meta_title,
            meta_titleAr: categories.meta_titleAr,
            meta_titleFr: categories.meta_titleFr,
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
    const { name, nameAr, nameFr, Image, meta_image, title, titleAr, titleFr, meta_title, meta_titleAr, meta_titleFr, priority, status } = req.body;

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
    if (nameAr) updateData.nameAr = nameAr;
    if (nameFr) updateData.nameFr = nameFr;
    if (Image) updateData.Image = Image;
    if (priority) updateData.priority = priority;
    if (meta_image !== undefined) updateData.meta_image = meta_image;
    if (title !== undefined) updateData.title = title;
    if (titleAr) updateData.titleAr = titleAr;
    if (titleFr) updateData.titleFr = titleFr;
    if (meta_title !== undefined) updateData.meta_title = meta_title;
    if (meta_titleAr) updateData.meta_titleAr = meta_titleAr;
    if (meta_titleFr) updateData.meta_titleFr = meta_titleFr;
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
