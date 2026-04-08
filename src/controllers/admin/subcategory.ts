import { Request, Response } from "express";
import { db } from "../../models/connection";
import { subcategories, categories } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

export const createSubcategory = async (req: Request, res: Response) => {
    const { name, categoryId, priority, status } = req.body;

    if (!name || !categoryId) {
        throw new BadRequest("Subcategory name and category ID are required");
    }

    // Check if category exists
    const existingCategory = await db
        .select()
        .from(categories)
        .where(eq(categories.id, categoryId))
        .limit(1);

    if (!existingCategory[0]) {
        throw new BadRequest("Category not found");
    }

    // Check if subcategory already exists
    const existingSubcategory = await db
        .select()
        .from(subcategories)
        .where(eq(subcategories.name, name))
        .limit(1);

    if (existingSubcategory[0]) {
        throw new BadRequest("Subcategory already exists");
    }

    const id = uuidv4();

    await db.insert(subcategories).values({
        id,
        name,
        categoryId,
        priority: priority || "low",
        status: status || "active",
    });

    return SuccessResponse(res, { message: "Create subcategory success", data: { id } }, 201);
};

export const getAllSubcategories = async (req: Request, res: Response) => {
    const allSubcategories = await db
        .select({
            id: subcategories.id,
            name: subcategories.name,
            categoryId: subcategories.categoryId,
            priority: subcategories.priority,
            status: subcategories.status,
            createdAt: subcategories.createdAt,
            updatedAt: subcategories.updatedAt,
            category: {
                id: categories.id,
                name: categories.name,
                status: categories.status,
            },
        })
        .from(subcategories)
        .leftJoin(categories, eq(subcategories.categoryId, categories.id));

    return SuccessResponse(res, { message: "Get all subcategories success", data: allSubcategories });
};

export const getSubcategoryById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const subcategory = await db
        .select({
            id: subcategories.id,
            name: subcategories.name,
            categoryId: subcategories.categoryId,
            priority: subcategories.priority,
            status: subcategories.status,
            createdAt: subcategories.createdAt,
            updatedAt: subcategories.updatedAt,
            category: {
                id: categories.id,
                name: categories.name,
                status: categories.status,
            },
        })
        .from(subcategories)
        .leftJoin(categories, eq(subcategories.categoryId, categories.id))
        .where(eq(subcategories.id, id))
        .limit(1);

    if (!subcategory[0]) {
        throw new NotFound("Subcategory not found");
    }

    return SuccessResponse(res, { message: "Get subcategory by id success", data: subcategory[0] });
};

export const updateSubcategory = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, categoryId, priority, status } = req.body;

    const existingSubcategory = await db
        .select()
        .from(subcategories)
        .where(eq(subcategories.id, id))
        .limit(1);

    if (!existingSubcategory[0]) {
        throw new NotFound("Subcategory not found");
    }

    // Check if category exists if categoryId is provided
    if (categoryId) {
        const existingCategory = await db
            .select()
            .from(categories)
            .where(eq(categories.id, categoryId))
            .limit(1);

        if (!existingCategory[0]) {
            throw new BadRequest("Category not found");
        }
    }

    const updateData: any = {
        updatedAt: new Date(),
    };

    if (name) updateData.name = name;
    if (categoryId) updateData.categoryId = categoryId;
    if (priority) updateData.priority = priority;
    if (status) updateData.status = status;

    if (Object.keys(updateData).length === 1) {
        throw new BadRequest("No data to update");
    }

    await db.update(subcategories).set(updateData).where(eq(subcategories.id, id));

    return SuccessResponse(res, { message: "Update subcategory success" });
};

export const deleteSubcategory = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingSubcategory = await db
        .select()
        .from(subcategories)
        .where(eq(subcategories.id, id))
        .limit(1);

    if (!existingSubcategory[0]) {
        throw new NotFound("Subcategory not found");
    }

    await db.delete(subcategories).where(eq(subcategories.id, id));

    return SuccessResponse(res, { message: "Delete subcategory success" });
};

export const getallcategory=async(req:Request,res:Response)=>{
    const allCategories = await db
        .select({
            id: categories.id,
            name: categories.name,
        })
        .from(categories)
        .where(eq(categories.status, "active"));
    return SuccessResponse(res, { message: "Get all categories success", data: allCategories });
}