import { Request, Response } from "express";
import { db } from "../../models/connection";
import { zones, cities } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

export const createZone = async (req: Request, res: Response) => {
    const { name, nameAr, nameFr, displayName, displayNameAr, displayNameFr, cityId,lat,lng } = req.body;

    if (!name || !nameAr || !nameFr || !displayName || !displayNameAr || !displayNameFr || !cityId || !lat || !lng) {
        throw new BadRequest("Name, nameAr, nameFr, displayName, displayNameAr, displayNameFr, cityId, lat, and lng are required");
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
        nameAr,
        nameFr,
        displayName,
        displayNameAr,
        displayNameFr,
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
            nameAr: zones.nameAr,
            nameFr: zones.nameFr,
            displayName: zones.displayName,
            displayNameAr: zones.displayNameAr,
            displayNameFr: zones.displayNameFr,
            status: zones.status,
            lat: zones.lat,
            lng: zones.lng,
            cityId: zones.cityId,
            createdAt: zones.createdAt,
            updatedAt: zones.updatedAt,
            city: {
                id: cities.id,
                name: cities.name,
                nameAr: cities.nameAr,
                nameFr: cities.nameFr,
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
            nameAr: zones.nameAr,
            nameFr: zones.nameFr,
            displayName: zones.displayName,
            displayNameAr: zones.displayNameAr,
            displayNameFr: zones.displayNameFr,
            status: zones.status,
            lat: zones.lat,
            lng: zones.lng,
            cityId: zones.cityId,
            createdAt: zones.createdAt,
            updatedAt: zones.updatedAt,
            city: {
                id: cities.id,
                name: cities.name,
                nameAr: cities.nameAr,
                nameFr: cities.nameFr,
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
    const { name, nameAr, nameFr, displayName, displayNameAr, displayNameFr, status, cityId, lat, lng } = req.body;

    // 1. التحقق المبكر: هل يوجد بيانات للتحديث أصلاً؟
    if (!name && !nameAr && !nameFr && !displayName && !displayNameAr && !displayNameFr && !status && !cityId) {
        throw new BadRequest("No data to update");
    }

    // 2. تجهيز الاستعلامات للعمل في نفس الوقت (Concurrent Queries)
    const zonePromise = db.select().from(zones).where(eq(zones.id, id)).limit(1);
    // إذا تم تمرير cityId نبحث عنه، وإلا نُرجع null مباشرة
    const cityPromise = cityId 
        ? db.select().from(cities).where(eq(cities.id, cityId)).limit(1) 
        : Promise.resolve(null);

    // تنفيذ الاستعلامات معاً
    const [existingZone, existingCity] = await Promise.all([zonePromise, cityPromise]);

    if (!existingZone[0]) {
        throw new NotFound("Zone not found");
    }

    if (cityId && (!existingCity || !existingCity[0])) {
        throw new BadRequest("City not found");
    }

    // 3. بناء كائن التحديث
    const updateData: any = {
        updatedAt: new Date(),
    };

    if (name !== undefined) updateData.name = name;
    if (nameAr !== undefined) updateData.nameAr = nameAr;
    if (nameFr !== undefined) updateData.nameFr = nameFr;
    if (displayName !== undefined) updateData.displayName = displayName;
    if (displayNameAr !== undefined) updateData.displayNameAr = displayNameAr;
    if (displayNameFr !== undefined) updateData.displayNameFr = displayNameFr;
    if (status !== undefined) updateData.status = status;
    if (cityId !== undefined) updateData.cityId = cityId;
    if (lat !== undefined) updateData.lat = lat;
    if (lng !== undefined) updateData.lng = lng;

    // 4. تنفيذ التحديث
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