import { Request, Response } from "express";
import { db } from "../../models/connection";
import { admins, rolesadmin as roles } from "../../models/schema"; // لم نعد بحاجة لاستيراد roles هنا للاستعلام
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, UnauthorizedError } from "../../Errors";
import bcrypt from "bcrypt";
import { generateAdminToken } from "../../utils/jwt";

export async function login(req: Request, res: Response) {
    const { email, password } = req.body;
    
    if (!email || !password) {
        throw new BadRequest("Email and password are required");
    }
    
    // 🔥 جلب الأدمن مع الرول باستخدام LEFT JOIN
    const result = await db
        .select({
            admin: admins,
            role: roles, // الجداول التي نريد إرجاعها
        })
        .from(admins)
        .leftJoin(roles, eq(admins.roleId, roles.id))
        .where(eq(admins.email, email));
    
    if (result.length === 0) {
        throw new UnauthorizedError("Invalid Credentials");
    }

    const { admin, role } = result[0]; // فصل بيانات الأدمن والرول
    
    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
        throw new UnauthorizedError("Invalid Credentials");
    }
    
    if (admin.status === "inactive") {
        throw new UnauthorizedError("Admin is inactive");
    }

    const tokenPayload = {
        id: admin.id,
        name: admin.name,
        type: admin.type as "super_admin" | "admin",
    };

    const token = generateAdminToken(tokenPayload);

    return SuccessResponse(res, {
        message: "Admin logged in successfully", 
        token, 
        admin: {
            name: admin.name,
            email: admin.email,
            phoneNumber: admin.phoneNumber,
            role: role || null, // 👈 إذا لم يكن له رول سيرجع null
            permissions: admin.permissions,
            status: admin.status,
            type: admin.type
        }
    }, 200);
}