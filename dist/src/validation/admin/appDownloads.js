"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restaurantAppDownloadsQuerySchema = exports.restaurantAppDownloadsParamsSchema = exports.getAppDownloadsQuerySchema = exports.syncAppDownloadsSchema = void 0;
const zod_1 = require("zod");
const dateString = zod_1.z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .refine((v) => !isNaN(Date.parse(v)), "Invalid date");
const optionalDate = zod_1.z.preprocess((v) => (v === "" ? undefined : v), dateString.optional());
const fromBeforeTo = (d) => !d.from || !d.to || d.from <= d.to;
exports.syncAppDownloadsSchema = zod_1.z.preprocess((v) => v ?? {}, zod_1.z
    .object({
    platform: zod_1.z.enum(["all", "android", "ios"]).default("all"),
    from: optionalDate,
    to: optionalDate,
    restaurantId: zod_1.z.string().uuid("Invalid restaurant ID").optional(),
})
    .refine(fromBeforeTo, { message: "from must be before or equal to to", path: ["from"] }));
exports.getAppDownloadsQuerySchema = zod_1.z
    .object({
    from: optionalDate,
    to: optionalDate,
    search: zod_1.z.string().trim().optional(),
    restaurantId: zod_1.z.string().uuid("Invalid restaurant ID").optional(),
    platform: zod_1.z.enum(["all", "android", "ios"]).default("all"),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
})
    .refine(fromBeforeTo, { message: "from must be before or equal to to", path: ["from"] });
exports.restaurantAppDownloadsParamsSchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid("Invalid restaurant ID"),
});
exports.restaurantAppDownloadsQuerySchema = zod_1.z
    .object({
    from: optionalDate,
    to: optionalDate,
    groupBy: zod_1.z.enum(["day", "month", "year"]).default("month"),
})
    .refine(fromBeforeTo, { message: "from must be before or equal to to", path: ["from"] });
