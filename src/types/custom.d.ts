// =======================
// Role System (Updated)
// =======================
export type Role = "user" | "admin" | "restaurant_admin" | "sales" | "shipping_company" | "delivery_man";

// =======================
// App User (Request.user)
// =======================
export interface AppUser {
    id: string;
    _id?: string; // MongoDB fallback
    name?: string;
    role: Role;
    isGuest?: boolean;

    // restaurant system
    type?: "super_admin" | "admin" | "owner" | "subadmin" | "branch_manager" | "staff" | "shipping_admin" | "delivery_man";

    restaurantId?: string | null;
    branchId?: string | null;
    shippingCompanyId?: string | null;
    deliveryManId?: string | null;

    // Phase 2: Shipping company & courier fields
    companyRole?: "admin" | "dispatcher" | "viewer" | null;
    workType?: "restaurant_shift" | "outsource" | null;
    tokenVersion?: number;
}

// =======================
// Token Payload
// =======================
export interface TokenPayload {
    id: string;
    name?: string;
    email?: string;
    phone?: string;
    role: Role;
    type?: string;
    restaurantId?: string;
    branchId?: string;
    shippingCompanyId?: string;
    deliveryManId?: string;
    isGuest?: boolean;
    companyRole?: "admin" | "dispatcher" | "viewer";
    workType?: "restaurant_shift" | "outsource";
    tokenVersion?: number;
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
    | "foods"
    | "Sales";

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