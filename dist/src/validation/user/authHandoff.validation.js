"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exchangeCodeSchema = exports.handoffSchema = void 0;
const zod_1 = require("zod");
/**
 * Validation schema for POST /api/auth/handoff
 */
exports.handoffSchema = zod_1.z.object({
    return_to: zod_1.z.string({
        required_error: "Invalid request",
        invalid_type_error: "Invalid request",
    }).min(1, "Invalid request"),
});
/**
 * Validation schema for POST /api/auth/exchange-code
 */
exports.exchangeCodeSchema = zod_1.z.object({
    code: zod_1.z.string({
        required_error: "Invalid request",
        invalid_type_error: "Invalid request",
    }).min(1, "Invalid request"),
});
