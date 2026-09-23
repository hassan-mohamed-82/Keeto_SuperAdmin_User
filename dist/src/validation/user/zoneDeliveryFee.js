"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getZoneDeliveryFeeSchema = void 0;
const zod_1 = require("zod");
// ============================================================
// Schema: Get Zone & Delivery Fee for a given lat/lng
// ============================================================
exports.getZoneDeliveryFeeSchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid({ message: "restaurantId must be a valid UUID" }),
    lat: zod_1.z.number({ required_error: "lat is required", invalid_type_error: "lat must be a number" }),
    lng: zod_1.z.number({ required_error: "lng is required", invalid_type_error: "lng must be a number" }),
    branchId: zod_1.z.string().uuid({ message: "branchId must be a valid UUID" }).optional(),
});
