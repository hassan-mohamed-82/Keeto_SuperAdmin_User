"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRestaurantSettings = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const getRestaurantSettings = async (req, res) => {
    const { restaurantId } = req.params;
    const [settings] = await connection_1.db.select({
        firstColor: schema_1.restaurantSettings.firstColor,
        secondColor: schema_1.restaurantSettings.secondColor,
    })
        .from(schema_1.restaurantSettings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId))
        .limit(1);
    if (!settings) {
        throw new NotFound_1.NotFound("Restaurant settings not found");
    }
    (0, response_1.SuccessResponse)(res, { message: "Restaurant settings fetched successfully", data: settings });
};
exports.getRestaurantSettings = getRestaurantSettings;
