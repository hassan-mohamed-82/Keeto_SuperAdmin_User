import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cartItems, food, restaurants, restaurantSettings, weightRequests, users } from "../../models/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { SuccessResponse } from "../../utils/response";
import { v4 as uuidv4 } from "uuid";
import { sendPushNotification } from "../../utils/notifications";
import { priceWeightRequestRows } from "../../services/weightRequestPricing.service";

const round2 = (n: number) => Math.round(n * 100) / 100;
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
/**
 * Push to the restaurant (and its branch) about a weight request: same channel as new orders
 * (sendPushNotification → notifications row + FCM). Never throws: the request itself already committed.
 */
const notifyRestaurantAboutWeightRequest = async (p: {
    restaurantId: string;
    branchId: string | null;
    userId: string;
    weightRequestId: string;
    type: "weight_request_new" | "weight_request_cancelled";
    title: string;
    body: (customerName: string) => string;
    extra?: Record<string, unknown>;
}) => {
    try {
        const [customer] = await db.select({ name: users.name }).from(users).where(eq(users.id, p.userId)).limit(1);
        await sendPushNotification({
            recipientType: "restaurant",
            recipientId: p.restaurantId,
            branchId: p.branchId,
            title: p.title,
            body: p.body(customer?.name || "عميل"),
            data: {
                type: p.type,
                weightRequestId: p.weightRequestId,
                restaurantId: p.restaurantId,
                branchId: p.branchId,
                ...(p.extra || {}),
            },
        });
    } catch (err) {
        console.warn(`[WeightRequest] ${p.type} notification failed for request ${p.weightRequestId}:`, err);
    }
};

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

        // Fallback = column default (migration 0013): 10 minutes.
        const timeoutMin = settings?.weightRestaurantTimeoutMin ?? 10;
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
            branchId: (userCart[0].branchId || null) as string | null,
            timeoutMin,
            expiresAt,
            createdAt: now,
        };
    });

    // Tell the restaurant AFTER the transaction committed; a notification failure must not fail the request.
    await notifyRestaurantAboutWeightRequest({
        restaurantId: result.restaurantId,
        branchId: result.branchId,
        userId,
        weightRequestId: result.id,
        type: "weight_request_new",
        title: "طلب وزن جديد ⚖️",
        body: (name) => `طلب وزن جديد من ${name}، يرجى وزن الأصناف وتأكيدها خلال ${result.timeoutMin} دقيقة.`,
        extra: { expiresAt: result.expiresAt },
    });

    const { timeoutMin: _timeoutMin, ...data } = result;
    return SuccessResponse(res, {
        message: "Order sent for weighing successfully",
        data,
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
            allow_custom_weight: food.allow_custom_weight,
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
            discountId: food.discountId,
            discountType: food.discount_type,
            discountValue: food.discount_value,
        })
        .from(cartItems)
        .leftJoin(food, eq(cartItems.foodId, food.id))
        .where(eq(cartItems.weightRequestId, id));

    // Same price snapshot + product discount + line formula as getCart (shared service).
    const priced = await priceWeightRequestRows(
        items.map((item) => ({
            foodId: item.foodId,
            isWeighted: item.sold_by === "weight" || item.orderedWeight != null,
            orderedWeight: item.orderedWeight,
            finalWeight: item.finalWeight,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            variations: item.variations,
            addons: item.addons,
            isUnavailable: item.isUnavailable,
            discountId: item.discountId,
            discountType: item.discountType,
            discountValue: item.discountValue,
        })),
        request.restaurantId
    );

    const formattedItems = items.map((item, index) => {
        const isWeighted = item.sold_by === "weight" || item.orderedWeight != null;
        const line = priced.lines[index];
        const orderedW = item.orderedWeight ? Number(item.orderedWeight) : null;
        const finalW = item.finalWeight ? Number(item.finalWeight) : null;
        const weightChanged = finalW != null && orderedW != null && Math.abs(finalW - orderedW) > 0.0001;

        const snap = snapshotPricing(item, isWeighted);

        return {
            cartItemId: item.cartItemId,
            foodId: item.foodId,
            name: item.name,
            nameAr: item.nameAr,
            image: item.image,
            sold_by: item.sold_by || "unit",
            allowCustomWeight: Boolean(item.allow_custom_weight ?? true),
            quantity: item.quantity,
            orderedWeight: item.orderedWeight ? String(item.orderedWeight) : null,
            finalWeight: item.finalWeight ? String(item.finalWeight) : null,
            weightUnit: item.weightUnit || item.foodWeightUnit || null,
            unitPrice: item.unitPrice,
            // per unit (or per weight unit for weighted items), before and after the product discount
            originalUnitPrice: round2(line.originalUnitPrice),
            discountedUnitPrice: round2(line.finalUnitPrice),
            originalTotalPrice: line.originalTotal.toFixed(2),
            discountAmount: line.discountTotal.toFixed(2),
            totalPrice: line.finalTotal.toFixed(2),
            appliedDiscount: line.appliedDiscount,
            variations: snap.vars,
            addons: snap.addonList,
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
                originalSubtotal: priced.totals.originalSubtotal,
                discountTotal: priced.totals.discountTotal,
                subtotal: priced.totals.subtotal,
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

    const cancelled = await db.transaction(async (tx) => {
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

        return { restaurantId: request.restaurantId, branchId: request.branchId, previousStatus: request.status };
    });

    // Tell the restaurant (it may be weighing right now) AFTER the transaction committed.
    await notifyRestaurantAboutWeightRequest({
        restaurantId: cancelled.restaurantId,
        branchId: cancelled.branchId,
        userId,
        weightRequestId: id,
        type: "weight_request_cancelled",
        title: "تم إلغاء طلب وزن ❌",
        body: (name) => `قام ${name} بإلغاء طلب الوزن${reason ? `: ${String(reason).slice(0, 200)}` : "."}`,
        extra: { previousStatus: cancelled.previousStatus, reason: reason || null },
    });

    return SuccessResponse(res, {
        message: "Weight request cancelled successfully",
        data: { id, status: "cancelled" },
    });
};
