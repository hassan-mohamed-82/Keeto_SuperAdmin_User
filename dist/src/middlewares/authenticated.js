"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalAuth = exports.authenticated = void 0;
const auth_1 = require("../utils/auth");
const Errors_1 = require("../Errors");
const authenticated = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        throw new Errors_1.UnauthorizedError("No token provided");
    }
    const token = authHeader.split(" ")[1];
    let decoded;
    try {
        decoded = (0, auth_1.verifyToken)(token);
    }
    catch (err) {
        throw new Errors_1.UnauthorizedError("Invalid token");
    }
    if (!decoded?.id || !decoded?.role) {
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    }
    req.user = {
        id: decoded.id,
        name: decoded.name,
        role: decoded.role,
        type: decoded.type,
        restaurantId: decoded.restaurantId,
        branchId: decoded.branchId,
    };
    next();
};
exports.authenticated = authenticated;
const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        return next();
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = (0, auth_1.verifyToken)(token);
        if (decoded?.id && decoded?.role) {
            req.user = {
                id: decoded.id,
                name: decoded.name,
                role: decoded.role,
                type: decoded.type,
                restaurantId: decoded.restaurantId,
                branchId: decoded.branchId,
            };
        }
    }
    catch (err) {
        // Ignore token errors for optional auth
    }
    next();
};
exports.optionalAuth = optionalAuth;
