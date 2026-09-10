import { z } from "zod";

// ==========================================
// User Stats Validation
// ==========================================

export const getUserStatsParamsSchema = z.object({
    id: z.string().uuid("Invalid user ID — must be a valid UUID"),
});