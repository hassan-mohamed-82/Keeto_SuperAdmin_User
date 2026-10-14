"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteZone = exports.updateZone = exports.getZoneById = exports.getZones = exports.createZone = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const catchAsync_1 = require("../../utils/catchAsync");
const turf = __importStar(require("@turf/turf"));
const uuid_1 = require("uuid");
// Helper: normalize and close coordinates ring
function normalizePolygonCoordinates(rawCoords) {
    if (!rawCoords || rawCoords.length < 3) {
        throw new Errors_1.BadRequest("A zone must have at least 3 coordinates");
    }
    const first = rawCoords[0];
    const last = rawCoords[rawCoords.length - 1];
    const isClosed = Math.abs(first.lat - last.lat) < 0.000001 && Math.abs(first.lng - last.lng) < 0.000001;
    const ring = [...rawCoords];
    if (!isClosed) {
        ring.push({ ...first });
    }
    // Check validity using turf polygon: turf expects [lng, lat]
    try {
        const turfCoords = ring.map((pt) => [pt.lng, pt.lat]);
        const poly = turf.polygon([turfCoords]);
        const kinks = turf.kinks(poly);
        if (kinks.features.length > 0) {
            throw new Errors_1.BadRequest("Polygon has self-intersecting edges (kinks). Please provide a valid boundary.");
        }
    }
    catch (err) {
        if (err instanceof Errors_1.BadRequest)
            throw err;
        throw new Errors_1.BadRequest(`Invalid polygon structure: ${err.message}`);
    }
    return ring;
}
// =========================================================================
// 1. Create Zone
// =========================================================================
exports.createZone = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const { name, nameAr, coordinates, coverageAreaRadiusKm, deliveryFee, minOrderAmount, status } = req.body;
    const normalizedCoordinates = normalizePolygonCoordinates(coordinates);
    const newId = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.shippingZones).values({
        id: newId,
        shippingCompanyId: companyId,
        name,
        nameAr,
        coordinates: normalizedCoordinates,
        coverageAreaRadiusKm: coverageAreaRadiusKm ? String(coverageAreaRadiusKm) : undefined,
        deliveryFee: deliveryFee ? String(deliveryFee) : "0.00",
        minOrderAmount: minOrderAmount ? String(minOrderAmount) : "0.00",
        status: status || "active",
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping zone created successfully",
        data: {
            id: newId,
            shippingCompanyId: companyId,
            name,
            nameAr,
            coordinates: normalizedCoordinates,
            coverageAreaRadiusKm: coverageAreaRadiusKm ? String(coverageAreaRadiusKm) : undefined,
            deliveryFee: deliveryFee ? String(deliveryFee) : "0.00",
            minOrderAmount: minOrderAmount ? String(minOrderAmount) : "0.00",
            status: status || "active",
        }
    }, 201);
});
// =========================================================================
// 2. Get Zones
// =========================================================================
exports.getZones = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const zones = await connection_1.db
        .select()
        .from(schema_1.shippingZones)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingZones.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.shippingZones.status, "active")));
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping zones retrieved successfully",
        data: zones,
    });
});
// =========================================================================
// 3. Get Zone By ID
// =========================================================================
exports.getZoneById = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const [zone] = await connection_1.db
        .select()
        .from(schema_1.shippingZones)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingZones.id, id), (0, drizzle_orm_1.eq)(schema_1.shippingZones.shippingCompanyId, companyId)))
        .limit(1);
    if (!zone) {
        throw new Errors_1.NotFound("Shipping zone not found");
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping zone retrieved successfully",
        data: zone,
    });
});
// =========================================================================
// 4. Update Zone
// =========================================================================
exports.updateZone = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const [zone] = await connection_1.db
        .select({ id: schema_1.shippingZones.id })
        .from(schema_1.shippingZones)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingZones.id, id), (0, drizzle_orm_1.eq)(schema_1.shippingZones.shippingCompanyId, companyId)))
        .limit(1);
    if (!zone) {
        throw new Errors_1.NotFound("Shipping zone not found");
    }
    const { name, nameAr, coordinates, coverageAreaRadiusKm, deliveryFee, minOrderAmount, status } = req.body;
    const updateData = {};
    if (name !== undefined)
        updateData.name = name;
    if (nameAr !== undefined)
        updateData.nameAr = nameAr;
    if (coordinates !== undefined) {
        updateData.coordinates = normalizePolygonCoordinates(coordinates);
    }
    if (coverageAreaRadiusKm !== undefined)
        updateData.coverageAreaRadiusKm = String(coverageAreaRadiusKm);
    if (deliveryFee !== undefined)
        updateData.deliveryFee = String(deliveryFee);
    if (minOrderAmount !== undefined)
        updateData.minOrderAmount = String(minOrderAmount);
    if (status !== undefined)
        updateData.status = status;
    await connection_1.db
        .update(schema_1.shippingZones)
        .set(updateData)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingZones.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping zone updated successfully",
    });
});
// =========================================================================
// 5. Delete Zone (Soft Delete per Phase 4: status = 'inactive')
// =========================================================================
exports.deleteZone = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const [zone] = await connection_1.db
        .select({ id: schema_1.shippingZones.id })
        .from(schema_1.shippingZones)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingZones.id, id), (0, drizzle_orm_1.eq)(schema_1.shippingZones.shippingCompanyId, companyId)))
        .limit(1);
    if (!zone) {
        throw new Errors_1.NotFound("Shipping zone not found");
    }
    // Soft delete
    await connection_1.db
        .update(schema_1.shippingZones)
        .set({ status: "inactive" })
        .where((0, drizzle_orm_1.eq)(schema_1.shippingZones.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping zone deactivated successfully",
    });
});
