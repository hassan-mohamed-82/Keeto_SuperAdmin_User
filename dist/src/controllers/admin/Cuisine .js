"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCuisine = exports.updateCuisine = exports.getCuisineById = exports.getAllCuisines = exports.createCuisine = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const createCuisine = async (req, res) => {
    const { name, Image, meta_image, description, meta_description, status } = req.body;
    if (!name || !Image) {
        throw new BadRequest_1.BadRequest("Cuisine name and image are required");
    }
    // Check if cuisine already exists
    const existingCuisine = await connection_1.db
        .select()
        .from(schema_1.cuisines)
        .where((0, drizzle_orm_1.eq)(schema_1.cuisines.name, name))
        .limit(1);
    if (existingCuisine[0]) {
        throw new BadRequest_1.BadRequest("Cuisine already exists");
    }
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.cuisines).values({
        id,
        name,
        Image,
        meta_image: meta_image || null,
        description: description || null,
        meta_description: meta_description || null,
        status: status || "active",
    });
    return (0, response_1.SuccessResponse)(res, { message: "Create cuisine success", data: { id } }, 201);
};
exports.createCuisine = createCuisine;
const getAllCuisines = async (req, res) => {
    const allCuisines = await connection_1.db
        .select({
        id: schema_1.cuisines.id,
        name: schema_1.cuisines.name,
        Image: schema_1.cuisines.Image,
        meta_image: schema_1.cuisines.meta_image,
        description: schema_1.cuisines.description,
        meta_description: schema_1.cuisines.meta_description,
        status: schema_1.cuisines.status,
        total_restaurants: schema_1.cuisines.total_restaurants,
        createdAt: schema_1.cuisines.createdAt,
        updatedAt: schema_1.cuisines.updatedAt,
    })
        .from(schema_1.cuisines);
    return (0, response_1.SuccessResponse)(res, { message: "Get all cuisines success", data: allCuisines });
};
exports.getAllCuisines = getAllCuisines;
const getCuisineById = async (req, res) => {
    const { id } = req.params;
    const cuisine = await connection_1.db
        .select({
        id: schema_1.cuisines.id,
        name: schema_1.cuisines.name,
        Image: schema_1.cuisines.Image,
        meta_image: schema_1.cuisines.meta_image,
        description: schema_1.cuisines.description,
        meta_description: schema_1.cuisines.meta_description,
        status: schema_1.cuisines.status,
        total_restaurants: schema_1.cuisines.total_restaurants,
        createdAt: schema_1.cuisines.createdAt,
        updatedAt: schema_1.cuisines.updatedAt,
    })
        .from(schema_1.cuisines)
        .where((0, drizzle_orm_1.eq)(schema_1.cuisines.id, id))
        .limit(1);
    if (!cuisine[0]) {
        throw new NotFound_1.NotFound("Cuisine not found");
    }
    return (0, response_1.SuccessResponse)(res, { message: "Get cuisine by id success", data: cuisine[0] });
};
exports.getCuisineById = getCuisineById;
const updateCuisine = async (req, res) => {
    const { id } = req.params;
    const { name, Image, meta_image, description, meta_description, status } = req.body;
    const existingCuisine = await connection_1.db
        .select()
        .from(schema_1.cuisines)
        .where((0, drizzle_orm_1.eq)(schema_1.cuisines.id, id))
        .limit(1);
    if (!existingCuisine[0]) {
        throw new NotFound_1.NotFound("Cuisine not found");
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
    if (description !== undefined)
        updateData.description = description;
    if (meta_description !== undefined)
        updateData.meta_description = meta_description;
    if (status)
        updateData.status = status;
    if (Object.keys(updateData).length === 1) {
        throw new BadRequest_1.BadRequest("No data to update");
    }
    await connection_1.db.update(schema_1.cuisines).set(updateData).where((0, drizzle_orm_1.eq)(schema_1.cuisines.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Update cuisine success" });
};
exports.updateCuisine = updateCuisine;
const deleteCuisine = async (req, res) => {
    const { id } = req.params;
    const existingCuisine = await connection_1.db
        .select()
        .from(schema_1.cuisines)
        .where((0, drizzle_orm_1.eq)(schema_1.cuisines.id, id))
        .limit(1);
    if (!existingCuisine[0]) {
        throw new NotFound_1.NotFound("Cuisine not found");
    }
    await connection_1.db.delete(schema_1.cuisines).where((0, drizzle_orm_1.eq)(schema_1.cuisines.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Delete cuisine success" });
};
exports.deleteCuisine = deleteCuisine;
