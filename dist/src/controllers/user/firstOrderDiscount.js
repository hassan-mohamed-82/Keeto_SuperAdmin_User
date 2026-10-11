"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAvailableFirstOrderDiscounts = exports.checkFirstOrderDiscount = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const userBlockCheck_1 = require("../../utils/userBlockCheck");
const firstOrderDiscount_helper_1 = require("../../helpers/firstOrderDiscount.helper");
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
const checkFirstOrderDiscount = async (req, res) => {
    const userId = req.user?.id;
    const { restaurantId, subtotal: reqSubtotal } = req.query;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("restaurantId is required");
    // Block check
    await (0, userBlockCheck_1.validateUserNotBlocked)(userId, restaurantId);
    // Resolve subtotal from query or cart
    let subtotal = typeof reqSubtotal === "number" ? reqSubtotal : parseFloat(reqSubtotal || "0");
    if (!subtotal || subtotal <= 0) {
        const userCart = await connection_1.db
            .select()
            .from(schema_1.cartItems)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.restaurantId, restaurantId)));
        if (userCart.length > 0) {
            subtotal = userCart.reduce((sum, item) => {
                return sum + parseFloat(item.totalPrice || "0");
            }, 0);
        }
    }
    const result = await (0, firstOrderDiscount_helper_1.resolveFirstOrderDiscount)(userId, restaurantId, subtotal);
    if (!result) {
        return (0, response_1.SuccessResponse)(res, {
            message: "No first-order discount is currently available for this user.",
            data: null,
        });
    }
    const { discount, discountAmount } = result;
    return (0, response_1.SuccessResponse)(res, {
        message: "First-order discount available",
        data: {
            discountId: discount.id,
            name: discount.name,
            nameAr: discount.nameAr,
            nameFr: discount.nameFr,
            discountType: discount.discountType,
            discountValue: parseFloat(discount.discountValue),
            maxDiscountAmount: discount.maxDiscountAmount
                ? parseFloat(discount.maxDiscountAmount)
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
exports.checkFirstOrderDiscount = checkFirstOrderDiscount;
/**
 * GET /user/first-order-discount/available?restaurantId=...
 *
 * Lists all active first-order discounts for the restaurant that the user
 * is currently eligible for (before taking per-usage limits into account this
 * is informational — full eligibility is enforced at checkout).
 */
const getAvailableFirstOrderDiscounts = async (req, res) => {
    const userId = req.user?.id;
    const { restaurantId } = req.query;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("restaurantId is required");
    await (0, userBlockCheck_1.validateUserNotBlocked)(userId, restaurantId);
    const now = new Date();
    const discounts = await connection_1.db
        .select()
        .from(schema_1.firstOrderDiscounts)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.firstOrderDiscounts.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.firstOrderDiscounts.status, "active"), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.firstOrderDiscounts.startDate), (0, drizzle_orm_1.lte)(schema_1.firstOrderDiscounts.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.firstOrderDiscounts.endDate), (0, drizzle_orm_1.gte)(schema_1.firstOrderDiscounts.endDate, now))));
    // Count user's completed orders at this restaurant
    const [orderCountRow] = await connection_1.db
        .select({ cnt: (0, drizzle_orm_1.count)(schema_1.orders.id) })
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId), (0, drizzle_orm_1.sql) `${schema_1.orders.status} NOT IN ('cancelled', 'failed')`));
    const userOrderCount = Number(orderCountRow?.cnt ?? 0);
    // Filter eligible discounts
    const eligible = discounts.filter(d => {
        if (d.maxUsage !== null && (d.usedCount ?? 0) >= d.maxUsage)
            return false;
        if (userOrderCount >= d.firstOrderCount)
            return false;
        return true;
    });
    return (0, response_1.SuccessResponse)(res, {
        message: "Available first-order discounts fetched",
        data: eligible.map(d => ({
            id: d.id,
            name: d.name,
            nameAr: d.nameAr,
            nameFr: d.nameFr,
            discountType: d.discountType,
            discountValue: parseFloat(d.discountValue),
            maxDiscountAmount: d.maxDiscountAmount ? parseFloat(d.maxDiscountAmount) : null,
            firstOrderCount: d.firstOrderCount,
            startDate: d.startDate,
            endDate: d.endDate,
            userOrderCount,
            remainingFreeOrders: Math.max(0, d.firstOrderCount - userOrderCount),
        })),
    });
};
exports.getAvailableFirstOrderDiscounts = getAvailableFirstOrderDiscounts;
