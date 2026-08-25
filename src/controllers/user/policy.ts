import { catchAsync } from "../../utils/catchAsync";
import { Response , Request} from "express";
import {SuccessResponse} from "../../utils/response";
import { policy } from "../../models/schema";
import { eq , and } from "drizzle-orm";
import { BadRequest } from "../../Errors";
import { db } from "../../models/connection";

export const getAllPolicy = async(req:Request,res:Response)=>{
   const { restaurantId } = req.params;

    if (!restaurantId) throw new BadRequest("Please provide restaurant id");

    const [restaurantPolicy] = await db
        .select()
        .from(policy)
        .where(
            and(
                eq(policy.type,"restaurant"),
                eq(policy.restaurantId, restaurantId)
            )
        );

    if (!restaurantPolicy) throw new BadRequest("Policy not found");

    return SuccessResponse(res, {
        message:"Policy fetched successfully",
        data: restaurantPolicy,
    });
}