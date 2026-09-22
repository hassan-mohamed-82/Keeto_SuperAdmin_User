"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toggleRestaurantGroupStatus = exports.deleteRestaurantGroup = exports.updateRestaurantGroup = exports.getRestaurantGroupById = exports.getAllRestaurantGroups = exports.createRestaurantGroup = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const handleImages_1 = require("../../utils/handleImages");
// Helper: Process and save banner images (base64 or URL) and sort by order
const processBanners = async (req, bannersList) => {
    if (!Array.isArray(bannersList))
        return [];
    const processed = [];
    for (const b of bannersList) {
        if (!b || !b.image)
            continue;
        let imageUrl = b.image;
        if (typeof b.image === "string" && !b.image.startsWith("http")) {
            const saved = await (0, handleImages_1.saveBase64Image)(req, b.image, "restaurant_groups/banners");
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
const createRestaurantGroup = async (req, res) => {
    const { name, nameAr, nameFr, restaurants: restaurantIds = [], coverageType, customCoordinates, customRadiusKm, banners = [], status, } = req.body;
    if (!name) {
        throw new BadRequest_1.BadRequest("Group name is required");
    }
    // Check if group name already exists
    const [existing] = await connection_1.db
        .select({ id: schema_1.restaurantGroups.id })
        .from(schema_1.restaurantGroups)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantGroups.name, name.trim()))
        .limit(1);
    if (existing) {
        throw new BadRequest_1.BadRequest("A restaurant group with this name already exists");
    }
    // Validate restaurant IDs if provided
    const validRestaurantIds = Array.isArray(restaurantIds) ? restaurantIds : [];
    if (validRestaurantIds.length > 0) {
        const foundRestaurants = await connection_1.db
            .select({ id: schema_1.restaurants.id })
            .from(schema_1.restaurants)
            .where((0, drizzle_orm_1.inArray)(schema_1.restaurants.id, validRestaurantIds));
        if (foundRestaurants.length !== validRestaurantIds.length) {
            const foundIds = new Set(foundRestaurants.map((r) => r.id));
            const missingIds = validRestaurantIds.filter((id) => !foundIds.has(id));
            throw new BadRequest_1.BadRequest(`The following restaurant IDs are invalid: ${missingIds.join(", ")}`);
        }
    }
    const processedBanners = await processBanners(req, banners);
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.restaurantGroups).values({
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
    return (0, response_1.SuccessResponse)(res, {
        message: "Restaurant group created successfully",
        data: { id },
    }, 201);
};
exports.createRestaurantGroup = createRestaurantGroup;
// ==========================================
// 2. Get All Restaurant Groups
// ==========================================
const getAllRestaurantGroups = async (req, res) => {
    const groups = await connection_1.db
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
        createdAt: schema_1.restaurantGroups.createdAt,
        updatedAt: schema_1.restaurantGroups.updatedAt,
    })
        .from(schema_1.restaurantGroups);
    // Collect all restaurant IDs across all groups to fetch details in a single query
    const allRestaurantIds = [
        ...new Set(groups.flatMap((g) => (Array.isArray(g.restaurants) ? g.restaurants : []))),
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
            status: schema_1.restaurants.status,
        })
            .from(schema_1.restaurants)
            .where((0, drizzle_orm_1.inArray)(schema_1.restaurants.id, allRestaurantIds));
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
    return (0, response_1.SuccessResponse)(res, {
        message: "Restaurant groups fetched successfully",
        data: result,
    });
};
exports.getAllRestaurantGroups = getAllRestaurantGroups;
// ==========================================
// 3. Get Restaurant Group by ID
// ==========================================
const getRestaurantGroupById = async (req, res) => {
    const { id } = req.params;
    const [group] = await connection_1.db
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
        createdAt: schema_1.restaurantGroups.createdAt,
        updatedAt: schema_1.restaurantGroups.updatedAt,
    })
        .from(schema_1.restaurantGroups)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantGroups.id, id))
        .limit(1);
    if (!group) {
        throw new NotFound_1.NotFound("Restaurant group not found");
    }
    const restIds = Array.isArray(group.restaurants) ? group.restaurants : [];
    let restaurantDetails = [];
    if (restIds.length > 0) {
        restaurantDetails = await connection_1.db
            .select({
            id: schema_1.restaurants.id,
            name: schema_1.restaurants.name,
            nameAr: schema_1.restaurants.nameAr,
            nameFr: schema_1.restaurants.nameFr,
            logo: schema_1.restaurants.logo,
            address: schema_1.restaurants.address,
            phone: schema_1.restaurants.callcenterphone,
            status: schema_1.restaurants.status,
        })
            .from(schema_1.restaurants)
            .where((0, drizzle_orm_1.inArray)(schema_1.restaurants.id, restIds));
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Restaurant group fetched successfully",
        data: {
            ...group,
            restaurantsCount: restIds.length,
            restaurantsDetails: restaurantDetails,
        },
    });
};
exports.getRestaurantGroupById = getRestaurantGroupById;
// ==========================================
// 4. Update Restaurant Group
// ==========================================
const updateRestaurantGroup = async (req, res) => {
    const { id, } = req.params;
    const { name, nameAr, nameFr, restaurants: restaurantIds, coverageType, customCoordinates, customRadiusKm, banners, status, } = req.body;
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.restaurantGroups)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantGroups.id, id))
        .limit(1);
    if (!existing) {
        throw new NotFound_1.NotFound("Restaurant group not found");
    }
    const updateData = {
        updatedAt: new Date(),
    };
    if (name !== undefined) {
        const trimmedName = name.trim();
        if (!trimmedName)
            throw new BadRequest_1.BadRequest("Group name cannot be empty");
        // Check uniqueness if name changed
        if (trimmedName !== existing.name) {
            const [nameConflict] = await connection_1.db
                .select({ id: schema_1.restaurantGroups.id })
                .from(schema_1.restaurantGroups)
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantGroups.name, trimmedName))
                .limit(1);
            if (nameConflict) {
                throw new BadRequest_1.BadRequest("A restaurant group with this name already exists");
            }
        }
        updateData.name = trimmedName;
    }
    if (nameAr !== undefined)
        updateData.nameAr = nameAr ? nameAr.trim() : "";
    if (nameFr !== undefined)
        updateData.nameFr = nameFr ? nameFr.trim() : "";
    if (coverageType !== undefined)
        updateData.coverageType = coverageType;
    if (customCoordinates !== undefined)
        updateData.customCoordinates = customCoordinates;
    if (customRadiusKm !== undefined) {
        updateData.customRadiusKm = customRadiusKm !== null ? String(customRadiusKm) : null;
    }
    if (banners !== undefined) {
        updateData.banners = await processBanners(req, banners);
    }
    if (status !== undefined)
        updateData.status = status;
    if (restaurantIds !== undefined) {
        const validRestaurantIds = Array.isArray(restaurantIds) ? restaurantIds : [];
        if (validRestaurantIds.length > 0) {
            const foundRestaurants = await connection_1.db
                .select({ id: schema_1.restaurants.id })
                .from(schema_1.restaurants)
                .where((0, drizzle_orm_1.inArray)(schema_1.restaurants.id, validRestaurantIds));
            if (foundRestaurants.length !== validRestaurantIds.length) {
                const foundIds = new Set(foundRestaurants.map((r) => r.id));
                const missingIds = validRestaurantIds.filter((rId) => !foundIds.has(rId));
                throw new BadRequest_1.BadRequest(`The following restaurant IDs are invalid: ${missingIds.join(", ")}`);
            }
        }
        updateData.restaurants = validRestaurantIds;
    }
    await connection_1.db
        .update(schema_1.restaurantGroups)
        .set(updateData)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantGroups.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Restaurant group updated successfully" });
};
exports.updateRestaurantGroup = updateRestaurantGroup;
// ==========================================
// 5. Delete Restaurant Group
// ==========================================
const deleteRestaurantGroup = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db
        .select({ id: schema_1.restaurantGroups.id })
        .from(schema_1.restaurantGroups)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantGroups.id, id))
        .limit(1);
    if (!existing) {
        throw new NotFound_1.NotFound("Restaurant group not found");
    }
    await connection_1.db.delete(schema_1.restaurantGroups).where((0, drizzle_orm_1.eq)(schema_1.restaurantGroups.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Restaurant group deleted successfully" });
};
exports.deleteRestaurantGroup = deleteRestaurantGroup;
// ==========================================
// 6. Toggle Restaurant Group Status
// ==========================================
const toggleRestaurantGroupStatus = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db
        .select({ id: schema_1.restaurantGroups.id, status: schema_1.restaurantGroups.status })
        .from(schema_1.restaurantGroups)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantGroups.id, id))
        .limit(1);
    if (!existing) {
        throw new NotFound_1.NotFound("Restaurant group not found");
    }
    const newStatus = existing.status === "active" ? "inactive" : "active";
    await connection_1.db
        .update(schema_1.restaurantGroups)
        .set({ status: newStatus, updatedAt: new Date() })
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantGroups.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: `Restaurant group status changed to ${newStatus}`,
        data: { status: newStatus },
    });
};
exports.toggleRestaurantGroupStatus = toggleRestaurantGroupStatus;
