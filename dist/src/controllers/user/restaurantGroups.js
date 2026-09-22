"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserRestaurantGroupById = exports.getRestaurantGroupsByLocation = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const geo_1 = require("../../utils/geo");
// ==========================================
// 1. Get Restaurant Groups by Location (Lat, Lng)
// ==========================================
const getRestaurantGroupsByLocation = async (req, res) => {
    const latRaw = req.query.lat ?? req.body.lat;
    const lngRaw = req.query.lng ?? req.body.lng;
    const userId = req.user?.id;
    if (latRaw === undefined || lngRaw === undefined) {
        throw new BadRequest_1.BadRequest("Latitude (lat) and Longitude (lng) are required.");
    }
    const lat = typeof latRaw === "number" ? latRaw : parseFloat(String(latRaw));
    const lng = typeof lngRaw === "number" ? lngRaw : parseFloat(String(lngRaw));
    if (isNaN(lat) || isNaN(lng)) {
        throw new BadRequest_1.BadRequest("Invalid latitude or longitude coordinates.");
    }
    // 1. Fetch User favorites if logged in
    const favoriteRestaurantIds = new Set();
    if (userId) {
        const userFavs = await connection_1.db
            .select({ restaurantId: schema_1.favorites.restaurantId })
            .from(schema_1.favorites)
            .where((0, drizzle_orm_1.eq)(schema_1.favorites.userId, userId));
        userFavs.forEach((f) => {
            if (f.restaurantId)
                favoriteRestaurantIds.add(f.restaurantId);
        });
    }
    // 2. Fetch all active restaurant groups
    const activeGroups = await connection_1.db
        .select({
        id: schema_1.restaurantGroups.id,
        name: schema_1.restaurantGroups.name,
        nameAr: schema_1.restaurantGroups.nameAr,
        nameFr: schema_1.restaurantGroups.nameFr,
        restaurants: schema_1.restaurantGroups.restaurants,
        coverageType: schema_1.restaurantGroups.coverageType,
        customCoordinates: schema_1.restaurantGroups.customCoordinates,
        customRadiusKm: schema_1.restaurantGroups.customRadiusKm,
        banners: schema_1.restaurantGroups.banners,
        status: schema_1.restaurantGroups.status,
    })
        .from(schema_1.restaurantGroups)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantGroups.status, "active"));
    // 3. Filter groups where (lat, lng) falls within their coverage area
    const matchedGroups = activeGroups.filter((group) => (0, geo_1.isLocationInZone)(lat, lng, null, group));
    if (matchedGroups.length === 0) {
        return (0, response_1.SuccessResponse)(res, {
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
        ...new Set(matchedGroups.flatMap((g) => (Array.isArray(g.restaurants) ? g.restaurants : []))),
    ];
    const restaurantMap = new Map();
    if (allRestaurantIds.length > 0) {
        const restaurantList = await connection_1.db
            .select({
            id: schema_1.restaurants.id,
            name: schema_1.restaurants.name,
            nameAr: schema_1.restaurants.nameAr,
            nameFr: schema_1.restaurants.nameFr,
            logo: schema_1.restaurants.logo,
            cover: schema_1.restaurants.cover,
            address: schema_1.restaurants.address,
            addressAr: schema_1.restaurants.addressAr,
            addressFr: schema_1.restaurants.addressFr,
            callcenterphone: schema_1.restaurants.callcenterphone,
            minDeliveryTime: schema_1.restaurants.minDeliveryTime,
            maxDeliveryTime: schema_1.restaurants.maxDeliveryTime,
            deliveryTimeUnit: schema_1.restaurants.deliveryTimeUnit,
            status: schema_1.restaurants.status,
        })
            .from(schema_1.restaurants)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.restaurants.id, allRestaurantIds), (0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active")));
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
    return (0, response_1.SuccessResponse)(res, {
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
exports.getRestaurantGroupsByLocation = getRestaurantGroupsByLocation;
// ==========================================
// 2. Get Single Restaurant Group by ID (User Details View)
// ==========================================
const getUserRestaurantGroupById = async (req, res) => {
    const { id } = req.params;
    const userId = req.user?.id;
    const [group] = await connection_1.db
        .select({
        id: schema_1.restaurantGroups.id,
        name: schema_1.restaurantGroups.name,
        nameAr: schema_1.restaurantGroups.nameAr,
        nameFr: schema_1.restaurantGroups.nameFr,
        restaurants: schema_1.restaurantGroups.restaurants,
        coverageType: schema_1.restaurantGroups.coverageType,
        banners: schema_1.restaurantGroups.banners,
        status: schema_1.restaurantGroups.status,
    })
        .from(schema_1.restaurantGroups)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantGroups.id, id), (0, drizzle_orm_1.eq)(schema_1.restaurantGroups.status, "active")))
        .limit(1);
    if (!group) {
        throw new NotFound_1.NotFound("Restaurant group not found or inactive.");
    }
    const restIds = Array.isArray(group.restaurants) ? group.restaurants : [];
    let restaurantList = [];
    if (restIds.length > 0) {
        // Fetch User favorites
        const favoriteRestaurantIds = new Set();
        if (userId) {
            const userFavs = await connection_1.db
                .select({ restaurantId: schema_1.favorites.restaurantId })
                .from(schema_1.favorites)
                .where((0, drizzle_orm_1.eq)(schema_1.favorites.userId, userId));
            userFavs.forEach((f) => {
                if (f.restaurantId)
                    favoriteRestaurantIds.add(f.restaurantId);
            });
        }
        const rawRestaurants = await connection_1.db
            .select({
            id: schema_1.restaurants.id,
            name: schema_1.restaurants.name,
            nameAr: schema_1.restaurants.nameAr,
            nameFr: schema_1.restaurants.nameFr,
            logo: schema_1.restaurants.logo,
            cover: schema_1.restaurants.cover,
            address: schema_1.restaurants.address,
            addressAr: schema_1.restaurants.addressAr,
            addressFr: schema_1.restaurants.addressFr,
            callcenterphone: schema_1.restaurants.callcenterphone,
            minDeliveryTime: schema_1.restaurants.minDeliveryTime,
            maxDeliveryTime: schema_1.restaurants.maxDeliveryTime,
            deliveryTimeUnit: schema_1.restaurants.deliveryTimeUnit,
            status: schema_1.restaurants.status,
        })
            .from(schema_1.restaurants)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.restaurants.id, restIds), (0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active")));
        restaurantList = rawRestaurants.map((r) => ({
            ...r,
            isFavorite: userId ? favoriteRestaurantIds.has(r.id) : false,
        }));
    }
    const banners = Array.isArray(group.banners)
        ? [...group.banners].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        : [];
    return (0, response_1.SuccessResponse)(res, {
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
exports.getUserRestaurantGroupById = getUserRestaurantGroupById;
