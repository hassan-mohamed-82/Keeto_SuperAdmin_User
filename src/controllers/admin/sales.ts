// controllers/admin/SalesController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { sales, restaurants } from "../../models/schema";
import { eq, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound, UnauthorizedError } from "../../Errors";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";
import { generateSalesToken } from "../../utils/jwt";

// ==========================================
// 1. إنشاء مندوب مبيعات جديد
// ==========================================
export const createSales = async (req: Request, res: Response) => {
    const { name, phone, email, password, points, status } = req.body;

    if (!name) throw new BadRequest("Sales name is required");
    if (!password) throw new BadRequest("Password is required");

    const hashedPassword = await bcrypt.hash(password, 10);

    const newSalesId = uuidv4();

    await db.insert(sales).values({
        id: newSalesId,
        name,
        phone: phone || null,
        email: email || null,
        password: hashedPassword,
        points: points || 0,
        status: status || "active",
    });

    return SuccessResponse(res, {
        message: "Sales representative created successfully",
        data: { id: newSalesId }
    });
};

// ==========================================
// 2. جلب كل موظفين المبيعات (للـ Select Dropdown والجدول)
// ==========================================
export const getAllSales = async (req: Request, res: Response) => {
    const allSales = await db
        .select()
        .from(sales)
        .orderBy(desc(sales.createdAt));

    return SuccessResponse(res, {
        message: "Get all sales success",
        data: allSales
    });
};

// ==========================================
// 3. جلب تفاصيل مندوب معين + المطاعم اللي جابها
// ==========================================
export const getSalesById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [salesRep] = await db.select().from(sales).where(eq(sales.id, id)).limit(1);
    if (!salesRep) throw new NotFound("Sales representative not found");

    // نجيب المطاعم اللي هو سجلها عشان نعرض إنجازاته
    const registeredRestaurants = await db
        .select({
            id: restaurants.id,
            name: restaurants.name,
            type: restaurants.type,
            status: restaurants.status,
            createdAt: restaurants.createdAt,
        })
        .from(restaurants)
        .where(eq(restaurants.salesId, id));

    return SuccessResponse(res, {
        message: "Get sales details success",
        data: {
            ...salesRep,
            restaurants: registeredRestaurants
        }
    });
};

// ==========================================
// 4. تعديل بيانات السيلز (أو تعديل البوينتس)
// ==========================================
export const updateSales = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, phone, email, password, points, status } = req.body;

    const [existing] = await db.select().from(sales).where(eq(sales.id, id)).limit(1);

    let hashedPassword = existing.password;
    if (password) {
        hashedPassword = await bcrypt.hash(password, 10);
    }
    if (!existing) throw new NotFound("Sales representative not found");

    await db.update(sales)
        .set({
            name: name ?? existing.name,
            phone: phone !== undefined ? phone : existing.phone,
            email: email !== undefined ? email : existing.email,
            password: hashedPassword,
            points: points !== undefined ? points : existing.points,
            status: status ?? existing.status,
            updatedAt: new Date()
        })
        .where(eq(sales.id, id));

    return SuccessResponse(res, { message: "Sales representative updated successfully" });
};

// ==========================================
// 5. مسح مندوب مبيعات
// ==========================================
export const deleteSales = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existing] = await db.select().from(sales).where(eq(sales.id, id)).limit(1);
    if (!existing) throw new NotFound("Sales representative not found");

    // تأكد إن المندوب ملوش مطاعم متسجلة باسمه قبل ما تمسحه (أو اعمل set null)
    const linkedRestaurants = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.salesId, id)).limit(1);
    
    if (linkedRestaurants.length > 0) {
        throw new BadRequest("Cannot delete this sales rep because they have assigned restaurants. Update the restaurants first.");
    }

    await db.delete(sales).where(eq(sales.id, id));

    return SuccessResponse(res, { message: "Sales representative deleted successfully" });
};

// ==========================================
// 6. تسجيل دخول مندوب مبيعات
// ==========================================
export const loginSales = async (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
        throw new BadRequest("Email and password are required");
    }

    const [salesRep] = await db.select().from(sales).where(eq(sales.email, email)).limit(1);
    if (!salesRep || !salesRep.password) {
        throw new UnauthorizedError("Invalid Credentials");
    }

    const isPasswordValid = await bcrypt.compare(password, salesRep.password);
    if (!isPasswordValid) {
        throw new UnauthorizedError("Invalid Credentials");
    }

    if (salesRep.status === "inactive") {
        throw new UnauthorizedError("Sales representative is inactive");
    }

    const token = generateSalesToken({
        id: salesRep.id,
        name: salesRep.name,
    });

    return SuccessResponse(res, {
        message: "Sales representative logged in successfully",
        token,
        sales: {
            id: salesRep.id,
            name: salesRep.name,
            email: salesRep.email,
            phone: salesRep.phone,
            points: salesRep.points,
            status: salesRep.status,
        }
    });
};