import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cartItems, food, restaurants, restaurantSettings, weightRequests, users } from "../../models/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { SuccessResponse } from "../../utils/response";
import { v4 as uuidv4 } from "uuid";
import {
    ACTIVE_WEIGHT_REQUEST_STATUSES,
    FROZEN_CART_STATUSES,
    isWeighedRow,
    snapshotPricing,
    weightedLineTotal,
} from "../../helpers/weightCart.helper";

/**
 * 🟢 1. POST /weight-requests
 * Sends the user's cart for weighing to the restaurant.
 * Enforces one active request per user + restaurant via a FOR UPDATE lock on cart items.
 */
export const sendWeightRequest = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    let restaurantId = req.body.restaurantId;

    const result = await db.transaction(async (tx) => {
        // If restaurantId not provided in body, discover from cart
        if (!restaurantId) {
            const [firstCart] = await tx
                .select({ restaurantId: cartItems.restaurantId })
                .from(cartItems)
                .where(eq(cartItems.userId, userId))
                .limit(1);
            if (!firstCart) throw new BadRequest("Your cart is empty");
            restaurantId = firstCart.restaurantId;
        }

        // Lock all cart items for this user and restaurant
        const userCart = await tx
            .select()
            .from(cartItems)
            .where(and(eq(cartItems.userId, userId), eq(cartItems.restaurantId, restaurantId)))
            .for("update");

        if (!userCart.length) throw new BadRequest("Your cart is empty");

        // Check that at least one item is weight-based
        const cartFoodIds = userCart.filter((c) => c.foodId).map((c) => c.foodId!);
        const dbFoods = cartFoodIds.length > 0
            ? await tx
                .select({ id: food.id, sold_by: food.sold_by, weight_unit: food.weight_unit })
                .from(food)
                .where(inArray(food.id, cartFoodIds))
            : [];

        const weightedFoodMap = new Map(dbFoods.map((f) => [f.id, f]));
        // Only WEIGHTED customer rows are sent for weighing; normal (unit) rows stay
        // untagged and editable, and are priced at checkout like any normal order.
        const weightedCustomerRows = userCart.filter(
            (c) => !c.offerId && c.addedBy === "customer" && isWeighedRow(c, weightedFoodMap.get(c.foodId)?.sold_by)
        );

        if (weightedCustomerRows.length === 0) {
            throw new BadRequest("Cart does not contain any weight-based items to weigh.");
        }

        // Check if any cart item is already tied to an active request
        const alreadyLocked = userCart.some((c) => c.weightRequestId);
        if (alreadyLocked) {
            throw new BadRequest("Some items in your cart are already submitted for weighing.");
        }

        // Restaurant-added rows without a request are leftovers of a dead request: drop them
        // so they can never ride along into the new request or an order.
        const orphanRestaurantRowIds = userCart.filter((c) => c.addedBy === "restaurant").map((c) => c.id);
        if (orphanRestaurantRowIds.length > 0) {
            await tx.delete(cartItems).where(inArray(cartItems.id, orphanRestaurantRowIds));
        }

        // Enforce at most ONE active weight request per user + restaurant
        const [activeRequest] = await tx
            .select({ id: weightRequests.id, status: weightRequests.status })
            .from(weightRequests)
            .where(
                and(
                    eq(weightRequests.userId, userId),
                    eq(weightRequests.restaurantId, restaurantId),
                    inArray(weightRequests.status, [...ACTIVE_WEIGHT_REQUEST_STATUSES, ...FROZEN_CART_STATUSES] as any)
                )
            )
            .for("update");

        if (activeRequest) {
            throw new BadRequest("An active weighing request already exists for this restaurant.");
        }

        // Fetch timeout from restaurant settings
        const [settings] = await tx
            .select({ weightRestaurantTimeoutMin: restaurantSettings.weightRestaurantTimeoutMin })
            .from(restaurantSettings)
            .where(eq(restaurantSettings.restaurantId, restaurantId))
            .limit(1);

        const timeoutMin = settings?.weightRestaurantTimeoutMin ?? 30;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + timeoutMin * 60 * 1000);
        const requestId = uuidv4();

        const [createdRequest] = await tx
            .insert(weightRequests)
            .values({
                id: requestId,
                userId,
                restaurantId,
                branchId: userCart[0].branchId || null,
                status: "awaiting_weighing",
                expiresAt,
                createdAt: now,
                updatedAt: now,
            })
            .$returningId();

        // Lock only the weighted customer rows to this weight request
        await tx
            .update(cartItems)
            .set({
                weightRequestId: requestId,
                finalWeight: null,
                isUnavailable: false,
                updatedAt: now,
            })
            .where(inArray(cartItems.id, weightedCustomerRows.map((c) => c.id)));

        return {
            id: requestId,
            status: "awaiting_weighing",
            restaurantId,
            expiresAt,
            createdAt: now,
        };
    });

    return SuccessResponse(res, {
        message: "Order sent for weighing successfully",
        data: result,
    });
};

/**
 * 🟢 2. GET /weight-requests/:id
 * Fetches status, expiry, items with ordered vs final weight, addedBy, totals, weightChanged.
 */
