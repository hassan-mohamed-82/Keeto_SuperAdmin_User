"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createZone = createZone;
exports.getZones = getZones;
exports.getZoneById = getZoneById;
exports.updateZone = updateZone;
exports.deleteZone = deleteZone;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
async function createZone(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const { name, nameAr, coordinates, coverageAreaRadiusKm, deliveryFee, minOrderAmount, status } = req.body;
    const [insertResult] = await connection_1.db.insert(schema_1.shippingCompanyZones).values({
        shippingCompanyId: companyId,
        name,
        nameAr,
        coordinates,
        coverageAreaRadiusKm: coverageAreaRadiusKm ? String(coverageAreaRadiusKm) : undefined,
        deliveryFee: deliveryFee ? String(deliveryFee) : "0.00",
        minOrderAmount: minOrderAmount ? String(minOrderAmount) : "0.00",
        status: status || "active",
    });
    const newZone = await connection_1.db
        .select()
        .from(schema_1.shippingCompanyZones)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyZones.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyZones.name, name)))
        .orderBy(schema_1.shippingCompanyZones.createdAt)
        .limit(1);
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping zone created successfully",
        data: newZone[0],
    }, 201);
}
async function getZones(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const zones = await connection_1.db
        .select()
        .from(schema_1.shippingCompanyZones)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyZones.shippingCompanyId, companyId));
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping zones retrieved successfully",
        data: zones,
    });
}
async function getZoneById(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const zone = await connection_1.db
        .select()
        .from(schema_1.shippingCompanyZones)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyZones.id, id), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyZones.shippingCompanyId, companyId)))
        .limit(1);
    if (zone.length === 0) {
        throw new Errors_1.NotFound("Shipping zone not found");
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping zone retrieved successfully",
        data: zone[0],
    });
}
async function updateZone(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const zone = await connection_1.db
        .select({ id: schema_1.shippingCompanyZones.id })
        .from(schema_1.shippingCompanyZones)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyZones.id, id), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyZones.shippingCompanyId, companyId)))
        .limit(1);
    if (zone.length === 0) {
        throw new Errors_1.NotFound("Shipping zone not found");
    }
    const { name, nameAr, coordinates, coverageAreaRadiusKm, deliveryFee, minOrderAmount, status } = req.body;
    const updateData = {};
    if (name !== undefined)
        updateData.name = name;
    if (nameAr !== undefined)
        updateData.nameAr = nameAr;
    if (coordinates !== undefined)
        updateData.coordinates = coordinates;
    if (coverageAreaRadiusKm !== undefined)
        updateData.coverageAreaRadiusKm = String(coverageAreaRadiusKm);
    if (deliveryFee !== undefined)
        updateData.deliveryFee = String(deliveryFee);
    if (minOrderAmount !== undefined)
        updateData.minOrderAmount = String(minOrderAmount);
    if (status !== undefined)
        updateData.status = status;
    await connection_1.db
        .update(schema_1.shippingCompanyZones)
        .set(updateData)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyZones.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping zone updated successfully",
    });
}
async function deleteZone(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const zone = await connection_1.db
        .select({ id: schema_1.shippingCompanyZones.id })
        .from(schema_1.shippingCompanyZones)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyZones.id, id), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyZones.shippingCompanyId, companyId)))
        .limit(1);
    if (zone.length === 0) {
        throw new Errors_1.NotFound("Shipping zone not found");
    }
    await connection_1.db.delete(schema_1.shippingCompanyZones).where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyZones.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping zone deleted successfully",
    });
}
