import { Request, Response } from "express";
import { db } from "../../models/connection";
import { images } from "../../models/schema";
import { eq } from "drizzle-orm";
import { NotFound } from "../../Errors";
import { SuccessResponse } from "../../utils/response";

export const getImages = async (req: Request, res: Response) => {
  const { resId } = req.params;
  if (!resId) {
    throw new NotFound("restaurant id");
  }
  const data = await db
    .select()
    .from(images)
    .where(eq(images.restaurantid, resId));

  return SuccessResponse(res, { data });
}
