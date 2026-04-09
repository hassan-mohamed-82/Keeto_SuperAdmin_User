"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateBasiccampaignStatus = exports.deleteBasiccampaign = exports.updateBasiccampaign = exports.getBasiccampaignById = exports.getAllBasiccampaigns = exports.createBasiccampaign = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const createBasiccampaign = async (req, res) => {
    const { Title, description, image, status, startDate, endDate, dailystarttime, dailyendtime } = req.body;
    if (!Title || !startDate || !endDate || !dailystarttime || !dailyendtime) {
        throw new BadRequest_1.BadRequest("Title, startDate, endDate, dailystarttime, and dailyendtime are required");
    }
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.basiccampaign).values({
        id,
        Title,
        description: description || null,
        image: image || null,
        status: status || "active",
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        dailystarttime,
        dailyendtime,
    });
    return (0, response_1.SuccessResponse)(res, { message: "Create basic campaign success", data: { id } }, 201);
};
exports.createBasiccampaign = createBasiccampaign;
const getAllBasiccampaigns = async (req, res) => {
    const allCampaigns = await connection_1.db
        .select({
        id: schema_1.basiccampaign.id,
        Title: schema_1.basiccampaign.Title,
        description: schema_1.basiccampaign.description,
        image: schema_1.basiccampaign.image,
        status: schema_1.basiccampaign.status,
        startDate: schema_1.basiccampaign.startDate,
        endDate: schema_1.basiccampaign.endDate,
        dailystarttime: schema_1.basiccampaign.dailystarttime,
        dailyendtime: schema_1.basiccampaign.dailyendtime,
        createdAt: schema_1.basiccampaign.createdAt,
        updatedAt: schema_1.basiccampaign.updatedAt,
    })
        .from(schema_1.basiccampaign);
    return (0, response_1.SuccessResponse)(res, { message: "Get all basic campaigns success", data: allCampaigns });
};
exports.getAllBasiccampaigns = getAllBasiccampaigns;
const getBasiccampaignById = async (req, res) => {
    const { id } = req.params;
    const campaign = await connection_1.db
        .select({
        id: schema_1.basiccampaign.id,
        Title: schema_1.basiccampaign.Title,
        description: schema_1.basiccampaign.description,
        image: schema_1.basiccampaign.image,
        status: schema_1.basiccampaign.status,
        startDate: schema_1.basiccampaign.startDate,
        endDate: schema_1.basiccampaign.endDate,
        dailystarttime: schema_1.basiccampaign.dailystarttime,
        dailyendtime: schema_1.basiccampaign.dailyendtime,
        createdAt: schema_1.basiccampaign.createdAt,
        updatedAt: schema_1.basiccampaign.updatedAt,
    })
        .from(schema_1.basiccampaign)
        .where((0, drizzle_orm_1.eq)(schema_1.basiccampaign.id, id))
        .limit(1);
    if (!campaign[0]) {
        throw new NotFound_1.NotFound("Basic campaign not found");
    }
    return (0, response_1.SuccessResponse)(res, { message: "Get basic campaign by id success", data: campaign[0] });
};
exports.getBasiccampaignById = getBasiccampaignById;
const updateBasiccampaign = async (req, res) => {
    const { id } = req.params;
    const { Title, description, image, status, startDate, endDate, dailystarttime, dailyendtime } = req.body;
    const existingCampaign = await connection_1.db
        .select()
        .from(schema_1.basiccampaign)
        .where((0, drizzle_orm_1.eq)(schema_1.basiccampaign.id, id))
        .limit(1);
    if (!existingCampaign[0]) {
        throw new NotFound_1.NotFound("Basic campaign not found");
    }
    const updateData = {
        updatedAt: new Date(),
    };
    if (Title)
        updateData.Title = Title;
    if (description !== undefined)
        updateData.description = description;
    if (image !== undefined)
        updateData.image = image;
    if (status)
        updateData.status = status;
    if (startDate)
        updateData.startDate = new Date(startDate);
    if (endDate)
        updateData.endDate = new Date(endDate);
    if (dailystarttime)
        updateData.dailystarttime = dailystarttime;
    if (dailyendtime)
        updateData.dailyendtime = dailyendtime;
    if (Object.keys(updateData).length === 1) {
        throw new BadRequest_1.BadRequest("No data to update");
    }
    await connection_1.db.update(schema_1.basiccampaign).set(updateData).where((0, drizzle_orm_1.eq)(schema_1.basiccampaign.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Update basic campaign success" });
};
exports.updateBasiccampaign = updateBasiccampaign;
const deleteBasiccampaign = async (req, res) => {
    const { id } = req.params;
    const existingCampaign = await connection_1.db
        .select()
        .from(schema_1.basiccampaign)
        .where((0, drizzle_orm_1.eq)(schema_1.basiccampaign.id, id))
        .limit(1);
    if (!existingCampaign[0]) {
        throw new NotFound_1.NotFound("Basic campaign not found");
    }
    await connection_1.db.delete(schema_1.basiccampaign).where((0, drizzle_orm_1.eq)(schema_1.basiccampaign.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Delete basic campaign success" });
};
exports.deleteBasiccampaign = deleteBasiccampaign;
const updateBasiccampaignStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const existingCampaign = await connection_1.db
        .select()
        .from(schema_1.basiccampaign)
        .where((0, drizzle_orm_1.eq)(schema_1.basiccampaign.id, id))
        .limit(1);
    if (!existingCampaign[0]) {
        throw new NotFound_1.NotFound("Basic campaign not found");
    }
    await connection_1.db.update(schema_1.basiccampaign).set({ status }).where((0, drizzle_orm_1.eq)(schema_1.basiccampaign.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Update basic campaign status success" });
};
exports.updateBasiccampaignStatus = updateBasiccampaignStatus;
