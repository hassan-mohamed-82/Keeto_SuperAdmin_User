"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateOrder = exports.getCancelReasons = exports.cancelOrder = exports.getOrderPrerequisites = exports.getOrderDetails = exports.getOrderHistory = exports.getActiveOrders = exports.checkout = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const dispatchEngine_1 = require("../../services/shipping/dispatchEngine");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const uuid_1 = require("uuid");
const Errors_1 = require("../../Errors");
const notifications_1 = require("../../utils/notifications");
const geo_1 = require("../../utils/geo");
const userPhoneCheck_1 = require("../../utils/userPhoneCheck");
const foodConditions_1 = require("../../helpers/foodConditions");
const restaurantWalletService_1 = require("../../services/restaurantWalletService");
const order_1 = require("../../services/order");
// 🗓️ Helper to format date 
const formatDate = (date) => {
    if (!date)
        return null;
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
const formatOrderItemsVariations = async (items) => {
    const parsedItems = items.map(item => {
        let cleanVariations = item.variations;
        if (typeof cleanVariations === 'string') {
            try {
                cleanVariations = JSON.parse(cleanVariations);
                if (typeof cleanVariations === 'string') {
                    cleanVariations = JSON.parse(cleanVariations);
                }
            }
            catch (e) {
                cleanVariations = [];
            }
        }
        if (!Array.isArray(cleanVariations))
            cleanVariations = [];
        return { item, cleanVariations };
    });
    // Collect option IDs that need fetching from DB (either missing names or missing weight metadata)
    const optionsToFetch = new Set();
    for (const { cleanVariations } of parsedItems) {
        for (const v of cleanVariations) {
            const optId = v?.optionId || v?.id;
            const hasFullDetails = Boolean(v?.variationName && v?.optionName);
            if (optId && (!hasFullDetails || v?.priceMode === undefined || v?.isWeightGroup === undefined)) {
                optionsToFetch.add(optId);
            }
        }
    }
    const optionsMap = new Map();
    if (optionsToFetch.size > 0) {
        const optionsWithParent = await connection_1.db
            .select({
            optionId: schema_1.variationOptions.id,
            optionName: schema_1.variationOptions.optionName,
            optionNameAr: schema_1.variationOptions.optionNameAr,
            optionNameFr: schema_1.variationOptions.optionNameFr,
            additionalPrice: schema_1.variationOptions.additionalPrice,
            priceMode: schema_1.variationOptions.priceMode,
            weightValue: schema_1.variationOptions.weightValue,
            variationId: schema_1.foodVariations.id,
            variationName: schema_1.foodVariations.name,
            variationNameAr: schema_1.foodVariations.nameAr,
            variationNameFr: schema_1.foodVariations.nameFr,
            isWeightGroup: schema_1.foodVariations.isWeightGroup,
        })
            .from(schema_1.variationOptions)
            .leftJoin(schema_1.foodVariations, (0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, schema_1.foodVariations.id))
            .where((0, drizzle_orm_1.inArray)(schema_1.variationOptions.id, Array.from(optionsToFetch)));
        for (const opt of optionsWithParent) {
            optionsMap.set(opt.optionId, opt);
        }
    }
    return parsedItems.map(({ item, cleanVariations }) => {
        const variationDetails = cleanVariations.map((v) => {
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
const checkout = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const isGuestUser = Boolean(req.user.isGuest);
    const { orderSource, paymentMethod, orderType, idempotencyKey, zoneId, branchId, addressId: inputAddressId, note, couponCode, guestAddress, restaurantName, } = req.body;
    let addressId = inputAddressId || null;
    const userId = req.user.id;
    // 1. User Phone & Guest Validation
    const phoneValidation = await (0, userPhoneCheck_1.validateUserPhone)(userId, isGuestUser, {
        ...req.body,
        name: req.user.name,
    }, "Phone number or alternative phone number is required to complete checkout.");
    const user = phoneValidation.user;
    const guestName = isGuestUser ? (phoneValidation.guestName || "Guest") : null;
    const guestPhone = isGuestUser ? phoneValidation.phone : null;
    const guestAltPhone = isGuestUser ? phoneValidation.alternatePhone : null;
    const registeredPhone = !isGuestUser ? phoneValidation.phone : null;
    // 2. Guest Address (in-memory)
    let pendingGuestAddress = null;
    if (isGuestUser && orderType === "delivery" && !addressId) {
        pendingGuestAddress = (0, order_1.buildGuestAddress)(guestAddress, userId);
        addressId = pendingGuestAddress.id;
    }
    // 3. Payment Method Validation
    const { isWalletPayment, isCashPayment, isVisaPayment, } = await (0, order_1.resolvePaymentMethod)(paymentMethod, isGuestUser);
    // 4. Idempotency Check
    const existingOrder = await (0, order_1.checkCheckoutIdempotency)(idempotencyKey, userId);
    if (existingOrder) {
        return (0, response_1.SuccessResponse)(res, { message: "Order already processed", data: existingOrder });
    }
    // 5. Get User Cart & Validate User Not Blocked
    const { userCart, restaurantId } = await (0, order_1.getAndValidateUserCart)(userId);
    // 6. Restaurant, Business Plan & Schedules
    const { restaurant, plan, schedulesList, settings, storedOrderSource, } = await (0, order_1.validateRestaurantAndPlan)(restaurantId, orderSource, restaurantName);
    // 7. Operating Hours & Channel Validation
    const { defaultPreparingDuration, resolvedOrderType, } = (0, order_1.validateOperatingHoursAndChannel)(settings, schedulesList, orderType, isCashPayment);
    // 8. Branch Resolution for Pricing
    const serviceModule = resolvedOrderType;
    const pricingBranchId = await (0, order_1.resolveBranchForPricing)(resolvedOrderType, addressId, branchId, restaurantId, pendingGuestAddress, settings, userCart);
    // 9. Subcategory-branch Availability Guard
    const blockedFoodIds = await (0, order_1.checkSubcategoryBranchAvailability)(pricingBranchId, userCart);
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
    const { activeWeightRequest, hasWeightedItems, checkoutCart, cartFoodSoldBy, assertWeightCartUnchanged, } = await (0, order_1.evaluateCartWeightGating)(userCart, userId, restaurantId);
    // 11. Fetch Cart Lookup Maps
    const { cartParsed, optionsWithParentMap, addonsMap, foodMap, checkoutOffersMap, checkoutOfferFoodsMap, } = await (0, order_1.fetchCartLookupMaps)(checkoutCart);
    // 12. Calculate Cart Pricing & Item Details
    const pricingResult = await (0, order_1.calculateCartPricingAndItems)({
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
    const { subtotal, initialSubtotal, hasFoodLevelDiscount, resolvedOrderProducts, appliedDiscountIds, itemsToInsert, } = pricingResult;
    // 13. Fees & Commission
    const serviceFee = parseFloat(plan.serviceFee || "0");
    const commissionRate = parseFloat(plan.commissionRate || "0");
    const appCommission = (0, order_1.roundMoney)(subtotal * (commissionRate / 100));
    // 14. Discounts & Coupons
    const discountResult = await (0, order_1.resolveDiscounts)({
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
        orderSource,
    });
    const { totalDiscount, appliedCoupon, isFreeDelivery: couponFreeDelivery, orderDiscountId, orderCouponId, orderFirstOrderDiscountId, orderDiscountType, orderDiscountValue, orderDiscountSource, firstOrderDiscountAmount, } = discountResult;
    // 15. Delivery & Zone Resolution
    const deliveryResult = await (0, order_1.resolveDeliveryAndZones)({
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
    const { deliveryFee, calculatedDeliveryFee, resolvedZoneId, resolvedBranchId, shippingAddressSnapshot, targetShippingCompanyId, branchSnapshotData, isFreeDelivery, } = deliveryResult;
    let totalAmount = (0, order_1.roundMoney)(subtotal + deliveryFee + serviceFee - totalDiscount);
    if (totalAmount < 0)
        totalAmount = 0;
    const orderId = (0, uuid_1.v4)();
    const orderNumber = `ORD-${Date.now()}`;
    const userInfo = isGuestUser
        ? { ...user, name: guestName, phone: guestPhone }
        : { ...user, phone: registeredPhone || user.phone };
    // 16. Prepare Payment Session & Visa Commission (Pre-Transaction)
    const paymentPrep = await (0, order_1.preparePaymentSessionAndCommission)({
        isVisaPayment,
        isWalletPayment,
        hasWeightedItems,
        activeWeightRequest,
        assertWeightCartUnchanged,
        settings,
        orderId,
        orderNumber,
        restaurantId,
        branchId: resolvedBranchId,
        totalAmount,
        restaurant,
        restaurantName,
        userInfo,
    });
    const { weightClaimRequestId, paymentSessionData, finalPaymentGatewayType, visaCommission, } = paymentPrep;
    const now = new Date();
    let orderCommitted = false;
    let createdDailyOrderNumber = 1;
    // 17. Execute Order DB Transaction
    try {
        const txResult = await (0, order_1.executeOrderTransaction)({
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
    }
    finally {
        if (weightClaimRequestId && !orderCommitted) {
            await (0, order_1.releaseWeightCheckoutClaim)(weightClaimRequestId);
        }
    }
    // 18. Send Push Notification to Restaurant
    await (0, order_1.notifyRestaurantAfterOrder)({
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
    const responsePayload = (0, order_1.formatCheckoutResponsePayload)({
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
    return (0, response_1.SuccessResponse)(res, responsePayload);
};
exports.checkout = checkout;
// ==========================================
// 2. Get Active Orders
// ==========================================
const getActiveOrders = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { restaurantId } = req.query;
    const activeOrders = await connection_1.db
        .select({
        orderId: schema_1.orders.id,
        orderNumber: schema_1.orders.orderNumber,
        dailyOrderNumber: schema_1.orders.dailyOrderNumber,
        orderType: schema_1.orders.orderType,
        durationOrderPreparing: schema_1.orders.durationOrderPreparing,
        restaurantName: schema_1.restaurants.name,
        restaurantNameAr: schema_1.restaurants.nameAr,
        restaurantNameFr: schema_1.restaurants.nameFr,
        restaurantImage: schema_1.restaurants.logo,
        totalAmount: schema_1.orders.totalAmount,
        status: schema_1.orders.status,
        createdAt: schema_1.orders.createdAt,
        itemsCount: (0, drizzle_orm_1.sql) `(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${schema_1.orders.id})`,
        // Branch info (for takeaway / dine_in)
        branchName: schema_1.branches.name,
        // Address info (for delivery)
        addressTitle: schema_1.addresses.title,
        addressStreet: schema_1.addresses.street,
        addressLandmark: schema_1.addresses.landmark,
        // Delivery man info
        deliveryManId: schema_1.orders.deliveryManId,
        deliveryManName: schema_1.deliveryMen.name,
        deliveryManPhone: schema_1.deliveryMen.phone,
        // Cancellation info
        cancelReason: schema_1.orders.cancelReason,
        cancelReasonType: schema_1.orders.cancelReasonType ? schema_1.orders.cancelReasonType : schema_1.selectReasons.type,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.branches, (0, drizzle_orm_1.eq)(schema_1.orders.branchId, schema_1.branches.id))
        .leftJoin(schema_1.addresses, (0, drizzle_orm_1.eq)(schema_1.orders.addressId, schema_1.addresses.id))
        .leftJoin(schema_1.deliveryMen, (0, drizzle_orm_1.eq)(schema_1.orders.deliveryManId, schema_1.deliveryMen.id))
        .leftJoin(schema_1.selectReasons, (0, drizzle_orm_1.eq)(schema_1.orders.cancelReasonId, schema_1.selectReasons.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), restaurantId ? (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, String(restaurantId)) : undefined, (0, drizzle_orm_1.ne)(schema_1.orders.paymentStatus, "pending_payment"), (0, drizzle_orm_1.ne)(schema_1.orders.status, "failed"), (0, drizzle_orm_1.inArray)(schema_1.orders.status, ["pending", "accepted", "preparing", "out_for_delivery"])))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.orders.createdAt));
    // Fetch items for the active orders
    const orderIds = activeOrders.map(o => o.orderId);
    let allItems = [];
    if (orderIds.length > 0) {
        allItems = await connection_1.db.select({
            orderId: schema_1.orderItems.orderId,
            foodId: schema_1.orderItems.foodId,
            foodName: schema_1.food.name,
            foodNameAr: schema_1.food.nameAr,
            foodNameFr: schema_1.food.nameFr,
            foodDescription: schema_1.food.description,
            foodDescriptionAr: schema_1.food.descriptionAr,
            foodDescriptionFr: schema_1.food.descriptionFr,
            foodImage: schema_1.food.image,
            quantity: schema_1.orderItems.quantity,
            basePrice: schema_1.orderItems.basePrice,
            variationsPrice: schema_1.orderItems.variationsPrice,
            addonsPrice: schema_1.orderItems.addonsPrice,
            totalPrice: schema_1.orderItems.totalPrice,
            note: schema_1.orderItems.note,
            variations: schema_1.orderItems.variations,
            addons: schema_1.orderItems.addons,
            sold_by: schema_1.food.sold_by,
            foodWeightUnit: schema_1.food.weight_unit,
            allowCustomWeight: schema_1.food.allow_custom_weight,
            orderedWeight: schema_1.orderItems.orderedWeight,
            finalWeight: schema_1.orderItems.finalWeight,
            weightUnit: schema_1.orderItems.weightUnit,
        })
            .from(schema_1.orderItems)
            .leftJoin(schema_1.food, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orderItems.foodId, schema_1.food.id), foodConditions_1.activeFoodCondition))
            .where((0, drizzle_orm_1.inArray)(schema_1.orderItems.orderId, orderIds));
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
    return (0, response_1.SuccessResponse)(res, { data: formatted });
};
exports.getActiveOrders = getActiveOrders;
// ==========================================
// 3. Get History Orders
// ==========================================
const getOrderHistory = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { restaurantId } = req.query;
    const historyOrders = await connection_1.db
        .select({
        orderId: schema_1.orders.id,
        orderNumber: schema_1.orders.orderNumber,
        dailyOrderNumber: schema_1.orders.dailyOrderNumber,
        orderType: schema_1.orders.orderType,
        durationOrderPreparing: schema_1.orders.durationOrderPreparing,
        restaurantName: schema_1.restaurants.name,
        restaurantNameAr: schema_1.restaurants.nameAr,
        restaurantNameFr: schema_1.restaurants.nameFr,
        restaurantImage: schema_1.restaurants.logo,
        totalAmount: schema_1.orders.totalAmount,
        status: schema_1.orders.status,
        createdAt: schema_1.orders.createdAt,
        rating: schema_1.orders.rating,
        ratingComment: schema_1.orders.ratingComment,
        itemsCount: (0, drizzle_orm_1.sql) `(SELECT COUNT(*) FROM order_items WHERE order_items.order_id = ${schema_1.orders.id})`,
        // Branch info (for takeaway / dine_in)
        branchName: schema_1.branches.name,
        // Address info (for delivery)
        addressTitle: schema_1.addresses.title,
        addressStreet: schema_1.addresses.street,
        addressLandmark: schema_1.addresses.landmark,
        // Delivery man info
        deliveryManId: schema_1.orders.deliveryManId,
        deliveryManName: schema_1.deliveryMen.name,
        deliveryManPhone: schema_1.deliveryMen.phone,
        // Cancellation info
        cancelReason: schema_1.orders.cancelReason,
        cancelReasonType: schema_1.orders.cancelReasonType ? schema_1.orders.cancelReasonType : schema_1.selectReasons.type,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.branches, (0, drizzle_orm_1.eq)(schema_1.orders.branchId, schema_1.branches.id))
        .leftJoin(schema_1.addresses, (0, drizzle_orm_1.eq)(schema_1.orders.addressId, schema_1.addresses.id))
        .leftJoin(schema_1.deliveryMen, (0, drizzle_orm_1.eq)(schema_1.orders.deliveryManId, schema_1.deliveryMen.id))
        .leftJoin(schema_1.selectReasons, (0, drizzle_orm_1.eq)(schema_1.orders.cancelReasonId, schema_1.selectReasons.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), restaurantId ? (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, String(restaurantId)) : undefined, (0, drizzle_orm_1.ne)(schema_1.orders.status, "failed"), (0, drizzle_orm_1.inArray)(schema_1.orders.status, ["delivered", "cancelled", "refund"])))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.orders.createdAt));
    // Fetch items for the history orders
    const orderIds = historyOrders.map(o => o.orderId);
    let allItems = [];
    if (orderIds.length > 0) {
        allItems = await connection_1.db.select({
            orderId: schema_1.orderItems.orderId,
            foodId: schema_1.orderItems.foodId,
            foodName: schema_1.food.name,
            foodNameAr: schema_1.food.nameAr,
            foodNameFr: schema_1.food.nameFr,
            foodDescription: schema_1.food.description,
            foodDescriptionAr: schema_1.food.descriptionAr,
            foodDescriptionFr: schema_1.food.descriptionFr,
            foodImage: schema_1.food.image,
            quantity: schema_1.orderItems.quantity,
            basePrice: schema_1.orderItems.basePrice,
            variationsPrice: schema_1.orderItems.variationsPrice,
            addonsPrice: schema_1.orderItems.addonsPrice,
            totalPrice: schema_1.orderItems.totalPrice,
            note: schema_1.orderItems.note,
            variations: schema_1.orderItems.variations,
            addons: schema_1.orderItems.addons,
            sold_by: schema_1.food.sold_by,
            foodWeightUnit: schema_1.food.weight_unit,
            allowCustomWeight: schema_1.food.allow_custom_weight,
            orderedWeight: schema_1.orderItems.orderedWeight,
            finalWeight: schema_1.orderItems.finalWeight,
            weightUnit: schema_1.orderItems.weightUnit,
        })
            .from(schema_1.orderItems)
            .leftJoin(schema_1.food, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orderItems.foodId, schema_1.food.id), foodConditions_1.activeFoodCondition))
            .where((0, drizzle_orm_1.inArray)(schema_1.orderItems.orderId, orderIds));
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
    return (0, response_1.SuccessResponse)(res, { data: formatted });
};
exports.getOrderHistory = getOrderHistory;
// ==========================================
// 4. Order Details
// ==========================================
const getOrderDetails = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;
    // ── Main order query (no discount/coupon joins to avoid column name collisions) ──
    const orderInfo = await connection_1.db
        .select({
        orderId: schema_1.orders.id,
        orderNumber: schema_1.orders.orderNumber,
        dailyOrderNumber: schema_1.orders.dailyOrderNumber,
        status: schema_1.orders.status,
        createdAt: schema_1.orders.createdAt,
        paymentMethod: schema_1.orders.paymentMethod,
        paymentMethodDetails: {
            id: schema_1.paymentMethods.id,
            name: schema_1.paymentMethods.name,
            nameAr: schema_1.paymentMethods.nameAr,
        },
        orderType: schema_1.orders.orderType,
        durationOrderPreparing: schema_1.orders.durationOrderPreparing,
        subtotal: schema_1.orders.subtotal,
        deliveryFee: schema_1.orders.deliveryFee,
        serviceFee: schema_1.orders.serviceFee,
        discountAmount: schema_1.orders.discountAmount,
        couponCode: schema_1.orders.couponCode,
        totalAmount: schema_1.orders.totalAmount,
        // Raw discount/coupon IDs — names fetched separately
        discountId: schema_1.orders.discountId,
        discountType: schema_1.orders.discountType,
        discountValue: schema_1.orders.discountValue,
        discountSource: schema_1.orders.discountSource,
        couponId: schema_1.orders.couponId,
        note: schema_1.orders.note,
        rating: schema_1.orders.rating,
        ratingComment: schema_1.orders.ratingComment,
        restaurantName: schema_1.restaurants.name,
        restaurantNameAr: schema_1.restaurants.nameAr,
        restaurantNameFr: schema_1.restaurants.nameFr,
        restaurantImage: schema_1.restaurants.logo,
        // Branch (takeaway / dine_in)
        branchId: schema_1.branches.id,
        branchName: schema_1.branches.name,
        branchAddress: schema_1.branches.address,
        // Address (delivery)
        addressId: schema_1.addresses.id,
        addressTitle: schema_1.addresses.title,
        addressStreet: schema_1.addresses.street,
        addressLandmark: schema_1.addresses.landmark,
        // Delivery man info
        deliveryManId: schema_1.orders.deliveryManId,
        deliveryManName: schema_1.deliveryMen.name,
        deliveryManPhone: schema_1.deliveryMen.phone,
        // Cancellation info
        cancelReason: schema_1.orders.cancelReason,
        cancelReasonType: schema_1.orders.cancelReasonType ? schema_1.orders.cancelReasonType : schema_1.selectReasons.type,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.paymentMethods, (0, drizzle_orm_1.eq)(schema_1.orders.paymentMethod, schema_1.paymentMethods.id))
        .leftJoin(schema_1.branches, (0, drizzle_orm_1.eq)(schema_1.orders.branchId, schema_1.branches.id))
        .leftJoin(schema_1.addresses, (0, drizzle_orm_1.eq)(schema_1.orders.addressId, schema_1.addresses.id))
        .leftJoin(schema_1.deliveryMen, (0, drizzle_orm_1.eq)(schema_1.orders.deliveryManId, schema_1.deliveryMen.id))
        .leftJoin(schema_1.selectReasons, (0, drizzle_orm_1.eq)(schema_1.orders.cancelReasonId, schema_1.selectReasons.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId), (0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), (0, drizzle_orm_1.ne)(schema_1.orders.status, "failed")))
        .limit(1);
    if (!orderInfo.length) {
        throw new NotFound_1.NotFound("Order not found");
    }
    const o = orderInfo[0];
    // ── Fetch discount & coupon names in separate queries (avoid JOIN name collisions) ──
    let discountRow = null;
    if (o.discountId) {
        const [d] = await connection_1.db.select({ name: schema_1.discounts.name, nameAr: schema_1.discounts.nameAr, nameFr: schema_1.discounts.nameFr })
            .from(schema_1.discounts).where((0, drizzle_orm_1.eq)(schema_1.discounts.id, o.discountId)).limit(1);
        discountRow = d ?? null;
    }
    let couponRow = null;
    if (o.couponId) {
        const [c] = await connection_1.db.select({ code: schema_1.coupons.code, name: schema_1.coupons.name, nameAr: schema_1.coupons.nameAr, nameFr: schema_1.coupons.nameFr })
            .from(schema_1.coupons).where((0, drizzle_orm_1.eq)(schema_1.coupons.id, o.couponId)).limit(1);
        couponRow = c ?? null;
    }
    // 1. جلب عناصر الطلب الأساسية
    const itemsRaw = await connection_1.db
        .select({
        foodId: schema_1.orderItems.foodId,
        foodName: schema_1.food.name,
        foodNameAr: schema_1.food.nameAr,
        foodNameFr: schema_1.food.nameFr,
        foodDescription: schema_1.food.description,
        foodDescriptionAr: schema_1.food.descriptionAr,
        foodDescriptionFr: schema_1.food.descriptionFr,
        foodImage: schema_1.food.image,
        quantity: schema_1.orderItems.quantity,
        basePrice: schema_1.orderItems.basePrice,
        variationsPrice: schema_1.orderItems.variationsPrice,
        addonsPrice: schema_1.orderItems.addonsPrice,
        totalPrice: schema_1.orderItems.totalPrice,
        note: schema_1.orderItems.note,
        variations: schema_1.orderItems.variations,
        addons: schema_1.orderItems.addons,
        sold_by: schema_1.food.sold_by,
        foodWeightUnit: schema_1.food.weight_unit,
        allowCustomWeight: schema_1.food.allow_custom_weight,
        orderedWeight: schema_1.orderItems.orderedWeight,
        finalWeight: schema_1.orderItems.finalWeight,
        weightUnit: schema_1.orderItems.weightUnit,
    })
        .from(schema_1.orderItems)
        .leftJoin(schema_1.food, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orderItems.foodId, schema_1.food.id), foodConditions_1.activeFoodCondition))
        .where((0, drizzle_orm_1.eq)(schema_1.orderItems.orderId, orderId));
    // 2. معالجة الـ Variations واستخراج أسماء الفارييشنز وتفاصيلها كاملة
    const formattedItems = await formatOrderItemsVariations(itemsRaw);
    return (0, response_1.SuccessResponse)(res, {
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
exports.getOrderDetails = getOrderDetails;
/**
 * مطابقة عنوان العميل بنطاقات التوصيل واختيار النطاق المناسب والسعر الأعلى
 */
const matchAddressToDeliveryZone = (address, zoneFees) => {
    if (!address) {
        return {
            isDeliverable: false,
            deliveryFee: null,
            matchedZoneId: null,
            matchedRestaurantDeliveryZoneId: null,
            applicableFee: null,
        };
    }
    const addrLat = parseFloat(address.lat || "0");
    const addrLng = parseFloat(address.lng || "0");
    if (!addrLat || !addrLng) {
        return {
            isDeliverable: false,
            deliveryFee: null,
            matchedZoneId: null,
            matchedRestaurantDeliveryZoneId: null,
            applicableFee: null,
        };
    }
    let isDeliverable = false;
    let applicableDeliveryFee = null;
    let matchedZoneId = null;
    let matchedRestaurantDeliveryZoneId = null;
    let applicableFee = null;
    for (const fee of zoneFees) {
        // فحص وقوع النقط جغرافياً داخل الـ restaurantDeliveryZone مع zoneId كآخر احتمال (Fallback)
        const matchesZone = (0, geo_1.isLocationInZone)(addrLat, addrLng, address.zoneId || fee.zoneId, fee);
        if (matchesZone) {
            const isBranchActive = !fee.branchId || fee.branchStatus === "active";
            if (!isBranchActive)
                continue;
            isDeliverable = true;
            const currentFee = parseFloat((fee.deliveryFee || "0"));
            // 🚀 اختيار السعر الأعلى والـ restaurantDeliveryZoneId التابع له
            if (applicableDeliveryFee === null || currentFee > applicableDeliveryFee) {
                applicableDeliveryFee = currentFee;
                matchedZoneId = fee.zoneId;
                matchedRestaurantDeliveryZoneId = fee.id;
                applicableFee = fee;
            }
        }
    }
    return {
        isDeliverable,
        deliveryFee: applicableDeliveryFee,
        matchedZoneId,
        matchedRestaurantDeliveryZoneId,
        applicableFee,
    };
};
/**
 * تحديد الفرع المسؤول عن الطلب بناءً على branchId أو نطاق التوصيل الفعلي للعنوان (restaurantDeliveryZone)
 */
const resolveServingBranchId = (params) => {
    const { branchId, address, zoneFees, restaurantBranches } = params;
    // 1. إذا تم إرسال branchId صراحة، نستخدمه مباشرة
    if (branchId) {
        return branchId;
    }
    // 2. إذا لم يتم إرسال عنوان، لا يمكن تحديد الفرع
    if (!address) {
        return null;
    }
    // 3. مطابقة العنوان مع نقاط الـ restaurantDeliveryZone
    const zoneMatch = matchAddressToDeliveryZone(address, zoneFees);
    if (!zoneMatch.isDeliverable || !zoneMatch.applicableFee) {
        return null;
    }
    // حساب الفرع من الـ restaurantDeliveryZone مباشرة وليس من zoneId
    if (zoneMatch.applicableFee.branchId) {
        return zoneMatch.applicableFee.branchId;
    }
    else if (restaurantBranches.length === 1) {
        return restaurantBranches[0].id;
    }
    return null;
};
// ==========================================
// 5. Order Prerequisites
// ==========================================
const getOrderPrerequisites = async (req, res) => {
    if (!req.user) {
        throw new Errors_1.UnauthorizedError("Unauthenticated: Token is missing or invalid");
    }
    const userId = req.user.id;
    const restaurantId = req.query.restaurantId;
    const orderSource = req.query.orderSource;
    const addressId = (req.query.addressId || req.query.addressid);
    const branchId = (req.query.branchId || req.query.branchid);
    if (!restaurantId) {
        throw new BadRequest_1.BadRequest("restaurantId is required");
    }
    const validOrderSources = ["online_order_app", "online_order_web", "food_aggregator", "mykeeto", "pos"];
    if (!orderSource || !validOrderSources.includes(orderSource)) {
        throw new BadRequest_1.BadRequest("Invalid or missing order source");
    }
    // 1. جلب البيانات من الداتا بيز بالتوازي
    const [userAddresses, restaurantBranches, restaurantZoneFees, allActivePaymentMethods, getCancelReasons, businessPlans, freeDeliveryOfferRows, restaurantSettingsRows] = await Promise.all([
        connection_1.db.select().from(schema_1.addresses).where((0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId)),
        connection_1.db.select().from(schema_1.branches).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active"))),
        connection_1.db.select({
            id: schema_1.restaurantZoneDeliveryFees.id,
            zoneId: schema_1.restaurantZoneDeliveryFees.zoneId,
            zoneName: schema_1.zones.name,
            zoneNameAr: schema_1.zones.nameAr,
            branchId: schema_1.restaurantZoneDeliveryFees.branchId,
            branchStatus: schema_1.branches.status,
            deliveryFee: schema_1.restaurantZoneDeliveryFees.deliveryFee,
            coverageType: schema_1.restaurantZoneDeliveryFees.coverageType,
            customCoordinates: schema_1.restaurantZoneDeliveryFees.customCoordinates,
            customRadiusKm: schema_1.restaurantZoneDeliveryFees.customRadiusKm,
            defaultCoordinates: schema_1.zones.coordinates,
            defaultRadiusKm: schema_1.zones.coverageAreaRadiusKm,
        })
            .from(schema_1.restaurantZoneDeliveryFees)
            .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.zoneId, schema_1.zones.id))
            .leftJoin(schema_1.branches, (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.branchId, schema_1.branches.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.status, "active"))),
        connection_1.db.select({
            id: schema_1.paymentMethods.id,
            name: schema_1.paymentMethods.name,
            nameAr: schema_1.paymentMethods.nameAr
        }).from(schema_1.paymentMethods).where((0, drizzle_orm_1.eq)(schema_1.paymentMethods.isActive, true)),
        connection_1.db.select().from(schema_1.selectReasons).where((0, drizzle_orm_1.eq)(schema_1.selectReasons.type, "user")),
        connection_1.db.select({ serviceFee: schema_1.restaurantBusinessPlans.serviceFee })
            .from(schema_1.restaurantBusinessPlans)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.platformType, (0, restaurantWalletService_1.mapOrderSourceToPlatformType)(orderSource))))
            .limit(1),
        connection_1.db.select()
            .from(schema_1.freeDeliveryOffers)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.freeDeliveryOffers.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.freeDeliveryOffers.status, "active")))
            .limit(1),
        // 🛡️ جلب إعدادات المطعم لمعرفة هل الدفع الإلكتروني و الكاش مفعلين أم لا ومعرفة شركة الشحن المرتبطة
        connection_1.db.select({
            enableOnlinePayment: schema_1.restaurantSettings.enableOnlinePayment,
            cashEnabled: schema_1.restaurantSettings.cashEnabled,
            shippingCompanyId: schema_1.restaurantSettings.shippingCompanyId,
            shippingCompanyName: schema_1.shippingCompanies.name,
            shippingCompanyStatus: schema_1.shippingCompanies.status,
        })
            .from(schema_1.restaurantSettings)
            .leftJoin(schema_1.shippingCompanies, (0, drizzle_orm_1.eq)(schema_1.restaurantSettings.shippingCompanyId, schema_1.shippingCompanies.id))
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId))
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
        throw new BadRequest_1.BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }
    let targetShippingCompanyId = restaurantSettingsRows[0]?.shippingCompanyId || null;
    let shippingCompanyName = restaurantSettingsRows[0]?.shippingCompanyName || null;
    let isCompanyActive = restaurantSettingsRows[0]?.shippingCompanyStatus === "active";
    // إذا لم تكن شركة الشحن مسجلة في الإعدادات، نتحقق من جدول الربط shippingCompanyRestaurants كخيار بديل
    if (!targetShippingCompanyId) {
        const [junctionLink] = await connection_1.db
            .select({
            shippingCompanyId: schema_1.shippingCompanyRestaurants.shippingCompanyId,
            shippingCompanyName: schema_1.shippingCompanies.name,
            shippingCompanyStatus: schema_1.shippingCompanies.status,
        })
            .from(schema_1.shippingCompanyRestaurants)
            .innerJoin(schema_1.shippingCompanies, (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, schema_1.shippingCompanies.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.status, "active"), (0, drizzle_orm_1.eq)(schema_1.shippingCompanies.status, "active")))
            .limit(1);
        if (junctionLink) {
            targetShippingCompanyId = junctionLink.shippingCompanyId;
            shippingCompanyName = junctionLink.shippingCompanyName;
            isCompanyActive = true;
        }
    }
    // 🚚 إذا كان المطعم مرتبطاً بشركة شحن نشطة، نستخدم نطاقات شركة الشحن (shipping_zones) بدلاً من نطاقات المطعم
    let zoneFees = [];
    if (targetShippingCompanyId && isCompanyActive) {
        const companyZones = await connection_1.db
            .select({
            id: schema_1.shippingZones.id,
            name: schema_1.shippingZones.name,
            nameAr: schema_1.shippingZones.nameAr,
            coordinates: schema_1.shippingZones.coordinates,
            coverageAreaRadiusKm: schema_1.shippingZones.coverageAreaRadiusKm,
            deliveryFee: schema_1.shippingZones.deliveryFee,
            minOrderAmount: schema_1.shippingZones.minOrderAmount,
            status: schema_1.shippingZones.status,
        })
            .from(schema_1.shippingZones)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingZones.shippingCompanyId, targetShippingCompanyId), (0, drizzle_orm_1.eq)(schema_1.shippingZones.status, "active")));
        if (companyZones.length > 0) {
            zoneFees = companyZones.map((sz) => {
                let coords = sz.coordinates;
                if (typeof coords === "string") {
                    try {
                        coords = JSON.parse(coords);
                    }
                    catch {
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
        }
        else {
            // Fallback لنطاقات المطعم في حال لم يتم إدخال نطاقات لشركة الشحن بعد
            zoneFees = restaurantZoneFees;
        }
    }
    else {
        zoneFees = restaurantZoneFees;
    }
    // 2. معالجة كل عنوان عند المستخدم ومعرفة هل هو قابل للتوصيل ومعرفة zoneId الخاص به
    const addressesWithDeliveryInfo = userAddresses.map((addr) => {
        const match = matchAddressToDeliveryZone(addr, zoneFees);
        return {
            ...addr,
            isDeliverable: match.isDeliverable,
            deliveryFee: match.deliveryFee,
            restaurantDeliveryZoneId: match.matchedRestaurantDeliveryZoneId,
            zoneId: match.matchedRestaurantDeliveryZoneId,
        };
    });
    const serviceFee = parseFloat((plan.serviceFee || "0"));
    // 🏢 تحديد الفرع المسؤول عن الطلب (سواء من branchId أو addressId)
    const targetAddress = addressId ? userAddresses.find((a) => a.id === addressId) || null : null;
    const resolvedBranchId = (branchId || addressId)
        ? resolveServingBranchId({
            branchId,
            address: targetAddress,
            zoneFees,
            restaurantBranches,
        })
        : null;
    // 🔍 Resolve branch-level visa status when addressId or branchId provided
    let visaEnabledForLocation = enableOnlinePayment;
    if (addressId || branchId) {
        if (!enableOnlinePayment || !resolvedBranchId) {
            // إذا كان الدفع أونلاين مغلق عاماً، أو لم يتطابق العنوان مع أي نطاق توصيل للمطعم
            visaEnabledForLocation = false;
        }
        else {
            const [branchRow] = await connection_1.db
                .select({ visa_status: schema_1.branches.visa_status })
                .from(schema_1.branches)
                .where((0, drizzle_orm_1.eq)(schema_1.branches.id, resolvedBranchId))
                .limit(1);
            visaEnabledForLocation = branchRow?.visa_status ?? true;
        }
    }
    // Free delivery offer — check validity window
    const nowForPrereq = new Date();
    const activeFreeDeliveryOffer = freeDeliveryOfferRows[0] ?? null;
    let freeDeliveryOfferData = null;
    if (activeFreeDeliveryOffer) {
        const startOk = !activeFreeDeliveryOffer.startDate || new Date(activeFreeDeliveryOffer.startDate) <= nowForPrereq;
        const endOk = !activeFreeDeliveryOffer.endDate || new Date(activeFreeDeliveryOffer.endDate) >= nowForPrereq;
        if (startOk && endOk) {
            let offerBranchIds = [];
            const rawBranchIds = activeFreeDeliveryOffer.branchIds;
            if (Array.isArray(rawBranchIds)) {
                offerBranchIds = rawBranchIds.map(String).filter(Boolean);
            }
            else if (typeof rawBranchIds === "string") {
                try {
                    const parsed = JSON.parse(rawBranchIds);
                    if (Array.isArray(parsed))
                        offerBranchIds = parsed.map(String).filter(Boolean);
                }
                catch {
                    offerBranchIds = [];
                }
            }
            const branchMap = new Map();
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
                const extraBranches = await connection_1.db
                    .select({
                    id: schema_1.branches.id,
                    name: schema_1.branches.name,
                    nameAr: schema_1.branches.nameAr,
                    nameFr: schema_1.branches.nameFr,
                })
                    .from(schema_1.branches)
                    .where((0, drizzle_orm_1.inArray)(schema_1.branches.id, missingBranchIds));
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
            // إذا تم إرسال addressId أو branchId في الـ query، نحدد الفرع الذي يخدم هذا الطلب ونرجع العرض الخاص به فقط
            if (addressId || branchId) {
                if (resolvedBranchId) {
                    const isBranchIncluded = offerBranchIds.length === 0 || offerBranchIds.includes(resolvedBranchId);
                    if (isBranchIncluded) {
                        const b = branchMap.get(resolvedBranchId);
                        const singleBranchObject = b ? {
                            id: b.id,
                            name: b.name || "Branch",
                            nameAr: b.nameAr || null,
                            nameFr: b.nameFr || null,
                        } : {
                            id: resolvedBranchId,
                            name: "Branch",
                            nameAr: null,
                            nameFr: null,
                        };
                        freeDeliveryOfferData = {
                            minOrderAmount: parseFloat(activeFreeDeliveryOffer.minOrderAmount || "0"),
                            startDate: activeFreeDeliveryOffer.startDate ? activeFreeDeliveryOffer.startDate.toISOString() : null,
                            endDate: activeFreeDeliveryOffer.endDate ? activeFreeDeliveryOffer.endDate.toISOString() : null,
                            branches: [singleBranchObject],
                        };
                    }
                    else {
                        // الفرع غير مشمول في عرض التوصيل المجاني
                        freeDeliveryOfferData = null;
                    }
                }
                else {
                    freeDeliveryOfferData = null;
                }
            }
            else {
                // في حال عدم إرسال addressId أو branchId، نرجع كل الفروع كما هي
                freeDeliveryOfferData = {
                    minOrderAmount: parseFloat(activeFreeDeliveryOffer.minOrderAmount || "0"),
                    startDate: activeFreeDeliveryOffer.startDate ? activeFreeDeliveryOffer.startDate.toISOString() : null,
                    endDate: activeFreeDeliveryOffer.endDate ? activeFreeDeliveryOffer.endDate.toISOString() : null,
                    branches: allBranchObjects,
                };
            }
        }
    }
    // إرجاع طرق الدفع وتوضيح حالة الفيزا للفرع/العنوان المحدد للفرونت إند لعمل disable إن لزم
    const formattedPaymentMethods = activePaymentMethods.map((pm) => {
        const name = pm.name?.toLowerCase() ?? "";
        const nameAr = pm.nameAr ?? "";
        const isVisa = name === "visa" || name === "card" || nameAr === "بطاقة";
        return {
            ...pm,
            ...(isVisa ? { visaEnabledForLocation } : {}),
        };
    });
    return (0, response_1.SuccessResponse)(res, {
        data: {
            addresses: addressesWithDeliveryInfo,
            branches: restaurantBranches,
            zones: zoneFees, // 👈 إرجاع مناطق التوصيل وأسعارها الخاصة بشركة الشحن أو المطعم
            paymentMethods: formattedPaymentMethods, // visa filtered out only when enableOnlinePayment=false
            enableOnlinePayment, // 👈 هل الدفع الإلكتروني (فيزا) مفعّل لهذا المطعم؟
            visaEnabledForLocation, // 👈 هل الفيزا مفعّلة لهذا الفرع/العنوان تحديداً؟
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
exports.getOrderPrerequisites = getOrderPrerequisites;
// ==========================================
// 6. Cancel Order
// ==========================================
const cancelOrder = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;
    const { cancelReasonId, customReason } = req.body;
    const inputCustomReason = customReason;
    if (!cancelReasonId && (!inputCustomReason || typeof inputCustomReason !== "string" || inputCustomReason.trim() === "")) {
        throw new BadRequest_1.BadRequest("Cancel reason or cancel reason ID is required");
    }
    // 1. جلب الطلب والتأكد أنه للمستخدم وأنه قابل للإلغاء
    const [order] = await connection_1.db.select().from(schema_1.orders).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId), (0, drizzle_orm_1.eq)(schema_1.orders.userId, userId))).limit(1);
    if (!order)
        throw new NotFound_1.NotFound("Order not found");
    if (!["pending", "accepted"].includes(order.status)) {
        throw new BadRequest_1.BadRequest("Order cannot be cancelled at this stage");
    }
    // 2. التحقق من سبب الإلغاء
    let finalReasonId = null;
    let finalReasonText = null;
    if (cancelReasonId) {
        const [reason] = await connection_1.db.select().from(schema_1.selectReasons).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.selectReasons.id, cancelReasonId), (0, drizzle_orm_1.eq)(schema_1.selectReasons.type, "user"))).limit(1);
        if (!reason)
            throw new BadRequest_1.BadRequest("Invalid cancel reason for user");
        finalReasonId = reason.id;
        finalReasonText = (inputCustomReason && inputCustomReason.trim()) ? inputCustomReason.trim() : reason.name;
    }
    else {
        finalReasonId = null;
        finalReasonText = inputCustomReason.trim();
    }
    // 3. تحديث حالة الطلب وإرجاع المبالغ المالية (إلغاء أرباح المطعم والعمولة)
    await connection_1.db.transaction(async (tx) => {
        // تحديث الطلب
        await tx.update(schema_1.orders)
            .set({
            status: "cancelled",
            cancelledAt: new Date(),
            cancelReasonId: finalReasonId,
            cancelReason: finalReasonText,
            cancelReasonType: "user",
            updatedAt: new Date()
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        // حسابات المبالغ التي تم دفعها أو خصمها
        const totalAmount = parseFloat(order.totalAmount || "0");
        // إرجاع فلوس المستخدم لو دفع بالمحفظة
        // note: paymentMethod stores UUID, so we check userWalletTransactions to know if it was a wallet payment
        const [walletTx] = await tx.select().from(schema_1.userWalletTransactions).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.reference, order.orderNumber), (0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.transactionType, "order_payment"))).limit(1);
        if (walletTx) {
            // Revert User Wallet
            const [userWallet] = await tx.select().from(schema_1.userWallets).where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId)).limit(1);
            if (userWallet) {
                const balanceBefore = parseFloat(userWallet.balance || "0");
                const newBalance = balanceBefore + totalAmount;
                await tx.update(schema_1.userWallets).set({ balance: newBalance.toString() }).where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId));
                await tx.insert(schema_1.userWalletTransactions).values({
                    id: (0, uuid_1.v4)(),
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
        await (0, restaurantWalletService_1.handleCancelledOrder)({ orderId, cancelReasonType: "user", tx });
    });
    // 4. إرسال إشعارات إلغاء الطلب (Type: cancel)
    await (0, notifications_1.sendPushNotification)({
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
        (0, dispatchEngine_1.releaseCourierForOrder)(order.id, order.deliveryManId).catch((err) => {
            console.error(`[releaseCourierForOrder:userCancel] failed for order ${order.id}:`, err);
        });
    }
    return (0, response_1.SuccessResponse)(res, { message: "Order cancelled successfully" });
};
exports.cancelOrder = cancelOrder;
// ==========================================
// 7. Get Cancel Reasons
// ==========================================
const getCancelReasons = async (req, res) => {
    const cancelReasons = await connection_1.db
        .select()
        .from(schema_1.selectReasons)
        .where((0, drizzle_orm_1.eq)(schema_1.selectReasons.type, "user"));
    return (0, response_1.SuccessResponse)(res, { data: cancelReasons });
};
exports.getCancelReasons = getCancelReasons;
// ==========================================
// 8. Rate Order (User)
// ==========================================
const rateOrder = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;
    const { rating, comment } = req.body;
    if (!rating) {
        throw new BadRequest_1.BadRequest("Rating is required");
    }
    if (typeof rating !== "number" || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        throw new BadRequest_1.BadRequest("Rating must be an integer between 1 and 5");
    }
    const [order] = await connection_1.db
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId), (0, drizzle_orm_1.eq)(schema_1.orders.userId, userId)))
        .limit(1);
    if (!order) {
        throw new NotFound_1.NotFound("Order not found");
    }
    if (order.status !== "delivered") {
        throw new BadRequest_1.BadRequest("Only delivered orders can be rated");
    }
    await connection_1.db
        .update(schema_1.orders)
        .set({
        rating,
        ratingComment: comment ?? null,
        updatedAt: new Date()
    })
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
    return (0, response_1.SuccessResponse)(res, {
        message: "Order rated successfully",
        data: {
            orderId,
            rating,
            ratingComment: comment ?? null,
        }
    });
};
exports.rateOrder = rateOrder;
