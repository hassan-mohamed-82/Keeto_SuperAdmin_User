"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllRestaurantsandaddonscategory = exports.deleteAddon = exports.updateAddon = exports.getAddonById = exports.getAllAddons = exports.createAddon = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const createAddon = async (req, res) => {
    const { name, price, stock_type, adonescategoryid, restaurantid } = req.body;
    // Required fields validation
    if (!name || !price || !stock_type || !adonescategoryid || !restaurantid) {
        throw new BadRequest_1.BadRequest("Missing required fields: name, price, stock_type, adonescategoryid, restaurantid");
    }
    // Validate adonescategory exists
    const existingAdonesCategory = await connection_1.db
        .select()
        .from(schema_1.adonescategory)
        .where((0, drizzle_orm_1.eq)(schema_1.adonescategory.id, adonescategoryid))
        .limit(1);
    if (!existingAdonesCategory[0]) {
        throw new BadRequest_1.BadRequest("Adones category not found");
    }
    // Validate restaurant exists
    const existingRestaurant = await connection_1.db
        .select()
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantid))
        .limit(1);
    if (!existingRestaurant[0]) {
        throw new BadRequest_1.BadRequest("Restaurant not found");
    }
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.addons).values({
        id,
        name,
        price,
        stock_type,
        adonescategoryid,
        restaurantid,
    });
    return (0, response_1.SuccessResponse)(res, { message: "Create addon success", data: { id } }, 201);
};
exports.createAddon = createAddon;
const getAllAddons = async (req, res) => {
    const allAddons = await connection_1.db
        .select({
        id: schema_1.addons.id,
        name: schema_1.addons.name,
        price: schema_1.addons.price,
        stock_type: schema_1.addons.stock_type,
        adonescategoryid: schema_1.addons.adonescategoryid,
        restaurantid: schema_1.addons.restaurantid,
        createdAt: schema_1.addons.createdAt,
        updatedAt: schema_1.addons.updatedAt,
        adonescategory: {
            id: schema_1.adonescategory.id,
            name: schema_1.adonescategory.name,
        },
        restaurant: {
            id: schema_1.restaurants.id,
            name: schema_1.restaurants.name,
        },
    })
        .from(schema_1.addons)
        .leftJoin(schema_1.adonescategory, (0, drizzle_orm_1.eq)(schema_1.addons.adonescategoryid, schema_1.adonescategory.id))
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.addons.restaurantid, schema_1.restaurants.id));
    return (0, response_1.SuccessResponse)(res, { message: "Get all addons success", data: allAddons });
};
exports.getAllAddons = getAllAddons;
const getAddonById = async (req, res) => {
    const { id } = req.params;
    const addon = await connection_1.db
        .select({
        id: schema_1.addons.id,
        name: schema_1.addons.name,
        price: schema_1.addons.price,
        stock_type: schema_1.addons.stock_type,
        adonescategoryid: schema_1.addons.adonescategoryid,
        restaurantid: schema_1.addons.restaurantid,
        createdAt: schema_1.addons.createdAt,
        updatedAt: schema_1.addons.updatedAt,
        adonescategory: {
            id: schema_1.adonescategory.id,
            name: schema_1.adonescategory.name,
        },
        restaurant: {
            id: schema_1.restaurants.id,
            name: schema_1.restaurants.name,
        },
    })
        .from(schema_1.addons)
        .leftJoin(schema_1.adonescategory, (0, drizzle_orm_1.eq)(schema_1.addons.adonescategoryid, schema_1.adonescategory.id))
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.addons.restaurantid, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.eq)(schema_1.addons.id, id))
        .limit(1);
    if (!addon[0]) {
        throw new NotFound_1.NotFound("Addon not found");
    }
    return (0, response_1.SuccessResponse)(res, { message: "Get addon success", data: addon[0] });
};
exports.getAddonById = getAddonById;
const updateAddon = async (req, res) => {
    const { id } = req.params;
    const { name, price, stock_type, stock, adonescategoryid, restaurantid } = req.body;
    // Validate addon exists
    const existingAddon = await connection_1.db
        .select()
        .from(schema_1.addons)
        .where((0, drizzle_orm_1.eq)(schema_1.addons.id, id))
        .limit(1);
    if (!existingAddon[0]) {
        throw new NotFound_1.NotFound("Addon not found");
    }
    // Validate adonescategory exists if provided
    if (adonescategoryid) {
        const existingAdonesCategory = await connection_1.db
            .select()
            .from(schema_1.adonescategory)
            .where((0, drizzle_orm_1.eq)(schema_1.adonescategory.id, adonescategoryid))
            .limit(1);
        if (!existingAdonesCategory[0]) {
            throw new BadRequest_1.BadRequest("Adones category not found");
        }
    }
    // Validate restaurant exists if provided
    if (restaurantid) {
        const existingRestaurant = await connection_1.db
            .select()
            .from(schema_1.restaurants)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantid))
            .limit(1);
        if (!existingRestaurant[0]) {
            throw new BadRequest_1.BadRequest("Restaurant not found");
        }
    }
    await connection_1.db
        .update(schema_1.addons)
        .set({
        name: name || existingAddon[0].name,
        price: price || existingAddon[0].price,
        stock_type: stock_type || existingAddon[0].stock_type,
        adonescategoryid: adonescategoryid || existingAddon[0].adonescategoryid,
        restaurantid: restaurantid || existingAddon[0].restaurantid,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.addons.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Update addon success", data: { id } });
};
exports.updateAddon = updateAddon;
const deleteAddon = async (req, res) => {
    const { id } = req.params;
    const existingAddon = await connection_1.db
        .select()
        .from(schema_1.addons)
        .where((0, drizzle_orm_1.eq)(schema_1.addons.id, id))
        .limit(1);
    if (!existingAddon[0]) {
        throw new NotFound_1.NotFound("Addon not found");
    }
    await connection_1.db.delete(schema_1.addons).where((0, drizzle_orm_1.eq)(schema_1.addons.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Delete addon success", data: { id } });
};
exports.deleteAddon = deleteAddon;
const getAllRestaurantsandaddonscategory = async (req, res) => {
    // 1. جلب المطاعم النشطة
    const allRestaurants = await connection_1.db
        .select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
    })
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active"));
    // 2. جلب الإضافات (بشرط الإضافة نفسها تكون نشطة)
    const allAddons = await connection_1.db
        .select({
        id: schema_1.adonescategory.id,
        name: schema_1.adonescategory.name
    })
        .from(schema_1.adonescategory)
        .where((0, drizzle_orm_1.eq)(schema_1.adonescategory.status, "active")); // فلتر فقط بحالة الإضافة مؤقتاً للتأكد من الداتا
    return (0, response_1.SuccessResponse)(res, {
        allRestaurants,
        allAddons
    }, 200);
};
exports.getAllRestaurantsandaddonscategory = getAllRestaurantsandaddonscategory;
