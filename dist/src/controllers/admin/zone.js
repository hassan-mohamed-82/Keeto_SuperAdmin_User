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
const createZone = async (req, res) => {
    const { name, displayName, cityId, lat, lng } = req.body;
    if (!name || !displayName || !cityId || !lat || !lng) {
        throw new BadRequest_1.BadRequest("Name, displayName, cityId, lat, and lng are required");
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
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.zones.name, name), (0, drizzle_orm_1.eq)(schema_1.zones.cityId, cityId), (0, drizzle_orm_1.eq)(schema_1.zones.status, "active"), (0, drizzle_orm_1.eq)(schema_1.zones.lat, lat), (0, drizzle_orm_1.eq)(schema_1.zones.lng, lng)))
        .limit(1);
    if (existingZone[0]) {
        throw new BadRequest_1.BadRequest("Zone already exists in this city");
    }
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.zones).values({
        id,
        name,
        displayName,
        lat,
        lng,
        status: "active",
        cityId,
    });
    return (0, response_1.SuccessResponse)(res, { message: "Create zone success", data: { id } }, 201);
};
exports.createZone = createZone;
const getAllZones = async (req, res) => {
    const allZones = await connection_1.db
        .select({
        id: schema_1.zones.id,
        name: schema_1.zones.name,
        displayName: schema_1.zones.displayName,
        status: schema_1.zones.status,
        lat: schema_1.zones.lat,
        lng: schema_1.zones.lng,
        cityId: schema_1.zones.cityId,
        createdAt: schema_1.zones.createdAt,
        updatedAt: schema_1.zones.updatedAt,
        city: {
            id: schema_1.cities.id,
            name: schema_1.cities.name,
            status: schema_1.cities.status,
        },
    })
        .from(schema_1.zones)
        .leftJoin(schema_1.cities, (0, drizzle_orm_1.eq)(schema_1.zones.cityId, schema_1.cities.id));
    return (0, response_1.SuccessResponse)(res, { message: "Get all zones success", data: allZones });
};
exports.getAllZones = getAllZones;
const getZoneById = async (req, res) => {
    const { id } = req.params;
    const zone = await connection_1.db
        .select({
        id: schema_1.zones.id,
        name: schema_1.zones.name,
        displayName: schema_1.zones.displayName,
        status: schema_1.zones.status,
        lat: schema_1.zones.lat,
        lng: schema_1.zones.lng,
        cityId: schema_1.zones.cityId,
        createdAt: schema_1.zones.createdAt,
        updatedAt: schema_1.zones.updatedAt,
        city: {
            id: schema_1.cities.id,
            name: schema_1.cities.name,
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
const updateZone = async (req, res) => {
    const { id } = req.params;
    const { name, displayName, status, cityId } = req.body;
    const existingZone = await connection_1.db
        .select()
        .from(schema_1.zones)
        .where((0, drizzle_orm_1.eq)(schema_1.zones.id, id))
        .limit(1);
    if (!existingZone[0]) {
        throw new NotFound_1.NotFound("Zone not found");
    }
    if (cityId) {
        const existingCity = await connection_1.db
            .select()
            .from(schema_1.cities)
            .where((0, drizzle_orm_1.eq)(schema_1.cities.id, cityId))
            .limit(1);
        if (!existingCity[0]) {
            throw new BadRequest_1.BadRequest("City not found");
        }
    }
    const updateData = {
        updatedAt: new Date(),
    };
    if (name)
        updateData.name = name;
    if (displayName)
        updateData.displayName = displayName;
    if (status)
        updateData.status = status;
    if (cityId)
        updateData.cityId = cityId;
    if (Object.keys(updateData).length === 1) {
        throw new BadRequest_1.BadRequest("No data to update");
    }
    await connection_1.db.update(schema_1.zones).set(updateData).where((0, drizzle_orm_1.eq)(schema_1.zones.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Update zone success" });
};
exports.updateZone = updateZone;
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
const getallcities = async (req, res) => {
    const allCities = await connection_1.db
        .select()
        .from(schema_1.cities)
        .where((0, drizzle_orm_1.eq)(schema_1.cities.status, "active"));
    return (0, response_1.SuccessResponse)(res, { message: "Get all active cities success", data: allCities });
};
exports.getallcities = getallcities;
