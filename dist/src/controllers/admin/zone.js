"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getallcities = exports.deleteZone = exports.updateZone = exports.getZoneById = exports.getAllZones = exports.createZone = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
// =============================================
// CREATE ZONE
// =============================================
const createZone = async (req, res) => {
    const { name, nameAr, nameFr, displayName, displayNameAr, displayNameFr, cityId, coordinates, coverageAreaRadiusKm, deliveryFee, minOrderAmount, } = req.body;
    if (!name || !displayName || !cityId) {
        throw new BadRequest_1.BadRequest("Name, displayName, and cityId are required");
    }
    if (!coordinates && !coverageAreaRadiusKm) {
        throw new BadRequest_1.BadRequest("Either coordinates (polygon) or coverageAreaRadiusKm (radius) must be provided");
    }
    const existingCity = await connection_1.db
        .select()
        .from(schema_1.cities)
        .where((0, drizzle_orm_1.eq)(schema_1.cities.id, cityId))
        .limit(1);
    if (!existingCity[0]) {
        throw new BadRequest_1.BadRequest("City not found");
    }
    const existingZone = await connection_1.db
        .select()
        .from(schema_1.zones)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.zones.name, name), (0, drizzle_orm_1.eq)(schema_1.zones.cityId, cityId), (0, drizzle_orm_1.eq)(schema_1.zones.status, "active")))
        .limit(1);
    if (existingZone[0]) {
        throw new BadRequest_1.BadRequest("Zone already exists in this city");
    }
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.zones).values({
        id,
        name,
        nameAr: nameAr || "",
        nameFr: nameFr || "",
        displayName,
        displayNameAr: displayNameAr || "",
        displayNameFr: displayNameFr || "",
        coordinates: coordinates || null,
        coverageAreaRadiusKm: coverageAreaRadiusKm ? String(coverageAreaRadiusKm) : null,
        deliveryFee: deliveryFee !== undefined ? String(deliveryFee) : "0.00",
        minOrderAmount: minOrderAmount !== undefined ? String(minOrderAmount) : "0.00",
        status: "active",
        cityId,
    });
    return (0, response_1.SuccessResponse)(res, { message: "Create zone success", data: { id } }, 201);
};
exports.createZone = createZone;
// =============================================
// GET ALL ZONES
// =============================================
const getAllZones = async (req, res) => {
    const allZones = await connection_1.db
        .select({
        id: schema_1.zones.id,
        name: schema_1.zones.name,
        nameAr: schema_1.zones.nameAr,
        nameFr: schema_1.zones.nameFr,
        displayName: schema_1.zones.displayName,
        displayNameAr: schema_1.zones.displayNameAr,
        displayNameFr: schema_1.zones.displayNameFr,
        coordinates: schema_1.zones.coordinates,
        coverageAreaRadiusKm: schema_1.zones.coverageAreaRadiusKm,
        deliveryFee: schema_1.zones.deliveryFee,
        minOrderAmount: schema_1.zones.minOrderAmount,
        status: schema_1.zones.status,
        cityId: schema_1.zones.cityId,
        createdAt: schema_1.zones.createdAt,
        updatedAt: schema_1.zones.updatedAt,
        city: {
            id: schema_1.cities.id,
            name: schema_1.cities.name,
            nameAr: schema_1.cities.nameAr,
            nameFr: schema_1.cities.nameFr,
            status: schema_1.cities.status,
        },
    })
        .from(schema_1.zones)
        .leftJoin(schema_1.cities, (0, drizzle_orm_1.eq)(schema_1.zones.cityId, schema_1.cities.id));
    return (0, response_1.SuccessResponse)(res, { message: "Get all zones success", data: allZones });
};
exports.getAllZones = getAllZones;
// =============================================
// GET ZONE BY ID
// =============================================
const getZoneById = async (req, res) => {
    const { id } = req.params;
    const zone = await connection_1.db
        .select({
        id: schema_1.zones.id,
        name: schema_1.zones.name,
        nameAr: schema_1.zones.nameAr,
        nameFr: schema_1.zones.nameFr,
        displayName: schema_1.zones.displayName,
        displayNameAr: schema_1.zones.displayNameAr,
        displayNameFr: schema_1.zones.displayNameFr,
        coordinates: schema_1.zones.coordinates,
        coverageAreaRadiusKm: schema_1.zones.coverageAreaRadiusKm,
        deliveryFee: schema_1.zones.deliveryFee,
        minOrderAmount: schema_1.zones.minOrderAmount,
        status: schema_1.zones.status,
        cityId: schema_1.zones.cityId,
        createdAt: schema_1.zones.createdAt,
        updatedAt: schema_1.zones.updatedAt,
        city: {
            id: schema_1.cities.id,
            name: schema_1.cities.name,
            nameAr: schema_1.cities.nameAr,
            nameFr: schema_1.cities.nameFr,
            status: schema_1.cities.status,
        },
    })
        .from(schema_1.zones)
        .leftJoin(schema_1.cities, (0, drizzle_orm_1.eq)(schema_1.zones.cityId, schema_1.cities.id))
        .where((0, drizzle_orm_1.eq)(schema_1.zones.id, id))
        .limit(1);
    if (!zone[0]) {
        throw new NotFound_1.NotFound("Zone not found");
    }
    return (0, response_1.SuccessResponse)(res, { message: "Get zone by id success", data: zone[0] });
};
exports.getZoneById = getZoneById;
// =============================================
// UPDATE ZONE
// =============================================
const updateZone = async (req, res) => {
    const { id } = req.params;
    const { name, nameAr, nameFr, displayName, displayNameAr, displayNameFr, status, cityId, coordinates, coverageAreaRadiusKm, deliveryFee, minOrderAmount, } = req.body;
    if (!name &&
        !nameAr &&
        !nameFr &&
        !displayName &&
        !displayNameAr &&
        !displayNameFr &&
        !status &&
        !cityId &&
        coordinates === undefined &&
        coverageAreaRadiusKm === undefined &&
        deliveryFee === undefined &&
        minOrderAmount === undefined) {
        throw new BadRequest_1.BadRequest("No data to update");
    }
    const zonePromise = connection_1.db.select().from(schema_1.zones).where((0, drizzle_orm_1.eq)(schema_1.zones.id, id)).limit(1);
    const cityPromise = cityId
        ? connection_1.db.select().from(schema_1.cities).where((0, drizzle_orm_1.eq)(schema_1.cities.id, cityId)).limit(1)
        : Promise.resolve(null);
    const [existingZone, existingCity] = await Promise.all([zonePromise, cityPromise]);
    if (!existingZone[0]) {
        throw new NotFound_1.NotFound("Zone not found");
    }
    if (cityId && (!existingCity || !existingCity[0])) {
        throw new BadRequest_1.BadRequest("City not found");
    }
    const updateData = {
        updatedAt: new Date(),
    };
    if (name !== undefined)
        updateData.name = name;
    if (nameAr !== undefined)
        updateData.nameAr = nameAr;
    if (nameFr !== undefined)
        updateData.nameFr = nameFr;
    if (displayName !== undefined)
        updateData.displayName = displayName;
    if (displayNameAr !== undefined)
        updateData.displayNameAr = displayNameAr;
    if (displayNameFr !== undefined)
        updateData.displayNameFr = displayNameFr;
    if (status !== undefined)
        updateData.status = status;
    if (cityId !== undefined)
        updateData.cityId = cityId;
    if (coordinates !== undefined)
        updateData.coordinates = coordinates;
    if (coverageAreaRadiusKm !== undefined)
        updateData.coverageAreaRadiusKm = coverageAreaRadiusKm ? String(coverageAreaRadiusKm) : null;
    if (deliveryFee !== undefined)
        updateData.deliveryFee = String(deliveryFee);
    if (minOrderAmount !== undefined)
        updateData.minOrderAmount = String(minOrderAmount);
    await connection_1.db.update(schema_1.zones).set(updateData).where((0, drizzle_orm_1.eq)(schema_1.zones.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Update zone success" });
};
exports.updateZone = updateZone;
// =============================================
// DELETE ZONE
// =============================================
const deleteZone = async (req, res) => {
    const { id } = req.params;
    const existingZone = await connection_1.db
        .select()
        .from(schema_1.zones)
        .where((0, drizzle_orm_1.eq)(schema_1.zones.id, id))
        .limit(1);
    if (!existingZone[0]) {
        throw new NotFound_1.NotFound("Zone not found");
    }
    await connection_1.db.delete(schema_1.zones).where((0, drizzle_orm_1.eq)(schema_1.zones.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Delete zone success" });
};
exports.deleteZone = deleteZone;
// =============================================
// GET ALL CITIES
// =============================================
const getallcities = async (req, res) => {
    const allCities = await connection_1.db
        .select()
        .from(schema_1.cities)
        .where((0, drizzle_orm_1.eq)(schema_1.cities.status, "active"));
    return (0, response_1.SuccessResponse)(res, { message: "Get all active cities success", data: allCities });
};
exports.getallcities = getallcities;
