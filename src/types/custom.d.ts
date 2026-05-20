// =======================
// Role System (Updated)
// =======================
export type Role = "user" | "admin" | "restaurant_admin";

// =======================
// App User (Request.user)
// =======================
export interface AppUser {
    id: string;
    _id?: string; // MongoDB fallback
    name?: string;
    role: Role;

    // restaurant system
    type?: "super_admin" | "admin" | "owner" | "subadmin" | "branch_manager" | "staff";

    restaurantId?: string | null;
    branchId?: string | null;
}

// =======================
// Token Payload
// =======================
export interface TokenPayload {
    id: string;
    name?: string;
    role: Role;
    type?: string;
    restaurantId?: string;
    branchId?: string;
}

// =======================
// API Response
// =======================
export interface ApiResponse<T = any> {
    success: boolean;
    message: string;
    data?: T;
    error?: {
        code: number;
        message: string;
        details?: any;
    };
}

// =======================
// Permissions System
// =======================
export type ActionName = "create" | "read" | "update" | "delete";

export type ModuleName =
    | "users"
    | "admins"
    | "restaurants"
    | "orders"
    | "favorites"
    | "foods";

export interface PermissionAction {
    id?: string;
    action: ActionName;
}

export interface Permission {
    module: ModuleName;
    actions: PermissionAction[];
}

// =======================
// Express Extend
// =======================
declare global {
    namespace Express {
        interface Request {
            user?: AppUser;
        }
    }
}