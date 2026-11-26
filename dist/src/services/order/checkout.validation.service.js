"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateOperatingHoursAndChannel = exports.validateRestaurantAndPlan = exports.checkCheckoutIdempotency = exports.resolvePaymentMethod = exports.buildGuestAddress = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
const BadRequest_1 = require("../../Errors/BadRequest");
const restaurantWalletService_1 = require("../restaurantWalletService");
const orderSources_1 = require("../../types/orderSources");
const restaurantFeatures_1 = require("../../controllers/user/restaurantFeatures");
/**
 * Validates and builds an in-memory guest address row.
 * Does NOT insert into DB.
 */
const buildGuestAddress = (guestAddress, userId) => {
    if (!guestAddress || typeof guestAddress !== "object") {
        throw new BadRequest_1.BadRequest("Delivery address is required.");
    }
    const lat = Number(guestAddress.lat);
    const lng = Number(guestAddress.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !lat || !lng || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new BadRequest_1.BadRequest("Delivery address requires valid latitude and longitude coordinates.");
    }
    if (!guestAddress.street || String(guestAddress.street).trim() === "") {
        throw new BadRequest_1.BadRequest("Street is required for the delivery address.");
    }
    const number = guestAddress.number != null ? String(guestAddress.number).trim() : "";
    return {
        id: (0, uuid_1.v4)(),
        userId,
        title: guestAddress.title || "Guest Address",
        street: String(guestAddress.street).trim(),
        number: number || "-",
        floor: guestAddress.floor ? String(guestAddress.floor) : null,
        apartment: guestAddress.apartment ? String(guestAddress.apartment) : null,
        landmark: guestAddress.landmark || null,
        location: guestAddress.location || null,
        fulladdress: guestAddress.fulladdress || `${number} ${String(guestAddress.street).trim()}`.trim(),
        lat: String(lat),
        lng: String(lng),
    };
};
exports.buildGuestAddress = buildGuestAddress;
/**
 * Validates that the selected payment method is active, resolves its type,
 * and ensures guest users cannot pay via wallet.
 */
const resolvePaymentMethod = async (paymentMethodId, isGuestUser) => {
    const [selectedPayment] = await connection_1.db
        .select()
        .from(schema_1.paymentMethods)
        .where((0, drizzle_orm_1.eq)(schema_1.paymentMethods.id, paymentMethodId))
        .limit(1);
    if (!selectedPayment || !selectedPayment.isActive) {
        throw new BadRequest_1.BadRequest("Invalid or inactive payment method");
    }
    const paymentMethodName = selectedPayment.name;
    const paymentMethodNameAr = selectedPayment.nameAr;
    const isWalletPayment = paymentMethodName === "wallet" || paymentMethodNameAr === "محفظتى";
    const isCashPayment = paymentMethodName === "cash_on_delivery" ||
        paymentMethodNameAr === "الدفع عند الاستلام" ||
        paymentMethodName === "cash";
    if (isGuestUser && isWalletPayment) {
        throw new BadRequest_1.BadRequest("Wallet payment is only available for registered accounts.");
    }
    const isVisaPayment = paymentMethodName?.toLowerCase() === "visa" || paymentMethodNameAr === "بطاقة";
    return {
        selectedPayment,
        paymentMethodName,
        paymentMethodNameAr,
        isWalletPayment,
        isCashPayment,
        isVisaPayment,
    };
};
exports.resolvePaymentMethod = resolvePaymentMethod;
/**
 * Checks if an order with the provided idempotencyKey already exists for this user.
 */
const checkCheckoutIdempotency = async (idempotencyKey, userId) => {
    if (!idempotencyKey)
        return null;
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.idempotencyKey, idempotencyKey), (0, drizzle_orm_1.eq)(schema_1.orders.userId, userId)))
        .limit(1);
    return existing || null;
};
exports.checkCheckoutIdempotency = checkCheckoutIdempotency;
/**
 * Fetches restaurant, business plan, schedules, and settings in parallel,
 * validating active business plan coverage and updating slug if needed.
 */
const validateRestaurantAndPlan = async (restaurantId, orderSource, restaurantName) => {
    if (!orderSources_1.CHECKOUT_ORDER_SOURCES.includes(orderSource)) {
        throw new BadRequest_1.BadRequest("Invalid order source");
    }
    const storedOrderSource = (0, orderSources_1.toStoredOrderSource)(orderSource);
    const [[restaurant], [plan], schedulesList, [settings],] = await Promise.all([
        connection_1.db.select().from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId)).limit(1),
        connection_1.db
            .select()
            .from(schema_1.restaurantBusinessPlans)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.platformType, (0, restaurantWalletService_1.mapOrderSourceToPlatformType)(orderSource))))
            .limit(1),
        connection_1.db.select().from(schema_1.restaurantSchedules).where((0, drizzle_orm_1.eq)(schema_1.restaurantSchedules.restaurantId, restaurantId)),
        connection_1.db.select().from(schema_1.restaurantSettings).where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId)).limit(1),
    ]);
    if (!restaurant)
        throw new BadRequest_1.BadRequest("Restaurant not found");
    if (!plan) {
        throw new BadRequest_1.BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }
    if (!restaurant.slug && restaurantName) {
        await connection_1.db
            .update(schema_1.restaurants)
            .set({
            slug: restaurantName,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurant.id));
    }
    return {
        restaurant,
        plan,
        schedulesList,
        settings,
        storedOrderSource,
    };
};
exports.validateRestaurantAndPlan = validateRestaurantAndPlan;
/**
 * Validates operational status, channel availability, cash settings,
 * and determines the default preparing duration.
 */
const validateOperatingHoursAndChannel = (settings, schedulesList, orderType, isCashPayment) => {
    const validOrderTypes = ["delivery", "takeaway", "dine_in"];
    if (!orderType || !validOrderTypes.includes(orderType)) {
        throw new BadRequest_1.BadRequest("orderType is required and must be one of: delivery, takeaway, dine_in");
    }
    const resolvedOrderType = orderType;
    const status = (0, restaurantFeatures_1.calculateCurrentStatus)(settings, schedulesList);
    if (!status.isOpenNow)
        throw new BadRequest_1.BadRequest(`Order failed. ${status.reason}`);
    if (resolvedOrderType === "delivery" && !status.canDeliveryNow) {
        throw new BadRequest_1.BadRequest("Order failed. Delivery service is currently disabled for this restaurant.");
    }
    if (resolvedOrderType === "takeaway" && !status.canTakeawayNow) {
        throw new BadRequest_1.BadRequest("Order failed. Takeaway service is currently disabled for this restaurant.");
    }
    if (isCashPayment && settings?.cashEnabled === false) {
        throw new BadRequest_1.BadRequest("Cash payment is not accepted by this restaurant. Please choose a different payment method.");
    }
    let defaultPreparingDuration;
    if (resolvedOrderType === "takeaway") {
        defaultPreparingDuration = settings?.maxTakeAwayTime ?? 25;
    }
    else if (resolvedOrderType === "dine_in") {
        defaultPreparingDuration = settings?.maxDineInTime ?? 25;
    }
    else {
        defaultPreparingDuration = settings?.maxDeliveryTime ?? 25;
    }
    return {
        status,
        defaultPreparingDuration,
        resolvedOrderType,
    };
};
exports.validateOperatingHoursAndChannel = validateOperatingHoursAndChannel;
