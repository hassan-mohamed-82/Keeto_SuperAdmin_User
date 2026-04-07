// src/middlewares/authenticated.ts

import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/auth";
import { UnauthorizedError } from "../Errors";

export const authenticated = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new UnauthorizedError("No token provided");
  }

  const token = authHeader.split(" ")[1];
  const decoded = verifyToken(token);

  req.user = decoded;
  next();
};
