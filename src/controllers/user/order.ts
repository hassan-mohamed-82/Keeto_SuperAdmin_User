// controllers/user/OrderController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    restaurantZoneDeliveryFees,
    restaurantSettings,
    addresses,
    branches,
    userWallets,
    userWalletTransactions,
    paymentMethods,
    coupons,
    discounts,
    selectReasons,
    orders,
    restaurants,
    orderItems,
    restaurantBusinessPlans,
    food,
    variationOptions,
    addons,
    zones,
    deliveryMen,
    freeDeliveryOffers,
    foodVariations,
    shippingCompanies,
    shippingZones,
    shippingCompanyRestaurants,
} from "../../models/schema";
import { releaseCourierForOrder } from "../../services/shipping/dispatchEngine";
import { eq, and, inArray, sql, desc, ne } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";
import { UnauthorizedError } from "../../Errors";
import { sendPushNotification } from "../../utils/notifications";
import { calculateDistance, isLocationInZone } from "../../utils/geo";
import { validateUserPhone } from "../../utils/userPhoneCheck";
import { type ServiceModule } from "../../helpers/pricing.helper";
import { activeFoodCondition } from "../../helpers/foodConditions";
import { handleCancelledOrder, mapOrderSourceToPlatformType } from "../../services/restaurantWalletService";
import {
    roundMoney,
    buildGuestAddress,
    resolvePaymentMethod,
    checkCheckoutIdempotency,
    getAndValidateUserCart,
    validateRestaurantAndPlan,
    validateOperatingHoursAndChannel,
    resolveBranchForPricing,
    checkSubcategoryBranchAvailability,
    evaluateCartWeightGating,
    fetchCartLookupMaps,
    calculateCartPricingAndItems,
    resolveDiscounts,
    resolveDeliveryAndZones,
    preparePaymentSessionAndCommission,
    releaseWeightCheckoutClaim,
    executeOrderTransaction,
    notifyRestaurantAfterOrder,
    formatCheckoutResponsePayload,
} from "../../services/order";

// 🗓️ Helper to format date 
const formatDate = (date: Date | null | undefined): string | null => {
    if (!date) return null;
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Cairo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    }).format(new Date(date));
};

// Helper to format order items variations, supporting both snapshot-stored variations and old database lookup fallback
const formatOrderItemsVariations = async (items: any[]) => {
    const parsedItems = items.map(item => {
        let cleanVariations = item.variations;
        if (typeof cleanVariations === 'string') {
            try {
                cleanVariations = JSON.parse(cleanVariations);
                if (typeof cleanVariations === 'string') {
                    cleanVariations = JSON.parse(cleanVariations);
                }
            } catch (e) {
                cleanVariations = [];
            }
        }
        if (!Array.isArray(cleanVariations)) cleanVariations = [];
        return { item, cleanVariations };
    });

    // Collect option IDs that need fetching from DB (either missing names or missing weight metadata)
    const optionsToFetch = new Set<string>();
    for (const { cleanVariations } of parsedItems) {
        for (const v of cleanVariations) {
            const optId = v?.optionId || v?.id;
            const hasFullDetails = Boolean(v?.variationName && v?.optionName);
            if (optId && (!hasFullDetails || v?.priceMode === undefined || v?.isWeightGroup === undefined)) {
                optionsToFetch.add(optId);
            }
        }
    }

    const optionsMap = new Map<string, any>();
    if (optionsToFetch.size > 0) {
        const optionsWithParent = await db
            .select({
                optionId: variationOptions.id,
                optionName: variationOptions.optionName,
                optionNameAr: variationOptions.optionNameAr,
                optionNameFr: variationOptions.optionNameFr,
                additionalPrice: variationOptions.additionalPrice,
                priceMode: variationOptions.priceMode,
                weightValue: variationOptions.weightValue,
                variationId: foodVariations.id,
                variationName: foodVariations.name,
                variationNameAr: foodVariations.nameAr,
                variationNameFr: foodVariations.nameFr,
                isWeightGroup: foodVariations.isWeightGroup,
            })
            .from(variationOptions)
            .leftJoin(foodVariations, eq(variationOptions.variationId, foodVariations.id))
            .where(inArray(variationOptions.id, Array.from(optionsToFetch)));

        for (const opt of optionsWithParent) {
            optionsMap.set(opt.optionId, opt);
        }
    }

    return parsedItems.map(({ item, cleanVariations }) => {
        const variationDetails = cleanVariations.map((v: any) => {
            const optId = v?.optionId || v?.id;
            const optDetails = optId ? optionsMap.get(optId) : null;

            const variationName = v.variationName || optDetails?.variationName || null;
            const optionName = v.optionName || optDetails?.optionName || null;

            if (!variationName && !optionName && !optId) {
                return null;
            }

            const variationNameAr = v.variationNameAr || optDetails?.variationNameAr || null;
            const variationNameFr = v.variationNameFr || optDetails?.variationNameFr || '';
            const optionNameAr = v.optionNameAr || optDetails?.optionNameAr || null;
            const optionNameFr = v.optionNameFr || optDetails?.optionNameFr || '';
            const additionalPrice = v.price || v.additionalPrice || optDetails?.additionalPrice || '0';
            const priceMode = v.priceMode || optDetails?.priceMode || 'fixed';
            const weightValue = v.weightValue != null ? String(v.weightValue) : (optDetails?.weightValue != null ? String(optDetails.weightValue) : null);
            const isWeightGroup = Boolean(v.isWeightGroup ?? optDetails?.isWeightGroup ?? false);
            const variationId = v.variationId || optDetails?.variationId || null;

            return {
                optionId: optId || null,
                optionName,
                optionNameAr,
                optionNameFr,
                additionalPrice,
                priceMode,
                weightValue,
                variationId,
                variationName,
                variationNameAr,
                variationNameFr,
                isWeightGroup,
                ...(v.isAvailable !== undefined ? { isAvailable: v.isAvailable } : (!optDetails && optId && !v.variationName ? { isAvailable: false } : {})),
            };
        }).filter(Boolean);

        return {
            ...item,
            sold_by: item.sold_by ?? (item.orderedWeight || item.finalWeight ? "weight" : "unit"),
            isSoldByWeight: item.sold_by === "weight" || Boolean(item.orderedWeight || item.finalWeight),
            weightUnit: item.weightUnit || item.foodWeightUnit || null,
            allowCustomWeight: item.allowCustomWeight ?? true,
            weight: item.orderedWeight ? String(item.orderedWeight) : null,
            orderedWeight: item.orderedWeight ? String(item.orderedWeight) : null,
            finalWeight: item.finalWeight ? String(item.finalWeight) : null,
            variations: variationDetails,
        };
    });
};

