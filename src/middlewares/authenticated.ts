import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/auth";
import { UnauthorizedError } from "../Errors";
import { AppUser } from "../types/custom";

export const authenticated = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
        throw new UnauthorizedError("No token provided");
    }

    const token = authHeader.split(" ")[1];

    let decoded;

    try {
        decoded = verifyToken(token);
    } catch (err) {
        throw new UnauthorizedError("Invalid token");
    }

    if (!decoded?.id || !decoded?.role) {
        throw new UnauthorizedError("Unauthenticated");
    }

    req.user = {
        id: decoded.id,
        name: decoded.name,
        role: decoded.role,
        type: decoded.type as AppUser["type"],
        restaurantId: decoded.restaurantId,
        branchId: decoded.branchId,
    };

    next();
};

export const optionalAuth = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
        return next();
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = verifyToken(token);
        if (decoded?.id && decoded?.role) {
            req.user = {
                id: decoded.id,
                name: decoded.name,
                role: decoded.role,
                type: decoded.type as AppUser["type"],
                restaurantId: decoded.restaurantId,
                branchId: decoded.branchId,
            };
        }
    } catch (err) {
        // Ignore token errors for optional auth
    }

    next();
};