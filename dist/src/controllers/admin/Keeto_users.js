"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserStats = exports.deleteUser = exports.updateUser = exports.getUserById = exports.getAllUsers = exports.toggleRestaurantUserBlock = exports.getBlockedUsers = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const handleImages_1 = require("../../utils/handleImages");
// Get all blocked users (globally blocked by Keeto OR blocked by specific restaurants)
const getBlockedUsers = async (req, res) => {
    const { restaurantId, search } = req.query;
    // ─── Step 1: Always fetch globally blocked users from users table ────────────
    // These must ALWAYS appear regardless of restaurant_users state.
    const globallyBlockedUsersPromise = connection_1.db
        .select()
        .from(schema_1.users)
        .where((0, drizzle_orm_1.eq)(schema_1.users.status, "blocked"));
    // ─── Step 2: Fetch restaurant-level blocked records ──────────────────────────
    const restaurantBlockConditions = [(0, drizzle_orm_1.eq)(schema_1.restaurant_users.status, "blocked")];
    if (restaurantId) {
        restaurantBlockConditions.push((0, drizzle_orm_1.eq)(schema_1.restaurant_users.restaurantId, restaurantId));
    }
    const blockedRestaurantLinksPromise = connection_1.db
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
    // Run both in parallel
    const [globallyBlockedUsers, blockedRestaurantLinks] = await Promise.all([
        globallyBlockedUsersPromise,
        blockedRestaurantLinksPromise,
    ]);
    // Build map: userId -> blocked restaurants array
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
    // ─── Step 3: Merge — globally blocked users + restaurant-only blocked users ──
    // Start with all globally blocked users (always included).
    const globallyBlockedIds = new Set(globallyBlockedUsers.map((u) => u.id));
    // Fetch users who are blocked at restaurant level but NOT globally blocked
    // (to avoid duplicates)
    const restaurantOnlyIds = [...restaurantBlockedUserIds].filter((id) => !globallyBlockedIds.has(id));
    let restaurantOnlyUsers = [];
    if (restaurantOnlyIds.length > 0) {
        restaurantOnlyUsers = await connection_1.db
            .select()
            .from(schema_1.users)
            .where((0, drizzle_orm_1.inArray)(schema_1.users.id, restaurantOnlyIds));
    }
    // All blocked users = globally blocked + restaurant-only blocked (no duplicates)
    let allBlockedUsers = [...globallyBlockedUsers, ...restaurantOnlyUsers];
    // Filter by search if provided
    if (search && typeof search === "string") {
        const query = search.toLowerCase();
        allBlockedUsers = allBlockedUsers.filter(u => (u.name && u.name.toLowerCase().includes(query)) ||
            (u.email && u.email.toLowerCase().includes(query)) ||
            (u.phone && u.phone.toLowerCase().includes(query)) ||
            (u.alternatePhone && u.alternatePhone.toLowerCase().includes(query)));
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
// Get all users — each user includes the restaurant they logged in from (via restaurant_users).
// If the user has no entry in restaurant_users (or no linked restaurant), restaurant returns "Keeto".
const getAllUsers = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = (req.query.search || req.query.query)?.trim();
    const status = req.query.status;
    const conditions = [];
    if (search) {
        const searchTerm = `%${search}%`;
        conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.users.name, searchTerm), (0, drizzle_orm_1.like)(schema_1.users.email, searchTerm), (0, drizzle_orm_1.like)(schema_1.users.phone, searchTerm), (0, drizzle_orm_1.like)(schema_1.users.alternatePhone, searchTerm)));
    }
    if (status && ["active", "blocked"].includes(status)) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.users.status, status));
    }
    const whereClause = conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined;
    // 1. Get total users count
    const [totalUsersData] = await connection_1.db
        .select({ count: (0, drizzle_orm_1.sql) `count(*)` })
        .from(schema_1.users)
        .where(whereClause);
    const totalUsers = Number(totalUsersData?.count || 0);
    const totalPages = Math.ceil(totalUsers / limit);
    // 2. Fetch paginated users
    const paginatedUsers = await connection_1.db
        .select()
        .from(schema_1.users)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy((0, drizzle_orm_1.desc)(schema_1.users.createdAt));
    const userIds = paginatedUsers.map(u => u.id);
    // 3. Fetch linked restaurants for these users
    let linkedRestaurants = [];
    if (userIds.length > 0) {
        linkedRestaurants = await connection_1.db
            .select({
            userId: schema_1.restaurant_users.userId,
            restaurantId: schema_1.restaurant_users.restaurantId,
            restaurantName: schema_1.restaurants.name,
            restaurantNameAr: schema_1.restaurants.nameAr,
            restaurantLogo: schema_1.restaurants.logo,
        })
            .from(schema_1.restaurant_users)
            .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.restaurant_users.restaurantId))
            .where((0, drizzle_orm_1.inArray)(schema_1.restaurant_users.userId, userIds));
    }
    // 4. Map them together
    const allUsers = paginatedUsers.map((u) => {
        const userRestaurants = linkedRestaurants
            .filter(lr => lr.userId === u.id && lr.restaurantId && lr.restaurantName)
            .map(lr => ({
            id: lr.restaurantId,
            name: lr.restaurantName,
            nameAr: lr.restaurantNameAr,
            logo: lr.restaurantLogo,
        }));
        return {
            id: u.id,
            name: u.name,
            email: u.email,
            phone: u.phone,
            alternatePhone: u.alternatePhone,
            photo: u.photo,
            status: u.status,
            isVerified: u.isVerified,
            isProfileComplete: u.isProfileComplete,
            totalOrders: u.totalOrders,
            createdAt: u.createdAt,
            restaurants: userRestaurants.length > 0 ? userRestaurants : "Keeto",
        };
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Users fetched successfully",
        data: allUsers,
        pagination: {
            total: totalUsers,
            page,
            limit,
            totalPages
        }
    }, 200);
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
    const { name, phone, status, photo, email, alternatePhone } = req.body;
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
        photo: photoUrl,
        email: email || existingUser.email,
        alternatePhone: alternatePhone || existingUser.alternatePhone
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
// =======================================================
// Get Single User Stats (SuperAdmin User Analytics Page)
// Returns: user info, total points across restaurants,
// total spendings, order source breakdown (pie chart),
// top 5 items, recent orders, and list of restaurants
// the user ordered from.
// =======================================================
const getUserStats = async (req, res) => {
    const { id: userId } = req.params;
    // ─── 1. Verify user exists ──────────────────────────────────────────────
    const [userRecord] = await connection_1.db
        .select({
        id: schema_1.users.id,
        name: schema_1.users.name,
        email: schema_1.users.email,
        phone: schema_1.users.phone,
        photo: schema_1.users.photo,
        status: schema_1.users.status,
        isVerified: schema_1.users.isVerified,
        isProfileComplete: schema_1.users.isProfileComplete,
        createdAt: schema_1.users.createdAt,
    })
        .from(schema_1.users)
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId))
        .limit(1);
    if (!userRecord)
        throw new NotFound_1.NotFound("User not found");
    // ─── 2. Run parallel queries ─────────────────────────────────────────────
    const [pointsRows, aggregateRows, recentOrderRows, topItemRows, restaurantRows] = await Promise.all([
        // Total Points across all restaurants
        connection_1.db.select({
            totalPoints: (0, drizzle_orm_1.sql) `COALESCE(SUM(${schema_1.userRestaurantPoints.points}), 0)`,
        })
            .from(schema_1.userRestaurantPoints)
            .where((0, drizzle_orm_1.eq)(schema_1.userRestaurantPoints.userId, userId)),
        // Aggregate: total orders & total spendings (exclude cancelled)
        connection_1.db.select({
            totalOrders: (0, drizzle_orm_1.sql) `COUNT(*)`,
            totalSpendings: (0, drizzle_orm_1.sql) `COALESCE(SUM(${schema_1.orders.totalAmount}), 0)`,
        })
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), (0, drizzle_orm_1.sql) `${schema_1.orders.status} != 'cancelled'`)),
        // Recent 50 orders with restaurant info
        connection_1.db.select({
            orderNumber: schema_1.orders.orderNumber,
            dailyOrderNumber: schema_1.orders.dailyOrderNumber,
            totalAmount: schema_1.orders.totalAmount,
            orderSource: schema_1.orders.orderSource,
            orderType: schema_1.orders.orderType,
            paymentMethod: schema_1.orders.paymentMethod,
            status: schema_1.orders.status,
            createdAt: schema_1.orders.createdAt,
            restaurant: {
                id: schema_1.restaurants.id,
                name: schema_1.restaurants.name,
                nameAr: schema_1.restaurants.nameAr,
                logo: schema_1.restaurants.logo,
            },
        })
            .from(schema_1.orders)
            .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
            .where((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.orders.createdAt))
            .limit(50),
        // Top 5 most ordered food items globally
        connection_1.db.select({
            foodId: schema_1.orderItems.foodId,
            name: schema_1.food.name,
            nameAr: schema_1.food.nameAr,
            image: schema_1.food.image,
            totalQuantity: (0, drizzle_orm_1.sql) `SUM(${schema_1.orderItems.quantity})`,
            orderCount: (0, drizzle_orm_1.sql) `COUNT(DISTINCT ${schema_1.orderItems.orderId})`,
        })
            .from(schema_1.orderItems)
            .innerJoin(schema_1.orders, (0, drizzle_orm_1.eq)(schema_1.orderItems.orderId, schema_1.orders.id))
            .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.orderItems.foodId, schema_1.food.id))
            .where((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId))
            .groupBy(schema_1.orderItems.foodId, schema_1.food.name, schema_1.food.nameAr, schema_1.food.image)
            .orderBy((0, drizzle_orm_1.sql) `SUM(${schema_1.orderItems.quantity}) DESC`)
            .limit(5),
        // Restaurants the user made orders from
        connection_1.db.select({
            id: schema_1.restaurants.id,
            name: schema_1.restaurants.name,
            nameAr: schema_1.restaurants.nameAr,
            logo: schema_1.restaurants.logo,
            orderCount: (0, drizzle_orm_1.sql) `COUNT(${schema_1.orders.id})`,
            totalSpent: (0, drizzle_orm_1.sql) `COALESCE(SUM(${schema_1.orders.totalAmount}), 0)`,
        })
            .from(schema_1.orders)
            .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), (0, drizzle_orm_1.sql) `${schema_1.orders.status} != 'cancelled'`))
            .groupBy(schema_1.restaurants.id, schema_1.restaurants.name, schema_1.restaurants.nameAr, schema_1.restaurants.logo)
            .orderBy((0, drizzle_orm_1.sql) `COUNT(${schema_1.orders.id}) DESC`),
    ]);
    // ─── 3. Build order-source breakdown (for pie chart) ────────────────────
    const sourceMap = {};
    for (const o of recentOrderRows) {
        const src = o.orderSource ?? "unknown";
        sourceMap[src] = (sourceMap[src] ?? 0) + 1;
    }
    const orderSourceBreakdown = Object.entries(sourceMap).map(([source, count]) => ({ source, count }));
    // ─── 4. Build response ──────────────────────────────────────────────────
    const aggregate = aggregateRows[0];
    return (0, response_1.SuccessResponse)(res, {
        message: "User stats fetched successfully",
        data: {
            user: userRecord,
            stats: {
                points: Number(pointsRows[0]?.totalPoints ?? 0),
                totalOrders: Number(aggregate?.totalOrders ?? 0),
                totalSpendings: Number(aggregate?.totalSpendings ?? 0).toFixed(2),
            },
            orderSourceBreakdown,
            topItems: topItemRows,
            restaurants: restaurantRows.map(r => ({
                ...r,
                orderCount: Number(r.orderCount),
                totalSpent: Number(r.totalSpent).toFixed(2),
            })),
            recentOrders: recentOrderRows,
        },
    }, 200);
};
exports.getUserStats = getUserStats;
