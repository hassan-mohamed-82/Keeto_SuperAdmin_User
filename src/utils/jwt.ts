import jwt from "jsonwebtoken";
import { UnauthorizedError } from "../Errors";
import { TokenPayload, Role, Permission } from "../types/custom";
import "dotenv/config";

const JWT_SECRET = process.env.JWT_SECRET as string;


export const generateAdminToken = (data: {
    id: string;
    name: string;
    role: Role;
    // permissions: Permission[];
}): string => {
    const payload: TokenPayload = {
        id: data.id,
        name: data.name,
        role: data.role,
        // permissions: data.permissions,
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
};