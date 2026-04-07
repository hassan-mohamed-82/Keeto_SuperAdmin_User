import { Permission } from "../types/custom";

function parsePermissions(permissions: any): Permission[] {
    if (!permissions) return [];

    // لو Array جاهز
    if (Array.isArray(permissions)) return permissions;

    // لو String
    if (typeof permissions === "string") {
        try {
            let parsed = JSON.parse(permissions);

            // ✅ لو لسه String بعد الـ parse (Double Escaped)
            while (typeof parsed === "string") {
                parsed = JSON.parse(parsed);
            }

            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.error("Error parsing permissions:", error);
            return [];
        }
    }

    return [];
}

function mergePermissions(
    rolePermissions: Permission[],
    adminPermissions: Permission[]
): Permission[] {
    if (!Array.isArray(rolePermissions)) rolePermissions = [];
    if (!Array.isArray(adminPermissions)) adminPermissions = [];

    if (rolePermissions.length === 0) return adminPermissions;
    if (adminPermissions.length === 0) return rolePermissions;

    const merged = [...rolePermissions];

    for (const adminPerm of adminPermissions) {
        if (!adminPerm?.module || !Array.isArray(adminPerm?.actions)) {
            continue;
        }

        const existingIndex = merged.findIndex((p) => p?.module === adminPerm.module);

        if (existingIndex >= 0 && Array.isArray(merged[existingIndex]?.actions)) {
            for (const action of adminPerm.actions) {
                if (!merged[existingIndex].actions.some((a) => a?.action === action?.action)) {
                    merged[existingIndex].actions.push(action);
                }
            }
        } else {
            merged.push(adminPerm);
        }
    }

    return merged;
}