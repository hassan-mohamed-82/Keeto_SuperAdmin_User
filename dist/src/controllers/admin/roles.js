"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAvailablePermissions = exports.toggleRoleStatus = exports.deleteRole = exports.updateRole = exports.createRole = exports.getRoleById = exports.getAllRoles = exports.getAdminPermissions = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const constant_1 = require("../../types/constant");
const uuid_1 = require("uuid");
// Generate ID للـ Action
const generateActionId = () => {
    return (0, uuid_1.v4)().replace(/-/g, "").substring(0, 24);
};
// إضافة IDs للـ Actions
const addIdsToPermissions = (permissions) => {
    return permissions.map((perm) => ({
        module: perm.module,
        actions: perm.actions.map((act) => ({
            id: act.id || generateActionId(),
            action: act.action,
        })),
    }));
};
// Helper function to parse permissions
const parsePermissions = (permissions) => {
    if (!permissions)
        return [];
    try {
        if (Array.isArray(permissions)) {
            return permissions;
        }
        if (typeof permissions === 'string') {
            const parsed = JSON.parse(permissions);
            return Array.isArray(parsed) ? parsed : [];
        }
        return [];
    }
    catch (error) {
        console.error('Error parsing permissions:', error);
        return [];
    }
};
// Format role response
const formatRole = (role) => ({
    id: role.id,
    name: role.name,
    permissions: parsePermissions(role.permissions),
    status: role.status,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
});
function formatLabel(str) {
    return str
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
}
// Get Admin Modules with Actions
const getAdminPermissions = async (req, res) => {
    try {
        const permissions = constant_1.MODULES.map((module) => ({
            module,
            label: formatLabel(module),
            actions: constant_1.ACTION_NAMES.map((action) => ({
                key: action.toLowerCase(),
                label: action,
                permission: `${module}.${action.toLowerCase()}`,
            })),
        }));
        return res.status(200).json({
            success: true,
            data: {
                modules: [...constant_1.MODULES],
                actions: [...constant_1.ACTION_NAMES],
                permissions,
            },
        });
    }
    catch (error) {
        console.error("Get admin permissions error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to get permissions",
            error: error.message,
        });
    }
};
exports.getAdminPermissions = getAdminPermissions;
// ✅ Get All Roles
const getAllRoles = async (req, res) => {
    const allRoles = await connection_1.db.select().from(schema_1.roles);
    const formattedRoles = allRoles.map(formatRole);
    (0, response_1.SuccessResponse)(res, { roles: formattedRoles }, 200);
};
exports.getAllRoles = getAllRoles;
// ✅ Get Role By ID
const getRoleById = async (req, res) => {
    const { id } = req.params;
    const role = await connection_1.db
        .select()
        .from(schema_1.roles)
        .where((0, drizzle_orm_1.eq)(schema_1.roles.id, id))
        .limit(1);
    if (!role[0]) {
        throw new NotFound_1.NotFound("Role not found");
    }
    (0, response_1.SuccessResponse)(res, { role: formatRole(role[0]) }, 200);
};
exports.getRoleById = getRoleById;
// ✅ Create Role
const createRole = async (req, res) => {
    const { name, permissions } = req.body;
    if (!name) {
        throw new BadRequest_1.BadRequest("Role name is required");
    }
    const existingRole = await connection_1.db
        .select()
        .from(schema_1.roles)
        .where((0, drizzle_orm_1.eq)(schema_1.roles.name, name))
        .limit(1);
    if (existingRole[0]) {
        throw new BadRequest_1.BadRequest("Role with this name already exists");
    }
    const permissionsWithIds = addIdsToPermissions(permissions || []);
    // ✅ ابعت array على طول - Drizzle هيتعامل معاه
    await connection_1.db.insert(schema_1.roles).values({
        name,
        permissions: permissionsWithIds,
    });
    // جيب الـ role اللي اتعمل
    const createdRole = await connection_1.db
        .select()
        .from(schema_1.roles)
        .where((0, drizzle_orm_1.eq)(schema_1.roles.name, name))
        .limit(1);
    (0, response_1.SuccessResponse)(res, {
        message: "Role created successfully",
        role: formatRole(createdRole[0])
    }, 201);
};
exports.createRole = createRole;
// ✅ Update Role
const updateRole = async (req, res) => {
    const { id } = req.params;
    const { name, permissions, status } = req.body;
    const existingRole = await connection_1.db
        .select()
        .from(schema_1.roles)
        .where((0, drizzle_orm_1.eq)(schema_1.roles.id, id))
        .limit(1);
    if (!existingRole[0]) {
        throw new NotFound_1.NotFound("Role not found");
    }
    if (name && name !== existingRole[0].name) {
        const duplicateName = await connection_1.db
            .select()
            .from(schema_1.roles)
            .where((0, drizzle_orm_1.eq)(schema_1.roles.name, name))
            .limit(1);
        if (duplicateName[0]) {
            throw new BadRequest_1.BadRequest("Role with this name already exists");
        }
    }
    const currentPermissions = parsePermissions(existingRole[0].permissions);
    const updatedPermissions = permissions
        ? addIdsToPermissions(permissions)
        : currentPermissions;
    // ✅ ابعت array على طول
    await connection_1.db
        .update(schema_1.roles)
        .set({
        name: name ?? existingRole[0].name,
        permissions: updatedPermissions,
        status: status ?? existingRole[0].status,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.roles.id, id));
    const updatedRole = await connection_1.db
        .select()
        .from(schema_1.roles)
        .where((0, drizzle_orm_1.eq)(schema_1.roles.id, id))
        .limit(1);
    (0, response_1.SuccessResponse)(res, {
        message: "Role updated successfully",
        role: formatRole(updatedRole[0])
    }, 200);
};
exports.updateRole = updateRole;
// ✅ Delete Role
const deleteRole = async (req, res) => {
    const { id } = req.params;
    const existingRole = await connection_1.db
        .select()
        .from(schema_1.roles)
        .where((0, drizzle_orm_1.eq)(schema_1.roles.id, id))
        .limit(1);
    if (!existingRole[0]) {
        throw new NotFound_1.NotFound("Role not found");
    }
    await connection_1.db.delete(schema_1.roles).where((0, drizzle_orm_1.eq)(schema_1.roles.id, id));
    (0, response_1.SuccessResponse)(res, { message: "Role deleted successfully" }, 200);
};
exports.deleteRole = deleteRole;
// ✅ Toggle Role Status
const toggleRoleStatus = async (req, res) => {
    const { id } = req.params;
    const existingRole = await connection_1.db
        .select()
        .from(schema_1.roles)
        .where((0, drizzle_orm_1.eq)(schema_1.roles.id, id))
        .limit(1);
    if (!existingRole[0]) {
        throw new NotFound_1.NotFound("Role not found");
    }
    const newStatus = existingRole[0].status === "active" ? "inactive" : "active";
    await connection_1.db.update(schema_1.roles).set({ status: newStatus }).where((0, drizzle_orm_1.eq)(schema_1.roles.id, id));
    const updatedRole = await connection_1.db
        .select()
        .from(schema_1.roles)
        .where((0, drizzle_orm_1.eq)(schema_1.roles.id, id))
        .limit(1);
    (0, response_1.SuccessResponse)(res, {
        message: `Role ${newStatus}`,
        role: formatRole(updatedRole[0])
    }, 200);
};
exports.toggleRoleStatus = toggleRoleStatus;
// ✅ Get Available Permissions
const getAvailablePermissions = async (req, res) => {
    const permissions = constant_1.MODULES.map((module) => ({
        module,
        actions: constant_1.ACTION_NAMES.map((action) => ({
            id: generateActionId(),
            action,
        })),
    }));
    (0, response_1.SuccessResponse)(res, {
        modules: constant_1.MODULES,
        actions: constant_1.ACTION_NAMES,
        permissions,
    }, 200);
};
exports.getAvailablePermissions = getAvailablePermissions;
