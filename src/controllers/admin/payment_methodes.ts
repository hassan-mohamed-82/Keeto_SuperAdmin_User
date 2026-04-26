import { Request, Response } from "express";
import { db } from "../../models/connection";
import { paymentMethods } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors";
import { saveBase64Image } from "../../utils/handleImages";

export const createPaymentMethod = async (req: Request, res: Response) => {
    const { name, nameAr, nameFr, image, description, descriptionAr, descriptionFr, type, isActive } = req.body;
    if(!name || !nameAr || !nameFr || !description || !descriptionAr || !descriptionFr || !type ){
        throw new BadRequest("Missing required fields");
    }
    let imageUrl: string | undefined = undefined;

    if (image) {
        const result = await saveBase64Image(req, image, "basiccampaign");
        imageUrl = result.url;
    }
    const [paymentMethod] = await db.insert(paymentMethods).values({
        name,
        nameAr,
        nameFr,
        image:imageUrl || '',
        description,
        descriptionAr,
        descriptionFr,
        type,
        isActive:isActive || true,
    })
    return SuccessResponse(res, { data: paymentMethod });
};
export const updatePaymentMethod = async (req: Request, res: Response) => {
    const { id, name, nameAr, nameFr, image, description, descriptionAr, descriptionFr, type, isActive } = req.body;
    const [paymentMethod] = await db.update(paymentMethods).set({
        name,
        nameAr,
        nameFr,
        image,
        description,
        descriptionAr,
        descriptionFr,
        type,
        isActive,
    }).where(eq(paymentMethods.id, id));
    return SuccessResponse(res, { data: paymentMethod });
};
export const deletePaymentMethod = async (req: Request, res: Response) => {
    const { id } = req.body;
    const [paymentMethod] = await db.delete(paymentMethods).where(eq(paymentMethods.id, id));
    return SuccessResponse(res, { data: paymentMethod });
};
export const getPaymentMethods = async (req: Request, res: Response) => {
    const paymentMethod = await db.select().from(paymentMethods);
    return SuccessResponse(res, { data: paymentMethod });
};
export const getPaymentMethod = async (req: Request, res: Response) => {
    const { id } = req.params;
    const [paymentMethod] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, id));
    return SuccessResponse(res, { data: paymentMethod });
};
