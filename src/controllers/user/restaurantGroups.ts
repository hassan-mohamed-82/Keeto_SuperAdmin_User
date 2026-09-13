import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurantGroups, restaurants, favorites } from "../../models/schema";
import { eq, and, inArray } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { isLocationInZone } from "../../utils/geo";

// ==========================================
// 1. Get Restaurant Groups by Location (Lat, Lng)
// ==========================================
export const getRestaurantGroupsByLocation = async (req: Request, res: Response) => {
    const latRaw = req.query.lat ?? req.body.lat;
    const lngRaw = req.query.lng ?? req.body.lng;
    const userId = (req as any).user?.id;

    if (latRaw === undefined || lngRaw === undefined) {
        throw new BadRequest("Latitude (lat) and Longitude (lng) are required.");
    }

    const lat = typeof latRaw === "number" ? latRaw : parseFloat(String(latRaw));
    const lng = typeof lngRaw === "number" ? lngRaw : parseFloat(String(lngRaw));

    if (isNaN(lat) || isNaN(lng)) {
        throw new BadRequest("Invalid latitude or longitude coordinates.");
    }

    // 1. Fetch User favorites if logged in
    const favoriteRestaurantIds = new Set<string>();
    if (userId) {
        const userFavs = await db
            .select({ restaurantId: favorites.restaurantId })
            .from(favorites)
            .where(eq(favorites.userId, userId));

        userFavs.forEach((f) => {
            if (f.restaurantId) favoriteRestaurantIds.add(f.restaurantId);
        });
    }

    // 2. Fetch all active restaurant groups
    const activeGroups = await db
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
        })
        .from(restaurantGroups)
        .where(eq(restaurantGroups.status, "active"));

    // 3. Filter groups where (lat, lng) falls within their coverage area
    const matchedGroups = activeGroups.filter((group) =>
        isLocationInZone(lat, lng, null, group)
    );

    if (matchedGroups.length === 0) {
        return SuccessResponse(res, {
            message: "No restaurant groups available for your location.",
            data: {
                requiresSelection: false,
                count: 0,
                groups: [],
            },
        });
    }

    // 4. Collect all restaurant IDs across matched groups to fetch details in a single query
    const allRestaurantIds = [
        ...new Set(
            matchedGroups.flatMap((g) => (Array.isArray(g.restaurants) ? g.restaurants : []))
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
                cover: restaurants.cover,
                address: restaurants.address,
                addressAr: restaurants.addressAr,
                addressFr: restaurants.addressFr,
                callcenterphone: restaurants.callcenterphone,
                minDeliveryTime: restaurants.minDeliveryTime,
                maxDeliveryTime: restaurants.maxDeliveryTime,
                deliveryTimeUnit: restaurants.deliveryTimeUnit,
                status: restaurants.status,
            })
            .from(restaurants)
            .where(
                and(
                    inArray(restaurants.id, allRestaurantIds),
                    eq(restaurants.status, "active")
                )
            );

        restaurantList.forEach((r) => {
            restaurantMap.set(r.id, {
                ...r,
                isFavorite: userId ? favoriteRestaurantIds.has(r.id) : false,
            });
        });
    }

    // 5. Format matched groups with sorted banners and restaurant details
    const formattedGroups = matchedGroups.map((group) => {
        const restIds = Array.isArray(group.restaurants) ? group.restaurants : [];
        const restaurantList = restIds
            .map((id) => restaurantMap.get(id))
            .filter(Boolean);

        const banners = Array.isArray(group.banners)
            ? [...group.banners].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            : [];

        return {
            id: group.id,
            name: group.name,
            nameAr: group.nameAr,
            nameFr: group.nameFr,
            coverageType: group.coverageType,
            banners,
            restaurantsCount: restaurantList.length,
            restaurants: restaurantList,
        };
    });

    const requiresSelection = formattedGroups.length > 1;

    return SuccessResponse(res, {
        message: requiresSelection
            ? "Your location matches multiple restaurant groups. Please select one to proceed."
            : "Restaurant group retrieved successfully.",
        data: {
            requiresSelection,
            count: formattedGroups.length,
            groups: formattedGroups,
        },
    });
};

// ==========================================
// 2. Get Single Restaurant Group by ID (User Details View)
// ==========================================
export const getUserRestaurantGroupById = async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = (req as any).user?.id;

    const [group] = await db
        .select({
            id: restaurantGroups.id,
            name: restaurantGroups.name,
            nameAr: restaurantGroups.nameAr,
            nameFr: restaurantGroups.nameFr,
            restaurants: restaurantGroups.restaurants,
            coverageType: restaurantGroups.coverageType,
            banners: restaurantGroups.banners,
            status: restaurantGroups.status,
        })
        .from(restaurantGroups)
        .where(
            and(
                eq(restaurantGroups.id, id),
                eq(restaurantGroups.status, "active")
            )
        )
        .limit(1);

    if (!group) {
        throw new NotFound("Restaurant group not found or inactive.");
    }

    const restIds = Array.isArray(group.restaurants) ? group.restaurants : [];
    let restaurantList: any[] = [];

    if (restIds.length > 0) {
        // Fetch User favorites
        const favoriteRestaurantIds = new Set<string>();
        if (userId) {
            const userFavs = await db
                .select({ restaurantId: favorites.restaurantId })
                .from(favorites)
                .where(eq(favorites.userId, userId));

            userFavs.forEach((f) => {
                if (f.restaurantId) favoriteRestaurantIds.add(f.restaurantId);
            });
        }

        const rawRestaurants = await db
            .select({
                id: restaurants.id,
                name: restaurants.name,
                nameAr: restaurants.nameAr,
                nameFr: restaurants.nameFr,
                logo: restaurants.logo,
                cover: restaurants.cover,
                address: restaurants.address,
                addressAr: restaurants.addressAr,
                addressFr: restaurants.addressFr,
                callcenterphone: restaurants.callcenterphone,
                minDeliveryTime: restaurants.minDeliveryTime,
                maxDeliveryTime: restaurants.maxDeliveryTime,
                deliveryTimeUnit: restaurants.deliveryTimeUnit,
                status: restaurants.status,
            })
            .from(restaurants)
            .where(
                and(
                    inArray(restaurants.id, restIds),
                    eq(restaurants.status, "active")
                )
            );

        restaurantList = rawRestaurants.map((r) => ({
            ...r,
            isFavorite: userId ? favoriteRestaurantIds.has(r.id) : false,
        }));
    }

    const banners = Array.isArray(group.banners)
        ? [...group.banners].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        : [];

    return SuccessResponse(res, {
        message: "Restaurant group details fetched successfully.",
        data: {
            id: group.id,
            name: group.name,
            nameAr: group.nameAr,
            nameFr: group.nameFr,
            coverageType: group.coverageType,
            banners,
            restaurantsCount: restaurantList.length,
            restaurants: restaurantList,
        },
    });
};
