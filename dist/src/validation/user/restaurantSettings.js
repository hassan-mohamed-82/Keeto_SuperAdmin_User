"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRestaurantSettingsParamsSchema = void 0;
const zod_1 = require("zod");
exports.getRestaurantSettingsParamsSchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID"),
});
