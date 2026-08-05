import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurants } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";

export const getActiveRestaurants = async (req: Request, res: Response) => {
    try {
        const activeRestaurants = await db.select({
            name: restaurants.name,
            nameAr: restaurants.nameAr,
            nameFr: restaurants.nameFr,
            orderLink: restaurants.orderLink,
            logo: restaurants.logo
        })
        .from(restaurants)
        .where(eq(restaurants.status, "active"));

        return SuccessResponse(res, {
            message: "Active restaurants fetched successfully",
            data: activeRestaurants
        });
    } catch (error) {
        console.error("Error fetching active restaurants:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
