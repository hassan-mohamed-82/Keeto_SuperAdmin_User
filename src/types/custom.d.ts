export type Role = 'admin' | 'teacher' | 'parent' | 'student';

export interface TokenPayload {
  id: string;
  name: string;
  role: Role;
  // permissions: Permission[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AppUser;
      admin?: AppUser;
    }
  }
}

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

export interface PermissionAction {
  id?: string;  // ✅ optional
  action: ActionName;
}

export interface Permission {
  module: ModuleName;
  actions: PermissionAction[];
}