"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChartsQuerySchema = exports.getPerformanceReportQuerySchema = exports.optionalDateQuerySchema = void 0;
const zod_1 = require("zod");
exports.optionalDateQuerySchema = zod_1.z
    .string()
    .trim()
    .transform((val) => (val === "" ? undefined : val))
    .refine((val) => val === undefined || !isNaN(Date.parse(val)), {
    message: "Invalid date format",
})
    .optional();
// Accepts a single UUID string, comma-separated UUIDs, or an array of UUIDs from repeated query params
const restaurantIdsSchema = zod_1.z
    .union([zod_1.z.string(), zod_1.z.array(zod_1.z.string())])
    .optional()
    .transform((val) => {
    if (!val)
        return undefined;
    const arr = Array.isArray(val) ? val : val.split(",");
    return arr.map((s) => s.trim()).filter(Boolean);
});
exports.getPerformanceReportQuerySchema = zod_1.z
    .object({
    startDate: exports.optionalDateQuerySchema,
    endDate: exports.optionalDateQuerySchema,
})
    .refine((data) => {
    if (data.startDate && data.endDate) {
        return new Date(data.startDate) <= new Date(data.endDate);
    }
    return true;
}, {
    message: "startDate must be before or equal to endDate",
    path: ["startDate"],
});
exports.getChartsQuerySchema = zod_1.z
    .object({
    startDate: exports.optionalDateQuerySchema,
    endDate: exports.optionalDateQuerySchema,
    // Restaurants with fewer than this many avg daily orders appear in the low-order chart (default 50)
    orderThreshold: zod_1.z.coerce.number().int().min(1).optional().default(50),
    // First N orders are treated as test orders and excluded from activation counting (default 10)
    testOrdersThreshold: zod_1.z.coerce.number().int().min(0).optional().default(10),
    // Optional list of restaurant IDs to limit the low-order chart
    restaurantIds: restaurantIdsSchema,
})
    .refine((data) => {
    if (data.startDate && data.endDate) {
        return new Date(data.startDate) <= new Date(data.endDate);
    }
    return true;
}, {
    message: "startDate must be before or equal to endDate",
    path: ["startDate"],
});
