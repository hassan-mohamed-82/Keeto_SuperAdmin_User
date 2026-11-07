import { z } from "zod";

/**
 * Validation schema for POST /api/auth/handoff
 */
export const handoffSchema = z.object({
  return_to: z.string({
    required_error: "Invalid request",
    invalid_type_error: "Invalid request",
  }).min(1, "Invalid request"),
});

/**
 * Validation schema for POST /api/auth/exchange-code
 */
export const exchangeCodeSchema = z.object({
  code: z.string({
    required_error: "Invalid request",
    invalid_type_error: "Invalid request",
  }).min(1, "Invalid request"),
});