// ==========================================
// 1. Create Order (Checkout)
// ==========================================
export const checkout = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const isGuestUser = Boolean(req.user.isGuest);
    const {
        orderSource,
        paymentMethod,
        orderType,
        idempotencyKey,
        zoneId,
        branchId,
        addressId: inputAddressId,
        note,
        couponCode,
        guestAddress,
        restaurantName,
    } = req.body;

    let addressId: string | null = inputAddressId || null;
    const userId: string = req.user.id;

    // 1. User Phone & Guest Validation
    const phoneValidation = await validateUserPhone(
        userId,
        isGuestUser,
        {
            ...req.body,
            name: req.user.name,
        },
        "Phone number or alternative phone number is required to complete checkout."
    );

    const user = phoneValidation.user;
    const guestName: string | null = isGuestUser ? (phoneValidation.guestName || "Guest") : null;
    const guestPhone: string | null = isGuestUser ? phoneValidation.phone : null;
    const guestAltPhone: string | null = isGuestUser ? phoneValidation.alternatePhone : null;
    const registeredPhone: string | null = !isGuestUser ? phoneValidation.phone : null;

    // 2. Guest Address (in-memory)
    let pendingGuestAddress: ReturnType<typeof buildGuestAddress> | null = null;
    if (isGuestUser && orderType === "delivery" && !addressId) {
        pendingGuestAddress = buildGuestAddress(guestAddress, userId);
        addressId = pendingGuestAddress.id;
    }

    // 3. Payment Method Validation
    const {
        isWalletPayment,
        isCashPayment,
        isVisaPayment,
    } = await resolvePaymentMethod(paymentMethod, isGuestUser);

    // 4. Idempotency Check
    const existingOrder = await checkCheckoutIdempotency(idempotencyKey, userId);
    if (existingOrder) {
        return SuccessResponse(res, { message: "Order already processed", data: existingOrder });
    }

    // 5. Get User Cart & Validate User Not Blocked
    const { userCart, restaurantId } = await getAndValidateUserCart(userId);

    // 6. Restaurant, Business Plan & Schedules
    const {
        restaurant,
        plan,
        schedulesList,
        settings,
        storedOrderSource,
    } = await validateRestaurantAndPlan(restaurantId, orderSource, restaurantName);

    // 7. Operating Hours & Channel Validation
    const {
        defaultPreparingDuration,
        resolvedOrderType,
    } = validateOperatingHoursAndChannel(settings, schedulesList, orderType, isCashPayment);

    // 8. Branch Resolution for Pricing
    const serviceModule = resolvedOrderType as ServiceModule;
    const pricingBranchId = await resolveBranchForPricing(
        resolvedOrderType,
        addressId,
        branchId,
        restaurantId,
        pendingGuestAddress,
        settings,
        userCart
    );

    // 9. Subcategory-branch Availability Guard
    const blockedFoodIds = await checkSubcategoryBranchAvailability(pricingBranchId, userCart);
    if (blockedFoodIds && blockedFoodIds.length > 0) {
        return res.status(422).json({
            success: false,
            message: "One or more items in your cart are not available at the selected branch or location.",
            data: {
                unavailableItems: blockedFoodIds.map((foodId) => ({ foodId })),
            },
        });
    }

    // 10. Weight-based Cart Gating
    const {
        activeWeightRequest,
        hasWeightedItems,
        checkoutCart,
        cartFoodSoldBy,
        assertWeightCartUnchanged,
    } = await evaluateCartWeightGating(userCart, userId, restaurantId);

    // 11. Fetch Cart Lookup Maps
    const {
        cartParsed,
        optionsWithParentMap,
        addonsMap,
        foodMap,
        checkoutOffersMap,
        checkoutOfferFoodsMap,
    } = await fetchCartLookupMaps(checkoutCart);

    // 12. Calculate Cart Pricing & Item Details
    const pricingResult = await calculateCartPricingAndItems({
        cartParsed,
        checkoutOffersMap,
        checkoutOfferFoodsMap,
        optionsWithParentMap,
        addonsMap,
        foodMap,
        pricingBranchId,
        serviceModule,
        hasWeightedItems,
        cartFoodSoldBy,
        restaurantId,
    });

    if ("error" in pricingResult && pricingResult.error) {
        return res.status(pricingResult.error.status).json({
            success: false,
            message: pricingResult.error.message,
            ...(pricingResult.error.data ? { data: pricingResult.error.data } : {}),
        });
    }

    const {
        subtotal,
        initialSubtotal,
        hasFoodLevelDiscount,
        resolvedOrderProducts,
        appliedDiscountIds,
        itemsToInsert,
    } = pricingResult;

    // 13. Fees & Commission
    const serviceFee = parseFloat((plan.serviceFee as string) || "0");
    const commissionRate = parseFloat((plan.commissionRate as string) || "0");
    const appCommission = roundMoney(subtotal * (commissionRate / 100));

    // 14. Discounts & Coupons
    const discountResult = await resolveDiscounts({
        subtotal,
        initialSubtotal,
        hasFoodLevelDiscount,
        resolvedOrderProducts,
        appliedDiscountIds,
        isGuestUser,
        userId,
        restaurantId,
        couponCode,
        itemsToInsert,
    });

    const {
        totalDiscount,
        appliedCoupon,
        isFreeDelivery: couponFreeDelivery,
        orderDiscountId,
        orderCouponId,
        orderFirstOrderDiscountId,
        orderDiscountType,
        orderDiscountValue,
        orderDiscountSource,
        firstOrderDiscountAmount,
    } = discountResult;

    // 15. Delivery & Zone Resolution
    const deliveryResult = await resolveDeliveryAndZones({
        resolvedOrderType,
        addressId,
        pendingGuestAddress,
        userId,
        restaurantId,
        branchId,
        zoneId,
        settings,
        guestPhone,
        registeredPhone,
        isGuestUser,
        subtotal,
        initialIsFreeDelivery: couponFreeDelivery,
    });

    const {
        deliveryFee,
        calculatedDeliveryFee,
        resolvedZoneId,
        resolvedBranchId,
        shippingAddressSnapshot,
        targetShippingCompanyId,
        branchSnapshotData,
        isFreeDelivery,
    } = deliveryResult;

    let totalAmount = roundMoney(subtotal + deliveryFee + serviceFee - totalDiscount);
    if (totalAmount < 0) totalAmount = 0;

    const orderId = uuidv4();
    const orderNumber = `ORD-${Date.now()}`;

    const userInfo = isGuestUser
        ? { ...user, name: guestName, phone: guestPhone }
        : { ...user, phone: registeredPhone || user.phone };

    // 16. Prepare Payment Session & Visa Commission (Pre-Transaction)
    const paymentPrep = await preparePaymentSessionAndCommission({
        isVisaPayment,
        isWalletPayment,
        hasWeightedItems,
        activeWeightRequest,
        assertWeightCartUnchanged,
        settings,
        orderId,
        orderNumber,
        restaurantId,
        totalAmount,
        restaurant,
        restaurantName,
        userInfo,
    });

    const {
        weightClaimRequestId,
        paymentSessionData,
        finalPaymentGatewayType,
        visaCommission,
    } = paymentPrep;

    const now = new Date();
    let orderCommitted = false;
    let createdDailyOrderNumber = 1;

    // 17. Execute Order DB Transaction
    try {
        const txResult = await executeOrderTransaction({
            now,
            hasWeightedItems,
            activeWeightRequest,
            weightClaimRequestId,
            assertWeightCartUnchanged,
            isGuestUser,
            guestName,
            guestPhone,
            guestAltPhone,
            pendingGuestAddress,
            isWalletPayment,
            isCashPayment,
            isVisaPayment,
            userId,
            totalAmount,
            orderNumber,
            restaurantId,
            settings,
            orderId,
            idempotencyKey,
            resolvedBranchId,
            resolvedZoneId,
            addressId,
            storedOrderSource,
            paymentMethod,
            finalPaymentGatewayType,
            paymentSessionData,
            resolvedOrderType,
            subtotal,
            deliveryFee,
            serviceFee,
            appCommission,
            visaCommission,
            shippingAddressSnapshot,
            branchSnapshotData,
            orderDiscountId,
            orderCouponId,
            orderFirstOrderDiscountId,
            totalDiscount,
            orderDiscountType,
            orderDiscountValue,
            orderDiscountSource,
            couponCode,
            note,
            targetShippingCompanyId,
            defaultPreparingDuration,
            userCart,
            itemsToInsert,
            restaurant,
            appliedCoupon,
            calculatedDeliveryFee,
            firstOrderDiscountAmount,
            appliedDiscountIds,
        });
        createdDailyOrderNumber = txResult.createdDailyOrderNumber;
        orderCommitted = true;
    } finally {
        if (weightClaimRequestId && !orderCommitted) {
            await releaseWeightCheckoutClaim(weightClaimRequestId);
        }
    }

    // 18. Send Push Notification to Restaurant
    await notifyRestaurantAfterOrder({
        isVisaPayment,
        restaurantId,
        resolvedBranchId,
        createdDailyOrderNumber,
        totalAmount,
        orderId,
        orderNumber,
        now,
    });

    // 19. Response
    const responsePayload = formatCheckoutResponsePayload({
        orderId,
        orderNumber,
        paymentSessionData,
        resolvedZoneId,
        subtotal,
        deliveryFee,
        serviceFee,
        totalDiscount,
        couponCode,
        totalAmount,
        now,
        createdDailyOrderNumber,
        defaultPreparingDuration,
        orderDiscountId,
        orderCouponId,
        orderFirstOrderDiscountId,
        orderDiscountType,
        orderDiscountValue,
        orderDiscountSource,
        isFreeDelivery,
        userInfo,
    });

    return SuccessResponse(res, responsePayload);
};

