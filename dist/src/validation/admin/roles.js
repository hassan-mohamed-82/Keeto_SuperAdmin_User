"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateRoleAdminSchema = exports.createRoleAdminSchema = exports.updateRoleSchema = exports.createRoleSchema = void 0;
const zod_1 = require("zod");
// ==========================================
// User / System Roles Validation
// ==========================================
exports.createRoleSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Role name is required").max(100),
    permissions: zod_1.z.array(zod_1.z.any()).optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
exports.updateRoleSchema = exports.createRoleSchema.partial();
// ==========================================
// Admin Roles Validation
// ==========================================
exports.createRoleAdminSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Admin role name is required").max(100),
    permissions: zod_1.z.array(zod_1.z.any()).optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
exports.updateRoleAdminSchema = exports.createRoleAdminSchema.partial();
