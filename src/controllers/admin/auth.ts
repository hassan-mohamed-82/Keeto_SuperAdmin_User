import { Request, Response } from "express";
import { db } from "../../models/connection";
import { admins, roles } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { UnauthorizedError } from "../../Errors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Permission, Role } from "../../types/custom";
import { generateAdminToken } from "../../utils/jwt";

export async function login(req: Request, res: Response) {
    const { email, password } = req.body;
    if (!email || !password) {
        throw new BadRequest("Email and password are required");
    }
    const admin = await db.select().from(admins).where(eq(admins.email, email));
    if (admin.length === 0) {
        throw new UnauthorizedError("Invalid Credentials");
    }
    const isPasswordValid = await bcrypt.compare(password, admin[0].password);
    if (!isPasswordValid) {
        throw new UnauthorizedError("Invalid Credentials");
    }
    if (admin[0].status === "inactive") {
        throw new UnauthorizedError("Admin is inactive");
    }

    let role = null;
    if (admin[0].roleId) {
        role = await db.select().from(roles).where(eq(roles.id, admin[0].roleId));
    }
    const tokenPayload = {
        id: admin[0].id,
        name: admin[0].name,
        role: (role && role[0] ? role[0].name : "admin") as Role,
        // permissions: admin[0].permissions,
    };

    const token = generateAdminToken(tokenPayload);


    return SuccessResponse(res, {
        message: "Admin logged in successfully", token, admin: {
            name: admin[0].name,
            email: admin[0].email,
            phoneNumber: admin[0].phoneNumber,
            roleId: admin[0].roleId,
            permissions: admin[0].permissions,
            status: admin[0].status,
        }
    }, 200);
}