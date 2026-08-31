"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSelectReasonSchema = exports.createSelectReasonSchema = void 0;
const zod_1 = require("zod");
exports.createSelectReasonSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Reason name is required").max(255),
    name_ar: zod_1.z.string().optional(),
    name_fr: zod_1.z.string().optional(),
    type: zod_1.z.enum(["user", "restaurant"]).optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
exports.updateSelectReasonSchema = exports.createSelectReasonSchema.partial();
