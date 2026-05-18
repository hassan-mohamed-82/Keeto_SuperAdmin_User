import { Request, Response } from "express";
import { db } from "../../models/connection";
import { popup } from "../../models/schema/admin/popup";
import { eq } from "drizzle-orm";
import { handleImageUpdate, deleteImage, saveBase64Image } from "../../utils/handleImages";
import { BadRequest, NotFound } from "../../Errors";
import { SuccessResponse } from "../../utils/response";
import { v4 as uuidv4 } from "uuid";

const IMAGE_FOLDER = "popup";

// ─── Create Popup ───
export const createPopup = async (req: Request, res: Response) => {
    const {
        Title, TitleAr, TitleFr,
        description, descriptionAr, descriptionFr,
        image, imageAr, imageFr,
        type, status, startDate, endDate,
        restaurantId,
    } = req.body;

    if (!Title || !startDate || !endDate) {
        throw new BadRequest("Title, startDate, and endDate are required");
    }

    let imageUrl: string | undefined = undefined;
    let imageArUrl: string | undefined = undefined;
    let imageFrUrl: string | undefined = undefined;

    if (image) {
        const result = await saveBase64Image(req, image, IMAGE_FOLDER);
        imageUrl = result.url;
    }
    if (imageAr) {
        const result = await saveBase64Image(req, imageAr, IMAGE_FOLDER);
        imageArUrl = result.url;
    }
    if (imageFr) {
        const result = await saveBase64Image(req, imageFr, IMAGE_FOLDER);
        imageFrUrl = result.url;
    }

    const id = uuidv4();

    await db.insert(popup).values({
        id,
        Title,
        TitleAr: TitleAr || null,
        TitleFr: TitleFr || null,
        description: description || null,
        descriptionAr: descriptionAr || null,
        descriptionFr: descriptionFr || null,
        image: imageUrl || null,
        imageAr: imageArUrl || null,
        imageFr: imageFrUrl || null,
        type: type || "mykeeto_app",
        status: status || "active",
        restaurantId: restaurantId || null,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
    });

    return SuccessResponse(res, { message: "Popup created successfully", data: { id } }, 201);
};

// ─── Get All Popups ───
export const getAllPopups = async (req: Request, res: Response) => {
    const allPopups = await db
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
            status: popup.status,
            startDate: popup.startDate,
            endDate: popup.endDate,
            createdAt: popup.createdAt,
            updatedAt: popup.updatedAt,
        })
        .from(popup);

    return SuccessResponse(res, { message: "Get all popups success", data: allPopups });
};

// ─── Get Popup By ID ───
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
            status: popup.status,
            startDate: popup.startDate,
            endDate: popup.endDate,
            createdAt: popup.createdAt,
            updatedAt: popup.updatedAt,
        })
        .from(popup)
        .where(eq(popup.id, id))
        .limit(1);

    if (!result[0]) {
        throw new NotFound("Popup not found");
    }

    return SuccessResponse(res, { message: "Get popup by id success", data: result[0] });
};

// ─── Update Popup ───
export const updatePopup = async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
        Title, TitleAr, TitleFr,
        description, descriptionAr, descriptionFr,
        image, imageAr, imageFr,
        type, status, startDate, endDate,
    } = req.body;

    const existing = await db
        .select()
        .from(popup)
        .where(eq(popup.id, id))
        .limit(1);

    if (!existing[0]) {
        throw new NotFound("Popup not found");
    }

    const updateData: any = {
        updatedAt: new Date(),
    };

    if (Title !== undefined) updateData.Title = Title;
    if (TitleAr !== undefined) updateData.TitleAr = TitleAr;
    if (TitleFr !== undefined) updateData.TitleFr = TitleFr;
    if (description !== undefined) updateData.description = description;
    if (descriptionAr !== undefined) updateData.descriptionAr = descriptionAr;
    if (descriptionFr !== undefined) updateData.descriptionFr = descriptionFr;
    if (type !== undefined) updateData.type = type;
    if (status !== undefined) updateData.status = status;
    if (startDate !== undefined) updateData.startDate = new Date(startDate);
    if (endDate !== undefined) updateData.endDate = new Date(endDate);

    // Handle images using handleImageUpdate
    if (image !== undefined) {
        updateData.image = await handleImageUpdate(req, existing[0].image, image, IMAGE_FOLDER);
    }
    if (imageAr !== undefined) {
        updateData.imageAr = await handleImageUpdate(req, existing[0].imageAr, imageAr, IMAGE_FOLDER);
    }
    if (imageFr !== undefined) {
        updateData.imageFr = await handleImageUpdate(req, existing[0].imageFr, imageFr, IMAGE_FOLDER);
    }

    if (Object.keys(updateData).length === 1) {
        throw new BadRequest("No data to update");
    }

    await db.update(popup).set(updateData).where(eq(popup.id, id));

    return SuccessResponse(res, { message: "Popup updated successfully" });
};

// ─── Delete Popup ───
export const deletePopup = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existing = await db
        .select()
        .from(popup)
        .where(eq(popup.id, id))
        .limit(1);

    if (!existing[0]) {
        throw new NotFound("Popup not found");
    }

    // Delete associated images
    if (existing[0].image) await deleteImage(existing[0].image);
    if (existing[0].imageAr) await deleteImage(existing[0].imageAr);
    if (existing[0].imageFr) await deleteImage(existing[0].imageFr);

    await db.delete(popup).where(eq(popup.id, id));

    return SuccessResponse(res, { message: "Popup deleted successfully" });
};

// ─── Toggle Popup Status ───
export const updatePopupStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["active", "inactive"].includes(status)) {
        throw new BadRequest("Status must be 'active' or 'inactive'");
    }

    const existing = await db
        .select()
        .from(popup)
        .where(eq(popup.id, id))
        .limit(1);

    if (!existing[0]) {
        throw new NotFound("Popup not found");
    }

    await db.update(popup).set({ status }).where(eq(popup.id, id));

    return SuccessResponse(res, { message: "Popup status updated successfully" });
};
