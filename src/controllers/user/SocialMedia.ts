import { socialmedia } from "../../models/schema";
import { db } from "../../models/connection";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors";
import { Request, Response } from "express";

export const getSocialMedia = async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = await db.select().from(socialmedia).where(eq(socialmedia.id, id));
  
  return SuccessResponse(res, { data: data[0] });
}