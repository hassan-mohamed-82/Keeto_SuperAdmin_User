// controllers/admin.controller.ts

import { Request, Response } from "express";
import { db } from "../../models/connection";
import { admins, roles } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";

export const createAdmin = async (req: Request, res: Response) => {
    const { name, email, phoneNumber, password, roleId } = req.body;

    const existingAdmin = await db
        .select()
        .from(admins)
        .where(eq(admins.email, email));

    if (existingAdmin.length > 0) {
        throw new BadRequest("email is already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuidv4();

    await db.insert(admins).values({
        id,
        name,
        email,
        phoneNumber,
        password: hashedPassword,
        roleId,
    });

    return SuccessResponse(res, { message: "create admin success", data: { id } });
};

export const getAllAdmins = async (req: Request, res: Response) => {
    const allAdmins = await db
        .select({
            id: admins.id,
            name: admins.name,
            email: admins.email,
            phoneNumber: admins.phoneNumber,
            status: admins.status,
            createdAt: admins.createdAt,
            updatedAt: admins.updatedAt,
            // بيانات الـ Role
            role: {
                id: roles.id,
                name: roles.name,
                permissions: roles.permissions,
                status: roles.status,
            },
        })
        .from(admins)
        .leftJoin(roles, eq(admins.roleId, roles.id));

    return SuccessResponse(res, { 
        message: "get all admins success", 
        data: allAdmins 
    });
};


export const getAdminById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const admin = await db
        .select({
            id: admins.id,
            name: admins.name,
            email: admins.email,
            phoneNumber: admins.phoneNumber,
            status: admins.status,
            createdAt: admins.createdAt,
            updatedAt: admins.updatedAt,
            // بيانات الـ Role
            role: {
                id: roles.id,
                name: roles.name,
                permissions: roles.permissions,
                status: roles.status,
            },
        })
        .from(admins)
        .leftJoin(roles, eq(admins.roleId, roles.id))
        .where(eq(admins.id, id));

    if (admin.length === 0) {
        throw new NotFound("admin not found");
    }

    return SuccessResponse(res, { 
        message: "get admin by id success", 
        data: admin[0] 
    });
};


export const updateAdmin = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, email, phoneNumber, roleId } = req.body;

    const existingAdmin = await db
        .select()
        .from(admins)
        .where(eq(admins.id, id));

    if (existingAdmin.length === 0) {
        throw new NotFound("admin not found");
    }

    const updateData: any = {
        updatedAt: new Date()
    };

    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (phoneNumber) updateData.phoneNumber = phoneNumber;
    if (roleId) updateData.roleId = roleId;

    if (Object.keys(updateData).length === 1) {
        throw new BadRequest("no data to update");
    }

    await db
        .update(admins)
        .set(updateData)
        .where(eq(admins.id, id));

    return SuccessResponse(res, { message: "update admin success" });
};

export const deleteAdmin = async (req: Request, res: Response) => {
    const { id } = req.params;

    const admin = await db
        .select()
        .from(admins)
        .where(eq(admins.id, id));

    if (admin.length === 0) {
        throw new NotFound("admin not found");
    }

    await db.delete(admins).where(eq(admins.id, id));

    return SuccessResponse(res, { message: "delete admin success" });
};


export const toggleAdminStatus = async (req: Request, res: Response) => {
    const { id } = req.params;

    const admin = await db
        .select()
        .from(admins)
        .where(eq(admins.id, id));

    if (admin.length === 0) {
        throw new NotFound("admin not found");
    }

    const newStatus = admin[0].status === "active" ? "inactive" : "active";

    await db
        .update(admins)
        .set({
            status: newStatus,
            updatedAt: new Date()
        })
        .where(eq(admins.id, id));

    return SuccessResponse(res, { message: `toggle admin status success` });
};


export const select=async(req:Request,res:Response)=>{
 
    const allroles= await db.select().from(roles);
    
    return SuccessResponse(res,{message:"get all roles success",data:allroles});
}