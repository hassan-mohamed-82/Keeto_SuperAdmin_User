"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasPermission = void 0;
const Errors_1 = require("../Errors");
const connection_1 = require("../models/connection");
const admin_1 = require("../models/schema/admin/admin");
const restrauntadmin_1 = require("../models/schema/admin/restrauntadmin");
const drizzle_orm_1 = require("drizzle-orm");
const hasPermission = (module, action) => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                throw new Errors_1.UnauthorizedError("Not authenticated");
            }
            // Super admin has all permissions
            if (req.user.type === "super_admin") {
                return next();
            }
            let userPermissions = [];
            if (req.user.role === "admin") {
                const adminRecord = await connection_1.db.select().from(admin_1.admins).where((0, drizzle_orm_1.eq)(admin_1.admins.id, req.user.id)).limit(1);
                if (!adminRecord[0]) {
                    throw new Errors_1.UnauthorizedError("Admin not found");
                }
                if (adminRecord[0].status !== "active") {
                    throw new Errors_1.ForbiddenError("Admin account is inactive");
                }
                // Parse permissions if it's a string (though drizzle json type handles it)
                const perms = adminRecord[0].permissions;
                userPermissions = typeof perms === 'string' ? JSON.parse(perms) : (perms || []);
            }
            else if (req.user.role === "restaurant_admin") {
                const restAdminRecord = await connection_1.db.select().from(restrauntadmin_1.restrauntadmin).where((0, drizzle_orm_1.eq)(restrauntadmin_1.restrauntadmin.id, req.user.id)).limit(1);
                if (!restAdminRecord[0]) {
                    throw new Errors_1.UnauthorizedError("Restaurant Admin not found");
                }
                if (restAdminRecord[0].status !== "active") {
                    throw new Errors_1.ForbiddenError("Account is inactive");
                }
                const perms = restAdminRecord[0].permissions;
                userPermissions = typeof perms === 'string' ? JSON.parse(perms) : (perms || []);
            }
            else {
                throw new Errors_1.ForbiddenError("You don't have permission to perform this action");
            }
            // Find the requested module
            const modulePermission = userPermissions.find(p => p.module === module);
            if (!modulePermission) {
                throw new Errors_1.ForbiddenError(`You don't have permission to access module: ${module}`);
            }
            // Check if the requested action exists for this module
            const hasAction = modulePermission.actions.some((act) => act.action === action);
            if (!hasAction) {
                throw new Errors_1.ForbiddenError(`You don't have '${action}' permission for module: ${module}`);
            }
            next();
        }
        catch (error) {
            next(error);
        }
    };
};
exports.hasPermission = hasPermission;
