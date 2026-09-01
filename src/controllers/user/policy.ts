import { catchAsync } from "../../utils/catchAsync";
import { Response, Request } from "express";
import { SuccessResponse } from "../../utils/response";
import { policy } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { BadRequest } from "../../Errors";
import { db } from "../../models/connection";

export const getAllPolicy = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;

    if (!restaurantId) throw new BadRequest("Please provide restaurant id");

    const restaurantPolicies = await db
        .select()
        .from(policy)
        .where(
            and(
                eq(policy.type, "restaurant"),
                eq(policy.restaurantId, restaurantId)
            )
        );

    // 🟢 التحقق من طول المصفوفة للتأكد من وجود سياسات
    if (!restaurantPolicies || restaurantPolicies.length === 0) {
        throw new BadRequest("Policies not found");
    }

    return SuccessResponse(res, {
        message: "Policies fetched successfully",
        data: restaurantPolicies,
    });
}