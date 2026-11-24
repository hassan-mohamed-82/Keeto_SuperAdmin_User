"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRestaurantSettings = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
/**
 * Safely parses a value that may already be an object or a raw JSON string.
 * MySQL json columns can sometimes be returned as strings by the driver.
 */
function parseJsonField(value, fallback) {
    if (value === null || value === undefined)
        return fallback;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        }
        catch {
            return fallback;
        }
    }
    return value;
}
const getRestaurantSettings = async (req, res) => {
    const { restaurantId } = req.params;
    const [settings] = await connection_1.db.select({
        firstColor: schema_1.restaurantSettings.firstColor,
        secondColor: schema_1.restaurantSettings.secondColor,
        firstTextColor: schema_1.restaurantSettings.firstTextColor,
        secondTextColor: schema_1.restaurantSettings.secondTextColor,
        productView: schema_1.restaurantSettings.productView,
        isTemporarilyClosed: schema_1.restaurantSettings.isTemporarilyClosed,
        instantOrder: schema_1.restaurantSettings.instantOrder,
        orderNowSetting: schema_1.restaurantSettings.orderNowSetting,
    })
        .from(schema_1.restaurantSettings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId))
        .limit(1);
    if (!settings) {
        throw new NotFound_1.NotFound("Restaurant settings not found");
    }
    // Parse orderNowSetting — MySQL may return JSON columns as raw strings
    const parsedOrderNowSetting = parseJsonField(settings.orderNowSetting, schema_1.defaultOrderNowSetting);
    const responseData = {
        restaurantId,
        firstColor: settings.firstColor,
        secondColor: settings.secondColor,
        firstTextColor: settings.firstTextColor,
        secondTextColor: settings.secondTextColor,
        productView: settings.productView,
        isTemporarilyClosed: settings.isTemporarilyClosed,
        instantOrder: settings.instantOrder,
        orderNowSetting: { ...schema_1.defaultOrderNowSetting, ...parsedOrderNowSetting },
    };
    (0, response_1.SuccessResponse)(res, { message: "Restaurant settings fetched successfully", data: responseData });
};
exports.getRestaurantSettings = getRestaurantSettings;
