import { db } from "../../models/connection";
import {
    orders,
    paymentMethods,
    restaurants,
    restaurantBusinessPlans,
    restaurantSchedules,
    restaurantSettings,
} from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { BadRequest } from "../../Errors/BadRequest";
import { mapOrderSourceToPlatformType } from "../restaurantWalletService";
import { CHECKOUT_ORDER_SOURCES, toStoredOrderSource } from "../../types/orderSources";
import { calculateCurrentStatus } from "../../controllers/user/restaurantFeatures";
import {
    GuestAddressRow,
    PaymentMethodResolution,
    RestaurantAndPlanInfo,
    OperatingHoursInfo,
} from "./checkout.types";

/**
 * Validates and builds an in-memory guest address row.
 * Does NOT insert into DB.
 */
export const buildGuestAddress = (guestAddress: any, userId: string): GuestAddressRow => {
    if (!guestAddress || typeof guestAddress !== "object") {
        throw new BadRequest("Delivery address is required.");
    }
    const lat = Number(guestAddress.lat);
    const lng = Number(guestAddress.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !lat || !lng || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new BadRequest("Delivery address requires valid latitude and longitude coordinates.");
    }
    if (!guestAddress.street || String(guestAddress.street).trim() === "") {
        throw new BadRequest("Street is required for the delivery address.");
    }
    const number = guestAddress.number != null ? String(guestAddress.number).trim() : "";
    return {
        id: uuidv4(),
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

/**
 * Validates that the selected payment method is active, resolves its type,
 * and ensures guest users cannot pay via wallet.
 */
export const resolvePaymentMethod = async (
    paymentMethodId: string,
    isGuestUser: boolean
): Promise<PaymentMethodResolution> => {
    const [selectedPayment] = await db
        .select()
        .from(paymentMethods)
        .where(eq(paymentMethods.id, paymentMethodId))
        .limit(1);

    if (!selectedPayment || !selectedPayment.isActive) {
        throw new BadRequest("Invalid or inactive payment method");
    }

    const paymentMethodName = selectedPayment.name;
    const paymentMethodNameAr = selectedPayment.nameAr;
    const isWalletPayment = paymentMethodName === "wallet" || paymentMethodNameAr === "محفظتى";
    const isCashPayment =
        paymentMethodName === "cash_on_delivery" ||
        paymentMethodNameAr === "الدفع عند الاستلام" ||
        paymentMethodName === "cash";

    if (isGuestUser && isWalletPayment) {
        throw new BadRequest("Wallet payment is only available for registered accounts.");
    }

    const isVisaPayment =
        paymentMethodName?.toLowerCase() === "visa" || paymentMethodNameAr === "بطاقة";

    return {
        selectedPayment,
        paymentMethodName,
        paymentMethodNameAr,
        isWalletPayment,
        isCashPayment,
        isVisaPayment,
    };
};

/**
 * Checks if an order with the provided idempotencyKey already exists for this user.
 */
export const checkCheckoutIdempotency = async (
    idempotencyKey: string | undefined,
    userId: string
): Promise<any | null> => {
    if (!idempotencyKey) return null;

    const [existing] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.idempotencyKey, idempotencyKey), eq(orders.userId, userId)))
        .limit(1);

    return existing || null;
};

/**
 * Fetches restaurant, business plan, schedules, and settings in parallel,
 * validating active business plan coverage and updating slug if needed.
 */
export const validateRestaurantAndPlan = async (
    restaurantId: string,
    orderSource: string,
    restaurantName?: string
): Promise<RestaurantAndPlanInfo> => {
    if (!(CHECKOUT_ORDER_SOURCES as readonly string[]).includes(orderSource)) {
        throw new BadRequest("Invalid order source");
    }

    const storedOrderSource = toStoredOrderSource(orderSource);

    const [
        [restaurant],
        [plan],
        schedulesList,
        [settings],
    ] = await Promise.all([
        db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1),
        db
            .select()
            .from(restaurantBusinessPlans)
            .where(
                and(
                    eq(restaurantBusinessPlans.restaurantId, restaurantId),
                    eq(restaurantBusinessPlans.platformType, mapOrderSourceToPlatformType(orderSource))
                )
            )
            .limit(1),
        db.select().from(restaurantSchedules).where(eq(restaurantSchedules.restaurantId, restaurantId)),
        db.select().from(restaurantSettings).where(eq(restaurantSettings.restaurantId, restaurantId)).limit(1),
    ]);

    if (!restaurant) throw new BadRequest("Restaurant not found");
    if (!plan) {
        throw new BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }

    if (!restaurant.slug && restaurantName) {
        await db
            .update(restaurants)
            .set({
                slug: restaurantName,
            })
            .where(eq(restaurants.id, restaurant.id));
    }

    return {
        restaurant,
        plan,
        schedulesList,
        settings,
        storedOrderSource,
    };
};

/**
 * Validates operational status, channel availability, cash settings,
 * and determines the default preparing duration.
 */
export const validateOperatingHoursAndChannel = (
    settings: any,
    schedulesList: any[],
    orderType: string,
    isCashPayment: boolean
): OperatingHoursInfo => {
    const validOrderTypes = ["delivery", "takeaway", "dine_in"];
    if (!orderType || !validOrderTypes.includes(orderType)) {
        throw new BadRequest("orderType is required and must be one of: delivery, takeaway, dine_in");
    }
    const resolvedOrderType = orderType as "delivery" | "takeaway" | "dine_in";

    const status = calculateCurrentStatus(settings, schedulesList);

    if (!status.isOpenNow) throw new BadRequest(`Order failed. ${status.reason}`);
    if (resolvedOrderType === "delivery" && !status.canDeliveryNow) {
        throw new BadRequest("Order failed. Delivery service is currently disabled for this restaurant.");
    }
    if (resolvedOrderType === "takeaway" && !status.canTakeawayNow) {
        throw new BadRequest("Order failed. Takeaway service is currently disabled for this restaurant.");
    }

    if (isCashPayment && settings?.cashEnabled === false) {
        throw new BadRequest(
            "Cash payment is not accepted by this restaurant. Please choose a different payment method."
        );
    }

    let defaultPreparingDuration: number;
    if (resolvedOrderType === "takeaway") {
        defaultPreparingDuration = settings?.maxTakeAwayTime ?? 25;
    } else if (resolvedOrderType === "dine_in") {
        defaultPreparingDuration = settings?.maxDineInTime ?? 25;
    } else {
        defaultPreparingDuration = settings?.maxDeliveryTime ?? 25;
    }

    return {
        status,
        defaultPreparingDuration,
        resolvedOrderType,
    };
};