// ==========================================
// 2. Get Active Orders
// ==========================================
export const getActiveOrders = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { restaurantId } = req.query;

    const activeOrders = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            dailyOrderNumber: orders.dailyOrderNumber,
            orderType: orders.orderType,
            durationOrderPreparing: orders.durationOrderPreparing,
            restaurantName: restaurants.name,
            restaurantNameAr: restaurants.nameAr,
            restaurantNameFr: restaurants.nameFr,
            restaurantImage: restaurants.logo,
            totalAmount: orders.totalAmount,
            status: orders.status,
            createdAt: orders.createdAt,
            itemsCount: sql<number>`(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${orders.id})`,
            // Branch info (for takeaway / dine_in)
            branchName: branches.name,
            // Address info (for delivery)
            addressTitle: addresses.title,
            addressStreet: addresses.street,
            addressLandmark: addresses.landmark,
            // Delivery man info
            deliveryManId: orders.deliveryManId,
            deliveryManName: deliveryMen.name,
            deliveryManPhone: deliveryMen.phone,
            // Cancellation info
            cancelReason: orders.cancelReason,
            cancelReasonType: orders.cancelReasonType ? orders.cancelReasonType : selectReasons.type,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(addresses, eq(orders.addressId, addresses.id))
        .leftJoin(deliveryMen, eq(orders.deliveryManId, deliveryMen.id))
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .where(
            and(
                eq(orders.userId, userId),
                restaurantId ? eq(orders.restaurantId, String(restaurantId)) : undefined,
                ne(orders.paymentStatus, "pending_payment"),
                ne(orders.status, "failed"),
                inArray(orders.status, ["pending", "accepted", "preparing", "out_for_delivery"])
            )
        )
        .orderBy(desc(orders.createdAt));

    // Fetch items for the active orders
    const orderIds = activeOrders.map(o => o.orderId);
    let allItems: any[] = [];
    if (orderIds.length > 0) {
        allItems = await db.select({
            orderId: orderItems.orderId,
            foodId: orderItems.foodId,
            foodName: food.name,
            foodNameAr: food.nameAr,
            foodNameFr: food.nameFr,
            foodDescription: food.description,
            foodDescriptionAr: food.descriptionAr,
            foodDescriptionFr: food.descriptionFr,
            foodImage: food.image,
            quantity: orderItems.quantity,
            basePrice: orderItems.basePrice,
            variationsPrice: orderItems.variationsPrice,
            addonsPrice: orderItems.addonsPrice,
            totalPrice: orderItems.totalPrice,
            note: orderItems.note,
            variations: orderItems.variations,
            addons: orderItems.addons,
            sold_by: food.sold_by,
            foodWeightUnit: food.weight_unit,
            allowCustomWeight: food.allow_custom_weight,
            orderedWeight: orderItems.orderedWeight,
            finalWeight: orderItems.finalWeight,
            weightUnit: orderItems.weightUnit,
        })
            .from(orderItems)
            .leftJoin(food, and(eq(orderItems.foodId, food.id), activeFoodCondition))
            .where(inArray(orderItems.orderId, orderIds));

        allItems = await formatOrderItemsVariations(allItems);
    }

    // Return branch name or address depending on orderType
    const formatted = activeOrders.map(o => ({
        orderId: o.orderId,
        orderNumber: o.orderNumber,
        dailyOrderNumber: o.dailyOrderNumber,
        orderType: o.orderType,
        durationOrderPreparing: o.durationOrderPreparing,
        restaurantName: o.restaurantName,
        restaurantNameAr: o.restaurantNameAr,
        restaurantNameFr: o.restaurantNameFr,
        restaurantImage: o.restaurantImage,
        totalAmount: o.totalAmount,
        status: o.status,
        createdAt: formatDate(o.createdAt),
        itemsCount: o.itemsCount,
        cancellation: o.status === "cancelled"
            ? { reason: o.cancelReason, type: o.cancelReasonType }
            : null,
        location: o.orderType === "delivery"
            ? { type: "address", title: o.addressTitle, street: o.addressStreet, landmark: o.addressLandmark }
            : { type: "branch", name: o.branchName },
        deliveryMan: o.orderType === "delivery" && o.deliveryManId
            ? { id: o.deliveryManId, name: o.deliveryManName, phone: o.deliveryManPhone }
            : null,
        items: allItems.filter(item => item.orderId === o.orderId).map(item => {
            const { orderId, ...rest } = item;
            return rest;
        })
    }));

    return SuccessResponse(res, { data: formatted });
};

