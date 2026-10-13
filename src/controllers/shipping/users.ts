import { Request, Response } from "express";
import { db } from "../../models/connection";
import { shippingCompanyUsers } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound, UnauthorizedError, ConflictError } from "../../Errors";
import bcrypt from "bcrypt";
import { catchAsync } from "../../utils/catchAsync";

// =========================================================================
// 1. Get all company users (admin only)
// =========================================================================
export const getCompanyUsers = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const users = await db
        .select({
            id: shippingCompanyUsers.id,
            shippingCompanyId: shippingCompanyUsers.shippingCompanyId,
            name: shippingCompanyUsers.name,
            email: shippingCompanyUsers.email,
            phone: shippingCompanyUsers.phone,
            role: shippingCompanyUsers.role,
            status: shippingCompanyUsers.status,
            createdAt: shippingCompanyUsers.createdAt,
            updatedAt: shippingCompanyUsers.updatedAt,
        })
        .from(shippingCompanyUsers)
        .where(eq(shippingCompanyUsers.shippingCompanyId, companyId));

    return SuccessResponse(res, {
        message: "Shipping company users retrieved successfully",
        data: users,
    });
});

// =========================================================================
// 2. Create company user (admin only)
// =========================================================================
export const createCompanyUser = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const { name, email, password, phone, role = "dispatcher" } = req.body;

    // Check duplicate email
    const [existing] = await db
        .select({ id: shippingCompanyUsers.id })
        .from(shippingCompanyUsers)
        .where(eq(shippingCompanyUsers.email, email))
        .limit(1);

    if (existing) {
        throw new ConflictError("Email already in use by another user");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [insertResult] = await db.insert(shippingCompanyUsers).values({
        shippingCompanyId: companyId,
        name,
        email,
        password: hashedPassword,
        phone,
        role,
        status: "active",
        tokenVersion: 0,
    });

    const [newUser] = await db
        .select({
            id: shippingCompanyUsers.id,
            shippingCompanyId: shippingCompanyUsers.shippingCompanyId,
            name: shippingCompanyUsers.name,
            email: shippingCompanyUsers.email,
            phone: shippingCompanyUsers.phone,
            role: shippingCompanyUsers.role,
            status: shippingCompanyUsers.status,
            createdAt: shippingCompanyUsers.createdAt,
        })
        .from(shippingCompanyUsers)
        .where(eq(shippingCompanyUsers.email, email))
        .limit(1);

    return SuccessResponse(res, {
        message: "Shipping company user created successfully",
        data: newUser,
    }, 201);
});

// =========================================================================
// 3. Update company user (admin only)
// =========================================================================
export const updateCompanyUser = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const [user] = await db
        .select()
        .from(shippingCompanyUsers)
        .where(
            and(
                eq(shippingCompanyUsers.id, id),
                eq(shippingCompanyUsers.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (!user) {
        throw new NotFound("User not found");
    }

    const { name, email, password, phone, role, status } = req.body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (role !== undefined) updateData.role = role;
    if (status !== undefined) {
        updateData.status = status;
        // Invalidate tokens when user is deactivated
        if (status === "inactive") {
            updateData.tokenVersion = user.tokenVersion + 1;
        }
    }

    if (email && email !== user.email) {
        const [existing] = await db
            .select({ id: shippingCompanyUsers.id })
            .from(shippingCompanyUsers)
            .where(eq(shippingCompanyUsers.email, email))
            .limit(1);

        if (existing) {
            throw new ConflictError("Email already in use by another user");
        }
        updateData.email = email;
    }

    if (password) {
        updateData.password = await bcrypt.hash(password, 10);
        // Increment tokenVersion to revoke active tokens upon password change
        updateData.tokenVersion = user.tokenVersion + 1;
    }

    await db
        .update(shippingCompanyUsers)
        .set(updateData)
        .where(eq(shippingCompanyUsers.id, id));

    return SuccessResponse(res, {
        message: "User updated successfully",
    });
});

// =========================================================================
// 4. Delete company user (admin only, cannot delete oneself)
// =========================================================================
export const deleteCompanyUser = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const currentUserId = req.user?.id;
    const { id } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    if (id === currentUserId) {
        throw new BadRequest("You cannot delete your own account");
    }

    const [user] = await db
        .select()
        .from(shippingCompanyUsers)
        .where(
            and(
                eq(shippingCompanyUsers.id, id),
                eq(shippingCompanyUsers.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (!user) {
        throw new NotFound("User not found");
    }

    await db
        .delete(shippingCompanyUsers)
        .where(eq(shippingCompanyUsers.id, id));

    return SuccessResponse(res, {
        message: "User deleted successfully",
    });
});
