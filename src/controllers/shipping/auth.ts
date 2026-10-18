import { Request, Response } from "express";
import { db } from "../../models/connection";
import { shippingCompanies, shippingCompanyUsers, deliveryMen } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError, NotFound, BadRequest } from "../../Errors";
import bcrypt from "bcrypt";
import { generateShippingCompanyToken, generateDeliveryManToken } from "../../utils/jwt";
import { catchAsync } from "../../utils/catchAsync";

// =========================================================================
// 1. Login via shipping_company_users (D6)
// =========================================================================
export const login = catchAsync(async (req: Request, res: Response) => {
    const { email, password } = req.body;

    if (!email || !password) {
        throw new BadRequest("Email and password are required");
    }

    const userList = await db
        .select({
            id: shippingCompanyUsers.id,
            shippingCompanyId: shippingCompanyUsers.shippingCompanyId,
            name: shippingCompanyUsers.name,
            email: shippingCompanyUsers.email,
            password: shippingCompanyUsers.password,
            role: shippingCompanyUsers.role,
            status: shippingCompanyUsers.status,
            tokenVersion: shippingCompanyUsers.tokenVersion,
            companyName: shippingCompanies.name,
            companyStatus: shippingCompanies.status,
        })
        .from(shippingCompanyUsers)
        .innerJoin(shippingCompanies, eq(shippingCompanyUsers.shippingCompanyId, shippingCompanies.id))
        .where(eq(shippingCompanyUsers.email, email))
        .limit(1);

    if (userList.length === 0) {
        throw new UnauthorizedError("Invalid credentials");
    }

    const user = userList[0];

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
        throw new UnauthorizedError("Invalid credentials");
    }

    if (user.status !== "active") {
        throw new UnauthorizedError("Your account is inactive. Please contact your administrator.");
    }

    if (user.companyStatus !== "active") {
        throw new UnauthorizedError("Shipping company account is inactive. Please contact system admin.");
    }

    // D6: JWT carries id=user.id, shippingCompanyId=company.id, role=shipping_company, companyRole
    const token = generateShippingCompanyToken({
        id: user.id,
        shippingCompanyId: user.shippingCompanyId,
        name: user.name,
        email: user.email,
        companyRole: user.role,
        tokenVersion: user.tokenVersion,
    });

    return SuccessResponse(res, {
        message: "Logged in successfully",
        token,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            shippingCompanyId: user.shippingCompanyId,
            companyName: user.companyName,
        },
    });
});

// =========================================================================
// 2. Get Company Profile (for shipping company users)
// =========================================================================
export const getProfile = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const companyList = await db
        .select({
            id: shippingCompanies.id,
            name: shippingCompanies.name,
            nameAr: shippingCompanies.nameAr,
            phone: shippingCompanies.phone,
            email: shippingCompanies.email,
            address: shippingCompanies.address,
            logo: shippingCompanies.logo,
            maxSearchRadius: shippingCompanies.maxSearchRadius,
            maxActiveOrders: shippingCompanies.maxActiveOrders,
            maxAttempts: shippingCompanies.maxAttempts,
            commissionType: shippingCompanies.commissionType,
            commissionValue: shippingCompanies.commissionValue,
            status: shippingCompanies.status,
            createdAt: shippingCompanies.createdAt,
            updatedAt: shippingCompanies.updatedAt,
        })
        .from(shippingCompanies)
        .where(eq(shippingCompanies.id, companyId))
        .limit(1);

    if (companyList.length === 0) {
        throw new NotFound("Shipping company not found");
    }

    return SuccessResponse(res, {
        message: "Profile retrieved successfully",
        data: companyList[0],
    });
});

// =========================================================================
// 3. Get Current User Profile
// =========================================================================
export const getMyUserProfile = catchAsync(async (req: Request, res: Response) => {
    const userId = req.user?.id;

    if (!userId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const userList = await db
        .select({
            id: shippingCompanyUsers.id,
            name: shippingCompanyUsers.name,
            email: shippingCompanyUsers.email,
            phone: shippingCompanyUsers.phone,
            role: shippingCompanyUsers.role,
            status: shippingCompanyUsers.status,
            shippingCompanyId: shippingCompanyUsers.shippingCompanyId,
            createdAt: shippingCompanyUsers.createdAt,
        })
        .from(shippingCompanyUsers)
        .where(eq(shippingCompanyUsers.id, userId))
        .limit(1);

    if (userList.length === 0) {
        throw new NotFound("User not found");
    }

    return SuccessResponse(res, {
        message: "User profile retrieved successfully",
        data: userList[0],
    });
});

// =========================================================================
// 4. Update Company Profile
// =========================================================================
export const updateProfile = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId || req.user?.id;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const { name, nameAr, phone, address, logo, password } = req.body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (nameAr !== undefined) updateData.nameAr = nameAr;
    if (phone !== undefined) updateData.phone = phone;
    if (address !== undefined) updateData.address = address;
    if (logo !== undefined) updateData.logo = logo;

    if (password) {
        updateData.password = await bcrypt.hash(password, 10);
    }

    await db
        .update(shippingCompanies)
        .set(updateData)
        .where(eq(shippingCompanies.id, companyId));

    return SuccessResponse(res, {
        message: "Profile updated successfully",
    });
});
