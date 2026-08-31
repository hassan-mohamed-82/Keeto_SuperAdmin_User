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
        .select({
        id: schema_1.socialmedia.id,
        restaurantid: schema_1.socialmedia.restaurantid,
        platformId: schema_1.socialmedia.platformId,
        link: schema_1.socialmedia.link,
        icon: schema_1.platforms.logo,
        name: schema_1.platforms.name,
        createdAt: schema_1.socialmedia.createdAt,
        updatedAt: schema_1.socialmedia.updatedAt,
    })
        .from(schema_1.socialmedia)
        .innerJoin(schema_1.platforms, (0, drizzle_orm_1.eq)(schema_1.socialmedia.platformId, schema_1.platforms.id))
        .where((0, drizzle_orm_1.eq)(schema_1.socialmedia.restaurantid, resId));
    return (0, response_1.SuccessResponse)(res, { data });
};
exports.getSocialMedia = getSocialMedia;
