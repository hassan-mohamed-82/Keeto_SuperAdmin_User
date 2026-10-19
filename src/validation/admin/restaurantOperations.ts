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

export const optionalDateQuerySchema = z
    .string()
    .trim()
    .transform((val) => (val === "" ? undefined : val))
    .refine((val) => val === undefined || !isNaN(Date.parse(val)), {
        message: "Invalid date format",
    })
    .optional();

export const getRestaurantOperationsQuerySchema = z
    .object({
        search: z.string().trim().optional(),
        restaurantId: z.string().uuid("Invalid Restaurant ID").optional(),
        restaurantType: restaurantTypeSchema.optional(),
        operationType: z.enum(["callcenter", "branch"]).optional(),
        status: restaurantOperationStatusSchema.optional(),
        startDate: optionalDateQuerySchema,
        endDate: optionalDateQuerySchema,
        app: z.enum(["on", "off"]).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .refine(
        (data) => {
            if (data.startDate && data.endDate) {
                return new Date(data.startDate) <= new Date(data.endDate);
            }
            return true;
        },
        {
            message: "startDate must be before or equal to endDate",
            path: ["startDate"],
        }
    );

const noteTextSchema = z.string().trim().min(1).max(2000);

// Accepts plain strings (old clients) or objects (new clients that send back the note id)
const noteSchema = z.union([
    noteTextSchema,
    z.object({
        id: z.string().min(1).optional(),
        text: noteTextSchema,
    }),
]);

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