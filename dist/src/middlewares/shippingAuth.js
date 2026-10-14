"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireDeliveryMan = exports.requireShippingCompany = void 0;
const Errors_1 = require("../Errors");
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
/**
 * Middleware requiring shipping_company role, valid company ID,
 * active user & company status, tokenVersion match, and optional companyRoles check.
 */
const requireShippingCompany = (...allowedCompanyRoles) => {
    return async (req, res, next) => {
        const user = req.user;
        if (!user || user.role !== "shipping_company") {
            throw new Errors_1.ForbiddenError("Access denied: Shipping company credentials required");
        }
        const companyId = user.shippingCompanyId;
        const userId = user.id;
        if (!companyId || !userId) {
            throw new Errors_1.UnauthorizedError("Invalid shipping company token payload");
        }
        // Verify user and company in DB (active check & tokenVersion check)
        const [companyUser] = await connection_1.db
            .select({
            id: schema_1.shippingCompanyUsers.id,
            shippingCompanyId: schema_1.shippingCompanyUsers.shippingCompanyId,
            role: schema_1.shippingCompanyUsers.role,
            status: schema_1.shippingCompanyUsers.status,
            tokenVersion: schema_1.shippingCompanyUsers.tokenVersion,
            companyStatus: schema_1.shippingCompanies.status,
        })
            .from(schema_1.shippingCompanyUsers)
            .innerJoin(schema_1.shippingCompanies, (0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.shippingCompanyId, schema_1.shippingCompanies.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.id, userId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.shippingCompanyId, companyId)))
            .limit(1);
        if (!companyUser) {
            throw new Errors_1.UnauthorizedError("Shipping company user not found");
        }
        if (companyUser.status !== "active") {
            throw new Errors_1.UnauthorizedError("Shipping company user account is inactive");
        }
        if (companyUser.companyStatus !== "active") {
            throw new Errors_1.UnauthorizedError("Shipping company account is inactive");
        }
        if (user.tokenVersion !== undefined && user.tokenVersion !== companyUser.tokenVersion) {
            throw new Errors_1.UnauthorizedError("Token is stale or revoked. Please login again.");
        }
        req.user.companyRole = companyUser.role;
        // Check specific company role if specified
        if (allowedCompanyRoles.length > 0 && !allowedCompanyRoles.includes(companyUser.role)) {
            throw new Errors_1.ForbiddenError(`Forbidden: requires role ${allowedCompanyRoles.join(" or ")}`);
        }
        next();
    };
};
exports.requireShippingCompany = requireShippingCompany;
/**
 * Middleware requiring delivery_man role, active and non-deleted courier status
 */
const requireDeliveryMan = async (req, res, next) => {
    const user = req.user;
    if (!user || user.role !== "delivery_man") {
        throw new Errors_1.ForbiddenError("Access denied: Courier credentials required");
    }
    const courierId = user.deliveryManId || user.id;
    if (!courierId) {
        throw new Errors_1.UnauthorizedError("Invalid courier token payload");
    }
    const [courier] = await connection_1.db
        .select({
        id: schema_1.deliveryMen.id,
        isActive: schema_1.deliveryMen.isActive,
        isDeleted: schema_1.deliveryMen.isDeleted,
        shippingCompanyId: schema_1.deliveryMen.shippingCompanyId,
        deliveryType: schema_1.deliveryMen.deliveryType,
    })
        .from(schema_1.deliveryMen)
        .where((0, drizzle_orm_1.eq)(schema_1.deliveryMen.id, courierId))
        .limit(1);
    if (!courier || courier.isDeleted || !courier.isActive) {
        throw new Errors_1.UnauthorizedError("Courier account is inactive or not found");
    }
    req.user.deliveryManId = courier.id;
    req.user.shippingCompanyId = courier.shippingCompanyId;
    req.user.deliveryType = courier.deliveryType;
    next();
};
exports.requireDeliveryMan = requireDeliveryMan;
