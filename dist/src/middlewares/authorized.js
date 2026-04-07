"use strict";
// src/middlewares/authorizeRoles.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizeRoles = void 0;
const Errors_1 = require("../Errors");
const authorizeRoles = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            throw new Errors_1.UnauthorizedError("Not authenticated");
        }
        if (!roles.includes(req.user.role)) {
            throw new Errors_1.UnauthorizedError("You don't have permission to access this resource");
        }
        next();
    };
};
exports.authorizeRoles = authorizeRoles;
