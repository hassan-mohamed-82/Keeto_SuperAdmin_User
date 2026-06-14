import { Request, Response } from "express";
import { db } from "../../models/connection";
import { selectReasons } from "../../models/schema"; 
import { eq, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound } from "../../Errors";
import { v4 as uuidv4 } from "uuid";

// تعريف النوع الخاص بالحالة عشان TypeScript ما يعترضش
type ReasonStatus = "active" | "inactive";

// ==========================================
// 1. إنشاء سبب جديد (Create)
// ==========================================
export const createReason = async (req: Request, res: Response) => {
    const { name, status, type } = req.body;

    if (!name || !type) {
        throw new BadRequest("Reason name and type are required");
    }

    const id = uuidv4();

    await db.insert(selectReasons).values({
        id,
        name,
        type,
        // لو مبعتش حالة، الديفولت هيكون active زي ما أنت عامل في الداتا بيز
        status: (status as ReasonStatus) || "active", 
    });

    const [newReason] = await db.select().from(selectReasons).where(eq(selectReasons.id, id));

    return SuccessResponse(res, {
        message: "Reason created successfully",
        data: newReason,
    });
};

// ==========================================
// 2. جلب كل الأسباب (Read All)
// ==========================================
export const getAllReasons = async (req: Request, res: Response) => {
    const reasons = await db
        .select()
        .from(selectReasons)
        .orderBy(desc(selectReasons.createdAt));

    return SuccessResponse(res, {
        message: "Reasons fetched successfully",
        data: reasons,
    });
};

// ==========================================
// 3. جلب سبب معين بالـ ID (Read One)
// ==========================================
export const getReasonById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [reason] = await db.select().from(selectReasons).where(eq(selectReasons.id, id));

    if (!reason) {
        throw new NotFound("Reason not found");
    }

    return SuccessResponse(res, {
        data: reason,
    });
};

// ==========================================
// 4. تعديل السبب (Update Name & Status)
// ==========================================
export const updateReason = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, status } = req.body;

    const [existing] = await db.select().from(selectReasons).where(eq(selectReasons.id, id));
    if (!existing) {
        throw new NotFound("Reason not found");
    }

    // تجهيز الداتا اللي هتتحدث بناءً على اللي مبعوت في الـ Body
    const updateData: any = {};
    if (name) updateData.name = name;
    if (status) updateData.status = status as ReasonStatus;

    await db.update(selectReasons)
        .set(updateData)
        .where(eq(selectReasons.id, id));

    const [updatedReason] = await db.select().from(selectReasons).where(eq(selectReasons.id, id));

    return SuccessResponse(res, {
        message: "Reason updated successfully",
        data: updatedReason,
    });
};

// ==========================================
// 5. حذف السبب (Delete)
// ==========================================
export const deleteReason = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existing] = await db.select().from(selectReasons).where(eq(selectReasons.id, id));
    if (!existing) {
        throw new NotFound("Reason not found");
    }

    await db.delete(selectReasons).where(eq(selectReasons.id, id));

    return SuccessResponse(res, {
        message: "Reason deleted successfully",
    });
};