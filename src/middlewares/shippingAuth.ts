import { Request, Response, NextFunction } from "express";
import { UnauthorizedError, ForbiddenError } from "../Errors";
import { db } from "../models/connection";
import { shippingCompanyUsers, shippingCompanies, deliveryMen } from "../models/schema";
import { eq, and } from "drizzle-orm";

/**
 * Middleware requiring shipping_company role, valid company ID,
 * active user & company status, tokenVersion match, and optional companyRoles check.
 */
export const requireShippingCompany = (...allowedCompanyRoles: Array<"admin" | "dispatcher" | "viewer">) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        const user = req.user;

        if (!user || user.role !== "shipping_company") {
            throw new ForbiddenError("Access denied: Shipping company credentials required");
        }

        const companyId = user.shippingCompanyId;
        const userId = user.id;

        if (!companyId || !userId) {
            throw new UnauthorizedError("Invalid shipping company token payload");
        }

        // Verify user and company in DB (active check & tokenVersion check)
        const [companyUser] = await db
            .select({
                id: shippingCompanyUsers.id,
                shippingCompanyId: shippingCompanyUsers.shippingCompanyId,
                role: shippingCompanyUsers.role,
                status: shippingCompanyUsers.status,
                tokenVersion: shippingCompanyUsers.tokenVersion,
                companyStatus: shippingCompanies.status,
            })
            .from(shippingCompanyUsers)
            .innerJoin(shippingCompanies, eq(shippingCompanyUsers.shippingCompanyId, shippingCompanies.id))
            .where(
                and(
                    eq(shippingCompanyUsers.id, userId),
                    eq(shippingCompanyUsers.shippingCompanyId, companyId)
                )
            )
            .limit(1);

        if (!companyUser) {
            throw new UnauthorizedError("Shipping company user not found");
        }

        if (companyUser.status !== "active") {
            throw new UnauthorizedError("Shipping company user account is inactive");
        }

        if (companyUser.companyStatus !== "active") {
            throw new UnauthorizedError("Shipping company account is inactive");
        }

        if (user.tokenVersion !== undefined && user.tokenVersion !== companyUser.tokenVersion) {
            throw new UnauthorizedError("Token is stale or revoked. Please login again.");
        }

        req.user!.companyRole = companyUser.role;

        // Check specific company role if specified
        if (allowedCompanyRoles.length > 0 && !allowedCompanyRoles.includes(companyUser.role)) {
            throw new ForbiddenError(`Forbidden: requires role ${allowedCompanyRoles.join(" or ")}`);
        }

        next();
    };
};

/**
 * Middleware requiring delivery_man role, active and non-deleted courier status
 */
export const requireDeliveryMan = async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user || user.role !== "delivery_man") {
        throw new ForbiddenError("Access denied: Courier credentials required");
    }

    const courierId = user.deliveryManId || user.id;

    if (!courierId) {
        throw new UnauthorizedError("Invalid courier token payload");
    }

    const [courier] = await db
        .select({
            id: deliveryMen.id,
            isActive: deliveryMen.isActive,
            isDeleted: deliveryMen.isDeleted,
            shippingCompanyId: deliveryMen.shippingCompanyId,
            workType: deliveryMen.workType,
        })
        .from(deliveryMen)
        .where(eq(deliveryMen.id, courierId))
        .limit(1);

    if (!courier || courier.isDeleted || !courier.isActive) {
        throw new UnauthorizedError("Courier account is inactive or not found");
    }

    req.user!.deliveryManId = courier.id;
    req.user!.shippingCompanyId = courier.shippingCompanyId;
    req.user!.workType = courier.workType;

    next();
};
