import { Request, Response } from "express";
import { db } from "../../models/connection";
import { images } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { NotFound } from "../../Errors";
import { SuccessResponse } from "../../utils/response";

export const getImages = async (req: Request, res: Response) => {
  const { resId } = req.params;
  const { branchId } = req.query;

  if (!resId) {
    throw new NotFound("restaurant id");
  }

  // بناء شروط التصفية
  const conditions = [eq(images.restaurantid, resId)];

  // إضافة شرط branchId في حال تم إرساله في الـ Query
  if (branchId && typeof branchId === "string") {
    conditions.push(eq(images.branchId, branchId));
  }

  const data = await db
    .select()
    .from(images)
    .where(and(...conditions));

  return SuccessResponse(res, { data });
};