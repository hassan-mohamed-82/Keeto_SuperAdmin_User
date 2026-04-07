import { Request, Response } from "express";
import { db } from "../../models/connection";
import { zones, cities } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

export const createZone = async (req: Request, res: Response) => {
    const { name, displayName, cityId,lat,lng } = req.body;

    if (!name || !displayName || !cityId || !lat || !lng) {
        throw new BadRequest("Name, displayName, cityId, lat, and lng are required");
    }

    const existingCity = await db
        .select()
        .from(cities)
        .where(eq(cities.id, cityId))
        .limit(1);

    if (!existingCity[0]) {
        throw new BadRequest("City not found");
    }

    const existingZone = await db
        .select()
        .from(zones)
        .where(and(eq(zones.name, name), eq(zones.cityId, cityId), eq(zones.status, "active"), eq(zones.lat, lat), eq(zones.lng, lng)))
        .limit(1);

    if (existingZone[0]) {
        throw new BadRequest("Zone already exists in this city");
    }

    const id = uuidv4();

    await db.insert(zones).values({
        id,
        name,
        displayName,
        lat,
        lng,
        status: "active",
        cityId,
    });

    return SuccessResponse(res, { message: "Create zone success", data: { id } }, 201);
};

export const getAllZones = async (req: Request, res: Response) => {
    const allZones = await db
        .select({
            id: zones.id,
            name: zones.name,
            displayName: zones.displayName,
            status: zones.status,
            lat: zones.lat,
            lng: zones.lng,
            cityId: zones.cityId,
            createdAt: zones.createdAt,
            updatedAt: zones.updatedAt,
            city: {
                id: cities.id,
                name: cities.name,
                status: cities.status,
            },
        })
        .from(zones)
        .leftJoin(cities, eq(zones.cityId, cities.id));

    return SuccessResponse(res, { message: "Get all zones success", data: allZones });
};

export const getZoneById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const zone = await db
        .select({
            id: zones.id,
            name: zones.name,
            displayName: zones.displayName,
            status: zones.status,
            lat: zones.lat,
            lng: zones.lng,
            cityId: zones.cityId,
            createdAt: zones.createdAt,
            updatedAt: zones.updatedAt,
            city: {
                id: cities.id,
                name: cities.name,
                status: cities.status,
            },
        })
        .from(zones)
        .leftJoin(cities, eq(zones.cityId, cities.id))
        .where(eq(zones.id, id))
        .limit(1);

    if (!zone[0]) {
        throw new NotFound("Zone not found");
    }

    return SuccessResponse(res, { message: "Get zone by id success", data: zone[0] });
};

export const updateZone = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, displayName, status, cityId } = req.body;

    const existingZone = await db
        .select()
        .from(zones)
        .where(eq(zones.id, id))
        .limit(1);

    if (!existingZone[0]) {
        throw new NotFound("Zone not found");
    }

    if (cityId) {
        const existingCity = await db
            .select()
            .from(cities)
            .where(eq(cities.id, cityId))
            .limit(1);

        if (!existingCity[0]) {
            throw new BadRequest("City not found");
        }
    }

    const updateData: any = {
        updatedAt: new Date(),
    };

    if (name) updateData.name = name;
    if (displayName) updateData.displayName = displayName;
    if (status) updateData.status = status;
    if (cityId) updateData.cityId = cityId;

    if (Object.keys(updateData).length === 1) {
        throw new BadRequest("No data to update");
    }

    await db.update(zones).set(updateData).where(eq(zones.id, id));

    return SuccessResponse(res, { message: "Update zone success" });
};

export const deleteZone = async (req: Request, res: Response) => {
    const { id } = req.params;

    const existingZone = await db
        .select()
        .from(zones)
        .where(eq(zones.id, id))
        .limit(1);

    if (!existingZone[0]) {
        throw new NotFound("Zone not found");
    }

    await db.delete(zones).where(eq(zones.id, id));

    return SuccessResponse(res, { message: "Delete zone success" });
};

export const getallcities = async (req: Request, res: Response) => {
    
    const allCities = await db
        .select()
        .from(cities)
        .where(eq(cities.status, "active"));

    return SuccessResponse(res, { message: "Get all active cities success", data: allCities });
};