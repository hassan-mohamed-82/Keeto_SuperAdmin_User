import { Request, Response } from "express";
import { db } from "../../models/connection";
import { users, restaurant_users, restaurants } from "../../models/schema";
import { eq, inArray, and, or } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";
import { saveBase64Image, handleImageUpdate } from "../../utils/handleImages";

// Get all blocked users (globally blocked or blocked by specific restaurants)
export const getBlockedUsers = async (req: Request, res: Response) => {
    const { restaurantId, search } = req.query;

    // 1. Get all restaurant-level blocked records
    const restaurantBlockConditions = [eq(restaurant_users.status, "blocked")];
    if (restaurantId) {
        restaurantBlockConditions.push(eq(restaurant_users.restaurantId, restaurantId as string));
    }

    const blockedRestaurantLinks = await db
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

    // Map of userId -> blocked restaurants array
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

    // 2. Query users:
    const userIds = Array.from(restaurantBlockedUserIds);
    let allBlockedUsers: any[] = [];

    if (userIds.length > 0) {
        allBlockedUsers = await db
            .select()
            .from(users)
            .where(
                or(
                    eq(users.status, "blocked"),
                    inArray(users.id, userIds)
                )
            );
    } else {
        allBlockedUsers = await db
            .select()
            .from(users)
            .where(eq(users.status, "blocked"));
    }

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

// Get all users
export const getAllUsers = async (req: Request, res: Response) => {
    const allUsers = await db.select().from(users);
    return SuccessResponse(res, { message: "Users fetched successfully", data: allUsers }, 200);
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



