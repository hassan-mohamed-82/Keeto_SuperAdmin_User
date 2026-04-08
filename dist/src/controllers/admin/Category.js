"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCategory = exports.updateCategory = exports.getCategoryById = exports.getAllCategories = exports.createCategory = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const createCategory = async (req, res) => {
    const { name, Image, meta_image, title, meta_title, status } = req.body;
    if (!name || !Image) {
        throw new BadRequest_1.BadRequest("Category name and image are required");
    }
    // Check if category already exists
    const existingCategory = await connection_1.db
        .select()
        .from(schema_1.categories)
        .where((0, drizzle_orm_1.eq)(schema_1.categories.name, name))
        .limit(1);
    if (existingCategory[0]) {
        throw new BadRequest_1.BadRequest("Category already exists");
    }
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.categories).values({
        id,
        name,
        Image,
        meta_image: meta_image || null,
        title: title || null,
        meta_title: meta_title || null,
        status: status || "active",
    });
    return (0, response_1.SuccessResponse)(res, { message: "Create category success", data: { id } }, 201);
};
exports.createCategory = createCategory;
const getAllCategories = async (req, res) => {
    const allCategories = await connection_1.db
        .select({
        id: schema_1.categories.id,
        name: schema_1.categories.name,
        Image: schema_1.categories.Image,
        meta_image: schema_1.categories.meta_image,
        title: schema_1.categories.title,
        meta_title: schema_1.categories.meta_title,
        status: schema_1.categories.status,
        createdAt: schema_1.categories.createdAt,
        updatedAt: schema_1.categories.updatedAt,
    })
        .from(schema_1.categories);
    return (0, response_1.SuccessResponse)(res, { message: "Get all categories success", data: allCategories });
};
exports.getAllCategories = getAllCategories;
const getCategoryById = async (req, res) => {
    const { id } = req.params;
    const category = await connection_1.db
        .select({
        id: schema_1.categories.id,
        name: schema_1.categories.name,
        Image: schema_1.categories.Image,
        meta_image: schema_1.categories.meta_image,
        title: schema_1.categories.title,
        meta_title: schema_1.categories.meta_title,
        status: schema_1.categories.status,
        createdAt: schema_1.categories.createdAt,
        updatedAt: schema_1.categories.updatedAt,
    })
        .from(schema_1.categories)
        .where((0, drizzle_orm_1.eq)(schema_1.categories.id, id))
        .limit(1);
    if (!category[0]) {
        throw new NotFound_1.NotFound("Category not found");
    }
    return (0, response_1.SuccessResponse)(res, { message: "Get category by id success", data: category[0] });
};
exports.getCategoryById = getCategoryById;
const updateCategory = async (req, res) => {
    const { id } = req.params;
    const { name, Image, meta_image, title, meta_title, status } = req.body;
    const existingCategory = await connection_1.db
        .select()
        .from(schema_1.categories)
        .where((0, drizzle_orm_1.eq)(schema_1.categories.id, id))
        .limit(1);
    if (!existingCategory[0]) {
        throw new NotFound_1.NotFound("Category not found");
    }
    const updateData = {
        updatedAt: new Date(),
    };
    if (name)
        updateData.name = name;
    if (Image)
        updateData.Image = Image;
    if (meta_image !== undefined)
        updateData.meta_image = meta_image;
    if (title !== undefined)
        updateData.title = title;
    if (meta_title !== undefined)
        updateData.meta_title = meta_title;
    if (status)
        updateData.status = status;
    if (Object.keys(updateData).length === 1) {
        throw new BadRequest_1.BadRequest("No data to update");
    }
    await connection_1.db.update(schema_1.categories).set(updateData).where((0, drizzle_orm_1.eq)(schema_1.categories.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Update category success" });
};
exports.updateCategory = updateCategory;
const deleteCategory = async (req, res) => {
    const { id } = req.params;
    const existingCategory = await connection_1.db
        .select()
        .from(schema_1.categories)
        .where((0, drizzle_orm_1.eq)(schema_1.categories.id, id))
        .limit(1);
    if (!existingCategory[0]) {
        throw new NotFound_1.NotFound("Category not found");
    }
    await connection_1.db.delete(schema_1.categories).where((0, drizzle_orm_1.eq)(schema_1.categories.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Delete category success" });
};
exports.deleteCategory = deleteCategory;
