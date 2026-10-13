import { z } from "zod";

export const reportsDateRangeSchema = z.object({
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    courierId: z.string().uuid("Invalid Courier ID").optional(),
});
