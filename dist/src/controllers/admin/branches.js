"use strict";
// controllers/branch.controller.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.getallrestraunt = exports.updateBranchStatus = exports.deleteBranch = exports.updateBranch = exports.getBranchById = exports.getMyBranches = exports.createBranch = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const uuid_1 = require("uuid");
const createBranch = async (req, res) => {
    const { restaurantId, name, address, phoneNumber, zoneId, nameAr, nameFr, addressAr, addressFr, deliveryRadiusKm, lat, lng } = req.body;
    if (!name || !address || !zoneId) {
        throw new BadRequest_1.BadRequest("Missing required fields (name, address, zoneId)");
    }
    // التأكد إن منطقة التوصيل دي موجودة
    const zoneExists = await connection_1.db.select().from(schema_1.zones).where((0, drizzle_orm_1.eq)(schema_1.zones.id, zoneId)).limit(1);
    if (!zoneExists[0])
        throw new BadRequest_1.BadRequest("Zone not found");
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.branches).values({
        id,
        restaurantId,
        name,
        nameAr,
        nameFr,
        address,
        addressAr,
        addressFr,
        deliveryRadiusKm,
        lat,
        lng,
        phoneNumber: phoneNumber || null,
        zoneId,
        status: "active"
    });
    return (0, response_1.SuccessResponse)(res, { message: "Branch created successfully", data: { id } }, 201);
};
exports.createBranch = createBranch;
const getMyBranches = async (req, res) => {
    const myBranches = await connection_1.db.select({
        id: schema_1.branches.id,
        name: schema_1.branches.name,
        nameAr: schema_1.branches.nameAr,
        nameFr: schema_1.branches.nameFr,
        address: schema_1.branches.address,
        addressAr: schema_1.branches.addressAr,
        addressFr: schema_1.branches.addressFr,
        deliveryRadiusKm: schema_1.branches.deliveryRadiusKm,
        lat: schema_1.branches.lat,
        lng: schema_1.branches.lng,
        phoneNumber: schema_1.branches.phoneNumber,
        status: schema_1.branches.status,
        zone: {
            id: schema_1.zones.id,
            name: schema_1.zones.name,
            nameAr: schema_1.zones.nameAr,
            nameFr: schema_1.zones.nameFr,
        },
        restaurantName: schema_1.restaurants.name,
    })
        .from(schema_1.branches)
        .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.branches.zoneId, schema_1.zones.id))
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, schema_1.restaurants.id));
    return (0, response_1.SuccessResponse)(res, { message: "Get branches success", data: myBranches });
};
exports.getMyBranches = getMyBranches;
const getBranchById = async (req, res) => {
    const { id } = req.params;
    const branch = await connection_1.db.select({
        id: schema_1.branches.id,
        name: schema_1.branches.name,
        nameAr: schema_1.branches.nameAr,
        nameFr: schema_1.branches.nameFr,
        address: schema_1.branches.address,
        addressAr: schema_1.branches.addressAr,
        addressFr: schema_1.branches.addressFr,
        deliveryRadiusKm: schema_1.branches.deliveryRadiusKm,
        lat: schema_1.branches.lat,
        lng: schema_1.branches.lng,
        phoneNumber: schema_1.branches.phoneNumber,
        status: schema_1.branches.status,
        zone: {
            id: schema_1.zones.id,
            name: schema_1.zones.name,
            nameAr: schema_1.zones.nameAr,
            nameFr: schema_1.zones.nameFr,
        },
        restaurantName: schema_1.restaurants.name,
    })
        .from(schema_1.branches)
        .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.branches.zoneId, schema_1.zones.id))
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.eq)(schema_1.branches.id, id))
        .limit(1);
    return (0, response_1.SuccessResponse)(res, { message: "Get branch by id success", data: branch[0] });
};
exports.getBranchById = getBranchById;
const updateBranch = async (req, res) => {
    const { id } = req.params;
    const { restaurantId, name, address, phoneNumber, zoneId, status, nameAr, nameFr, addressAr, addressFr, deliveryRadiusKm, lat, lng } = req.body;
    const existingBranch = await connection_1.db
        .select()
        .from(schema_1.branches)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.id, id), (0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId)))
        .limit(1);
    if (!existingBranch[0])
        throw new NotFound_1.NotFound("Branch not found or you don't have permission to edit it");
    const updateData = {};
    if (name)
        updateData.name = name;
    if (nameAr !== undefined)
        updateData.nameAr = nameAr;
    if (nameFr !== undefined)
        updateData.nameFr = nameFr;
    if (address)
        updateData.address = address;
    if (addressAr !== undefined)
        updateData.addressAr = addressAr;
    if (addressFr !== undefined)
        updateData.addressFr = addressFr;
    if (phoneNumber)
        updateData.phoneNumber = phoneNumber;
    if (deliveryRadiusKm)
        updateData.deliveryRadiusKm = deliveryRadiusKm;
    if (restaurantId)
        updateData.restaurantId = restaurantId;
    if (lat)
        updateData.lat = lat;
    if (lng)
        updateData.lng = lng;
    if (zoneId) {
        const zoneExists = await connection_1.db.select().from(schema_1.zones).where((0, drizzle_orm_1.eq)(schema_1.zones.id, zoneId)).limit(1);
        if (!zoneExists[0])
            throw new BadRequest_1.BadRequest("Zone not found");
        updateData.zoneId = zoneId;
    }
    if (status)
        updateData.status = status;
    await connection_1.db
        .update(schema_1.branches)
        .set(updateData)
        .where((0, drizzle_orm_1.eq)(schema_1.branches.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Branch updated successfully" });
};
exports.updateBranch = updateBranch;
const deleteBranch = async (req, res) => {
    const { id, restaurantId } = req.params;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Restaurant ID missing");
    const existingBranch = await connection_1.db
        .select()
        .from(schema_1.branches)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.id, id), (0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId)))
        .limit(1);
    if (!existingBranch[0])
        throw new NotFound_1.NotFound("Branch not found or you don't have permission to delete it");
    await connection_1.db.delete(schema_1.branches).where((0, drizzle_orm_1.eq)(schema_1.branches.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Branch deleted successfully" });
};
exports.deleteBranch = deleteBranch;
const updateBranchStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Restaurant ID missing");
    const existingBranch = await connection_1.db
        .select()
        .from(schema_1.branches)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.id, id), (0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId)))
        .limit(1);
    if (!existingBranch[0])
        throw new NotFound_1.NotFound("Branch not found or you don't have permission to edit it");
    await connection_1.db
        .update(schema_1.branches)
        .set({ status })
        .where((0, drizzle_orm_1.eq)(schema_1.branches.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Branch status updated successfully" });
};
exports.updateBranchStatus = updateBranchStatus;
const getallrestraunt = async (req, res) => {
    const restaurant = await connection_1.db.select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        nameAr: schema_1.restaurants.nameAr,
        nameFr: schema_1.restaurants.nameFr
    }).from(schema_1.restaurants);
    return (0, response_1.SuccessResponse)(res, { message: "Get restaurants success", data: restaurant });
};
exports.getallrestraunt = getallrestraunt;
