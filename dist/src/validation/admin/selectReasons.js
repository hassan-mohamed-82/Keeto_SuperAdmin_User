"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSelectReasonSchema = exports.createSelectReasonSchema = void 0;
const zod_1 = require("zod");
exports.createSelectReasonSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Reason name is required").max(255),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
exports.updateSelectReasonSchema = exports.createSelectReasonSchema.partial();
