"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateImage = exports.getImageById = exports.deleteImage = exports.getAllImages = exports.createImage = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const handleImages_1 = require("../../utils/handleImages");
const createImage = async (req, res) => {
    const { img } = req.body;
    const result = await (0, handleImages_1.saveBase64Image)(req, img, "images");
    if (!result.url) {
        throw new BadRequest_1.BadRequest("Image is required.");
    }
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.images).values({
        id,
        img: result.url,
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Image created successfully",
        data: {
            id,
            img: result.url
        }
    }, 201);
};
exports.createImage = createImage;
const getAllImages = async (req, res) => {
    const image = await connection_1.db.select().from(schema_1.images);
    return (0, response_1.SuccessResponse)(res, {
        message: "Images fetched successfully",
        data: image,
    }, 200);
};
exports.getAllImages = getAllImages;
const deleteImage = async (req, res) => {
    const { id } = req.params;
    await connection_1.db.delete(schema_1.images).where((0, drizzle_orm_1.eq)(schema_1.images.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Image deleted successfully",
    }, 200);
};
exports.deleteImage = deleteImage;
const getImageById = async (req, res) => {
    const { id } = req.params;
    const image = await connection_1.db.select().from(schema_1.images).where((0, drizzle_orm_1.eq)(schema_1.images.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Image fetched successfully",
        data: image[0],
    }, 200);
};
exports.getImageById = getImageById;
const updateImage = async (req, res) => {
    const { id } = req.params;
    const { img } = req.body;
    const image = await connection_1.db.select().from(schema_1.images).where((0, drizzle_orm_1.eq)(schema_1.images.id, id));
    if (!image[0]) {
        throw new NotFound_1.NotFound("Image not found");
    }
    const updatedUrl = await (0, handleImages_1.handleImageUpdate)(req, image[0].img, img, "images");
    if (!updatedUrl) {
        throw new BadRequest_1.BadRequest("Image is required.");
    }
    await connection_1.db.update(schema_1.images).set({
        img: updatedUrl,
    }).where((0, drizzle_orm_1.eq)(schema_1.images.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Image updated successfully",
        data: updatedUrl,
    }, 200);
};
exports.updateImage = updateImage;
