// src/middlewares/authorizeRoles.ts

import { Request, Response, NextFunction, RequestHandler } from "express";
import { UnauthorizedError } from "../Errors";

type Role = "superadmin" | "admin" ; // Example roles

export const authorizeRoles = (...roles: Role[]): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new UnauthorizedError("Not authenticated");
    }

    if (!roles.includes(req.user.role as Role)) {
      throw new UnauthorizedError("You don't have permission to access this resource");
    }

    next();
  };
};
