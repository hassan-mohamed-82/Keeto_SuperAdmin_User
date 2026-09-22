"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserStatsParamsSchema = void 0;
const zod_1 = require("zod");
// ==========================================
// User Stats Validation
// ==========================================
exports.getUserStatsParamsSchema = zod_1.z.object({
    id: zod_1.z.string().uuid("Invalid user ID — must be a valid UUID"),
});
