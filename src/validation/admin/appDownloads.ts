import { z } from "zod";

const dateString = z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .refine((v) => !isNaN(Date.parse(v)), "Invalid date");

const optionalDate = z.preprocess((v) => (v === "" ? undefined : v), dateString.optional());

const fromBeforeTo = (d: { from?: string; to?: string }) => !d.from || !d.to || d.from <= d.to;

export const syncAppDownloadsSchema = z.preprocess(
    (v) => v ?? {},
    z
        .object({
            platform: z.enum(["all", "android", "ios"]).default("all"),
            from: optionalDate,
            to: optionalDate,
            restaurantId: z.string().uuid("Invalid restaurant ID").optional(),
        })
        .refine(fromBeforeTo, { message: "from must be before or equal to to", path: ["from"] })
);

export const getAppDownloadsQuerySchema = z
    .object({
        from: optionalDate,
        to: optionalDate,
        search: z.string().trim().optional(),
        restaurantId: z.string().uuid("Invalid restaurant ID").optional(),
        platform: z.enum(["all", "android", "ios"]).default("all"),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
    })
    .refine(fromBeforeTo, { message: "from must be before or equal to to", path: ["from"] });

export const restaurantAppDownloadsParamsSchema = z.object({
    restaurantId: z.string().uuid("Invalid restaurant ID"),
});

export const restaurantAppDownloadsQuerySchema = z
    .object({
        from: optionalDate,
        to: optionalDate,
        groupBy: z.enum(["day", "month", "year"]).default("month"),
    })
    .refine(fromBeforeTo, { message: "from must be before or equal to to", path: ["from"] });