// ==========================================
// 3. Get History Orders
// ==========================================
export const getOrderHistory = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { restaurantId } = req.query;

    const historyOrders = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            dailyOrderNumber: orders.dailyOrderNumber,
            orderType: orders.orderType,
            durationOrderPreparing: orders.durationOrderPreparing,
            restaurantName: restaurants.name,
            restaurantNameAr: restaurants.nameAr,
            restaurantNameFr: restaurants.nameFr,
            restaurantImage: restaurants.logo,
            totalAmount: orders.totalAmount,
            status: orders.status,
            createdAt: orders.createdAt,
            rating: orders.rating,
            ratingComment: orders.ratingComment,
            itemsCount: sql<number>`(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${orders.id})`,
            // Branch info (for takeaway / dine_in)
            branchName: branches.name,
            // Address info (for delivery)
            addressTitle: addresses.title,
            addressStreet: addresses.street,
            addressLandmark: addresses.landmark,
            // Delivery man info
            deliveryManId: orders.deliveryManId,
            deliveryManName: deliveryMen.name,
            deliveryManPhone: deliveryMen.phone,
            // Cancellation info
            cancelReason: orders.cancelReason,
            cancelReasonType: orders.cancelReasonType ? orders.cancelReasonType : selectReasons.type,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(addresses, eq(orders.addressId, addresses.id))
        .leftJoin(deliveryMen, eq(orders.deliveryManId, deliveryMen.id))
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .where(
            and(
                eq(orders.userId, userId),
                restaurantId ? eq(orders.restaurantId, String(restaurantId)) : undefined,
                ne(orders.status, "failed"),
                inArray(orders.status, ["delivered", "cancelled", "refund"])
            )
        )
        .orderBy(desc(orders.createdAt));

    // Fetch items for the history orders
    const orderIds = historyOrders.map(o => o.orderId);
    let allItems: any[] = [];
    if (orderIds.length > 0) {
        allItems = await db.select({
            orderId: orderItems.orderId,
            foodId: orderItems.foodId,
            foodName: food.name,
            foodNameAr: food.nameAr,
            foodNameFr: food.nameFr,
            foodDescription: food.description,
            foodDescriptionAr: food.descriptionAr,
            foodDescriptionFr: food.descriptionFr,
            foodImage: food.image,
            quantity: orderItems.quantity,
            basePrice: orderItems.basePrice,
            variationsPrice: orderItems.variationsPrice,
            addonsPrice: orderItems.addonsPrice,
            totalPrice: orderItems.totalPrice,
            note: orderItems.note,
            variations: orderItems.variations,
            addons: orderItems.addons,
            sold_by: food.sold_by,
            foodWeightUnit: food.weight_unit,
            allowCustomWeight: food.allow_custom_weight,
            orderedWeight: orderItems.orderedWeight,
            finalWeight: orderItems.finalWeight,
            weightUnit: orderItems.weightUnit,
        })
            .from(orderItems)
            .leftJoin(food, and(eq(orderItems.foodId, food.id), activeFoodCondition))
            .where(inArray(orderItems.orderId, orderIds));

        allItems = await formatOrderItemsVariations(allItems);
    }

    // Return branch name or address depending on orderType
    const formatted = historyOrders.map(o => ({
        orderId: o.orderId,
        orderNumber: o.orderNumber,
        dailyOrderNumber: o.dailyOrderNumber,
        orderType: o.orderType,
        durationOrderPreparing: o.durationOrderPreparing,
        restaurantName: o.restaurantName,
        restaurantNameAr: o.restaurantNameAr,
        restaurantNameFr: o.restaurantNameFr,
        restaurantImage: o.restaurantImage,
        totalAmount: o.totalAmount,
        status: o.status,
        createdAt: formatDate(o.createdAt),
        rating: o.rating,
        ratingComment: o.ratingComment,
        itemsCount: o.itemsCount,
        cancellation: o.status === "cancelled"
            ? { reason: o.cancelReason, type: o.cancelReasonType }
            : null,
        location: o.orderType === "delivery"
            ? { type: "address", title: o.addressTitle, street: o.addressStreet, landmark: o.addressLandmark }
            : { type: "branch", name: o.branchName },
        deliveryMan: o.orderType === "delivery" && o.deliveryManId
            ? { id: o.deliveryManId, name: o.deliveryManName, phone: o.deliveryManPhone }
            : null,
        items: allItems.filter(item => item.orderId === o.orderId).map(item => {
            const { orderId, ...rest } = item;
            return rest;
        })
    }));

    return SuccessResponse(res, { data: formatted });
};

