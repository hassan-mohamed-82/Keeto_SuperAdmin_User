"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportsDateRangeSchema = void 0;
const zod_1 = require("zod");
exports.reportsDateRangeSchema = zod_1.z.object({
    fromDate: zod_1.z.string().optional(),
    toDate: zod_1.z.string().optional(),
    courierId: zod_1.z.string().uuid("Invalid Courier ID").optional(),
});
