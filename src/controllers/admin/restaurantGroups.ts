import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurantGroups, restaurants, type RestaurantGroupBanner } from "../../models/schema";
import { eq, inArray } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";
import { saveBase64Image } from "../../utils/handleImages";

// Helper: Process and save banner images (base64 or URL) and sort by order
const processBanners = async (req: Request, bannersList: any[]): Promise<RestaurantGroupBanner[]> => {
    if (!Array.isArray(bannersList)) return [];

    const processed: RestaurantGroupBanner[] = [];
    for (const b of bannersList) {
        if (!b || !b.image) continue;

        let imageUrl = b.image;
        if (typeof b.image === "string" && !b.image.startsWith("http")) {
            const saved = await saveBase64Image(req, b.image, "restaurant_groups/banners");
            imageUrl = saved.url || b.image;
        }

        processed.push({
            image: imageUrl,
            link: b.link ? String(b.link).trim() : null,
            order: typeof b.order === "number" ? b.order : (parseInt(b.order, 10) || 0),
        });
    }

    return processed.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
};

// ==========================================
// 1. Create Restaurant Group
// ==========================================
export const createRestaurantGroup = async (req: Request, res: Response) => {
    const {
        name,
        nameAr,
        nameFr,
        restaurants: restaurantIds = [],
        coverageType,
        customCoordinates,
        customRadiusKm,
        banners = [],
        status,
    } = req.body;

    if (!name) {
        throw new BadRequest("Group name is required");
    }

    // Check if group name already exists
    const [existing] = await db
        .select({ id: restaurantGroups.id })
        .from(restaurantGroups)
        .where(eq(restaurantGroups.name, name.trim()))
        .limit(1);

    if (existing) {
        throw new BadRequest("A restaurant group with this name already exists");
    }

    // Validate restaurant IDs if provided
    const validRestaurantIds: string[] = Array.isArray(restaurantIds) ? restaurantIds : [];
    if (validRestaurantIds.length > 0) {
        const foundRestaurants = await db
            .select({ id: restaurants.id })
            .from(restaurants)
            .where(inArray(restaurants.id, validRestaurantIds));

        if (foundRestaurants.length !== validRestaurantIds.length) {
            const foundIds = new Set(foundRestaurants.map((r) => r.id));
            const missingIds = validRestaurantIds.filter((id) => !foundIds.has(id));
            throw new BadRequest(`The following restaurant IDs are invalid: ${missingIds.join(", ")}`);
        }
    }

    const processedBanners = await processBanners(req, banners);
    const id = uuidv4();

    await db.insert(restaurantGroups).values({
        id,
        name: name.trim(),
        nameAr: nameAr ? nameAr.trim() : "",
        nameFr: nameFr ? nameFr.trim() : "",
        restaurants: validRestaurantIds,
        coverageType: coverageType || "POLYGON",
        customCoordinates: customCoordinates || null,
        customRadiusKm: customRadiusKm !== undefined && customRadiusKm !== null ? String(customRadiusKm) : null,
        banners: processedBanners,
        status: status || "active",
    });

    return SuccessResponse(
        res,
        {
            message: "Restaurant group created successfully",
            data: { id },
        },
        201
    );
};

// ==========================================
// 2. Get All Restaurant Groups
// ==========================================
export const getAllRestaurantGroups = async (req: Request, res: Response) => {
    const groups = await db
        .select({
            id: restaurantGroups.id,
            name: restaurantGroups.name,
            nameAr: restaurantGroups.nameAr,
            nameFr: restaurantGroups.nameFr,
            restaurants: restaurantGroups.restaurants,
            coverageType: restaurantGroups.coverageType,
            customCoordinates: restaurantGroups.customCoordinates,
            customRadiusKm: restaurantGroups.customRadiusKm,
            banners: restaurantGroups.banners,
            status: restaurantGroups.status,
            createdAt: restaurantGroups.createdAt,
            updatedAt: restaurantGroups.updatedAt,
        })
        .from(restaurantGroups);

    // Collect all restaurant IDs across all groups to fetch details in a single query
    const allRestaurantIds = [
        ...new Set(
            groups.flatMap((g) => (Array.isArray(g.restaurants) ? g.restaurants : []))
        ),
    ];

    const restaurantMap = new Map<string, any>();
    if (allRestaurantIds.length > 0) {
        const restaurantList = await db
            .select({
                id: restaurants.id,
                name: restaurants.name,
                nameAr: restaurants.nameAr,
                nameFr: restaurants.nameFr,
                logo: restaurants.logo,
                status: restaurants.status,
            })
            .from(restaurants)
            .where(inArray(restaurants.id, allRestaurantIds));

        restaurantList.forEach((r) => restaurantMap.set(r.id, r));
    }

    const result = groups.map((g) => {
        const restIds = Array.isArray(g.restaurants) ? g.restaurants : [];
        const restaurantDetails = restIds
            .map((id) => restaurantMap.get(id))
            .filter(Boolean);

        return {
            ...g,
            restaurantsCount: restIds.length,
            restaurantsDetails: restaurantDetails,
        };
    });

    return SuccessResponse(res, {
        message: "Restaurant groups fetched successfully",
        data: result,
    });
};

