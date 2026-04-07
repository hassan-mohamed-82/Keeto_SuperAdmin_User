import { Request, Response } from "express";
import { db } from "../../models/connection";
import { roles } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { MODULES, ACTION_NAMES } from "../../types/constant";
import { v4 as uuidv4 } from "uuid";
import { Permission } from "../../types/custom";

// Generate ID للـ Action
const generateActionId = (): string => {
    return uuidv4().replace(/-/g, "").substring(0, 24);
};

// إضافة IDs للـ Actions
const addIdsToPermissions = (permissions: Permission[]): Permission[] => {
    return permissions.map((perm) => ({
        module: perm.module,
        actions: perm.actions.map((act) => ({
            id: act.id || generateActionId(),
            action: act.action,
        })),
    }));
};

// Helper function to parse permissions
const parsePermissions = (permissions: any): Permission[] => {
    if (!permissions) return [];

    try {
        if (Array.isArray(permissions)) {
            return permissions;
        }

        if (typeof permissions === 'string') {
            const parsed = JSON.parse(permissions);
            return Array.isArray(parsed) ? parsed : [];
        }

        return [];
    } catch (error) {
        console.error('Error parsing permissions:', error);
        return [];
    }
};

// Format role response
const formatRole = (role: any) => ({
    id: role.id,
    name: role.name,
    permissions: parsePermissions(role.permissions),
    status: role.status,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
});
function formatLabel(str: string): string {
    return str
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
}

// Get Admin Modules with Actions
export const getAdminPermissions = async (req: Request, res: Response) => {
    try {
        const permissions = MODULES.map((module) => ({
            module,
            label: formatLabel(module),
            actions: ACTION_NAMES.map((action) => ({
                key: action.toLowerCase(),
                label: action,
                permission: `${module}.${action.toLowerCase()}`,
            })),
        }));

        return res.status(200).json({
            success: true,
            data: {
                modules: [...MODULES],
                actions: [...ACTION_NAMES],
                permissions,
            },
        });
    } catch (error: any) {
        console.error("Get admin permissions error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to get permissions",
            error: error.message,
        });
    }
};

// ✅ Get All Roles
export const getAllRoles = async (req: Request, res: Response) => {
    const allRoles = await db.select().from(roles);
    const formattedRoles = allRoles.map(formatRole);

    SuccessResponse(res, { roles: formattedRoles }, 200);
};

// ✅ Get Role By ID
export const getRoleById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const role = await db
        .select()
        .from(roles)
        .where(eq(roles.id, id))
        .limit(1);

    if (!role[0]) {
        throw new NotFound("Role not found");
    }

    SuccessResponse(res, { role: formatRole(role[0]) }, 200);
};

// ✅ Create Role
export const createRole = async (req: Request, res: Response) => {
    const { name, permissions } = req.body;

    if (!name) {
        throw new BadRequest("Role name is required");
    }

    const existingRole = await db
        .select()
        .from(roles)
        .where(eq(roles.name, name))
        .limit(1);

    if (existingRole[0]) {
        throw new BadRequest("Role with this name already exists");
    }

    const permissionsWithIds = addIdsToPermissions(permissions || []);

    // ✅ ابعت array على طول - Drizzle هيتعامل معاه
    await db.insert(roles).values({
        name,
        permissions: permissionsWithIds,
    });

    // جيب الـ role اللي اتعمل
    const createdRole = await db
        .select()
        .from(roles)
        .where(eq(roles.name, name))
        .limit(1);

    SuccessResponse(res, {
        message: "Role created successfully",
        role: formatRole(createdRole[0])
    }, 201);
};

// ✅ Update Role
export const updateRole = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, permissions, status } = req.body;

    const existingRole = await db
        .select()
        .from(roles)
        .where(eq(roles.id, id))
        .limit(1);

    if (!existingRole[0]) {
        throw new NotFound("Role not found");
    }

    if (name && name !== existingRole[0].name) {
        const duplicateName = await db
            .select()
            .from(roles)
            .where(eq(roles.name, name))
            .limit(1);

        if (duplicateName[0]) {
            throw new BadRequest("Role with this name already exists");
        }
    }

    const currentPermissions = parsePermissions(existingRole[0].permissions);
    const updatedPermissions = permissions
        ? addIdsToPermissions(permissions)
        : currentPermissions;

    // ✅ ابعت array على طول
    await db
        .update(roles)
        .set({
            name: name ?? existingRole[0].name,
            permissions: updatedPermissions,
            status: status ?? existingRole[0].status,
        })
        .where(eq(roles.id, id));

    const updatedRole = await db
        .select()
        .from(roles)
        .where(eq(roles.id, id))
        .limit(1);

    SuccessResponse(res, {
        message: "Role updated successfully",
        role: formatRole(updatedRole[0])
    }, 200);
};

// ✅ Delete Role
export const deleteRole = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingRole = await db
        .select()
        .from(roles)
        .where(eq(roles.id, id))
        .limit(1);

    if (!existingRole[0]) {
        throw new NotFound("Role not found");
    }

    await db.delete(roles).where(eq(roles.id, id));

    SuccessResponse(res, { message: "Role deleted successfully" }, 200);
};

// ✅ Toggle Role Status
export const toggleRoleStatus = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingRole = await db
        .select()
        .from(roles)
        .where(eq(roles.id, id))
        .limit(1);

    if (!existingRole[0]) {
        throw new NotFound("Role not found");
    }

    const newStatus = existingRole[0].status === "active" ? "inactive" : "active";

    await db.update(roles).set({ status: newStatus }).where(eq(roles.id, id));

    const updatedRole = await db
        .select()
        .from(roles)
        .where(eq(roles.id, id))
        .limit(1);

    SuccessResponse(res, {
        message: `Role ${newStatus}`,
        role: formatRole(updatedRole[0])
    }, 200);
};

// ✅ Get Available Permissions
export const getAvailablePermissions = async (req: Request, res: Response) => {
    const permissions = MODULES.map((module) => ({
        module,
        actions: ACTION_NAMES.map((action) => ({
            id: generateActionId(),
            action,
        })),
    }));

    SuccessResponse(res, {
        modules: MODULES,
        actions: ACTION_NAMES,
        permissions,
    }, 200);
};