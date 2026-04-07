"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllCountries = exports.deleteCity = exports.updateCity = exports.getCityById = exports.getAllCities = exports.createCity = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const createCity = async (req, res) => {
    const { name, countryId } = req.body;
    if (!name || !countryId) {
        throw new BadRequest_1.BadRequest("City name and country ID are required");
    }
    // Check if country exists
    const existingCountry = await connection_1.db
        .select()
        .from(schema_1.countries)
        .where((0, drizzle_orm_1.eq)(schema_1.countries.id, countryId))
        .limit(1);
    if (!existingCountry[0]) {
        throw new BadRequest_1.BadRequest("Country not found");
    }
    // Check if city already exists in the same country
    const existingCity = await connection_1.db
        .select()
        .from(schema_1.cities)
        .where((0, drizzle_orm_1.eq)(schema_1.cities.name, name))
        .limit(1);
    if (existingCity[0]) {
        throw new BadRequest_1.BadRequest("City already exists");
    }
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.cities).values({
        id,
        name,
        countryId,
    });
    return (0, response_1.SuccessResponse)(res, { message: "Create city success", data: { id } }, 201);
};
exports.createCity = createCity;
const getAllCities = async (req, res) => {
    const allCities = await connection_1.db
        .select({
        id: schema_1.cities.id,
        name: schema_1.cities.name,
        status: schema_1.cities.status,
        countryId: schema_1.cities.countryId,
        createdAt: schema_1.cities.createdAt,
        updatedAt: schema_1.cities.updatedAt,
        country: {
            id: schema_1.countries.id,
            name: schema_1.countries.name,
            status: schema_1.countries.status,
        },
    })
        .from(schema_1.cities)
        .leftJoin(schema_1.countries, (0, drizzle_orm_1.eq)(schema_1.cities.countryId, schema_1.countries.id));
    return (0, response_1.SuccessResponse)(res, { message: "Get all cities success", data: allCities });
};
exports.getAllCities = getAllCities;
const getCityById = async (req, res) => {
    const { id } = req.params;
    const city = await connection_1.db
        .select({
        id: schema_1.cities.id,
        name: schema_1.cities.name,
        status: schema_1.cities.status,
        countryId: schema_1.cities.countryId,
        createdAt: schema_1.cities.createdAt,
        updatedAt: schema_1.cities.updatedAt,
        country: {
            id: schema_1.countries.id,
            name: schema_1.countries.name,
            status: schema_1.countries.status,
        },
    })
        .from(schema_1.cities)
        .leftJoin(schema_1.countries, (0, drizzle_orm_1.eq)(schema_1.cities.countryId, schema_1.countries.id))
        .where((0, drizzle_orm_1.eq)(schema_1.cities.id, id))
        .limit(1);
    if (!city[0]) {
        throw new NotFound_1.NotFound("City not found");
    }
    return (0, response_1.SuccessResponse)(res, { message: "Get city by id success", data: city[0] });
};
exports.getCityById = getCityById;
const updateCity = async (req, res) => {
    const { id } = req.params;
    const { name, status, countryId } = req.body;
    const existingCity = await connection_1.db
        .select()
        .from(schema_1.cities)
        .where((0, drizzle_orm_1.eq)(schema_1.cities.id, id))
        .limit(1);
    if (!existingCity[0]) {
        throw new NotFound_1.NotFound("City not found");
    }
    // Check if country exists if countryId is provided
    if (countryId) {
        const existingCountry = await connection_1.db
            .select()
            .from(schema_1.countries)
            .where((0, drizzle_orm_1.eq)(schema_1.countries.id, countryId))
            .limit(1);
        if (!existingCountry[0]) {
            throw new BadRequest_1.BadRequest("Country not found");
        }
    }
    const updateData = {
        updatedAt: new Date(),
    };
    if (name)
        updateData.name = name;
    if (status)
        updateData.status = status;
    if (countryId)
        updateData.countryId = countryId;
    if (Object.keys(updateData).length === 1) {
        throw new BadRequest_1.BadRequest("No data to update");
    }
    await connection_1.db.update(schema_1.cities).set(updateData).where((0, drizzle_orm_1.eq)(schema_1.cities.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Update city success" });
};
exports.updateCity = updateCity;
const deleteCity = async (req, res) => {
    const { id } = req.params;
    const existingCity = await connection_1.db
        .select()
        .from(schema_1.cities)
        .where((0, drizzle_orm_1.eq)(schema_1.cities.id, id))
        .limit(1);
    if (!existingCity[0]) {
        throw new NotFound_1.NotFound("City not found");
    }
    await connection_1.db.delete(schema_1.cities).where((0, drizzle_orm_1.eq)(schema_1.cities.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Delete city success" });
};
exports.deleteCity = deleteCity;
const getAllCountries = async (req, res) => {
    const allCountries = await connection_1.db
        .select()
        .from(schema_1.countries)
        .where((0, drizzle_orm_1.eq)(schema_1.countries.status, "active"));
    return (0, response_1.SuccessResponse)(res, { message: "Get all active countries success", data: allCountries });
};
exports.getAllCountries = getAllCountries;
