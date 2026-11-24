"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelWeightRequest = exports.getWeightRequestById = exports.sendWeightRequest = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const response_1 = require("../../utils/response");
const uuid_1 = require("uuid");
const notifications_1 = require("../../utils/notifications");
const weightRequestPricing_service_1 = require("../../services/weightRequestPricing.service");
const round2 = (n) => Math.round(n * 100) / 100;
const weightCart_helper_1 = require("../../helpers/weightCart.helper");
/**
 * 🟢 1. POST /weight-requests
 * Sends the user's cart for weighing to the restaurant.
 * Enforces one active request per user + restaurant via a FOR UPDATE lock on cart items.
 */
/**
 * Push to the restaurant (and its branch) about a weight request: same channel as new orders
 * (sendPushNotification → notifications row + FCM). Never throws: the request itself already committed.
 */
const notifyRestaurantAboutWeightRequest = async (p) => {
    try {
        const [customer] = await connection_1.db.select({ name: schema_1.users.name }).from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, p.userId)).limit(1);
        await (0, notifications_1.sendPushNotification)({
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
    }
    catch (err) {
        console.warn(`[WeightRequest] ${p.type} notification failed for request ${p.weightRequestId}:`, err);
    }
};
const sendWeightRequest = async (req, res) => {
    const userId = req.user?.id;
    let restaurantId = req.body.restaurantId;
    const result = await connection_1.db.transaction(async (tx) => {
        // If restaurantId not provided in body, discover from cart
        if (!restaurantId) {
            const [firstCart] = await tx
                .select({ restaurantId: schema_1.cartItems.restaurantId })
                .from(schema_1.cartItems)
                .where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId))
                .limit(1);
            if (!firstCart)
                throw new BadRequest_1.BadRequest("Your cart is empty");
            restaurantId = firstCart.restaurantId;
        }
        // Lock all cart items for this user and restaurant
        const userCart = await tx
            .select()
            .from(schema_1.cartItems)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.restaurantId, restaurantId)))
            .for("update");
        if (!userCart.length)
            throw new BadRequest_1.BadRequest("Your cart is empty");
        // Check that at least one item is weight-based
        const cartFoodIds = userCart.filter((c) => c.foodId).map((c) => c.foodId);
        const dbFoods = cartFoodIds.length > 0
            ? await tx
                .select({ id: schema_1.food.id, sold_by: schema_1.food.sold_by, weight_unit: schema_1.food.weight_unit })
                .from(schema_1.food)
                .where((0, drizzle_orm_1.inArray)(schema_1.food.id, cartFoodIds))
            : [];
        const weightedFoodMap = new Map(dbFoods.map((f) => [f.id, f]));
        // Only WEIGHTED customer rows are sent for weighing; normal (unit) rows stay
        // untagged and editable, and are priced at checkout like any normal order.
        const weightedCustomerRows = userCart.filter((c) => !c.offerId && c.addedBy === "customer" && (0, weightCart_helper_1.isWeighedRow)(c, weightedFoodMap.get(c.foodId)?.sold_by));
        if (weightedCustomerRows.length === 0) {
            throw new BadRequest_1.BadRequest("Cart does not contain any weight-based items to weigh.");
        }
        // Check if any cart item is already tied to an active request
        const alreadyLocked = userCart.some((c) => c.weightRequestId);
        if (alreadyLocked) {
            throw new BadRequest_1.BadRequest("Some items in your cart are already submitted for weighing.");
        }
        // Restaurant-added rows without a request are leftovers of a dead request: drop them
        // so they can never ride along into the new request or an order.
        const orphanRestaurantRowIds = userCart.filter((c) => c.addedBy === "restaurant").map((c) => c.id);
        if (orphanRestaurantRowIds.length > 0) {
            await tx.delete(schema_1.cartItems).where((0, drizzle_orm_1.inArray)(schema_1.cartItems.id, orphanRestaurantRowIds));
        }
        // Enforce at most ONE active weight request per user + restaurant
        const [activeRequest] = await tx
            .select({ id: schema_1.weightRequests.id, status: schema_1.weightRequests.status })
            .from(schema_1.weightRequests)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.weightRequests.userId, userId), (0, drizzle_orm_1.eq)(schema_1.weightRequests.restaurantId, restaurantId), (0, drizzle_orm_1.inArray)(schema_1.weightRequests.status, [...weightCart_helper_1.ACTIVE_WEIGHT_REQUEST_STATUSES, ...weightCart_helper_1.FROZEN_CART_STATUSES])))
            .for("update");
        if (activeRequest) {
            throw new BadRequest_1.BadRequest("An active weighing request already exists for this restaurant.");
        }
        // Fetch timeout from restaurant settings
        const [settings] = await tx
            .select({ weightRestaurantTimeoutMin: schema_1.restaurantSettings.weightRestaurantTimeoutMin })
            .from(schema_1.restaurantSettings)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId))
            .limit(1);
        // Fallback = column default (migration 0013): 10 minutes.
        const timeoutMin = settings?.weightRestaurantTimeoutMin ?? 10;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + timeoutMin * 60 * 1000);
        const requestId = (0, uuid_1.v4)();
        const [createdRequest] = await tx
            .insert(schema_1.weightRequests)
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
            .update(schema_1.cartItems)
            .set({
            weightRequestId: requestId,
            finalWeight: null,
            isUnavailable: false,
            updatedAt: now,
        })
            .where((0, drizzle_orm_1.inArray)(schema_1.cartItems.id, weightedCustomerRows.map((c) => c.id)));
        return {
            id: requestId,
            status: "awaiting_weighing",
            restaurantId,
            branchId: (userCart[0].branchId || null),
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
    return (0, response_1.SuccessResponse)(res, {
        message: "Order sent for weighing successfully",
        data,
    });
};
exports.sendWeightRequest = sendWeightRequest;
/**
 * 🟢 2. GET /weight-requests/:id
 * Fetches status, expiry, items with ordered vs final weight, addedBy, totals, weightChanged.
 */
