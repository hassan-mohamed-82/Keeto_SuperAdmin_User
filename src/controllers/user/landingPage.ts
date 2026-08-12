import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurants } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";

export const getActiveRestaurants = async (req: Request, res: Response) => {
    try {
        const activeRestaurants = await db.select({
            id: restaurants.id,
            name: restaurants.name,
            nameAr: restaurants.nameAr,
            nameFr: restaurants.nameFr,
            orderLink: restaurants.orderLink,
            logo: restaurants.logo
        })
            .from(restaurants)
            .where(
                and(
                    eq(restaurants.status, "active"),
                    eq(restaurants.deliverystatus, "delivered")
                )
            );

        return SuccessResponse(res, {
            message: "Active restaurants fetched successfully",
            data: activeRestaurants
        });
    } catch (error) {
        console.error("Error fetching active restaurants:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};