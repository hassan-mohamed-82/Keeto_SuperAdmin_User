import { socialmedia, platforms } from "../../models/schema";
import { db } from "../../models/connection";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors";
import { Request, Response } from "express";

export const getSocialMedia = async (req: Request, res: Response) => {
  const { resId } = req.params;
  if (!resId) {
    throw new NotFound("restaurant id");
  }

  const data = await db
    .select({
      id: socialmedia.id,
      restaurantid: socialmedia.restaurantid,
      platformId: socialmedia.platformId,
      link: socialmedia.link,
      icon: platforms.logo,
      name: platforms.name,
      createdAt: socialmedia.createdAt,
      updatedAt: socialmedia.updatedAt,
    })
    .from(socialmedia)
    .innerJoin(platforms, eq(socialmedia.platformId, platforms.id))
    .where(eq(socialmedia.restaurantid, resId));

  return SuccessResponse(res, { data });
};