import { z } from "zod";

export const optionalDateQuerySchema = z
    .string()
    .trim()
    .transform((val) => (val === "" ? undefined : val))
    .refine((val) => val === undefined || !isNaN(Date.parse(val)), {
        message: "Invalid date format",
    })
    .optional();

// Accepts a single UUID string, comma-separated UUIDs, or an array of UUIDs from repeated query params
const restaurantIdsSchema = z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => {
        if (!val) return undefined;
        const arr = Array.isArray(val) ? val : val.split(",");
        return arr.map((s) => s.trim()).filter(Boolean);
    });

export const getPerformanceReportQuerySchema = z
    .object({
        startDate: optionalDateQuerySchema,
        endDate: optionalDateQuerySchema,
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

export const getChartsQuerySchema = z
    .object({
        startDate: optionalDateQuerySchema,
        endDate: optionalDateQuerySchema,
        // Restaurants with fewer than this many avg daily orders appear in the low-order chart (default 50)
        orderThreshold: z.coerce.number().int().min(1).optional().default(50),
        // First N orders are treated as test orders and excluded from activation counting (default 10)
        testOrdersThreshold: z.coerce.number().int().min(0).optional().default(10),
        // Optional list of restaurant IDs to limit the low-order chart
        restaurantIds: restaurantIdsSchema,
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

export type GetPerformanceReportQuery = z.infer<typeof getPerformanceReportQuerySchema>;
export type GetChartsQuery = z.infer<typeof getChartsQuerySchema>;

