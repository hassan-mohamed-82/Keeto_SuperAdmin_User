"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getallcousinesandzones = exports.deleteRestaurant = exports.updateRestaurant = exports.getRestaurantById = exports.getAllRestaurants = exports.createRestaurant = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const bcrypt_1 = __importDefault(require("bcrypt"));
const uuid_1 = require("uuid");
// Helper: increment total_restaurants on a cuisine
const incrementCuisineCount = async (cuisineId) => {
    const cuisine = await connection_1.db
        .select({ total_restaurants: schema_1.cuisines.total_restaurants })
        .from(schema_1.cuisines)
        .where((0, drizzle_orm_1.eq)(schema_1.cuisines.id, cuisineId))
        .limit(1);
    if (cuisine[0]) {
        const current = parseInt(cuisine[0].total_restaurants || "0", 10);
        await connection_1.db
            .update(schema_1.cuisines)
            .set({ total_restaurants: String(current + 1) })
            .where((0, drizzle_orm_1.eq)(schema_1.cuisines.id, cuisineId));
    }
};
// Helper: decrement total_restaurants on a cuisine
const decrementCuisineCount = async (cuisineId) => {
    const cuisine = await connection_1.db
        .select({ total_restaurants: schema_1.cuisines.total_restaurants })
        .from(schema_1.cuisines)
        .where((0, drizzle_orm_1.eq)(schema_1.cuisines.id, cuisineId))
        .limit(1);
    if (cuisine[0]) {
        const current = parseInt(cuisine[0].total_restaurants || "0", 10);
        await connection_1.db
            .update(schema_1.cuisines)
            .set({ total_restaurants: String(Math.max(0, current - 1)) })
            .where((0, drizzle_orm_1.eq)(schema_1.cuisines.id, cuisineId));
    }
};
const createRestaurant = async (req, res) => {
    const { name, address, cuisineId, zoneId, logo, cover, minDeliveryTime, maxDeliveryTime, deliveryTimeUnit, ownerFirstName, ownerLastName, ownerPhone, tags, taxNumber, taxExpireDate, taxCertificate, email, password, status, } = req.body;
    // Required fields validation
    if (!name || !address || !zoneId || !logo || !ownerFirstName || !ownerLastName || !ownerPhone || !email || !password) {
        throw new BadRequest_1.BadRequest("Missing required fields: name, address, zoneId, logo, ownerFirstName, ownerLastName, ownerPhone, email, password");
    }
    // Check if email already exists
    const existingRestaurant = await connection_1.db
        .select()
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.email, email))
        .limit(1);
    if (existingRestaurant[0]) {
        throw new BadRequest_1.BadRequest("Email already exists");
    }
    // Validate zone exists
    const existingZone = await connection_1.db
        .select()
        .from(schema_1.zones)
        .where((0, drizzle_orm_1.eq)(schema_1.zones.id, zoneId))
        .limit(1);
    if (!existingZone[0]) {
        throw new BadRequest_1.BadRequest("Zone not found");
    }
    // Validate cuisine exists if provided
    if (cuisineId) {
        const existingCuisine = await connection_1.db
            .select()
            .from(schema_1.cuisines)
            .where((0, drizzle_orm_1.eq)(schema_1.cuisines.id, cuisineId))
            .limit(1);
        if (!existingCuisine[0]) {
            throw new BadRequest_1.BadRequest("Cuisine not found");
        }
    }
    const id = (0, uuid_1.v4)();
    const hashedPassword = await bcrypt_1.default.hash(password, 10);
    await connection_1.db.insert(schema_1.restaurants).values({
        id,
        name,
        address,
        cuisineId: cuisineId || null,
        zoneId,
        logo,
        cover: cover || null,
        minDeliveryTime: minDeliveryTime || null,
        maxDeliveryTime: maxDeliveryTime || null,
        deliveryTimeUnit: deliveryTimeUnit || "Minutes",
        ownerFirstName,
        ownerLastName,
        ownerPhone,
        tags: tags || [],
        taxNumber: taxNumber || null,
        taxExpireDate: taxExpireDate || null,
        taxCertificate: taxCertificate || null,
        email,
        password: hashedPassword,
        status: status || "pending",
    });
    // Increment total_restaurants on the selected cuisine
    if (cuisineId) {
        await incrementCuisineCount(cuisineId);
    }
    return (0, response_1.SuccessResponse)(res, { message: "Create restaurant success", data: { id } }, 201);
};
exports.createRestaurant = createRestaurant;
const getAllRestaurants = async (req, res) => {
    const allRestaurants = await connection_1.db
        .select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        address: schema_1.restaurants.address,
        cuisineId: schema_1.restaurants.cuisineId,
        zoneId: schema_1.restaurants.zoneId,
        logo: schema_1.restaurants.logo,
        cover: schema_1.restaurants.cover,
        minDeliveryTime: schema_1.restaurants.minDeliveryTime,
        maxDeliveryTime: schema_1.restaurants.maxDeliveryTime,
        deliveryTimeUnit: schema_1.restaurants.deliveryTimeUnit,
        ownerFirstName: schema_1.restaurants.ownerFirstName,
        ownerLastName: schema_1.restaurants.ownerLastName,
        ownerPhone: schema_1.restaurants.ownerPhone,
        tags: schema_1.restaurants.tags,
        taxNumber: schema_1.restaurants.taxNumber,
        taxExpireDate: schema_1.restaurants.taxExpireDate,
        taxCertificate: schema_1.restaurants.taxCertificate,
        email: schema_1.restaurants.email,
        status: schema_1.restaurants.status,
        createdAt: schema_1.restaurants.createdAt,
        updatedAt: schema_1.restaurants.updatedAt,
        cuisine: {
            id: schema_1.cuisines.id,
            name: schema_1.cuisines.name,
        },
        zone: {
            id: schema_1.zones.id,
            name: schema_1.zones.name,
        },
    })
        .from(schema_1.restaurants)
        .leftJoin(schema_1.cuisines, (0, drizzle_orm_1.eq)(schema_1.restaurants.cuisineId, schema_1.cuisines.id))
        .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurants.zoneId, schema_1.zones.id));
    return (0, response_1.SuccessResponse)(res, { message: "Get all restaurants success", data: allRestaurants });
};
exports.getAllRestaurants = getAllRestaurants;
const getRestaurantById = async (req, res) => {
    const { id } = req.params;
    const restaurant = await connection_1.db
        .select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        address: schema_1.restaurants.address,
        cuisineId: schema_1.restaurants.cuisineId,
        zoneId: schema_1.restaurants.zoneId,
        logo: schema_1.restaurants.logo,
        cover: schema_1.restaurants.cover,
        minDeliveryTime: schema_1.restaurants.minDeliveryTime,
        maxDeliveryTime: schema_1.restaurants.maxDeliveryTime,
        deliveryTimeUnit: schema_1.restaurants.deliveryTimeUnit,
        ownerFirstName: schema_1.restaurants.ownerFirstName,
        ownerLastName: schema_1.restaurants.ownerLastName,
        ownerPhone: schema_1.restaurants.ownerPhone,
        tags: schema_1.restaurants.tags,
        taxNumber: schema_1.restaurants.taxNumber,
        taxExpireDate: schema_1.restaurants.taxExpireDate,
        taxCertificate: schema_1.restaurants.taxCertificate,
        email: schema_1.restaurants.email,
        status: schema_1.restaurants.status,
        createdAt: schema_1.restaurants.createdAt,
        updatedAt: schema_1.restaurants.updatedAt,
        cuisine: {
            id: schema_1.cuisines.id,
            name: schema_1.cuisines.name,
        },
        zone: {
            id: schema_1.zones.id,
            name: schema_1.zones.name,
        },
    })
        .from(schema_1.restaurants)
        .leftJoin(schema_1.cuisines, (0, drizzle_orm_1.eq)(schema_1.restaurants.cuisineId, schema_1.cuisines.id))
        .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurants.zoneId, schema_1.zones.id))
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id))
        .limit(1);
    if (!restaurant[0]) {
        throw new NotFound_1.NotFound("Restaurant not found");
    }
    return (0, response_1.SuccessResponse)(res, { message: "Get restaurant by id success", data: restaurant[0] });
};
exports.getRestaurantById = getRestaurantById;
const updateRestaurant = async (req, res) => {
    const { id } = req.params;
    const { name, address, cuisineId, zoneId, lat, lng, logo, cover, minDeliveryTime, maxDeliveryTime, deliveryTimeUnit, ownerFirstName, ownerLastName, ownerPhone, tags, taxNumber, taxExpireDate, taxCertificate, email, password, confirmPassword, status, } = req.body;
    const existingRestaurant = await connection_1.db
        .select()
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id))
        .limit(1);
    if (!existingRestaurant[0]) {
        throw new NotFound_1.NotFound("Restaurant not found");
    }
    // Validate zone if provided
    if (zoneId) {
        const existingZone = await connection_1.db
            .select()
            .from(schema_1.zones)
            .where((0, drizzle_orm_1.eq)(schema_1.zones.id, zoneId))
            .limit(1);
        if (!existingZone[0]) {
            throw new BadRequest_1.BadRequest("Zone not found");
        }
    }
    // Validate cuisine if provided
    if (cuisineId) {
        const existingCuisine = await connection_1.db
            .select()
            .from(schema_1.cuisines)
            .where((0, drizzle_orm_1.eq)(schema_1.cuisines.id, cuisineId))
            .limit(1);
        if (!existingCuisine[0]) {
            throw new BadRequest_1.BadRequest("Cuisine not found");
        }
    }
    // Validate email uniqueness if changed
    if (email && email !== existingRestaurant[0].email) {
        const emailExists = await connection_1.db
            .select()
            .from(schema_1.restaurants)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurants.email, email))
            .limit(1);
        if (emailExists[0]) {
            throw new BadRequest_1.BadRequest("Email already exists");
        }
    }
    // Password validation
    if (password) {
        if (password !== confirmPassword) {
            throw new BadRequest_1.BadRequest("Password and confirm password do not match");
        }
    }
    const updateData = {
        updatedAt: new Date(),
    };
    if (name)
        updateData.name = name;
    if (address)
        updateData.address = address;
    if (cuisineId !== undefined)
        updateData.cuisineId = cuisineId || null;
    if (zoneId)
        updateData.zoneId = zoneId;
    if (lat !== undefined)
        updateData.lat = lat;
    if (lng !== undefined)
        updateData.lng = lng;
    if (logo)
        updateData.logo = logo;
    if (cover !== undefined)
        updateData.cover = cover;
    if (minDeliveryTime !== undefined)
        updateData.minDeliveryTime = minDeliveryTime;
    if (maxDeliveryTime !== undefined)
        updateData.maxDeliveryTime = maxDeliveryTime;
    if (deliveryTimeUnit)
        updateData.deliveryTimeUnit = deliveryTimeUnit;
    if (ownerFirstName)
        updateData.ownerFirstName = ownerFirstName;
    if (ownerLastName)
        updateData.ownerLastName = ownerLastName;
    if (ownerPhone)
        updateData.ownerPhone = ownerPhone;
    if (tags !== undefined)
        updateData.tags = tags;
    if (taxNumber !== undefined)
        updateData.taxNumber = taxNumber;
    if (taxExpireDate !== undefined)
        updateData.taxExpireDate = taxExpireDate;
    if (taxCertificate !== undefined)
        updateData.taxCertificate = taxCertificate;
    if (email)
        updateData.email = email;
    if (password)
        updateData.password = await bcrypt_1.default.hash(password, 10);
    if (status)
        updateData.status = status;
    if (Object.keys(updateData).length === 1) {
        throw new BadRequest_1.BadRequest("No data to update");
    }
    await connection_1.db.update(schema_1.restaurants).set(updateData).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id));
    // Handle cuisine count if cuisineId changed
    if (cuisineId !== undefined && cuisineId !== existingRestaurant[0].cuisineId) {
        // Decrement old cuisine count
        if (existingRestaurant[0].cuisineId) {
            await decrementCuisineCount(existingRestaurant[0].cuisineId);
        }
        // Increment new cuisine count
        if (cuisineId) {
            await incrementCuisineCount(cuisineId);
        }
    }
    return (0, response_1.SuccessResponse)(res, { message: "Update restaurant success" });
};
exports.updateRestaurant = updateRestaurant;
const deleteRestaurant = async (req, res) => {
    const { id } = req.params;
    const existingRestaurant = await connection_1.db
        .select()
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id))
        .limit(1);
    if (!existingRestaurant[0]) {
        throw new NotFound_1.NotFound("Restaurant not found");
    }
    // Decrement cuisine count before deleting
    if (existingRestaurant[0].cuisineId) {
        await decrementCuisineCount(existingRestaurant[0].cuisineId);
    }
    await connection_1.db.delete(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Delete restaurant success" });
};
exports.deleteRestaurant = deleteRestaurant;
const getallcousinesandzones = async (req, res) => {
    const allCuisines = await connection_1.db.select({
        id: schema_1.cuisines.id,
        name: schema_1.cuisines.name,
    }).from(schema_1.cuisines)
        .where((0, drizzle_orm_1.eq)(schema_1.cuisines.status, "active"));
    const allZones = await connection_1.db.select({
        id: schema_1.zones.id,
        name: schema_1.zones.name,
    }).from(schema_1.zones)
        .where((0, drizzle_orm_1.eq)(schema_1.zones.status, "active"));
    return (0, response_1.SuccessResponse)(res, { message: "Get all cuisines and zones success", data: { allCuisines, allZones } });
};
exports.getallcousinesandzones = getallcousinesandzones;
