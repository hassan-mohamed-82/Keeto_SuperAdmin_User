import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    shippingCompanyRestaurants,
    restaurants,
    branches,
    restaurantSettings,
} from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError } from "../../Errors";

export async function getAssignedRestaurants(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const assigned = await db
        .select({
            id: restaurants.id,
            name: restaurants.name,
            nameAr: restaurants.nameAr,
            logo: restaurants.logo,
            cover: restaurants.cover,
            address: restaurants.address,
            phone: restaurants.ownerPhone,
            lat: restaurants.lat,
            lng: restaurants.lng,
            status: restaurants.status,
            homeDelivery: restaurantSettings.homeDelivery,
            selfDelivery: restaurantSettings.selfDelivery,
            assignedAt: shippingCompanyRestaurants.createdAt,
        })
        .from(shippingCompanyRestaurants)
        .innerJoin(restaurants, eq(shippingCompanyRestaurants.restaurantId, restaurants.id))
        .leftJoin(restaurantSettings, eq(restaurants.id, restaurantSettings.restaurantId))
        .where(
            and(
                eq(shippingCompanyRestaurants.shippingCompanyId, companyId),
                eq(shippingCompanyRestaurants.status, "active")
            )
        );

    return SuccessResponse(res, {
        message: "Assigned restaurants retrieved successfully",
        data: assigned,
    });
}

export async function getRestaurantBranches(req: Request, res: Response) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { restaurantId } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    // التأكد أن المطعم تابع لشركة الشحن
    const isAssigned = await db
        .select({ id: shippingCompanyRestaurants.id })
        .from(shippingCompanyRestaurants)
        .where(
            and(
                eq(shippingCompanyRestaurants.shippingCompanyId, companyId),
                eq(shippingCompanyRestaurants.restaurantId, restaurantId),
                eq(shippingCompanyRestaurants.status, "active")
            )
        )
        .limit(1);

    if (isAssigned.length === 0) {
        throw new UnauthorizedError("Restaurant is not assigned to this shipping company");
    }

    const branchList = await db
        .select()
        .from(branches)
        .where(eq(branches.restaurantId, restaurantId));

    return SuccessResponse(res, {
        message: "Restaurant branches retrieved successfully",
        data: branchList,
    });
}
