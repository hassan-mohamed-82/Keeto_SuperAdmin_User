import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    restaurants,
    branches,
    restaurantSettings,
} from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError } from "../../Errors";
import { catchAsync } from "../../utils/catchAsync";

// D3: Read strictly from restaurantSettings.shippingCompanyId
export const getAssignedRestaurants = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;

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
        })
        .from(restaurantSettings)
        .innerJoin(restaurants, eq(restaurantSettings.restaurantId, restaurants.id))
        .where(eq(restaurantSettings.shippingCompanyId, companyId));

    return SuccessResponse(res, {
        message: "Assigned restaurants retrieved successfully",
        data: assigned,
    });
});

export const getRestaurantBranches = catchAsync(async (req: Request, res: Response) => {
    const companyId = req.user?.shippingCompanyId;
    const { restaurantId } = req.params;

    if (!companyId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    // Verify restaurant is linked to this shipping company
    const [settings] = await db
        .select({ id: restaurantSettings.id })
        .from(restaurantSettings)
        .where(
            and(
                eq(restaurantSettings.restaurantId, restaurantId),
                eq(restaurantSettings.shippingCompanyId, companyId)
            )
        )
        .limit(1);

    if (!settings) {
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
});
