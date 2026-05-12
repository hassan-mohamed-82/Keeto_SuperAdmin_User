import { z } from "zod";

// ==========================================
// User / System Roles Validation
// ==========================================
export const createRoleSchema = z.object({
    name: z.string().min(1, "Role name is required").max(100),
    permissions: z.array(z.any()).optional(),
    status: z.enum(["active", "inactive"]).optional(),
});

export const updateRoleSchema = createRoleSchema.partial();

// ==========================================
// Admin Roles Validation
// ==========================================
export const createRoleAdminSchema = z.object({
    name: z.string().min(1, "Admin role name is required").max(100),
    permissions: z.array(z.any()).optional(),
    status: z.enum(["active", "inactive"]).optional(),
});

export const updateRoleAdminSchema = createRoleAdminSchema.partial();