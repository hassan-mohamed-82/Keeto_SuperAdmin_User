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
const handleImages_1 = require("../../utils/handleImages");
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
    const clean = (v) => typeof v === "string" ? v.trim() : v;
    const { name, nameAr, nameFr, address, addressAr, addressFr, cuisineId, zoneId, logo, cover, minDeliveryTime, maxDeliveryTime, deliveryTimeUnit, ownerFirstName, ownerLastName, ownerPhone, tags, taxNumber, taxExpireDate, taxCertificate, email, password, status } = req.body;
    if (!name || !nameAr || !nameFr || !address || !addressAr || !addressFr || !zoneId || !logo || !ownerFirstName || !ownerLastName || !ownerPhone || !email || !password) {
        throw new BadRequest_1.BadRequest("Missing required fields");
    }
    let logoUrl = undefined;
    if (logo) {
        const result = await (0, handleImages_1.saveBase64Image)(req, logo, "restaurants");
        logoUrl = result.url;
    }
    // handle cover image
    let coverUrl = undefined;
    if (cover) {
        const result = await (0, handleImages_1.saveBase64Image)(req, cover, "restaurants_cover");
        coverUrl = result.url;
    }
    const existing = await connection_1.db
        .select()
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.email, email))
        .limit(1);
    if (existing[0]) {
        throw new BadRequest_1.BadRequest("Email already exists");
    }
    const hashedPassword = await bcrypt_1.default.hash(password, 10);
    const id = (0, uuid_1.v4)();
    let parsedTags = [];
    if (tags) {
        parsedTags = typeof tags === "string" ? JSON.parse(tags) : tags;
    }
    await connection_1.db.transaction(async (tx) => {
        await tx.insert(schema_1.restaurants).values({
            id,
            name: clean(name),
            nameAr: clean(nameAr),
            nameFr: clean(nameFr),
            address: clean(address),
            addressAr: clean(addressAr),
            addressFr: clean(addressFr),
            cuisineId: cuisineId || null,
            zoneId: clean(zoneId),
            logo: logoUrl || '',
            cover: coverUrl || '',
            minDeliveryTime: minDeliveryTime ? clean(minDeliveryTime) : null,
            maxDeliveryTime: maxDeliveryTime ? clean(maxDeliveryTime) : null,
            deliveryTimeUnit: deliveryTimeUnit || "Minutes",
            ownerFirstName: clean(ownerFirstName),
            ownerLastName: clean(ownerLastName),
            ownerPhone: clean(ownerPhone),
            tags: parsedTags,
            taxNumber: taxNumber ? clean(taxNumber) : null,
            taxExpireDate: taxExpireDate || null,
            taxCertificate: taxCertificate ? clean(taxCertificate) : null,
            email: clean(email),
            password: hashedPassword,
            status: "active",
        });
        await tx.insert(schema_1.restaurantWallets).values({
            id: (0, uuid_1.v4)(),
            restaurantId: id,
            balance: "0.00",
            collectedCash: "0.00",
            pendingWithdraw: "0.00",
            totalWithdrawn: "0.00",
            totalEarning: "0.00",
        });
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Restaurant created successfully",
        data: { id }
    }, 201);
};
exports.createRestaurant = createRestaurant;
const getAllRestaurants = async (req, res) => {
    const raw = await connection_1.db.select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        nameAr: schema_1.restaurants.nameAr,
        nameFr: schema_1.restaurants.nameFr,
        address: schema_1.restaurants.address,
        addressAr: schema_1.restaurants.addressAr,
        addressFr: schema_1.restaurants.addressFr,
        logo: schema_1.restaurants.logo,
        cover: schema_1.restaurants.cover,
        status: schema_1.restaurants.status,
        cuisine_id: schema_1.cuisines.id,
        cuisine_name: schema_1.cuisines.name,
        zone_id: schema_1.zones.id,
        zone_name: schema_1.zones.name,
    })
        .from(schema_1.restaurants)
        .leftJoin(schema_1.cuisines, (0, drizzle_orm_1.eq)(schema_1.restaurants.cuisineId, schema_1.cuisines.id))
        .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurants.zoneId, schema_1.zones.id));
    const formatted = raw.map(r => ({
        id: r.id,
        name: r.name,
        nameAr: r.nameAr,
        nameFr: r.nameFr,
        address: r.address,
        addressAr: r.addressAr,
        addressFr: r.addressFr,
        logo: r.logo,
        cover: r.cover,
        status: r.status,
        cuisine: r.cuisine_id
            ? { id: r.cuisine_id, name: r.cuisine_name }
            : null,
        zone: r.zone_id
            ? { id: r.zone_id, name: r.zone_name }
            : null,
    }));
    return (0, response_1.SuccessResponse)(res, {
        message: "Get all restaurants success",
        data: formatted
    });
};
exports.getAllRestaurants = getAllRestaurants;
// =============================================
// GET Restaurant By ID (مُصلح: فصل الكائنات لتجنب خطأ 500)
// =============================================
const getRestaurantById = async (req, res) => {
    const { id } = req.params;
    const rawRestaurants = await connection_1.db
        .select({
        restaurantObj: schema_1.restaurants,
        cuisineObj: schema_1.cuisines,
        zoneObj: schema_1.zones,
    })
        .from(schema_1.restaurants)
        .leftJoin(schema_1.cuisines, (0, drizzle_orm_1.eq)(schema_1.restaurants.cuisineId, schema_1.cuisines.id))
        .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurants.zoneId, schema_1.zones.id))
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, id))
        .limit(1);
    if (!rawRestaurants[0]) {
        throw new NotFound_1.NotFound("Restaurant not found");
    }
    // استخراج الصف الأول وتهيئته
    const row = rawRestaurants[0];
    const formattedRestaurant = {
        ...row.restaurantObj,
        cuisine: row.cuisineObj ? { id: row.cuisineObj.id, name: row.cuisineObj.name } : null,
        zone: row.zoneObj ? { id: row.zoneObj.id, name: row.zoneObj.name } : null,
    };
    return (0, response_1.SuccessResponse)(res, {
        message: "Get restaurant by id success",
        data: formattedRestaurant
    });
};
exports.getRestaurantById = getRestaurantById;
const updateRestaurant = async (req, res) => {
    const { id } = req.params;
    const { name, nameAr, nameFr, address, addressAr, addressFr, cuisineId, zoneId, lat, lng, logo, cover, minDeliveryTime, maxDeliveryTime, deliveryTimeUnit, ownerFirstName, ownerLastName, ownerPhone, tags, taxNumber, taxExpireDate, taxCertificate, email, password, confirmPassword, status } = req.body;
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
    if (nameAr)
        updateData.nameAr = nameAr;
    if (nameFr)
        updateData.nameFr = nameFr;
    if (address)
        updateData.address = address;
    if (addressAr)
        updateData.addressAr = addressAr;
    if (addressFr)
        updateData.addressFr = addressFr;
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
