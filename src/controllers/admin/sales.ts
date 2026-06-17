// controllers/admin/SalesController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { sales, restaurants } from "../../models/schema";
import { eq, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";
import { v4 as uuidv4 } from "uuid";

// ==========================================
// 1. إنشاء مندوب مبيعات جديد
// ==========================================
export const createSales = async (req: Request, res: Response) => {
    const { name, phone, email, points, status } = req.body;

    if (!name) throw new BadRequest("Sales name is required");

    const newSalesId = uuidv4();

    await db.insert(sales).values({
        id: newSalesId,
        name,
        phone: phone || null,
        email: email || null,
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
    const { name, phone, email, points, status } = req.body;

    const [existing] = await db.select().from(sales).where(eq(sales.id, id)).limit(1);
    if (!existing) throw new NotFound("Sales representative not found");

    await db.update(sales)
        .set({
            name: name ?? existing.name,
            phone: phone !== undefined ? phone : existing.phone,
            email: email !== undefined ? email : existing.email,
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