"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSocialMedia = void 0;
const schema_1 = require("../../models/schema");
const connection_1 = require("../../models/connection");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const getSocialMedia = async (req, res) => {
    const { resId } = req.params;
    if (!resId) {
        throw new Errors_1.NotFound("restaurant id");
    }
    const data = await connection_1.db
        .select()
        .from(schema_1.socialmedia)
        .where((0, drizzle_orm_1.eq)(schema_1.socialmedia.restaurantid, resId));
    return (0, response_1.SuccessResponse)(res, { data });
};
exports.getSocialMedia = getSocialMedia;
