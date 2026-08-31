"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deletePlatform = exports.updatePlatform = exports.getPlatformById = exports.getAllPlatforms = exports.createPlatform = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const response_1 = require("../../utils/response");
const handleImages_1 = require("../../utils/handleImages");
const uuid_1 = require("uuid");
// 1. Create Platform
const createPlatform = async (req, res) => {
    const { name, logo } = req.body;
    if (!name || !logo) {
        throw new BadRequest_1.BadRequest("Platform name and logo are required");
    }
    // حفظ الصورة من Base64 والحصول على رابط الصورة المباشر
    const { url: iconUrl } = await (0, handleImages_1.saveBase64Image)(req, logo, "icons");
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.platforms).values({
        id,
        name,
        logo: iconUrl
    });
    const [newPlatform] = await connection_1.db.select().from(schema_1.platforms).where((0, drizzle_orm_1.eq)(schema_1.platforms.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Platform created successfully",
        data: newPlatform,
    }, 201);
};
exports.createPlatform = createPlatform;
// 2. Get All Platforms
const getAllPlatforms = async (_req, res) => {
    const allPlatforms = await connection_1.db.select().from(schema_1.platforms);
    return (0, response_1.SuccessResponse)(res, {
        message: "Platforms retrieved successfully",
        data: allPlatforms,
    });
};
exports.getAllPlatforms = getAllPlatforms;
// 3. Get Platform By ID
const getPlatformById = async (req, res) => {
    const { id } = req.params;
    const [platform] = await connection_1.db.select().from(schema_1.platforms).where((0, drizzle_orm_1.eq)(schema_1.platforms.id, id)).limit(1);
    if (!platform) {
        throw new NotFound_1.NotFound("Platform not found");
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Platform retrieved successfully",
        data: platform,
    });
};
exports.getPlatformById = getPlatformById;
// 4. Update Platform
const updatePlatform = async (req, res) => {
    const { id } = req.params;
    const { name, logo } = req.body;
    const [existing] = await connection_1.db.select().from(schema_1.platforms).where((0, drizzle_orm_1.eq)(schema_1.platforms.id, id)).limit(1);
    if (!existing) {
        throw new NotFound_1.NotFound("Platform not found");
    }
    let logoUrl = existing.logo;
    if (logo) {
        logoUrl = await (0, handleImages_1.handleImageUpdate)(req, existing.logo, logo, "icons");
    }
    await connection_1.db.update(schema_1.platforms)
        .set({
        ...(name && { name }),
        logo: logoUrl,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.platforms.id, id));
    const [updatedPlatform] = await connection_1.db.select().from(schema_1.platforms).where((0, drizzle_orm_1.eq)(schema_1.platforms.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Platform updated successfully",
        data: updatedPlatform,
    });
};
exports.updatePlatform = updatePlatform;
// 5. Delete Platform
const deletePlatform = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db.select().from(schema_1.platforms).where((0, drizzle_orm_1.eq)(schema_1.platforms.id, id)).limit(1);
    if (!existing) {
        throw new NotFound_1.NotFound("Platform not found");
    }
    if (existing.logo) {
        await (0, handleImages_1.deleteImage)(existing.logo);
    }
    await connection_1.db.delete(schema_1.platforms).where((0, drizzle_orm_1.eq)(schema_1.platforms.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Platform deleted successfully" });
};
exports.deletePlatform = deletePlatform;