// ==========================================
// 4. Order Details
// ==========================================
export const getOrderDetails = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;

    // ── Main order query (no discount/coupon joins to avoid column name collisions) ──
    const orderInfo = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.orderNumber,
            dailyOrderNumber: orders.dailyOrderNumber,
            status: orders.status,
            createdAt: orders.createdAt,
            paymentMethod: orders.paymentMethod,
            paymentMethodDetails: {
                id: paymentMethods.id,
                name: paymentMethods.name,
                nameAr: paymentMethods.nameAr,
            },
            orderType: orders.orderType,
            durationOrderPreparing: orders.durationOrderPreparing,
            subtotal: orders.subtotal,
            deliveryFee: orders.deliveryFee,
            serviceFee: orders.serviceFee,
            discountAmount: orders.discountAmount,
            couponCode: orders.couponCode,
            totalAmount: orders.totalAmount,

            // Raw discount/coupon IDs — names fetched separately
            discountId: orders.discountId,
            discountType: orders.discountType,
            discountValue: orders.discountValue,
            discountSource: orders.discountSource,
            couponId: orders.couponId,

            note: orders.note,
            rating: orders.rating,
            ratingComment: orders.ratingComment,

            restaurantName: restaurants.name,
            restaurantNameAr: restaurants.nameAr,
            restaurantNameFr: restaurants.nameFr,
            restaurantImage: restaurants.logo,

            // Branch (takeaway / dine_in)
            branchId: branches.id,
            branchName: branches.name,
            branchAddress: branches.address,

            // Address (delivery)
            addressId: addresses.id,
            addressTitle: addresses.title,
            addressStreet: addresses.street,
            addressLandmark: addresses.landmark,

            // Delivery man info
            deliveryManId: orders.deliveryManId,
            deliveryManName: deliveryMen.name,
            deliveryManPhone: deliveryMen.phone,
            // Cancellation info
            cancelReason: orders.cancelReason,
            cancelReasonType: orders.cancelReasonType ? orders.cancelReasonType : selectReasons.type,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(paymentMethods, eq(orders.paymentMethod, paymentMethods.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(addresses, eq(orders.addressId, addresses.id))
        .leftJoin(deliveryMen, eq(orders.deliveryManId, deliveryMen.id))
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .where(
            and(
                eq(orders.id, orderId),
                eq(orders.userId, userId),
                ne(orders.status, "failed")
            )
        )
        .limit(1);

    if (!orderInfo.length) {
        throw new NotFound("Order not found");
    }

    const o = orderInfo[0];

    // ── Fetch discount & coupon names in separate queries (avoid JOIN name collisions) ──
    let discountRow: { name: string | null; nameAr: string | null; nameFr: string | null } | null = null;
    if (o.discountId) {
        const [d] = await db.select({ name: discounts.name, nameAr: discounts.nameAr, nameFr: discounts.nameFr })
            .from(discounts).where(eq(discounts.id, o.discountId)).limit(1);
        discountRow = d ?? null;
    }

    let couponRow: { code: string | null; name: string | null; nameAr: string | null; nameFr: string | null } | null = null;
    if (o.couponId) {
        const [c] = await db.select({ code: coupons.code, name: coupons.name, nameAr: coupons.nameAr, nameFr: coupons.nameFr })
            .from(coupons).where(eq(coupons.id, o.couponId)).limit(1);
        couponRow = c ?? null;
    }

    // 1. جلب عناصر الطلب الأساسية
    const itemsRaw = await db
        .select({
            foodId: orderItems.foodId,
            foodName: food.name,
            foodNameAr: food.nameAr,
            foodNameFr: food.nameFr,
            foodDescription: food.description,
            foodDescriptionAr: food.descriptionAr,
            foodDescriptionFr: food.descriptionFr,
            foodImage: food.image,
            quantity: orderItems.quantity,
            basePrice: orderItems.basePrice,
            variationsPrice: orderItems.variationsPrice,
            addonsPrice: orderItems.addonsPrice,
            totalPrice: orderItems.totalPrice,
            note: orderItems.note,
            variations: orderItems.variations,
            addons: orderItems.addons,
            sold_by: food.sold_by,
            foodWeightUnit: food.weight_unit,
            allowCustomWeight: food.allow_custom_weight,
            orderedWeight: orderItems.orderedWeight,
            finalWeight: orderItems.finalWeight,
            weightUnit: orderItems.weightUnit,
        })
        .from(orderItems)
        .leftJoin(food, and(eq(orderItems.foodId, food.id), activeFoodCondition))
        .where(eq(orderItems.orderId, orderId));

    // 2. معالجة الـ Variations واستخراج أسماء الفارييشنز وتفاصيلها كاملة
    const formattedItems = await formatOrderItemsVariations(itemsRaw);

    return SuccessResponse(res, {
        data: {
            orderId: o.orderId,
            orderNumber: o.orderNumber,
            dailyOrderNumber: o.dailyOrderNumber,
            status: o.status,
            orderType: o.orderType,
            durationOrderPreparing: o.durationOrderPreparing,
            createdAt: formatDate(o.createdAt),
            paymentMethod: o.paymentMethod,
            paymentMethodDetails: o.paymentMethodDetails,
            subtotal: o.subtotal,
            deliveryFee: o.deliveryFee,
            serviceFee: o.serviceFee,
            discountAmount: o.discountAmount,
            couponCode: o.couponCode,
            discount: {
                discountId: o.discountId ?? null,
                discountAmount: o.discountAmount ? String(o.discountAmount) : "0.00",
                discountType: o.discountType ?? null,
                discountValue: o.discountValue ? String(o.discountValue) : null,
                discountSource: o.discountSource ?? null,
                discountName: discountRow?.name ?? null,
                discountNameAr: discountRow?.nameAr ?? null,
                discountNameFr: discountRow?.nameFr ?? null,
                couponId: o.couponId ?? null,
                couponCode: o.couponCode ?? couponRow?.code ?? null,
                couponName: couponRow?.name ?? null,
                couponNameAr: couponRow?.nameAr ?? null,
                couponNameFr: couponRow?.nameFr ?? null,
            },
            totalAmount: o.totalAmount,
            note: o.note,
            rating: o.rating,
            ratingComment: o.ratingComment,
            cancellation: o.status === "cancelled"
                ? { reason: o.cancelReason, type: o.cancelReasonType }
                : null,
            restaurantName: o.restaurantName,
            restaurantNameAr: o.restaurantNameAr,
            restaurantNameFr: o.restaurantNameFr,
            restaurantImage: o.restaurantImage,
            location: o.orderType === "delivery"
                ? {
                    type: "address",
                    id: o.addressId,
                    title: o.addressTitle,
                    street: o.addressStreet,
                    landmark: o.addressLandmark,
                }
                : {
                    type: "branch",
                    id: o.branchId,
                    name: o.branchName,
                    address: o.branchAddress,
                },
            deliveryMan: o.orderType === "delivery" && o.deliveryManId
                ? { id: o.deliveryManId, name: o.deliveryManName, phone: o.deliveryManPhone }
                : null,
            items: formattedItems
        }
    });
};

// ==========================================
// 5. Order Prerequisites
// ==========================================
export const getOrderPrerequisites = async (req: Request | any, res: Response) => {
    if (!req.user) {
        throw new UnauthorizedError("Unauthenticated: Token is missing or invalid");
    }

    const userId = req.user.id;
    const restaurantId = req.query.restaurantId as string;
    const orderSource = req.query.orderSource as string;
    const addressId = (req.query.addressId || req.query.addressid) as string | undefined;

    if (!restaurantId) {
        throw new BadRequest("restaurantId is required");
    }

    const validOrderSources = ["online_order_app", "online_order_web", "food_aggregator", "mykeeto", "pos"];
    if (!orderSource || !validOrderSources.includes(orderSource)) {
        throw new BadRequest("Invalid or missing order source");
    }

    // 1. جلب البيانات من الداتا بيز بالتوازي
    const [
        userAddresses,
        restaurantBranches,
        restaurantZoneFees,
        allActivePaymentMethods,
        getCancelReasons,
        businessPlans,
        freeDeliveryOfferRows,
        restaurantSettingsRows
    ] = await Promise.all([
        db.select().from(addresses).where(eq(addresses.userId, userId)),
        db.select().from(branches).where(
            and(
                eq(branches.restaurantId, restaurantId),
                eq(branches.status, "active")
            )
        ),
        db.select({
            id: restaurantZoneDeliveryFees.id,
            zoneId: restaurantZoneDeliveryFees.zoneId,
            zoneName: zones.name,
            zoneNameAr: zones.nameAr,
            branchId: restaurantZoneDeliveryFees.branchId,
            branchStatus: branches.status,
            deliveryFee: restaurantZoneDeliveryFees.deliveryFee,
            coverageType: restaurantZoneDeliveryFees.coverageType,
            customCoordinates: restaurantZoneDeliveryFees.customCoordinates,
            customRadiusKm: restaurantZoneDeliveryFees.customRadiusKm,
            defaultCoordinates: zones.coordinates,
            defaultRadiusKm: zones.coverageAreaRadiusKm,
        })
            .from(restaurantZoneDeliveryFees)
            .leftJoin(zones, eq(restaurantZoneDeliveryFees.zoneId, zones.id))
            .leftJoin(branches, eq(restaurantZoneDeliveryFees.branchId, branches.id))
            .where(
                and(
                    eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
                    eq(restaurantZoneDeliveryFees.status, "active")
                )
            ),
        db.select({
            id: paymentMethods.id,
            name: paymentMethods.name,
            nameAr: paymentMethods.nameAr
        }).from(paymentMethods).where(eq(paymentMethods.isActive, true)),
        db.select().from(selectReasons).where(eq(selectReasons.type, "user")),
        db.select({ serviceFee: restaurantBusinessPlans.serviceFee })
            .from(restaurantBusinessPlans)
            .where(
                and(
                    eq(restaurantBusinessPlans.restaurantId, restaurantId),
                    eq(restaurantBusinessPlans.platformType, mapOrderSourceToPlatformType(orderSource))
                )
            )
            .limit(1),
        db.select()
            .from(freeDeliveryOffers)
            .where(
                and(
                    eq(freeDeliveryOffers.restaurantId, restaurantId),
                    eq(freeDeliveryOffers.status, "active")
                )
            )
            .limit(1),
        // 🛡️ جلب إعدادات المطعم لمعرفة هل الدفع الإلكتروني و الكاش مفعلين أم لا ومعرفة شركة الشحن المرتبطة
        db.select({
            enableOnlinePayment: restaurantSettings.enableOnlinePayment,
            cashEnabled: restaurantSettings.cashEnabled,
            shippingCompanyId: restaurantSettings.shippingCompanyId,
            shippingCompanyName: shippingCompanies.name,
            shippingCompanyStatus: shippingCompanies.status,
        })
            .from(restaurantSettings)
            .leftJoin(shippingCompanies, eq(restaurantSettings.shippingCompanyId, shippingCompanies.id))
            .where(eq(restaurantSettings.restaurantId, restaurantId))
            .limit(1)
    ]);

    // 🛡️ تحقق من إعداد الدفع الإلكتروني والكاش للمطعم
    const enableOnlinePayment = restaurantSettingsRows[0]?.enableOnlinePayment ?? true;
    const cashEnabled = restaurantSettingsRows[0]?.cashEnabled ?? true;

    // إذا كان الدفع الإلكتروني معطلاً للمطعم، نحذف طريقة الدفع بالفيزا من القائمة
    // إذا كان الكاش معطلاً للمطعم، نحذف طريقة الكاش من القائمة
    const activePaymentMethods = allActivePaymentMethods.filter((pm) => {
        const name = pm.name?.toLowerCase() ?? "";
        const nameAr = pm.nameAr ?? "";

        // Remove Visa/card if online payment is disabled
        if (!enableOnlinePayment && (name === "visa" || name === "card" || nameAr === "بطاقة")) {
            return false;
        }

        // Remove cash if cash is disabled
        if (!cashEnabled && (name === "cash" || name === "cash_on_delivery" || nameAr === "الدفع عند الاستلام")) {
            return false;
        }

        return true;
    });

    const plan = businessPlans[0];
    if (!plan) {
        throw new BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }

    let targetShippingCompanyId = restaurantSettingsRows[0]?.shippingCompanyId || null;
    let shippingCompanyName = restaurantSettingsRows[0]?.shippingCompanyName || null;
    let isCompanyActive = restaurantSettingsRows[0]?.shippingCompanyStatus === "active";

    // إذا لم تكن شركة الشحن مسجلة في الإعدادات، نتحقق من جدول الربط shippingCompanyRestaurants كخيار بديل
    if (!targetShippingCompanyId) {
        const [junctionLink] = await db
            .select({
                shippingCompanyId: shippingCompanyRestaurants.shippingCompanyId,
                shippingCompanyName: shippingCompanies.name,
                shippingCompanyStatus: shippingCompanies.status,
            })
            .from(shippingCompanyRestaurants)
            .innerJoin(shippingCompanies, eq(shippingCompanyRestaurants.shippingCompanyId, shippingCompanies.id))
            .where(
                and(
                    eq(shippingCompanyRestaurants.restaurantId, restaurantId),
                    eq(shippingCompanyRestaurants.status, "active"),
                    eq(shippingCompanies.status, "active")
                )
            )
            .limit(1);

        if (junctionLink) {
            targetShippingCompanyId = junctionLink.shippingCompanyId;
            shippingCompanyName = junctionLink.shippingCompanyName;
            isCompanyActive = true;
        }
    }

    // 🚚 إذا كان المطعم مرتبطاً بشركة شحن نشطة، نستخدم نطاقات شركة الشحن (shipping_zones) بدلاً من نطاقات المطعم
    let zoneFees: any[] = [];
    if (targetShippingCompanyId && isCompanyActive) {
        const companyZones = await db
            .select({
                id: shippingZones.id,
                name: shippingZones.name,
                nameAr: shippingZones.nameAr,
                coordinates: shippingZones.coordinates,
                coverageAreaRadiusKm: shippingZones.coverageAreaRadiusKm,
                deliveryFee: shippingZones.deliveryFee,
                minOrderAmount: shippingZones.minOrderAmount,
                status: shippingZones.status,
            })
            .from(shippingZones)
            .where(
                and(
                    eq(shippingZones.shippingCompanyId, targetShippingCompanyId),
                    eq(shippingZones.status, "active")
                )
            );

        if (companyZones.length > 0) {
            zoneFees = companyZones.map((sz) => {
                let coords = sz.coordinates as any;
                if (typeof coords === "string") {
                    try {
                        coords = JSON.parse(coords);
                    } catch {
                        coords = [];
                    }
                }
                const isPolygon = Array.isArray(coords) && coords.length >= 3;
                return {
                    id: sz.id,
                    zoneId: sz.id,
                    branchId: null,
                    branchStatus: "active",
                    deliveryFee: sz.deliveryFee,
                    coverageType: isPolygon ? "POLYGON" : "RADIUS",
                    customCoordinates: coords,
                    customRadiusKm: sz.coverageAreaRadiusKm,
                    defaultCoordinates: coords,
                    defaultRadiusKm: sz.coverageAreaRadiusKm,
                    name: sz.name,
                    nameAr: sz.nameAr,
                    minOrderAmount: sz.minOrderAmount,
                    shippingCompanyId: targetShippingCompanyId,
                    isShippingCompanyZone: true,
                };
            });
        } else {
            // Fallback لنطاقات المطعم في حال لم يتم إدخال نطاقات لشركة الشحن بعد
            zoneFees = restaurantZoneFees;
        }
    } else {
        zoneFees = restaurantZoneFees;
    }

    // 2. معالجة كل عنوان عند المستخدم ومعرفة هل هو قابل للتوصيل ومعرفة zoneId الخاص به
    const addressesWithDeliveryInfo = userAddresses.map((addr) => {
        let isDeliverable = false;
        let applicableDeliveryFee: number | null = null;
        let matchedZoneId: string | null = null;
        let matchedRestaurantDeliveryZoneId: string | null = null;

        const addrLat = parseFloat(addr.lat || "0");
        const addrLng = parseFloat(addr.lng || "0");

        if (!addrLat || !addrLng) {
            return {
                ...addr,
                isDeliverable: false,
                deliveryFee: null,
                restaurantDeliveryZoneId: null,
                zoneId: null,
            };
        }

        for (const fee of zoneFees) {
            let matchesZone = isLocationInZone(addrLat, addrLng, addr.zoneId, fee);

            // لو النطاق ده طابق موقع العميل
            if (matchesZone) {
                const isBranchActive = !fee.branchId || fee.branchStatus === "active";

                if (!isBranchActive) {
                    continue;
                }

                isDeliverable = true;
                const currentFee = parseFloat((fee.deliveryFee || "0") as string);

                // 🚀 اختيار السعر الأعلى والـ zoneId التابع له في حالة مطابقة أكثر من نطاق
                if (applicableDeliveryFee === null || currentFee > applicableDeliveryFee) {
                    applicableDeliveryFee = currentFee;
                    matchedZoneId = fee.zoneId;
                    matchedRestaurantDeliveryZoneId = fee.id;
                }
            }
        }

        return {
            ...addr,
            isDeliverable,
            deliveryFee: applicableDeliveryFee,
            zoneId: matchedRestaurantDeliveryZoneId,
        };
    });

    const serviceFee = parseFloat((plan.serviceFee || "0") as string);

    // Free delivery offer — check validity window
    const nowForPrereq = new Date();
    const activeFreeDeliveryOffer = freeDeliveryOfferRows[0] ?? null;
    let freeDeliveryOfferData: {
        minOrderAmount: number;
        startDate: string | null;
        endDate: string | null;
        branches: Array<{ id: string; name: string; nameAr: string | null; nameFr: string | null }>;
    } | null = null;

    if (activeFreeDeliveryOffer) {
        const startOk = !activeFreeDeliveryOffer.startDate || new Date(activeFreeDeliveryOffer.startDate) <= nowForPrereq;
        const endOk = !activeFreeDeliveryOffer.endDate || new Date(activeFreeDeliveryOffer.endDate) >= nowForPrereq;
        if (startOk && endOk) {
            let offerBranchIds: string[] = [];
            const rawBranchIds = activeFreeDeliveryOffer.branchIds;
            if (Array.isArray(rawBranchIds)) {
                offerBranchIds = rawBranchIds.map(String).filter(Boolean);
            } else if (typeof rawBranchIds === "string") {
                try {
                    const parsed = JSON.parse(rawBranchIds);
                    if (Array.isArray(parsed)) offerBranchIds = parsed.map(String).filter(Boolean);
                } catch {
                    offerBranchIds = [];
                }
            }

            const branchMap = new Map<string, { id: string; name: string; nameAr: string | null; nameFr: string | null }>();
            for (const b of restaurantBranches) {
                branchMap.set(b.id, {
                    id: b.id,
                    name: b.name,
                    nameAr: b.nameAr || null,
                    nameFr: b.nameFr || null,
                });
            }

            const missingBranchIds = offerBranchIds.filter(id => !branchMap.has(id));
            if (missingBranchIds.length > 0) {
                const extraBranches = await db
                    .select({
                        id: branches.id,
                        name: branches.name,
                        nameAr: branches.nameAr,
                        nameFr: branches.nameFr,
                    })
                    .from(branches)
                    .where(inArray(branches.id, missingBranchIds));
                for (const b of extraBranches) {
                    branchMap.set(b.id, {
                        id: b.id,
                        name: b.name,
                        nameAr: b.nameAr || null,
                        nameFr: b.nameFr || null,
                    });
                }
            }

            const allBranchObjects = offerBranchIds.length > 0
                ? offerBranchIds.map((id) => {
                    const b = branchMap.get(id);
                    return {
                        id,
                        name: b?.name || "Branch",
                        nameAr: b?.nameAr || null,
                        nameFr: b?.nameFr || null,
                    };
                })
                : restaurantBranches.map(b => ({
                    id: b.id,
                    name: b.name,
                    nameAr: b.nameAr || null,
                    nameFr: b.nameFr || null,
                }));

            // إذا تم إرسال addressId في الـ query، نحدد الفرع الذي يخدم هذا العنوان ونرجع العرض الخاص به فقط
            if (addressId) {
                let targetAddress = userAddresses.find(a => a.id === addressId);
                if (!targetAddress) {
                    const [fetchedAddr] = await db
                        .select()
                        .from(addresses)
                        .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
                        .limit(1);
                    if (fetchedAddr) {
                        targetAddress = fetchedAddr;
                    }
                }

                let matchedBranchId: string | null = null;
                if (targetAddress) {
                    const addrLat = parseFloat(targetAddress.lat || "0");
                    const addrLng = parseFloat(targetAddress.lng || "0");
                    let applicableFee: any = null;
                    let applicableDeliveryFee: number | null = null;

                    if (addrLat && addrLng) {
                        for (const fee of zoneFees) {
                            const matchesZone = isLocationInZone(addrLat, addrLng, targetAddress.zoneId, fee);
                            if (matchesZone) {
                                const isBranchActive = !fee.branchId || fee.branchStatus === "active";
                                if (!isBranchActive) continue;

                                const currentFee = parseFloat((fee.deliveryFee || "0") as string);
                                if (applicableDeliveryFee === null || currentFee > applicableDeliveryFee) {
                                    applicableDeliveryFee = currentFee;
                                    applicableFee = fee;
                                }
                            }
                        }
                    }

                    if (applicableFee?.branchId) {
                        matchedBranchId = applicableFee.branchId;
                    } else if (applicableFee?.zoneId) {
                        const branchInZone = restaurantBranches.find(b => b.zoneId === applicableFee.zoneId);
                        if (branchInZone) {
                            matchedBranchId = branchInZone.id;
                        }
                    }

                    if (!matchedBranchId && addrLat && addrLng && restaurantBranches.length > 0) {
                        let minDistance = Infinity;
                        let closestBranch = restaurantBranches[0];
                        for (const b of restaurantBranches) {
                            const bLat = parseFloat(b.lat as string || "0");
                            const bLng = parseFloat(b.lng as string || "0");
                            if (bLat && bLng) {
                                const dist = calculateDistance(addrLat, addrLng, bLat, bLng);
                                if (dist < minDistance) {
                                    minDistance = dist;
                                    closestBranch = b;
                                }
                            }
                        }
                        matchedBranchId = closestBranch?.id || null;
                    } else if (!matchedBranchId && restaurantBranches.length > 0) {
                        matchedBranchId = restaurantBranches[0]?.id || null;
                    }
                }

                if (matchedBranchId) {
                    const isBranchIncluded = offerBranchIds.length === 0 || offerBranchIds.includes(matchedBranchId);
                    if (isBranchIncluded) {
                        const b = branchMap.get(matchedBranchId);
                        const singleBranchObject = b ? {
                            id: b.id,
                            name: b.name || "Branch",
                            nameAr: b.nameAr || null,
                            nameFr: b.nameFr || null,
                        } : {
                            id: matchedBranchId,
                            name: "Branch",
                            nameAr: null,
                            nameFr: null,
                        };

                        freeDeliveryOfferData = {
                            minOrderAmount: parseFloat(activeFreeDeliveryOffer.minOrderAmount as string || "0"),
                            startDate: activeFreeDeliveryOffer.startDate ? activeFreeDeliveryOffer.startDate.toISOString() : null,
                            endDate: activeFreeDeliveryOffer.endDate ? activeFreeDeliveryOffer.endDate.toISOString() : null,
                            branches: [singleBranchObject],
                        };
                    } else {
                        // الفرع غير مشمول في عرض التوصيل المجاني
                        freeDeliveryOfferData = null;
                    }
                } else {
                    freeDeliveryOfferData = null;
                }
            } else {
                // في حال عدم إرسال addressId، نرجع كل الفروع كما هي
                freeDeliveryOfferData = {
                    minOrderAmount: parseFloat(activeFreeDeliveryOffer.minOrderAmount as string || "0"),
                    startDate: activeFreeDeliveryOffer.startDate ? activeFreeDeliveryOffer.startDate.toISOString() : null,
                    endDate: activeFreeDeliveryOffer.endDate ? activeFreeDeliveryOffer.endDate.toISOString() : null,
                    branches: allBranchObjects,
                };
            }
        }
    }

    return SuccessResponse(res, {
        data: {
            addresses: addressesWithDeliveryInfo,
            branches: restaurantBranches,
            zones: zoneFees, // 👈 إرجاع مناطق التوصيل وأسعارها الخاصة بشركة الشحن أو المطعم
            paymentMethods: activePaymentMethods, // visa filtered out when enableOnlinePayment=false
            enableOnlinePayment, // 👈 هل الدفع الإلكتروني (فيزا) مفعّل لهذا المطعم؟
            reasons: getCancelReasons,
            serviceFee: serviceFee.toFixed(2),
            freeDeliveryOffer: freeDeliveryOfferData,
            shippingCompany: (targetShippingCompanyId && isCompanyActive) ? {
                id: targetShippingCompanyId,
                name: shippingCompanyName,
            } : null,
        }
    });
};

// ==========================================
// 6. Cancel Order
// ==========================================
export const cancelOrder = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;
    const { cancelReasonId, customReason } = req.body;

    const inputCustomReason = customReason as string | undefined;

    if (!cancelReasonId && (!inputCustomReason || typeof inputCustomReason !== "string" || inputCustomReason.trim() === "")) {
        throw new BadRequest("Cancel reason or cancel reason ID is required");
    }

    // 1. جلب الطلب والتأكد أنه للمستخدم وأنه قابل للإلغاء
    const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).limit(1);
    if (!order) throw new NotFound("Order not found");
    if (!["pending", "accepted"].includes(order.status as string)) {
        throw new BadRequest("Order cannot be cancelled at this stage");
    }

    // 2. التحقق من سبب الإلغاء
    let finalReasonId: string | null = null;
    let finalReasonText: string | null = null;

    if (cancelReasonId) {
        const [reason] = await db.select().from(selectReasons).where(and(eq(selectReasons.id, cancelReasonId), eq(selectReasons.type, "user"))).limit(1);
        if (!reason) throw new BadRequest("Invalid cancel reason for user");
        finalReasonId = reason.id;
        finalReasonText = (inputCustomReason && inputCustomReason.trim()) ? inputCustomReason.trim() : reason.name;
    } else {
        finalReasonId = null;
        finalReasonText = (inputCustomReason as string).trim();
    }

    // 3. تحديث حالة الطلب وإرجاع المبالغ المالية (إلغاء أرباح المطعم والعمولة)
    await db.transaction(async (tx) => {
        // تحديث الطلب
        await tx.update(orders)
            .set({
                status: "cancelled",
                cancelledAt: new Date(),
                cancelReasonId: finalReasonId,
                cancelReason: finalReasonText,
                cancelReasonType: "user",
                updatedAt: new Date()
            })
            .where(eq(orders.id, orderId));

        // حسابات المبالغ التي تم دفعها أو خصمها
        const totalAmount = parseFloat(order.totalAmount as string || "0");
        // إرجاع فلوس المستخدم لو دفع بالمحفظة
        // note: paymentMethod stores UUID, so we check userWalletTransactions to know if it was a wallet payment
        const [walletTx] = await tx.select().from(userWalletTransactions).where(and(eq(userWalletTransactions.reference, order.orderNumber), eq(userWalletTransactions.transactionType, "order_payment"))).limit(1);

        if (walletTx) {
            // Revert User Wallet
            const [userWallet] = await tx.select().from(userWallets).where(eq(userWallets.userId, userId)).limit(1);
            if (userWallet) {
                const balanceBefore = parseFloat(userWallet.balance as string || "0");
                const newBalance = balanceBefore + totalAmount;
                await tx.update(userWallets).set({ balance: newBalance.toString() }).where(eq(userWallets.userId, userId));
                await tx.insert(userWalletTransactions).values({
                    id: uuidv4(),
                    userId,
                    type: "credit",
                    transactionType: "refund",
                    amount: totalAmount.toString(),
                    balanceBefore: balanceBefore.toString(),
                    reference: order.orderNumber,
                    status: "approved"
                });
            }
        }

        await handleCancelledOrder({ orderId, cancelReasonType: "user", tx });
    });

    // 4. إرسال إشعارات إلغاء الطلب (Type: cancel)
    await sendPushNotification({
        recipientType: "restaurant",
        recipientId: order.restaurantId,
        branchId: order.branchId || null,
        title: "إلغاء الطلب ❌",
        body: `تم إلغاء الطلب #${order.dailyOrderNumber} من قبل العميل. السبب: ${finalReasonText}`,
        data: {
            restaurantId: order.restaurantId,
            orderId: order.id,
            orderNumber: order.orderNumber,
            dailyOrderNumber: order.dailyOrderNumber,
            branchId: order.branchId || null,
            type: "cancel",
            reason: finalReasonText
        }
    });

    // Release courier active orders count if order had courier assigned
    if (order.deliveryManId) {
        releaseCourierForOrder(order.id, order.deliveryManId).catch((err) => {
            console.error(`[releaseCourierForOrder:userCancel] failed for order ${order.id}:`, err);
        });
    }

    return SuccessResponse(res, { message: "Order cancelled successfully" });
};

// ==========================================
// 7. Get Cancel Reasons
// ==========================================
export const getCancelReasons = async (req: Request | any, res: Response) => {
    const cancelReasons = await db
        .select()
        .from(selectReasons)
        .where(eq(selectReasons.type, "user"));
    return SuccessResponse(res, { data: cancelReasons });
};

// ==========================================
// 8. Rate Order (User)
// ==========================================
export const rateOrder = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;
    const { rating, comment } = req.body;

    if (!rating) {
        throw new BadRequest("Rating is required");
    }

    if (typeof rating !== "number" || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        throw new BadRequest("Rating must be an integer between 1 and 5");
    }

    const [order] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
        .limit(1);

    if (!order) {
        throw new NotFound("Order not found");
    }

    if (order.status !== "delivered") {
        throw new BadRequest("Only delivered orders can be rated");
    }

    await db
        .update(orders)
        .set({
            rating,
            ratingComment: comment ?? null,
            updatedAt: new Date()
        })
        .where(eq(orders.id, orderId));

    return SuccessResponse(res, {
        message: "Order rated successfully",
        data: {
            orderId,
            rating,
            ratingComment: comment ?? null,
        }
    });
};

