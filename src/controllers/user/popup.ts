import { Request, Response } from "express";
import { db } from "../../models/connection";
import { popup } from "../../models/schema/admin/popup";
import { eq, and, gte, lte } from "drizzle-orm";
import { NotFound } from "../../Errors";
import { SuccessResponse } from "../../utils/response";

// ─── Get All Active Popups (filtered by date and status) ───
export const getActivePopups = async (req: Request, res: Response) => {
    const now = new Date();

    const activePopups = await db
        .select({
            id: popup.id,
            Title: popup.Title,
            TitleAr: popup.TitleAr,
            TitleFr: popup.TitleFr,
            description: popup.description,
            descriptionAr: popup.descriptionAr,
            descriptionFr: popup.descriptionFr,
            image: popup.image,
            imageAr: popup.imageAr,
            imageFr: popup.imageFr,
            type: popup.type,
            startDate: popup.startDate,
            endDate: popup.endDate,
        })
        .from(popup)
        .where(
            and(
                eq(popup.status, "active"),
                lte(popup.startDate, now),
                gte(popup.endDate, now)
            )
        );

    return SuccessResponse(res, { message: "Get active popups success", data: activePopups });
};

// ─── Get Active Popup By ID ───
export const getPopupById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const result = await db
        .select({
            id: popup.id,
            Title: popup.Title,
            TitleAr: popup.TitleAr,
            TitleFr: popup.TitleFr,
            description: popup.description,
            descriptionAr: popup.descriptionAr,
            descriptionFr: popup.descriptionFr,
            image: popup.image,
            imageAr: popup.imageAr,
            imageFr: popup.imageFr,
            type: popup.type,
            startDate: popup.startDate,
            endDate: popup.endDate,
        })
        .from(popup)
        .where(
            and(
                eq(popup.id, id),
                eq(popup.status, "active")
            )
        )
        .limit(1);

    if (!result[0]) {
        throw new NotFound("Popup not found");
    }

    return SuccessResponse(res, { message: "Get popup by id success", data: result[0] });
};
