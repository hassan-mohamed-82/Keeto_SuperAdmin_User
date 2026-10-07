import { z } from "zod";

export const restaurantOperationStatusSchema = z.enum([
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

export const restaurantTypeSchema = z.enum([
    "mega",
    "super",
    "A",
    "B",
    "C",
    "C-",
    "test",
]);

export const getRestaurantOperationsQuerySchema = z.object({
    search: z.string().trim().optional(),
    restaurantId: z.string().uuid("Invalid Restaurant ID").optional(),
    restaurantType: restaurantTypeSchema.optional(),
    operationType: z.enum(["callcenter", "branch"]).optional(),
    status: restaurantOperationStatusSchema.optional(),
    app: z.enum(["on", "off"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

const noteSchema = z.string().trim().min(1).max(2000);

export const updateRestaurantOperationParamsSchema = z.object({
    restaurantId: z.string().uuid(),
});

export const updateRestaurantOperationSchema = z
    .object({
        operationType: z.enum(["callcenter", "branch"]).optional(),
        status: restaurantOperationStatusSchema.optional(),
        app: z.enum(["on", "off"]).optional(),
        notes: z.array(noteSchema).optional(),
    })
    .refine(
        (data) =>
            data.operationType !== undefined ||
            data.status !== undefined ||
            data.app !== undefined ||
            data.notes !== undefined,
        { message: "At least one operation field or note is required" }
    );