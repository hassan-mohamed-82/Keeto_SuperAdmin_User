// controllers/branch.controller.ts

import { Request, Response } from "express";
import { db } from "../../models/connection";
import { branches, restaurants, zones } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";

export const createBranch = async (req: Request, res: Response) => {
    const { restaurantId, name, address, phoneNumber, zoneId, nameAr, nameFr, addressAr, addressFr,deliveryRadiusKm,lat,lng } = req.body;

    if (!name || !address || !zoneId) {
        throw new BadRequest("Missing required fields (name, address, zoneId)");
    }

    // التأكد إن منطقة التوصيل دي موجودة
    const zoneExists = await db.select().from(zones).where(eq(zones.id, zoneId)).limit(1);
    if (!zoneExists[0]) throw new BadRequest("Zone not found");

    const id = uuidv4();

    await db.insert(branches).values({
        id,
        restaurantId,
        name,
        nameAr,
        nameFr,
        address,
        addressAr,
        addressFr,
        deliveryRadiusKm,
        lat,
        lng,
        phoneNumber: phoneNumber || null,
        zoneId,
        status: "active"
    });

    return SuccessResponse(res, { message: "Branch created successfully", data: { id } }, 201);
};

export const getMyBranches = async (req: Request, res: Response) => {

    const myBranches = await db.select({
        id: branches.id,
        name: branches.name,
        nameAr: branches.nameAr,
        nameFr: branches.nameFr,
        address: branches.address,
        addressAr: branches.addressAr,
        addressFr: branches.addressFr,
        deliveryRadiusKm: branches.deliveryRadiusKm,
        lat: branches.lat,
        lng: branches.lng,
        phoneNumber: branches.phoneNumber,
        status: branches.status,
        zone: {
            id: zones.id,
            name: zones.name,
            nameAr: zones.nameAr,
            nameFr: zones.nameFr,
        },
        restaurantName: restaurants.name,
    })
    .from(branches)
    .leftJoin(zones, eq(branches.zoneId, zones.id))
    .leftJoin(restaurants, eq(branches.restaurantId, restaurants.id))
    return SuccessResponse(res, { message: "Get branches success", data: myBranches });
};

export const getBranchById = async (req: Request, res: Response) => {
    const { id } = req.params;
    const branch = await db.select({
        id: branches.id,
        name: branches.name,
        nameAr: branches.nameAr,
        nameFr: branches.nameFr,
        address: branches.address,
        addressAr: branches.addressAr,
        addressFr: branches.addressFr,
        deliveryRadiusKm: branches.deliveryRadiusKm,
        lat: branches.lat,
        lng: branches.lng,
        phoneNumber: branches.phoneNumber,
        status: branches.status,
        zone: {
            id: zones.id,
            name: zones.name,
            nameAr: zones.nameAr,
            nameFr: zones.nameFr,
        },
        restaurantName: restaurants.name,
    })
    .from(branches)
    .leftJoin(zones, eq(branches.zoneId, zones.id))
    .leftJoin(restaurants, eq(branches.restaurantId, restaurants.id))
    .where(eq(branches.id, id))
    .limit(1);


    return SuccessResponse(res, { message: "Get branch by id success", data: branch[0] });
};

export const updateBranch = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { restaurantId,name, address, phoneNumber, zoneId, status, nameAr, nameFr, addressAr, addressFr ,deliveryRadiusKm,lat,lng} = req.body;

    const existingBranch = await db
        .select()
        .from(branches)
        .where(
            and(
                eq(branches.id, id),
                eq(branches.restaurantId, restaurantId)
            )
        )
        .limit(1);

    if (!existingBranch[0]) throw new NotFound("Branch not found or you don't have permission to edit it");

    const updateData: any = {};
    if (name) updateData.name = name;
    if (nameAr !== undefined) updateData.nameAr = nameAr;
    if (nameFr !== undefined) updateData.nameFr = nameFr;
    if (address) updateData.address = address;
    if (addressAr !== undefined) updateData.addressAr = addressAr;
    if (addressFr !== undefined) updateData.addressFr = addressFr;
    if (phoneNumber) updateData.phoneNumber = phoneNumber;
    if (deliveryRadiusKm) updateData.deliveryRadiusKm = deliveryRadiusKm;
    if(restaurantId) updateData.restaurantId = restaurantId;
    if (lat) updateData.lat = lat;
    if (lng) updateData.lng = lng;
    if (zoneId) {
        const zoneExists = await db.select().from(zones).where(eq(zones.id, zoneId)).limit(1);
        if (!zoneExists[0]) throw new BadRequest("Zone not found");
        updateData.zoneId = zoneId;
    }
    if (status) updateData.status = status;

    await db
        .update(branches)
        .set(updateData)
        .where(eq(branches.id, id));

    return SuccessResponse(res, { message: "Branch updated successfully" });
};

export const deleteBranch = async (req: Request, res: Response) => {
    const { id ,restaurantId} = req.params;
    if (!restaurantId) throw new BadRequest("Restaurant ID missing");

    const existingBranch = await db
        .select()
        .from(branches)
        .where(
            and(
                eq(branches.id, id),
                eq(branches.restaurantId, restaurantId)
            )
        )
        .limit(1);

    if (!existingBranch[0]) throw new NotFound("Branch not found or you don't have permission to delete it");

    await db.delete(branches).where(eq(branches.id, id));

    return SuccessResponse(res, { message: "Branch deleted successfully" });
};


export const updateBranchStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    const restaurantId = req.user?.restaurantId || req.user?.id;
    if (!restaurantId) throw new BadRequest("Restaurant ID missing");

    const existingBranch = await db
        .select()
        .from(branches)
        .where(
            and(
                eq(branches.id, id),
                eq(branches.restaurantId, restaurantId)
            )
        )
        .limit(1);

    if (!existingBranch[0]) throw new NotFound("Branch not found or you don't have permission to edit it");

    await db
        .update(branches)
        .set({ status })
        .where(eq(branches.id, id));

    return SuccessResponse(res, { message: "Branch status updated successfully" });
};



export const getallrestraunt = async (req: Request, res: Response) => {
    
    const restaurant = await db.select().from(restaurants);
    return SuccessResponse(res, { message: "Get restaurants success", data: restaurant });
};