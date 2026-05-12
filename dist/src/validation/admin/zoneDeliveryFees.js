"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateZoneDeliveryFeeSchema = exports.createZoneDeliveryFeeSchema = void 0;
const zod_1 = require("zod");
exports.createZoneDeliveryFeeSchema = zod_1.z.object({
    // العلاقات (Required)
    fromZoneId: zod_1.z.string().uuid("Invalid Source Zone ID"),
    toZoneId: zod_1.z.string().uuid("Invalid Destination Zone ID"),
    // سعر التوصيل متسجل كـ Decimal، فبنستخدم coerce.string
    fee: zod_1.z.coerce.string({
        required_error: "Fee is required",
        invalid_type_error: "Fee must be a valid number",
    }).min(1, "Fee cannot be empty"),
});
exports.updateZoneDeliveryFeeSchema = exports.createZoneDeliveryFeeSchema.partial();
