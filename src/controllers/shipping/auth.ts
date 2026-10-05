import { Request, Response } from "express";
import { db } from "../../models/connection";
import { shippingCompanies } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, UnauthorizedError, NotFound } from "../../Errors";
import bcrypt from "bcrypt";
import { generateShippingCompanyToken } from "../../utils/jwt";

export async function login(req: Request, res: Response) {
    const { email, password } = req.body;

    const companyList = await db
        .select()
        .from(shippingCompanies)
        .where(eq(shippingCompanies.email, email))
        .limit(1);

    if (companyList.length === 0) {
        throw new UnauthorizedError("Invalid credentials");
    }

    const company = companyList[0];

    const isPasswordValid = await bcrypt.compare(password, company.password);
    if (!isPasswordValid) {
        throw new UnauthorizedError("Invalid credentials");
    }

    if (company.status === "inactive") {
        throw new UnauthorizedError("Shipping company account is inactive. Please contact system admin.");
    }

    const token = generateShippingCompanyToken({
        id: company.id,
        name: company.name,
        email: company.email,
    });

    const { password: _, ...companyData } = company;

    return SuccessResponse(res, {
        message: "Logged in successfully",
        token,
        company: companyData,
    });
}

export async function getProfile(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const companyList = await db
        .select()
        .from(shippingCompanies)
        .where(eq(shippingCompanies.id, companyId))
        .limit(1);

    if (companyList.length === 0) {
        throw new NotFound("Shipping company not found");
    }

    const { password: _, ...companyData } = companyList[0];

    return SuccessResponse(res, {
        message: "Profile retrieved successfully",
        data: companyData,
    });
}

export async function updateProfile(req: Request, res: Response) {
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
}
