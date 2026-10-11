// src/controllers/user/firstOrderDiscount.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cartItems, firstOrderDiscounts, firstOrderDiscountUsages, orders } from "../../models/schema";
import { eq, and, count, sql, or, isNull, lte, gte } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { validateUserNotBlocked } from "../../utils/userBlockCheck";
import { resolveFirstOrderDiscount } from "../../helpers/firstOrderDiscount.helper";

/**
 * GET /user/first-order-discount/check?restaurantId=...
 *
 * Returns the best eligible first-order discount for the current user at the
 * specified restaurant, along with the computed discount amount based on their
 * current cart subtotal.
 *
 * Also shows any currently existing product / campaign discounts so the client
 * can display the maximum discount that will be applied at checkout.
 */
export const checkFirstOrderDiscount = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { restaurantId, subtotal: reqSubtotal } = req.query as any;

    if (!restaurantId) throw new BadRequest("restaurantId is required");

    // Block check
    await validateUserNotBlocked(userId, restaurantId);

    // Resolve subtotal from query or cart
    let subtotal = typeof reqSubtotal === "number" ? reqSubtotal : parseFloat(reqSubtotal || "0");

    if (!subtotal || subtotal <= 0) {
        const userCart = await db
            .select()
            .from(cartItems)
            .where(
                and(
                    eq(cartItems.userId, userId),
                    eq(cartItems.restaurantId, restaurantId)
                )
            );

        if (userCart.length > 0) {
            subtotal = userCart.reduce((sum, item) => {
                return sum + parseFloat(item.totalPrice as string || "0");
            }, 0);
        }
    }

    const result = await resolveFirstOrderDiscount(userId, restaurantId, subtotal);

    if (!result) {
        return SuccessResponse(res, {
            message: "No first-order discount is currently available for this user.",
            data: null,
        });
    }

    const { discount, discountAmount } = result;

    return SuccessResponse(res, {
        message: "First-order discount available",
        data: {
            discountId: discount.id,
            name: discount.name,
            nameAr: discount.nameAr,
            nameFr: discount.nameFr,
            discountType: discount.discountType,
            discountValue: parseFloat(discount.discountValue as string),
            maxDiscountAmount: discount.maxDiscountAmount
                ? parseFloat(discount.maxDiscountAmount as string)
                : null,
            firstOrderCount: discount.firstOrderCount,
            discountAmount,
            summary: {
                subtotal: Math.round(subtotal * 100) / 100,
                discountAmount,
                finalSubtotal: Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100),
            },
        },
    });
};

/**
 * GET /user/first-order-discount/available?restaurantId=...
 *
 * Lists all active first-order discounts for the restaurant that the user
 * is currently eligible for (before taking per-usage limits into account this
 * is informational — full eligibility is enforced at checkout).
 */
export const getAvailableFirstOrderDiscounts = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { restaurantId } = req.query as any;

    if (!restaurantId) throw new BadRequest("restaurantId is required");

    await validateUserNotBlocked(userId, restaurantId);

    const now = new Date();

    const discounts = await db
        .select()
        .from(firstOrderDiscounts)
        .where(
            and(
                eq(firstOrderDiscounts.restaurantId, restaurantId),
                eq(firstOrderDiscounts.status, "active"),
                or(isNull(firstOrderDiscounts.startDate), lte(firstOrderDiscounts.startDate, now)),
                or(isNull(firstOrderDiscounts.endDate), gte(firstOrderDiscounts.endDate, now)),
            )
        );

    // Count user's completed orders at this restaurant
    const [orderCountRow] = await db
        .select({ cnt: count(orders.id) })
        .from(orders)
        .where(
            and(
                eq(orders.userId, userId),
                eq(orders.restaurantId, restaurantId),
                sql`${orders.status} NOT IN ('cancelled', 'failed')`
            )
        );
    const userOrderCount = Number(orderCountRow?.cnt ?? 0);

    // Filter eligible discounts
    const eligible = discounts.filter(d => {
        if (d.maxUsage !== null && (d.usedCount ?? 0) >= d.maxUsage) return false;
        if (userOrderCount >= d.firstOrderCount) return false;
        return true;
    });

    return SuccessResponse(res, {
        message: "Available first-order discounts fetched",
        data: eligible.map(d => ({
            id: d.id,
            name: d.name,
            nameAr: d.nameAr,
            nameFr: d.nameFr,
            discountType: d.discountType,
            discountValue: parseFloat(d.discountValue as string),
            maxDiscountAmount: d.maxDiscountAmount ? parseFloat(d.maxDiscountAmount as string) : null,
            firstOrderCount: d.firstOrderCount,
            startDate: d.startDate,
            endDate: d.endDate,
            userOrderCount,
            remainingFreeOrders: Math.max(0, d.firstOrderCount - userOrderCount),
        })),
    });
};
