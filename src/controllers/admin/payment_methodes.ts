import { Request, Response } from "express";
import { db } from "../../models/connection";
import { paymentMethods } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors";
import { saveBase64Image } from "../../utils/handleImages";

export const createPaymentMethod = async (req: Request, res: Response) => {
    const { name, nameAr, isActive } = req.body;
    if(!name || !nameAr ){
        throw new BadRequest("Missing required fields");
    }

    const [paymentMethod] = await db.insert(paymentMethods).values({
        name,
        nameAr,
        isActive:isActive || true,
    })
    return SuccessResponse(res, { data: paymentMethod });
};

export const getPaymentMethods = async (req: Request, res: Response) => {
    const paymentMethod = await db.select().from(paymentMethods);
    return SuccessResponse(res, { data: paymentMethod });
};

export const updatepaymentmethodstatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { isActive } = req.body;
    if( !isActive ){
        throw new BadRequest("Missing required fields");
    }
    const [paymentMethod] = await db.update(paymentMethods).set({
        isActive:isActive || true,
    }).where(eq(paymentMethods.id, id));
    return SuccessResponse(res, { data: paymentMethod });
};