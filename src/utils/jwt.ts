import jwt from "jsonwebtoken";
import { TokenPayload, Role } from "../types/custom";

const JWT_SECRET = process.env.JWT_SECRET as string;

// =======================
// Generate User Token
// =======================
export const generateUserToken = (data: {
    id: string;
    name: string;
}): string => {
    return jwt.sign(
        {
            id: data.id,
            name: data.name,
            role: "user",
        },
        JWT_SECRET,
        { expiresIn: "30d" }
    );
};

// =======================
// Generate Admin Token
// =======================
export const generateAdminToken = (data: {
    id: string;
    name: string;
    type: "super_admin" | "admin";
}): string => {
    return jwt.sign(
        {
            id: data.id,
            name: data.name,
            role: "admin",
            type: data.type,
        },
        JWT_SECRET,
        { expiresIn: "7d" }
    );
};

// =======================
// Generate Restaurant Admin Token
// =======================
export const generateRestaurantAdminToken = (data: {
    id: string;
    name: string;
    type: "owner" | "subadmin" | "branch_manager" | "staff";
    restaurantId: string;
    branchId?: string | null;
}): string => {
    return jwt.sign(
        {
            id: data.id,
            name: data.name,
            role: "restaurant_admin",
            type: data.type,
            restaurantId: data.restaurantId,
            branchId: data.branchId || null,
        },
        JWT_SECRET,
        { expiresIn: "7d" }
    );
};

// =======================
// Verify Token
// =======================
export const verifyToken = (token: string): TokenPayload => {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
};