"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteUser = exports.updateUser = exports.getUserById = exports.getAllUsers = exports.toggleRestaurantUserBlock = exports.getBlockedUsers = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const handleImages_1 = require("../../utils/handleImages");
// Get all blocked users (globally blocked or blocked by specific restaurants)
const getBlockedUsers = async (req, res) => {
    const { restaurantId, search } = req.query;
    // 1. Get all restaurant-level blocked records
    const restaurantBlockConditions = [(0, drizzle_orm_1.eq)(schema_1.restaurant_users.status, "blocked")];
    if (restaurantId) {
        restaurantBlockConditions.push((0, drizzle_orm_1.eq)(schema_1.restaurant_users.restaurantId, restaurantId));
    }
    const blockedRestaurantLinks = await connection_1.db
        .select({
        id: schema_1.restaurant_users.id,
        userId: schema_1.restaurant_users.userId,
        restaurantId: schema_1.restaurant_users.restaurantId,
        status: schema_1.restaurant_users.status,
        createdAt: schema_1.restaurant_users.createdAt,
        updatedAt: schema_1.restaurant_users.updatedAt,
        restaurantName: schema_1.restaurants.name,
        restaurantNameAr: schema_1.restaurants.nameAr,
        restaurantLogo: schema_1.restaurants.logo
    })
        .from(schema_1.restaurant_users)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.restaurant_users.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.and)(...restaurantBlockConditions));
    // Map of userId -> blocked restaurants array
    const userRestaurantBlocksMap = {};
    const restaurantBlockedUserIds = new Set();
    for (const link of blockedRestaurantLinks) {
        restaurantBlockedUserIds.add(link.userId);
        if (!userRestaurantBlocksMap[link.userId]) {
            userRestaurantBlocksMap[link.userId] = [];
        }
        userRestaurantBlocksMap[link.userId].push({
            restaurantId: link.restaurantId,
            restaurantName: link.restaurantName,
            restaurantNameAr: link.restaurantNameAr,
            restaurantLogo: link.restaurantLogo,
            blockedAt: link.updatedAt || link.createdAt
        });
    }
    // 2. Query users:
    const userIds = Array.from(restaurantBlockedUserIds);
    let allBlockedUsers = [];
    if (userIds.length > 0) {
        allBlockedUsers = await connection_1.db
            .select()
            .from(schema_1.users)
            .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.users.status, "blocked"), (0, drizzle_orm_1.inArray)(schema_1.users.id, userIds)));
    }
    else {
        allBlockedUsers = await connection_1.db
            .select()
            .from(schema_1.users)
            .where((0, drizzle_orm_1.eq)(schema_1.users.status, "blocked"));
    }
    // Filter by search if provided
    if (search && typeof search === "string") {
        const query = search.toLowerCase();
        allBlockedUsers = allBlockedUsers.filter(u => (u.name && u.name.toLowerCase().includes(query)) ||
            (u.email && u.email.toLowerCase().includes(query)) ||
            (u.phone && u.phone.toLowerCase().includes(query)));
    }
    // 3. Format the result
    const result = allBlockedUsers.map(u => {
        const blockedByRestaurants = userRestaurantBlocksMap[u.id] || [];
        const isGloballyBlocked = u.status === "blocked";
        const isRestaurantBlocked = blockedByRestaurants.length > 0;
        let blockType = "global";
        if (isGloballyBlocked && isRestaurantBlocked) {
            blockType = "both";
        }
        else if (isRestaurantBlocked) {
            blockType = "restaurant";
        }
        return {
            id: u.id,
            name: u.name,
            email: u.email,
            phone: u.phone,
            photo: u.photo,
            status: u.status, // general status in users table
            isGloballyBlocked,
            isRestaurantBlocked,
            blockType,
            blockedByRestaurants
        };
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Blocked users fetched successfully",
        total: result.length,
        data: result
    }, 200);
};
exports.getBlockedUsers = getBlockedUsers;
// Block or Unblock user for a specific restaurant
const toggleRestaurantUserBlock = async (req, res) => {
    const { userId, restaurantId, status } = req.body; // status: "active" | "blocked"
    if (!userId || !restaurantId || !status) {
        throw new BadRequest_1.BadRequest("userId, restaurantId, and status ('active' | 'blocked') are required");
    }
    if (!["active", "blocked"].includes(status)) {
        throw new BadRequest_1.BadRequest("Status must be either 'active' or 'blocked'");
    }
    const [existingLink] = await connection_1.db
        .select()
        .from(schema_1.restaurant_users)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurant_users.userId, userId), (0, drizzle_orm_1.eq)(schema_1.restaurant_users.restaurantId, restaurantId)))
        .limit(1);
    if (existingLink) {
        await connection_1.db
            .update(schema_1.restaurant_users)
            .set({ status })
            .where((0, drizzle_orm_1.eq)(schema_1.restaurant_users.id, existingLink.id));
    }
    else {
        await connection_1.db.insert(schema_1.restaurant_users).values({
            id: (0, uuid_1.v4)(),
            userId,
            restaurantId,
            status
        });
    }
    return (0, response_1.SuccessResponse)(res, {
        message: `User successfully ${status === "blocked" ? "blocked from" : "unblocked for"} this restaurant`,
        data: { userId, restaurantId, status }
    }, 200);
};
exports.toggleRestaurantUserBlock = toggleRestaurantUserBlock;
// Get all users
const getAllUsers = async (req, res) => {
    const allUsers = await connection_1.db.select().from(schema_1.users);
    return (0, response_1.SuccessResponse)(res, { message: "Users fetched successfully", data: allUsers }, 200);
};
exports.getAllUsers = getAllUsers;
// Get a single user by ID
const getUserById = async (req, res) => {
    const { id } = req.params;
    const [user] = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, id)).limit(1);
    if (!user)
        throw new NotFound_1.NotFound("User not found");
    return (0, response_1.SuccessResponse)(res, { message: "User fetched successfully", data: user }, 200);
};
exports.getUserById = getUserById;
// Update user details and status
const updateUser = async (req, res) => {
    const { id } = req.params;
    const { name, phone, status, photo } = req.body;
    const [existingUser] = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, id)).limit(1);
    if (!existingUser) {
        throw new NotFound_1.NotFound("User not found");
    }
    let photoUrl = existingUser.photo;
    if (photo && photo !== existingUser.photo) {
        if (photo.startsWith("data:image")) {
            photoUrl = await (0, handleImages_1.handleImageUpdate)(req, existingUser.photo, photo, "users");
            // If replacing, you might want to delete the old image using handleImageUpdate if configured
        }
        else {
            photoUrl = photo;
        }
    }
    await connection_1.db.update(schema_1.users)
        .set({
        name: name || existingUser.name,
        phone: phone || existingUser.phone,
        status: status || existingUser.status,
        photo: photoUrl
    })
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "User updated successfully", data: { id } }, 200);
};
exports.updateUser = updateUser;
// Delete a user
const deleteUser = async (req, res) => {
    const { id } = req.params;
    const [existingUser] = await connection_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, id)).limit(1);
    if (!existingUser) {
        throw new NotFound_1.NotFound("User not found");
    }
    await connection_1.db.delete(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "User deleted successfully", data: { id } }, 200);
};
exports.deleteUser = deleteUser;
