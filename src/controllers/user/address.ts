import{Request,Response} from "express";
import { db } from "../../models/connection";
import { users , addresses, zones} from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound, UnauthorizedError } from "../../Errors";
import { v4 as uuidv4 } from "uuid";

export const getUserAddresses = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id; 

    const userAddresses = await db.select({}).from(addresses).where(eq(addresses.userId, userId));

    return SuccessResponse(res, { data: userAddresses });
};

export const addUserAddress = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id; 
    const { type, title, street, number, floor } = req.body;

    const newAddress = await db.insert(addresses).values({
        id: uuidv4(),
        userId,
        type,
        title,
        street,
        number,
        zoneId: req.body.zoneId,
        floor,
    });

    return SuccessResponse(res, { message: "Address added successfully", data: newAddress });
};

export const deleteUserAddress = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id; 
    const { addressId } = req.params;

    const existingAddress = await db.select().from(addresses).where(eq(addresses.id, addressId)).limit(1);
    if (!existingAddress[0]) {
        throw new NotFound("Address not found");
    }

    await db.delete(addresses).where(eq(addresses.id, addressId));

    return SuccessResponse(res, { message: "Address deleted successfully" });
};

export const updateUserAddress = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id; 
    const { addressId } = req.params;
    const { type, title, street, number, floor } = req.body;

    const existingAddress = await db.select().from(addresses).where(eq(addresses.id, addressId)).limit(1);
    if (!existingAddress[0]) {
        throw new NotFound("Address not found");
    }

    await db
        .update(addresses)
        .set({ type, title, street, number, floor, zoneId: req.body.zoneId })
        .where(eq(addresses.id, addressId));

    return SuccessResponse(res, { message: "Address updated successfully" });
};

export const getZones = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const zone = await db.select().from(zones);

    return SuccessResponse(res, { data: zone });
}