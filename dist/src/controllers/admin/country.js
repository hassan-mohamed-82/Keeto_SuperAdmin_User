"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCountry = exports.updateCountry = exports.getCountryById = exports.getAllCountries = exports.createCountry = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const createCountry = async (req, res) => {
    const { name } = req.body;
    if (!name) {
        throw new BadRequest_1.BadRequest("Country name is required");
    }
    const existingCountry = await connection_1.db
        .select()
        .from(schema_1.countries)
        .where((0, drizzle_orm_1.eq)(schema_1.countries.name, name))
        .limit(1);
    if (existingCountry[0]) {
        throw new BadRequest_1.BadRequest("Country already exists");
    }
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.countries).values({
        id,
        name,
    });
    return (0, response_1.SuccessResponse)(res, { message: "Create country success", data: { id } }, 201);
};
exports.createCountry = createCountry;
const getAllCountries = async (req, res) => {
    const allCountries = await connection_1.db.select().from(schema_1.countries);
    return (0, response_1.SuccessResponse)(res, { message: "Get all countries success", data: allCountries });
};
exports.getAllCountries = getAllCountries;
const getCountryById = async (req, res) => {
    const { id } = req.params;
    const country = await connection_1.db
        .select()
        .from(schema_1.countries)
        .where((0, drizzle_orm_1.eq)(schema_1.countries.id, id))
        .limit(1);
    if (!country[0]) {
        throw new NotFound_1.NotFound("Country not found");
    }
    return (0, response_1.SuccessResponse)(res, { message: "Get country by id success", data: country[0] });
};
exports.getCountryById = getCountryById;
const updateCountry = async (req, res) => {
    const { id } = req.params;
    const { name, status } = req.body;
    const existingCountry = await connection_1.db
        .select()
        .from(schema_1.countries)
        .where((0, drizzle_orm_1.eq)(schema_1.countries.id, id))
        .limit(1);
    if (!existingCountry[0]) {
        throw new NotFound_1.NotFound("Country not found");
    }
    const updateData = {
        updatedAt: new Date(),
    };
    if (name)
        updateData.name = name;
    if (status)
        updateData.status = status;
    if (Object.keys(updateData).length === 1) {
        throw new BadRequest_1.BadRequest("No data to update");
    }
    await connection_1.db.update(schema_1.countries).set(updateData).where((0, drizzle_orm_1.eq)(schema_1.countries.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Update country success" });
};
exports.updateCountry = updateCountry;
const deleteCountry = async (req, res) => {
    const { id } = req.params;
    const existingCountry = await connection_1.db
        .select()
        .from(schema_1.countries)
        .where((0, drizzle_orm_1.eq)(schema_1.countries.id, id))
        .limit(1);
    if (!existingCountry[0]) {
        throw new NotFound_1.NotFound("Country not found");
    }
    await connection_1.db.delete(schema_1.countries).where((0, drizzle_orm_1.eq)(schema_1.countries.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Delete country success" });
};
exports.deleteCountry = deleteCountry;
