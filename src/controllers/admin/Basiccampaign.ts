import { Request, Response } from "express";
import { db } from "../../models/connection";
import { basiccampaign } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

export const createBasiccampaign = async (req: Request, res: Response) => {
    const { Title, description, image, status, startDate, endDate, dailystarttime, dailyendtime } = req.body;

    if (!Title || !startDate || !endDate || !dailystarttime || !dailyendtime) {
        throw new BadRequest("Title, startDate, endDate, dailystarttime, and dailyendtime are required");
    }

    const id = uuidv4();

    await db.insert(basiccampaign).values({
        id,
        Title,
        description: description || null,
        image: image || null,
        status: status || "active",
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        dailystarttime,
        dailyendtime,
    });

    return SuccessResponse(res, { message: "Create basic campaign success", data: { id } }, 201);
};

export const getAllBasiccampaigns = async (req: Request, res: Response) => {
    const allCampaigns = await db
        .select({
            id: basiccampaign.id,
            Title: basiccampaign.Title,
            description: basiccampaign.description,
            image: basiccampaign.image,
            status: basiccampaign.status,
            startDate: basiccampaign.startDate,
            endDate: basiccampaign.endDate,
            dailystarttime: basiccampaign.dailystarttime,
            dailyendtime: basiccampaign.dailyendtime,
            createdAt: basiccampaign.createdAt,
            updatedAt: basiccampaign.updatedAt,
        })
        .from(basiccampaign);

    return SuccessResponse(res, { message: "Get all basic campaigns success", data: allCampaigns });
};

export const getBasiccampaignById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const campaign = await db
        .select({
            id: basiccampaign.id,
            Title: basiccampaign.Title,
            description: basiccampaign.description,
            image: basiccampaign.image,
            status: basiccampaign.status,
            startDate: basiccampaign.startDate,
            endDate: basiccampaign.endDate,
            dailystarttime: basiccampaign.dailystarttime,
            dailyendtime: basiccampaign.dailyendtime,
            createdAt: basiccampaign.createdAt,
            updatedAt: basiccampaign.updatedAt,
        })
        .from(basiccampaign)
        .where(eq(basiccampaign.id, id))
        .limit(1);

    if (!campaign[0]) {
        throw new NotFound("Basic campaign not found");
    }

    return SuccessResponse(res, { message: "Get basic campaign by id success", data: campaign[0] });
};

export const updateBasiccampaign = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { Title, description, image, status, startDate, endDate, dailystarttime, dailyendtime } = req.body;

    const existingCampaign = await db
        .select()
        .from(basiccampaign)
        .where(eq(basiccampaign.id, id))
        .limit(1);

    if (!existingCampaign[0]) {
        throw new NotFound("Basic campaign not found");
    }

    const updateData: any = {
        updatedAt: new Date(),
    };

    if (Title) updateData.Title = Title;
    if (description !== undefined) updateData.description = description;
    if (image !== undefined) updateData.image = image;
    if (status) updateData.status = status;
    if (startDate) updateData.startDate = new Date(startDate);
    if (endDate) updateData.endDate = new Date(endDate);
    if (dailystarttime) updateData.dailystarttime = dailystarttime;
    if (dailyendtime) updateData.dailyendtime = dailyendtime;

    if (Object.keys(updateData).length === 1) {
        throw new BadRequest("No data to update");
    }

    await db.update(basiccampaign).set(updateData).where(eq(basiccampaign.id, id));

    return SuccessResponse(res, { message: "Update basic campaign success" });
};

export const deleteBasiccampaign = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingCampaign = await db
        .select()
        .from(basiccampaign)
        .where(eq(basiccampaign.id, id))
        .limit(1);

    if (!existingCampaign[0]) {
        throw new NotFound("Basic campaign not found");
    }

    await db.delete(basiccampaign).where(eq(basiccampaign.id, id));

    return SuccessResponse(res, { message: "Delete basic campaign success" });
};

export const updateBasiccampaignStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;

    const existingCampaign = await db
        .select()
        .from(basiccampaign)
        .where(eq(basiccampaign.id, id))
        .limit(1);

    if (!existingCampaign[0]) {
        throw new NotFound("Basic campaign not found");
    }

    await db.update(basiccampaign).set({ status }).where(eq(basiccampaign.id, id));

    return SuccessResponse(res, { message: "Update basic campaign status success" });
};