export const getWeightRequestById = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { id } = req.params;

    const [request] = await db
        .select()
        .from(weightRequests)
        .where(and(eq(weightRequests.id, id), eq(weightRequests.userId, userId)))
        .limit(1);

    if (!request) {
        throw new NotFound("Weight request not found");
    }

    const items = await db
        .select({
            cartItemId: cartItems.id,
            foodId: cartItems.foodId,
            name: food.name,
            nameAr: food.nameAr,
            image: food.image,
            basePrice: food.price,
            sold_by: food.sold_by,
            foodWeightUnit: food.weight_unit,
            quantity: cartItems.quantity,
            orderedWeight: cartItems.weight,
            finalWeight: cartItems.finalWeight,
            weightUnit: cartItems.weightUnit,
            unitPrice: cartItems.unitPrice,
            totalPrice: cartItems.totalPrice,
            variations: cartItems.variations,
            addons: cartItems.addons,
            note: cartItems.note,
            isUnavailable: cartItems.isUnavailable,
            addedBy: cartItems.addedBy,
            addedByAdminId: cartItems.addedByAdminId,
        })
        .from(cartItems)
        .leftJoin(food, eq(cartItems.foodId, food.id))
        .where(eq(cartItems.weightRequestId, id));

    let subtotal = 0;
    const formattedItems = items.map((item) => {
        const isWeighted = item.sold_by === "weight" || item.orderedWeight != null;
        const orderedW = item.orderedWeight ? Number(item.orderedWeight) : null;
        const finalW = item.finalWeight ? Number(item.finalWeight) : null;
        const weightChanged = finalW != null && orderedW != null && Math.abs(finalW - orderedW) > 0.0001;

        let parsedVars: any[] = [];
        try {
            parsedVars = typeof item.variations === "string" ? JSON.parse(item.variations) : item.variations || [];
        } catch {
            parsedVars = [];
        }

        let parsedAddons: any[] = [];
        try {
            parsedAddons = typeof item.addons === "string" ? JSON.parse(item.addons) : item.addons || [];
        } catch {
            parsedAddons = [];
        }

        let lineTotal = parseFloat(item.totalPrice as string || "0");
        if (isWeighted) {
            // Same snapshot pricing as checkout (unit_price = base price per weight unit,
            // option/addon prices from the snapshot), not the live food.price.
            const effectiveWeight = finalW ?? orderedW ?? 0;
            const snap = snapshotPricing(item, true);
            lineTotal = weightedLineTotal(effectiveWeight, snap.basePrice, snap.variationExtras, snap.addonExtras);
            parsedVars = snap.vars;
            parsedAddons = snap.addonList;
        }

        if (!item.isUnavailable) {
            subtotal += lineTotal;
        }

        return {
            cartItemId: item.cartItemId,
            foodId: item.foodId,
            name: item.name,
            nameAr: item.nameAr,
            image: item.image,
            sold_by: item.sold_by || "unit",
            quantity: item.quantity,
            orderedWeight: item.orderedWeight ? String(item.orderedWeight) : null,
            finalWeight: item.finalWeight ? String(item.finalWeight) : null,
            weightUnit: item.weightUnit || item.foodWeightUnit || null,
            unitPrice: item.unitPrice,
            totalPrice: lineTotal.toFixed(2),
            variations: parsedVars,
            addons: parsedAddons,
            note: item.note,
            isUnavailable: Boolean(item.isUnavailable),
            addedBy: item.addedBy || "customer",
            addedByAdminId: item.addedByAdminId,
            weightChanged,
        };
    });

    const isExpired = new Date(request.expiresAt) <= new Date();
    const isEstimatedTotal = request.status !== "awaiting_customer_approval";

    return SuccessResponse(res, {
        message: "Weight request fetched successfully",
        data: {
            request: {
                id: request.id,
                status: request.status,
                expiresAt: request.expiresAt,
                weighedAt: request.weighedAt,
                cancelReason: request.cancelReason,
                orderId: request.orderId,
                isExpired,
            },
            items: formattedItems,
            totals: {
                subtotal: parseFloat(subtotal.toFixed(2)),
                isEstimatedTotal,
            },
            canCheckout: request.status === "awaiting_customer_approval" && !isExpired && formattedItems.some((i) => !i.isUnavailable),
        },
    });
};

/**
 * 🟢 3. POST /weight-requests/:id/cancel
 * Cancels the request, unlocks and resets customer cart items, and deletes items added by restaurant.
 */
export const cancelWeightRequest = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { id } = req.params;
    const { reason } = req.body;

    const now = new Date();

    await db.transaction(async (tx) => {
        const [request] = await tx
            .select()
            .from(weightRequests)
            .where(and(eq(weightRequests.id, id), eq(weightRequests.userId, userId)))
            .for("update");

        if (!request) {
            throw new NotFound("Weight request not found");
        }

        if (!["awaiting_weighing", "awaiting_customer_approval"].includes(request.status)) {
            throw new BadRequest(`Cannot cancel request with status: ${request.status}`);
        }

        // Update request status
        await tx
            .update(weightRequests)
            .set({
                status: "cancelled",
                cancelReason: reason || "Cancelled by customer",
                updatedAt: now,
            })
            .where(eq(weightRequests.id, id));

        // 1. Delete items added by restaurant
        await tx
            .delete(cartItems)
            .where(and(eq(cartItems.weightRequestId, id), eq(cartItems.addedBy, "restaurant")));

        // 2. Unlock and reset customer's own items
        await tx
            .update(cartItems)
            .set({
                weightRequestId: null,
                finalWeight: null,
                isUnavailable: false,
                updatedAt: now,
            })
            .where(and(eq(cartItems.weightRequestId, id), eq(cartItems.addedBy, "customer")));
    });

    return SuccessResponse(res, {
        message: "Weight request cancelled successfully",
        data: { id, status: "cancelled" },
    });
};
