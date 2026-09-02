import { Request, Response } from "express";
import { db } from "../../models/connection";
import { users, restaurant_users, restaurants } from "../../models/schema";
import { eq, inArray, and, or } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";
import { saveBase64Image, handleImageUpdate } from "../../utils/handleImages";

// Get all blocked users (globally blocked by Keeto OR blocked by specific restaurants)
export const getBlockedUsers = async (req: Request, res: Response) => {
    const { restaurantId, search } = req.query;

    // ─── Step 1: Always fetch globally blocked users from users table ────────────
    // These must ALWAYS appear regardless of restaurant_users state.
    const globallyBlockedUsersPromise = db
        .select()
        .from(users)
        .where(eq(users.status, "blocked"));

    // ─── Step 2: Fetch restaurant-level blocked records ──────────────────────────
    const restaurantBlockConditions: ReturnType<typeof eq>[] = [eq(restaurant_users.status, "blocked")];
    if (restaurantId) {
        restaurantBlockConditions.push(eq(restaurant_users.restaurantId, restaurantId as string));
    }

    const blockedRestaurantLinksPromise = db
        .select({
            id: restaurant_users.id,
            userId: restaurant_users.userId,
            restaurantId: restaurant_users.restaurantId,
            status: restaurant_users.status,
            createdAt: restaurant_users.createdAt,
            updatedAt: restaurant_users.updatedAt,
            restaurantName: restaurants.name,
            restaurantNameAr: restaurants.nameAr,
            restaurantLogo: restaurants.logo
        })
        .from(restaurant_users)
        .leftJoin(restaurants, eq(restaurant_users.restaurantId, restaurants.id))
        .where(and(...restaurantBlockConditions));

    // Run both in parallel
    const [globallyBlockedUsers, blockedRestaurantLinks] = await Promise.all([
        globallyBlockedUsersPromise,
        blockedRestaurantLinksPromise,
    ]);

    // Build map: userId -> blocked restaurants array
    const userRestaurantBlocksMap: Record<string, any[]> = {};
    const restaurantBlockedUserIds = new Set<string>();

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

    let restaurantOnlyUsers: any[] = [];
    if (restaurantOnlyIds.length > 0) {
        restaurantOnlyUsers = await db
            .select()
            .from(users)
            .where(inArray(users.id, restaurantOnlyIds));
    }

    // All blocked users = globally blocked + restaurant-only blocked (no duplicates)
    let allBlockedUsers: any[] = [...globallyBlockedUsers, ...restaurantOnlyUsers];

    // Filter by search if provided
    if (search && typeof search === "string") {
        const query = search.toLowerCase();
        allBlockedUsers = allBlockedUsers.filter(u =>
            (u.name && u.name.toLowerCase().includes(query)) ||
            (u.email && u.email.toLowerCase().includes(query)) ||
            (u.phone && u.phone.toLowerCase().includes(query))
        );
    }

    // 3. Format the result
    const result = allBlockedUsers.map(u => {
        const blockedByRestaurants = userRestaurantBlocksMap[u.id] || [];
        const isGloballyBlocked = u.status === "blocked";
        const isRestaurantBlocked = blockedByRestaurants.length > 0;

        let blockType: "global" | "restaurant" | "both" = "global";
        if (isGloballyBlocked && isRestaurantBlocked) {
            blockType = "both";
        } else if (isRestaurantBlocked) {
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

    return SuccessResponse(res, {
        message: "Blocked users fetched successfully",
        total: result.length,
        data: result
    }, 200);
};

// Block or Unblock user for a specific restaurant
export const toggleRestaurantUserBlock = async (req: Request, res: Response) => {
    const { userId, restaurantId, status } = req.body; // status: "active" | "blocked"

    if (!userId || !restaurantId || !status) {
        throw new BadRequest("userId, restaurantId, and status ('active' | 'blocked') are required");
    }

    if (!["active", "blocked"].includes(status)) {
        throw new BadRequest("Status must be either 'active' or 'blocked'");
    }

    const [existingLink] = await db
        .select()
        .from(restaurant_users)
        .where(
            and(
                eq(restaurant_users.userId, userId),
                eq(restaurant_users.restaurantId, restaurantId)
            )
        )
        .limit(1);

    if (existingLink) {
        await db
            .update(restaurant_users)
            .set({ status })
            .where(eq(restaurant_users.id, existingLink.id));
    } else {
        await db.insert(restaurant_users).values({
            id: uuidv4(),
            userId,
            restaurantId,
            status
        });
    }

    return SuccessResponse(res, {
        message: `User successfully ${status === "blocked" ? "blocked from" : "unblocked for"} this restaurant`,
        data: { userId, restaurantId, status }
    }, 200);
};

// Get all users — each user includes the restaurant they logged in from (via restaurant_users).
// If the user has no entry in restaurant_users (or no linked restaurant), restaurant returns "Keeto".
export const getAllUsers = async (req: Request, res: Response) => {
    // Fetch all users with their linked restaurant (if any)
    const result = await db
        .select({
            id: users.id,
            name: users.name,
            email: users.email,
            phone: users.phone,
            photo: users.photo,
            status: users.status,
            isVerified: users.isVerified,
            isProfileComplete: users.isProfileComplete,
            totalOrders: users.totalOrders,
            createdAt: users.createdAt,
            // restaurant_users join fields
            restaurantUserId: restaurant_users.id,
            restaurantId: restaurant_users.restaurantId,
            // restaurant fields
            restaurantName: restaurants.name,
            restaurantNameAr: restaurants.nameAr,
            restaurantLogo: restaurants.logo,
        })
        .from(users)
        .leftJoin(restaurant_users, eq(restaurant_users.userId, users.id))
        .leftJoin(restaurants, eq(restaurants.id, restaurant_users.restaurantId));

    // Group by userId — collect ALL restaurants for each user
    const usersMap: Record<string, any> = {};

    for (const row of result) {
        if (!usersMap[row.id]) {
            usersMap[row.id] = {
                id: row.id,
                name: row.name,
                email: row.email,
                phone: row.phone,
                photo: row.photo,
                status: row.status,
                isVerified: row.isVerified,
                isProfileComplete: row.isProfileComplete,
                totalOrders: row.totalOrders,
                createdAt: row.createdAt,
                restaurants: [], // array to hold all linked restaurants
            };
        }

        // Push every linked restaurant into the array
        if (row.restaurantId && row.restaurantName) {
            usersMap[row.id].restaurants.push({
                id: row.restaurantId,
                name: row.restaurantName,
                nameAr: row.restaurantNameAr,
                logo: row.restaurantLogo,
            });
        }
    }

    const allUsers = Object.values(usersMap).map((u) => ({
        ...u,
        // If no restaurants linked → "Keeto", otherwise return the full array
        restaurants: u.restaurants.length > 0 ? u.restaurants : "Keeto",
    }));

    return SuccessResponse(res, { message: "Users fetched successfully", total: allUsers.length, data: allUsers }, 200);
};

// Get a single user by ID
export const getUserById = async (req: Request, res: Response) => {
    const { id } = req.params;
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    
    if (!user) throw new NotFound("User not found");
    
    return SuccessResponse(res, { message: "User fetched successfully", data: user }, 200);
};

// Update user details and status
export const updateUser = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, phone, status, photo } = req.body;

    const [existingUser] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    
    if (!existingUser) {
        throw new NotFound("User not found");
    }

    let photoUrl = existingUser.photo;
    if (photo && photo !== existingUser.photo) {
        if (photo.startsWith("data:image")) {
            photoUrl = await handleImageUpdate(req, existingUser.photo, photo, "users");
            // If replacing, you might want to delete the old image using handleImageUpdate if configured
        } else {
            photoUrl = photo;
        }
    }

    await db.update(users)
        .set({
            name: name || existingUser.name,
            phone: phone || existingUser.phone,
            status: status || existingUser.status,
            photo: photoUrl
        })
        .where(eq(users.id, id));

    return SuccessResponse(res, { message: "User updated successfully", data: { id } }, 200);
};

// Delete a user
export const deleteUser = async (req: Request, res: Response) => {
    const { id } = req.params;

    const [existingUser] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existingUser) {
        throw new NotFound("User not found");
    }

    await db.delete(users).where(eq(users.id, id));

    return SuccessResponse(res, { message: "User deleted successfully", data: { id } }, 200);
};



