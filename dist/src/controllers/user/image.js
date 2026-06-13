"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getImages = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const Errors_1 = require("../../Errors");
const response_1 = require("../../utils/response");
const getImages = async (req, res) => {
    const { resId } = req.params;
    if (!resId) {
        throw new Errors_1.NotFound("restaurant id");
    }
    const data = await connection_1.db
        .select()
        .from(schema_1.images)
        .where((0, drizzle_orm_1.eq)(schema_1.images.restaurantid, resId));
    return (0, response_1.SuccessResponse)(res, { data });
};
exports.getImages = getImages;
