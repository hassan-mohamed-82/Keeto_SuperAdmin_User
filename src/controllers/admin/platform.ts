import { Request, Response } from "express";
import { db } from "../../models/connection";
import { platforms } from "../../models/schema";
import { eq } from "drizzle-orm";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { SuccessResponse } from "../../utils/response";
import { saveBase64Image, handleImageUpdate, deleteImage } from "../../utils/handleImages";
import { v4 as uuidv4 } from "uuid";

// 1. Create Platform
export const createPlatform = async (req: Request, res: Response) => {
    const { name, logo } = req.body;

    if (!name || !logo) {
        throw new BadRequest("Platform name and logo are required");
    }

    // حفظ الصورة من Base64 والحصول على رابط الصورة المباشر
    const { url: iconUrl } = await saveBase64Image(req, logo, "icons");

    const id = uuidv4();

    await db.insert(platforms).values({
        id,
        name,
        logo: iconUrl
    });

    const [newPlatform] = await db.select().from(platforms).where(eq(platforms.id, id));

    return SuccessResponse(res, {
        message: "Platform created successfully",
        data: newPlatform,
    }, 201);
};

// 2. Get All Platforms
export const getAllPlatforms = async (_req: Request, res: Response) => {
    const allPlatforms = await db.select().from(platforms);

    return SuccessResponse(res, {
        message: "Platforms retrieved successfully",
        data: allPlatforms,
    });
};

// 3. Get Platform By ID
export const getPlatformById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [platform] = await db.select().from(platforms).where(eq(platforms.id, id)).limit(1);

    if (!platform) {
        throw new NotFound("Platform not found");
    }

    return SuccessResponse(res, {
        message: "Platform retrieved successfully",
        data: platform,
    });
};

// 4. Update Platform
export const updatePlatform = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, logo } = req.body;

    const [existing] = await db.select().from(platforms).where(eq(platforms.id, id)).limit(1);
    if (!existing) {
        throw new NotFound("Platform not found");
    }

    let logoUrl = existing.logo;
    if (logo) {
        logoUrl = await handleImageUpdate(req, existing.logo, logo, "icons");
    }

    await db.update(platforms)
        .set({
            ...(name && { name }),
            logo: logoUrl,
        })
        .where(eq(platforms.id, id));

    const [updatedPlatform] = await db.select().from(platforms).where(eq(platforms.id, id));

    return SuccessResponse(res, {
        message: "Platform updated successfully",
        data: updatedPlatform,
    });
};

// 5. Delete Platform
export const deletePlatform = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existing] = await db.select().from(platforms).where(eq(platforms.id, id)).limit(1);
    if (!existing) {
        throw new NotFound("Platform not found");
    }

    if (existing.logo) {
        await deleteImage(existing.logo);
    }

    await db.delete(platforms).where(eq(platforms.id, id));

    return SuccessResponse(res, { message: "Platform deleted successfully" });
};