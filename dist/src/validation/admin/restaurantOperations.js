"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateRestaurantOperationSchema = exports.updateRestaurantOperationParamsSchema = exports.getRestaurantOperationsQuerySchema = exports.restaurantTypeSchema = exports.restaurantOperationStatusSchema = void 0;
const zod_1 = require("zod");
exports.restaurantOperationStatusSchema = zod_1.z.enum([
    "demo",
    "sales",
    "data",
    "customer support",
    "visit",
    "start order",
    "qr",
    "points",
    "social media",
]);
exports.restaurantTypeSchema = zod_1.z.enum([
    "mega",
    "super",
    "A",
    "B",
    "C",
    "C-",
    "test",
]);
exports.getRestaurantOperationsQuerySchema = zod_1.z.object({
    search: zod_1.z.string().trim().optional(),
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID").optional(),
    restaurantType: exports.restaurantTypeSchema.optional(),
    operationType: zod_1.z.enum(["callcenter", "branch"]).optional(),
    status: exports.restaurantOperationStatusSchema.optional(),
    app: zod_1.z.enum(["on", "off"]).optional(),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
});
const noteTextSchema = zod_1.z.string().trim().min(1).max(2000);
// Accepts plain strings (old clients) or objects (new clients that send back the note id)
const noteSchema = zod_1.z.union([
    noteTextSchema,
    zod_1.z.object({
        id: zod_1.z.string().min(1).optional(),
        text: noteTextSchema,
    }),
]);
exports.updateRestaurantOperationParamsSchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid(),
});
exports.updateRestaurantOperationSchema = zod_1.z
    .object({
    operationType: zod_1.z.enum(["callcenter", "branch"]).optional(),
    status: exports.restaurantOperationStatusSchema.optional(),
    app: zod_1.z.enum(["on", "off"]).optional(),
    notes: zod_1.z.array(noteSchema).optional(),
})
    .refine((data) => data.operationType !== undefined ||
    data.status !== undefined ||
    data.app !== undefined ||
    data.notes !== undefined, { message: "At least one operation field or note is required" });
