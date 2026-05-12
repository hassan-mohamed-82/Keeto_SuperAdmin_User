"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateZoneDeliveryFeeSchema = exports.createZoneDeliveryFeeSchema = void 0;
const zod_1 = require("zod");
exports.createZoneDeliveryFeeSchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID"),
    zoneId: zod_1.z.string().uuid("Invalid Zone ID"),
    deliveryFee: zod_1.z.coerce.string({
        required_error: "Delivery fee is required",
        invalid_type_error: "Delivery fee must be a valid number",
    }).min(1, "Delivery fee cannot be empty"),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
exports.updateZoneDeliveryFeeSchema = exports.createZoneDeliveryFeeSchema.partial();
