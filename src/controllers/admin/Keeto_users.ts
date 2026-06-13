import { Request, Response } from "express";
import { db } from "../../models/connection";import { users } from "../../models/schema";
import { eq, inArray, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";
import { saveBase64Image, handleImageUpdate } from "../../utils/handleImages";

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



