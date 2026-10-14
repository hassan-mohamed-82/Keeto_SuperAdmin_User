import jwt from "jsonwebtoken";
import { TokenPayload, Role } from "../types/custom";

const JWT_SECRET = process.env.JWT_SECRET as string;

// =======================
// Generate User Token
// =======================
export const generateUserToken = (data: {
    id: string;
    name: string;
    restaurantId: string | null;
}): string => {
    return jwt.sign(
        {
            id: data.id,
            name: data.name,
            role: "user",
            restaurantId: data.restaurantId || null
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
// Generate Sales Token
// =======================
export const generateSalesToken = (data: {
    id: string;
    name: string;
}): string => {
    return jwt.sign(
        {
            id: data.id,
            name: data.name,
            role: "sales",
        },
        JWT_SECRET,
        { expiresIn: "30d" }
    );
};

// =======================
// Generate Guest Token
// =======================
export const generateGuestToken = (data: {
    id: string;
    restaurantId?: string | null;
}): string => {
    return jwt.sign(
        {
            id: data.id,
            name: "Guest",
            role: "user",
            isGuest: true,
            restaurantId: data.restaurantId || null,
        },
        JWT_SECRET,
        { expiresIn: "30d" }
    );
};

// =======================
// Generate Shipping Company Token (User-level per D6)
// =======================
export const generateShippingCompanyToken = (data: {
    id: string; // shipping_company_users.id
    shippingCompanyId: string; // shipping_companies.id
    name: string;
    email: string;
    companyRole?: "admin" | "dispatcher" | "viewer";
    tokenVersion?: number;
}): string => {
    return jwt.sign(
        {
            id: data.id,
            name: data.name,
            email: data.email,
            role: "shipping_company",
            type: "shipping_admin",
            shippingCompanyId: data.shippingCompanyId,
            companyRole: data.companyRole || "admin",
            tokenVersion: data.tokenVersion ?? 0,
        },
        JWT_SECRET,
        { expiresIn: "30d" }
    );
};

// =======================
// Generate Delivery Man Token
// =======================
export const generateDeliveryManToken = (data: {
    id: string;
    name: string;
    phone?: string;
    email?: string;
    restaurantId?: string | null;
    branchId?: string | null;
    shippingCompanyId?: string | null;
    deliveryType?: "restaurant" | "outsource";
}): string => {
    return jwt.sign(
        {
            id: data.id,
            name: data.name,
            phone: data.phone || undefined,
            email: data.email || undefined,
            role: "delivery_man",
            type: "delivery_man",
            restaurantId: data.restaurantId || null,
            branchId: data.branchId || null,
            shippingCompanyId: data.shippingCompanyId || null,
            deliveryManId: data.id,
            deliveryType: data.deliveryType || "outsource",
        },
        JWT_SECRET,
        { expiresIn: "30d" }
    );
};

// =======================
// Verify Token
// =======================
export const verifyToken = (token: string): TokenPayload => {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
};