import { Request, Response, NextFunction } from "express";
import { ForbiddenError, UnauthorizedError } from "../Errors";
import { db } from "../models/connection";
import { admins } from "../models/schema/admin/admin";
import { restrauntadmin } from "../models/schema/admin/restrauntadmin";
import { eq } from "drizzle-orm";
import { ModuleName, ActionName } from "../types/constant";

export const hasPermission = (module: ModuleName, action: ActionName) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!req.user) {
                throw new UnauthorizedError("Not authenticated");
            }

            // Super admin has all permissions
            if (req.user.type === "super_admin") {
                return next();
            }

            let userPermissions: any[] = [];

            if (req.user.role === "admin") {
                const adminRecord = await db.select().from(admins).where(eq(admins.id, req.user.id)).limit(1);
                if (!adminRecord[0]) {
                    throw new UnauthorizedError("Admin not found");
                }
                
                if (adminRecord[0].status !== "active") {
                    throw new ForbiddenError("Admin account is inactive");
                }
                
                // Parse permissions if it's a string (though drizzle json type handles it)
                const perms = adminRecord[0].permissions;
                userPermissions = typeof perms === 'string' ? JSON.parse(perms) : (perms || []);

            } else if (req.user.role === "restaurant_admin") {
                const restAdminRecord = await db.select().from(restrauntadmin).where(eq(restrauntadmin.id, req.user.id)).limit(1);
                if (!restAdminRecord[0]) {
                    throw new UnauthorizedError("Restaurant Admin not found");
                }
                
                if (restAdminRecord[0].status !== "active") {
                    throw new ForbiddenError("Account is inactive");
                }
                
                const perms = restAdminRecord[0].permissions;
                userPermissions = typeof perms === 'string' ? JSON.parse(perms) : (perms || []);
            } else {
                throw new ForbiddenError("You don't have permission to perform this action");
            }

            // Find the requested module
            const modulePermission = userPermissions.find(p => p.module === module);
            
            if (!modulePermission) {
                throw new ForbiddenError(`You don't have permission to access module: ${module}`);
            }

            // Check if the requested action exists for this module
            const hasAction = modulePermission.actions.some((act: any) => act.action === action);

            if (!hasAction) {
                throw new ForbiddenError(`You don't have '${action}' permission for module: ${module}`);
            }

            next();
        } catch (error) {
            next(error);
        }
    };
};