const getWeightRequestById = async (req, res) => {
    const userId = req.user?.id;
    const { id } = req.params;
    const [request] = await connection_1.db
        .select()
        .from(schema_1.weightRequests)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.weightRequests.id, id), (0, drizzle_orm_1.eq)(schema_1.weightRequests.userId, userId)))
        .limit(1);
    if (!request) {
        throw new NotFound_1.NotFound("Weight request not found");
    }
    const items = await connection_1.db
        .select({
        cartItemId: schema_1.cartItems.id,
        foodId: schema_1.cartItems.foodId,
        name: schema_1.food.name,
        nameAr: schema_1.food.nameAr,
        image: schema_1.food.image,
        basePrice: schema_1.food.price,
        sold_by: schema_1.food.sold_by,
        foodWeightUnit: schema_1.food.weight_unit,
        allow_custom_weight: schema_1.food.allow_custom_weight,
        quantity: schema_1.cartItems.quantity,
        orderedWeight: schema_1.cartItems.weight,
        finalWeight: schema_1.cartItems.finalWeight,
        weightUnit: schema_1.cartItems.weightUnit,
        unitPrice: schema_1.cartItems.unitPrice,
        totalPrice: schema_1.cartItems.totalPrice,
        variations: schema_1.cartItems.variations,
        addons: schema_1.cartItems.addons,
        note: schema_1.cartItems.note,
        isUnavailable: schema_1.cartItems.isUnavailable,
        addedBy: schema_1.cartItems.addedBy,
        addedByAdminId: schema_1.cartItems.addedByAdminId,
        discountId: schema_1.food.discountId,
        discountType: schema_1.food.discount_type,
        discountValue: schema_1.food.discount_value,
    })
        .from(schema_1.cartItems)
        .leftJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.cartItems.foodId, schema_1.food.id))
        .where((0, drizzle_orm_1.eq)(schema_1.cartItems.weightRequestId, id));
    // Same price snapshot + product discount + line formula as getCart (shared service).
    const priced = await (0, weightRequestPricing_service_1.priceWeightRequestRows)(items.map((item) => ({
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
    })), request.restaurantId);
    const formattedItems = items.map((item, index) => {
        const isWeighted = item.sold_by === "weight" || item.orderedWeight != null;
        const line = priced.lines[index];
        const orderedW = item.orderedWeight ? Number(item.orderedWeight) : null;
        const finalW = item.finalWeight ? Number(item.finalWeight) : null;
        const weightChanged = finalW != null && orderedW != null && Math.abs(finalW - orderedW) > 0.0001;
        const snap = (0, weightCart_helper_1.snapshotPricing)(item, isWeighted);
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
    return (0, response_1.SuccessResponse)(res, {
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
exports.getWeightRequestById = getWeightRequestById;
/**
 * 🟢 3. POST /weight-requests/:id/cancel
 * Cancels the request, unlocks and resets customer cart items, and deletes items added by restaurant.
 */
const cancelWeightRequest = async (req, res) => {
    const userId = req.user?.id;
    const { id } = req.params;
    const { reason } = req.body;
    const now = new Date();
    const cancelled = await connection_1.db.transaction(async (tx) => {
        const [request] = await tx
            .select()
            .from(schema_1.weightRequests)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.weightRequests.id, id), (0, drizzle_orm_1.eq)(schema_1.weightRequests.userId, userId)))
            .for("update");
        if (!request) {
            throw new NotFound_1.NotFound("Weight request not found");
        }
        if (!["awaiting_weighing", "awaiting_customer_approval"].includes(request.status)) {
            throw new BadRequest_1.BadRequest(`Cannot cancel request with status: ${request.status}`);
        }
        // Update request status
        await tx
            .update(schema_1.weightRequests)
            .set({
            status: "cancelled",
            cancelReason: reason || "Cancelled by customer",
            updatedAt: now,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.weightRequests.id, id));
        // 1. Delete items added by restaurant
        await tx
            .delete(schema_1.cartItems)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.weightRequestId, id), (0, drizzle_orm_1.eq)(schema_1.cartItems.addedBy, "restaurant")));
        // 2. Unlock and reset customer's own items
        await tx
            .update(schema_1.cartItems)
            .set({
            weightRequestId: null,
            finalWeight: null,
            isUnavailable: false,
            updatedAt: now,
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.weightRequestId, id), (0, drizzle_orm_1.eq)(schema_1.cartItems.addedBy, "customer")));
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
    return (0, response_1.SuccessResponse)(res, {
        message: "Weight request cancelled successfully",
        data: { id, status: "cancelled" },
    });
};
exports.cancelWeightRequest = cancelWeightRequest;