// ==========================================
// 3. Get Restaurant Group by ID
// ==========================================
export const getRestaurantGroupById = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [group] = await db
        .select({
            id: restaurantGroups.id,
            name: restaurantGroups.name,
            nameAr: restaurantGroups.nameAr,
            nameFr: restaurantGroups.nameFr,
            restaurants: restaurantGroups.restaurants,
            coverageType: restaurantGroups.coverageType,
            customCoordinates: restaurantGroups.customCoordinates,
            customRadiusKm: restaurantGroups.customRadiusKm,
            banners: restaurantGroups.banners,
            status: restaurantGroups.status,
            createdAt: restaurantGroups.createdAt,
            updatedAt: restaurantGroups.updatedAt,
        })
        .from(restaurantGroups)
        .where(eq(restaurantGroups.id, id))
        .limit(1);

    if (!group) {
        throw new NotFound("Restaurant group not found");
    }

    const restIds = Array.isArray(group.restaurants) ? group.restaurants : [];
    let restaurantDetails: any[] = [];

    if (restIds.length > 0) {
        restaurantDetails = await db
            .select({
                id: restaurants.id,
                name: restaurants.name,
                nameAr: restaurants.nameAr,
                nameFr: restaurants.nameFr,
                logo: restaurants.logo,
                address: restaurants.address,
                phone: restaurants.callcenterphone,
                status: restaurants.status,
            })
            .from(restaurants)
            .where(inArray(restaurants.id, restIds));
    }

    return SuccessResponse(res, {
        message: "Restaurant group fetched successfully",
        data: {
            ...group,
            restaurantsCount: restIds.length,
            restaurantsDetails: restaurantDetails,
        },
    });
};

// ==========================================
// 4. Update Restaurant Group
// ==========================================
export const updateRestaurantGroup = async (req: Request, res: Response) => {
    const {
        id,
    } = req.params;
    const {
        name,
        nameAr,
        nameFr,
        restaurants: restaurantIds,
        coverageType,
        customCoordinates,
        customRadiusKm,
        banners,
        status,
    } = req.body;

    const [existing] = await db
        .select()
        .from(restaurantGroups)
        .where(eq(restaurantGroups.id, id))
        .limit(1);

    if (!existing) {
        throw new NotFound("Restaurant group not found");
    }

    const updateData: any = {
        updatedAt: new Date(),
    };

    if (name !== undefined) {
        const trimmedName = name.trim();
        if (!trimmedName) throw new BadRequest("Group name cannot be empty");

        // Check uniqueness if name changed
        if (trimmedName !== existing.name) {
            const [nameConflict] = await db
                .select({ id: restaurantGroups.id })
                .from(restaurantGroups)
                .where(eq(restaurantGroups.name, trimmedName))
                .limit(1);

            if (nameConflict) {
                throw new BadRequest("A restaurant group with this name already exists");
            }
        }
        updateData.name = trimmedName;
    }

    if (nameAr !== undefined) updateData.nameAr = nameAr ? nameAr.trim() : "";
    if (nameFr !== undefined) updateData.nameFr = nameFr ? nameFr.trim() : "";
    if (coverageType !== undefined) updateData.coverageType = coverageType;
    if (customCoordinates !== undefined) updateData.customCoordinates = customCoordinates;
    if (customRadiusKm !== undefined) {
        updateData.customRadiusKm = customRadiusKm !== null ? String(customRadiusKm) : null;
    }
    if (banners !== undefined) {
        updateData.banners = await processBanners(req, banners);
    }
    if (status !== undefined) updateData.status = status;

    if (restaurantIds !== undefined) {
        const validRestaurantIds: string[] = Array.isArray(restaurantIds) ? restaurantIds : [];
        if (validRestaurantIds.length > 0) {
            const foundRestaurants = await db
                .select({ id: restaurants.id })
                .from(restaurants)
                .where(inArray(restaurants.id, validRestaurantIds));

            if (foundRestaurants.length !== validRestaurantIds.length) {
                const foundIds = new Set(foundRestaurants.map((r) => r.id));
                const missingIds = validRestaurantIds.filter((rId) => !foundIds.has(rId));
                throw new BadRequest(`The following restaurant IDs are invalid: ${missingIds.join(", ")}`);
            }
        }
        updateData.restaurants = validRestaurantIds;
    }

    await db
        .update(restaurantGroups)
        .set(updateData)
        .where(eq(restaurantGroups.id, id));

    return SuccessResponse(res, { message: "Restaurant group updated successfully" });
};

// ==========================================
// 5. Delete Restaurant Group
// ==========================================
export const deleteRestaurantGroup = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existing] = await db
        .select({ id: restaurantGroups.id })
        .from(restaurantGroups)
        .where(eq(restaurantGroups.id, id))
        .limit(1);

    if (!existing) {
        throw new NotFound("Restaurant group not found");
    }

    await db.delete(restaurantGroups).where(eq(restaurantGroups.id, id));

    return SuccessResponse(res, { message: "Restaurant group deleted successfully" });
};

// ==========================================
// 6. Toggle Restaurant Group Status
// ==========================================
export const toggleRestaurantGroupStatus = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existing] = await db
        .select({ id: restaurantGroups.id, status: restaurantGroups.status })
        .from(restaurantGroups)
        .where(eq(restaurantGroups.id, id))
        .limit(1);

    if (!existing) {
        throw new NotFound("Restaurant group not found");
    }

    const newStatus = existing.status === "active" ? "inactive" : "active";

    await db
        .update(restaurantGroups)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(restaurantGroups.id, id));

    return SuccessResponse(res, {
        message: `Restaurant group status changed to ${newStatus}`,
        data: { status: newStatus },
    });
};
