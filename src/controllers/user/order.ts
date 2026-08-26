// controllers/user/OrderController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import {
    restaurantWallets, restaurantWalletTransactions,
    restaurantZoneDeliveryFees, zoneDeliveryFees, restaurantSettings,
    restaurantSchedules, cartItems, users, addresses, branches,
    userWallets, userWalletTransactions, paymentMethods,
    coupons, couponUsages, couponRestaurants, discounts, discountRestaurants, discountFoods,
    selectReasons,
    orders,
    restaurants,
    orderItems,
    notifications,
    restaurantBusinessPlans, food,
    variationOptions,
    addons,
    zones,
    deliveryMen,
    freeDeliveryOffers
} from "../../models/schema";
import { eq, and, inArray, sql, desc, gte } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { v4 as uuidv4 } from "uuid";
import { UnauthorizedError } from "../../Errors";
import { sendPushNotification } from "../../utils/notifications";
import { calculateDistance, isLocationInZone } from "../../utils/geo";
import { getAvailableDiscounts, applyPriorityDiscount } from "../../utils/discount";
import { validateUserNotBlocked } from "../../utils/userBlockCheck";
import { calculateCurrentStatus } from "./restaurantFeatures";
import * as turf from "@turf/turf";
import { calculateCalculatedPrice, resolveBranchIdFromAddress, type ServiceModule } from "../../helpers/pricing.helper";
import { validateAndCalculateCoupon } from "../../helpers/coupon.helper";

// 👇 1. دالة تظبيط الوقت لتوقيت مصر عشان نص الإشعار
const formatToEgyptTime = (date: Date) => {
    return new Intl.DateTimeFormat("ar-EG", { // غيرتها لـ ar-EG عشان تطلع بالعربي لو حابة
        timeZone: "Africa/Cairo",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    }).format(date);
};

// 🗓️ Helper لتحويل التاريخ لصيغة مقروءة وواضحة
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

// ==========================================
// 1. إنشاء الطلب (Checkout)
// ==========================================
// دالة مساعدة لضمان سلامة العمليات الحسابية المالية

const roundMoney = (amount: number): number => Math.round(amount * 100) / 100;
export const checkout = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;

    const {
        orderSource,
        paymentMethod,
        orderType,
        idempotencyKey,
        zoneId,
        branchId,
        addressId,
        note,
        couponCode
    } = req.body;

    // ==========================================
    // 🛡️ 1. Validation
    // ==========================================
    const validOrderSources = ["online_order_app", "online_order_web", "food_aggregator", "mykeeto", "pos"];
    if (!validOrderSources.includes(orderSource)) {
        throw new BadRequest("Invalid order source");
    }

    const [selectedPayment] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, paymentMethod)).limit(1);
    if (!selectedPayment || !selectedPayment.isActive) {
        throw new BadRequest("Invalid or inactive payment method");
    }
    const paymentMethodName = selectedPayment.name;
    const paymentMethodNameAr = selectedPayment.nameAr;
    const isWalletPayment = paymentMethodName === "wallet" || paymentMethodNameAr === "محفظتى";
    const isCashPayment = paymentMethodName === "cash_on_delivery" || paymentMethodNameAr === "الدفع عند الاستلام" || paymentMethodName === "cash";

    // ==========================================
    // 2. Idempotency Check
    // ==========================================
    if (idempotencyKey) {
        const [existing] = await db.select().from(orders).where(eq(orders.idempotencyKey, idempotencyKey)).limit(1);
        if (existing) return SuccessResponse(res, { message: "Order already processed", data: existing });
    }

    // ==========================================
    // 3. Get Cart Items
    // ==========================================
    const userCart = await db.select().from(cartItems).where(eq(cartItems.userId, userId));
    if (!userCart.length) throw new BadRequest("Your cart is empty");

    const restaurantId = userCart[0].restaurantId;

    // 🛡️ Block check: Verify user is not blocked globally or by this restaurant
    await validateUserNotBlocked(userId, restaurantId);

    // ==========================================
    // 4. Get Restaurant & Business Plan
    // ==========================================
    const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
    if (!restaurant) throw new BadRequest("Restaurant not found");

    const [plan] = await db.select()
        .from(restaurantBusinessPlans)
        .where(
            and(
                eq(restaurantBusinessPlans.restaurantId, restaurantId),
                eq(restaurantBusinessPlans.platformType, orderSource as any)
            )
        )
        .limit(1);

    if (!plan) {
        throw new BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }

    // ==========================================
    // 🛡️ 4.5 فحص مواعيد المطعم وإعدادات التشغيل
    // ==========================================
    const schedulesList = await db.select().from(restaurantSchedules).where(eq(restaurantSchedules.restaurantId, restaurantId));
    const [settings] = await db.select().from(restaurantSettings).where(eq(restaurantSettings.restaurantId, restaurantId)).limit(1);

    const validOrderTypes = ["delivery", "takeaway", "dine_in"];
    if (!orderType || !validOrderTypes.includes(orderType)) {
        throw new BadRequest("orderType is required and must be one of: delivery, takeaway, dine_in");
    }
    const resolvedOrderType = orderType;
    const status = calculateCurrentStatus(settings, schedulesList);

    if (!status.isOpenNow) throw new BadRequest(`Order failed. ${status.reason}`);
    if (resolvedOrderType === "delivery" && !status.canDeliveryNow) throw new BadRequest("Order failed. Delivery service is currently disabled for this restaurant.");
    if (resolvedOrderType === "takeaway" && !status.canTakeawayNow) throw new BadRequest("Order failed. Takeaway service is currently disabled for this restaurant.");

    const defaultPreparingDuration = settings?.maxDeliveryTime ?? 30;

    // ==========================================
    // ⚡ 5. Channel Pricing Engine — Subtotal, Variations & Addons
    // orderType IS the serviceModule (they are the same concept)
    // ==========================================
    const serviceModule = resolvedOrderType as ServiceModule;

    // We need the resolvedBranchId from step 6, but step 6 runs after step 5 in the
    // original flow. We pre-resolve it here so the pricing engine can run first.
    // Branch resolution for pricing purposes (full resolution happens again in step 6 for delivery fee).
    let pricingBranchId: string | null = branchId || null;

    if (resolvedOrderType === "delivery") {
        if (!addressId) throw new BadRequest("Delivery address is required.");
        if (!pricingBranchId) {
            try {
                pricingBranchId = await resolveBranchIdFromAddress(addressId, restaurantId);
            } catch (err: any) {
                const storedBranch = userCart.find(c => c.branchId);
                pricingBranchId = storedBranch?.branchId || null;
            }
        }
    } else {
        // Takeaway / dine_in: branchId is required
        if (!branchId) throw new BadRequest("Branch is required for takeaway or dine-in orders.");
    }

    // Parse cart variations + addons (needed for pricing engine + order items)
    const allAddonIds: string[] = [];
    const cartParsed = userCart.map(item => {
        let safeVars = typeof item.variations === "string" ? JSON.parse(item.variations) : item.variations;
        if (typeof safeVars === "string") safeVars = JSON.parse(safeVars);

        let parsedVariations: any[] = [];
        let parsedAddons: any[] = [];

        if (Array.isArray(safeVars)) {
            parsedVariations = safeVars;
        } else if (safeVars && typeof safeVars === "object") {
            parsedVariations = Array.isArray(safeVars.variations) ? safeVars.variations : [];
            parsedAddons = Array.isArray(safeVars.addons) ? safeVars.addons : [];
        }

        let safeAddons = typeof item.addons === "string" ? JSON.parse(item.addons) : item.addons;
        if (typeof safeAddons === "string") safeAddons = JSON.parse(safeAddons);
        if (Array.isArray(safeAddons)) {
            parsedAddons = [...parsedAddons, ...safeAddons];
        }

        parsedAddons.forEach((a: any) => { if (a.addonId || a.id) allAddonIds.push(a.addonId || a.id); });
        return { cartItem: item, parsedVariations, parsedAddons };
    });

    // Batch fetch addon prices (channel pricing does not cover addons)
    const addonsListDb = allAddonIds.length > 0
        ? await db.select().from(addons).where(inArray(addons.id, [...new Set(allAddonIds)]))
        : [];
    const addonsMap = new Map(addonsListDb.map(a => [a.id, a]));

    // ─── Per-item pricing via 4-tier cascade ────────────────────────────
    let subtotal = 0;
    let initialSubtotal = 0;
    const itemsWithData: any[] = [];
    let checkoutHasUnavailable = false;
    let checkoutPriceChanged = false;
    const priceChangedItems: any[] = [];

    for (const { cartItem, parsedVariations, parsedAddons } of cartParsed) {
        const optionIds = parsedVariations.map((v: any) => v.optionId).filter(Boolean);

        // Resolve addon prices (not covered by channel pricing)
        let addonPrice = 0;
        for (const a of parsedAddons) {
            const addonId = a.addonId || a.id;
            const dbAddon = addonsMap.get(addonId);
            if (dbAddon) {
                const p = parseFloat((dbAddon.price || "0") as string);
                addonPrice += p;
                a.price = p.toString();
            } else {
                addonPrice += parseFloat(a.price || "0");
            }
        }

        let channelBasePrice: number;
        let varPrice: number;
        let itemIsAvailable = true;

        if (pricingBranchId) {
            // ── Channel pricing cascade ──────────────────────────────
            const priceResult = await calculateCalculatedPrice(
                cartItem.foodId,
                optionIds,
                pricingBranchId,
                serviceModule
            );

            channelBasePrice = priceResult.basePrice;
            varPrice = priceResult.variants.reduce((s, v) => s + v.price, 0);
            itemIsAvailable = priceResult.isAvailable;

            // Sync resolved variant prices back into snapshot for order record
            for (const v of parsedVariations) {
                if (v.optionId) {
                    const resolved = priceResult.variants.find(r => r.variantOptionId === v.optionId);
                    if (resolved) v.additionalPrice = resolved.price.toString();
                }
            }

            // Detect price drift vs stored cart snapshot
            const storedUnit = parseFloat(cartItem.unitPrice as string || "0");
            const liveUnit = channelBasePrice + varPrice + addonPrice;
            if (Math.abs(liveUnit - storedUnit) > 0.01) {
                checkoutPriceChanged = true;
                priceChangedItems.push({
                    foodId: cartItem.foodId,
                    oldUnitPrice: storedUnit,
                    newUnitPrice: liveUnit,
                });
            }
        } else {
            // ── Fallback: no channel context — use food.price + option additionalPrice ──
            const [foodRow] = await db.select({ price: food.price, status: food.status, isOutOfStock: food.isOutOfStock })
                .from(food).where(eq(food.id, cartItem.foodId)).limit(1);
            if (!foodRow) throw new BadRequest(`Food item with ID ${cartItem.foodId} not found`);

            channelBasePrice = parseFloat(foodRow.price as string || "0");
            itemIsAvailable = foodRow.status !== "inactive" && !foodRow.isOutOfStock;

            varPrice = 0;
            if (optionIds.length > 0) {
                const opts = await db.select({ id: variationOptions.id, additionalPrice: variationOptions.additionalPrice })
                    .from(variationOptions).where(inArray(variationOptions.id, optionIds));
                const optMap = new Map(opts.map(o => [o.id, o]));
                for (const v of parsedVariations) {
                    if (v.optionId) {
                        const opt = optMap.get(v.optionId);
                        if (opt) { varPrice += parseFloat(opt.additionalPrice as string || "0"); }
                    }
                }
            }
        }

        if (!itemIsAvailable) checkoutHasUnavailable = true;

        // Build initial subtotal for discount engine
        const originalBasePrice = channelBasePrice;
        const foodMeta = await db.select({ id: food.id, discount_type: food.discount_type, discount_value: food.discount_value })
            .from(food).where(eq(food.id, cartItem.foodId)).limit(1);
        const foodItem = foodMeta[0];

        let initialDiscountPrice = originalBasePrice;
        if (foodItem?.discount_value && Number(foodItem.discount_value) > 0) {
            if (foodItem.discount_type === "percentage") {
                initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(foodItem.discount_value) / 100));
            } else if (foodItem.discount_type === "amount" || foodItem.discount_type === "fixed") {
                initialDiscountPrice = Math.max(0, originalBasePrice - Number(foodItem.discount_value));
            }
        }

        initialSubtotal += (initialDiscountPrice + varPrice + addonPrice) * cartItem.quantity;
        itemsWithData.push({
            cartItem,
            foodItem,
            originalBasePrice,
            varPrice,
            addonPrice,
            vars: parsedVariations,
            addonsList: parsedAddons,
            itemIsAvailable,
        });
    }

    // ─── 422: Unavailable items guard ────────────────────────────────────
    if (checkoutHasUnavailable) {
        return res.status(422).json({
            success: false,
            message: "One or more items in your cart are unavailable. Please review your cart before placing the order.",
            data: {
                unavailableItems: itemsWithData
                    .filter(d => !d.itemIsAvailable)
                    .map(d => ({ foodId: d.cartItem.foodId })),
            },
        });
    }

    // ─── 409: Price drift guard ───────────────────────────────────────────
    if (checkoutPriceChanged) {
        return res.status(409).json({
            success: false,
            message: "Prices have changed since you added items to your cart. Please review the updated prices and re-confirm your order.",
            data: {
                isPriceChanged: true,
                changedItems: priceChangedItems,
            },
        });
    }

    const availableDiscounts = await getAvailableDiscounts(restaurantId);
    const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };
    const itemsToInsert: any[] = [];

    for (const data of itemsWithData) {
        const { cartItem, foodItem, originalBasePrice, varPrice, addonPrice, vars, addonsList } = data;

        const { price: discountedBasePrice } = applyPriorityDiscount(
            { id: foodItem.id, discountType: foodItem.discount_type, discountValue: foodItem.discount_value },
            originalBasePrice,
            initialSubtotal,
            availableDiscounts,
            discountState,
            true
        );

        const itemTotal = roundMoney((discountedBasePrice + varPrice + addonPrice) * cartItem.quantity);
        subtotal += itemTotal;

        itemsToInsert.push({
            id: uuidv4(),
            foodId: cartItem.foodId,
            quantity: cartItem.quantity,
            basePrice: discountedBasePrice.toFixed(2),
            variationsPrice: varPrice.toFixed(2),
            addonsPrice: addonPrice.toFixed(2),
            totalPrice: itemTotal.toFixed(2),
            variations: vars,
            addons: addonsList,
            note: cartItem.note || null,
        });
    }

    subtotal = roundMoney(subtotal);

    // ==========================================
    // 5.2 Fees & Commission
    // ==========================================
    const serviceFee = parseFloat(plan.serviceFee as string || "0");
    const commissionRate = parseFloat(plan.commissionRate as string || "0");
    const appCommission = roundMoney(subtotal * (commissionRate / 100));

    // ==========================================
    // 5.5 Check Coupons (Unified Engine)
    // ==========================================
    let totalDiscount = 0;
    let appliedCoupon: any = null;
    let isFreeDelivery = false;

    if (couponCode) {
        const couponResult = await validateAndCalculateCoupon(
            couponCode,
            userId,
            restaurantId,
            subtotal,
            0 // Delivery fee is resolved in step 6; if free_delivery, isFreeDelivery flag is set
        );

        appliedCoupon = couponResult.coupon;
        totalDiscount = couponResult.discountAmount;
        isFreeDelivery = couponResult.isFreeDelivery;
    }

    totalDiscount = roundMoney(totalDiscount);

    // ==========================================
    // 6. Dynamic Delivery & Turf Zone Logic (Updated)
    // ==========================================
    let deliveryFee = 0;
    let resolvedZoneId: string | null = zoneId || null;
    let resolvedBranchId: string | null = branchId || null;

    if (resolvedOrderType === "delivery") {
        if (!addressId) throw new BadRequest("Delivery address is required");

        const [userAddress] = await db.select().from(addresses)
            .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId))).limit(1);
        if (!userAddress) throw new BadRequest("Invalid delivery address");

        const lat = parseFloat(userAddress.lat as string || "0");
        const lng = parseFloat(userAddress.lng as string || "0");

        if (!lat || !lng) {
            throw new BadRequest("Delivery address requires valid latitude and longitude coordinates.");
        }

        // Fetch all active delivery fees for this restaurant (including branchId)
        const restaurantFees = await db.select({
            id: restaurantZoneDeliveryFees.id,
            zoneId: restaurantZoneDeliveryFees.zoneId,
            branchId: restaurantZoneDeliveryFees.branchId,
            deliveryFee: restaurantZoneDeliveryFees.deliveryFee,
            coverageType: restaurantZoneDeliveryFees.coverageType,
            customCoordinates: restaurantZoneDeliveryFees.customCoordinates,
            customRadiusKm: restaurantZoneDeliveryFees.customRadiusKm,
            defaultCoordinates: zones.coordinates,
            defaultRadiusKm: zones.coverageAreaRadiusKm
        })
            .from(restaurantZoneDeliveryFees)
            .leftJoin(zones, eq(restaurantZoneDeliveryFees.zoneId, zones.id))
            .where(
                and(
                    eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
                    eq(restaurantZoneDeliveryFees.status, "active"),
                    branchId ? eq(restaurantZoneDeliveryFees.branchId, branchId) : undefined
                )
            );

        let applicableFee: any = null;
        let maxDeliveryFee = -1;

        for (const fee of restaurantFees) {
            if (isLocationInZone(lat, lng, fee.zoneId, fee)) {
                const currentFee = parseFloat(fee.deliveryFee as string || "0");
                if (currentFee > maxDeliveryFee) {
                    maxDeliveryFee = currentFee;
                    applicableFee = fee;
                }
            }
        }

        if (!applicableFee) {
            throw new BadRequest("Your delivery address is outside our covered delivery zones.");
        }

        const genericZoneId = applicableFee.zoneId;
        resolvedZoneId = applicableFee.id; // 👈 حفظ id الخاص بـ restaurantZoneDeliveryFees في الـ order
        if (!resolvedZoneId) {
            throw new BadRequest("No delivery zone found for this address.");
        }
        deliveryFee = parseFloat(applicableFee.deliveryFee as string || "0");

        // 🏪 تحديد/التحقق من الفرع المخصص للـ Delivery
        if (applicableFee.branchId) {
            resolvedBranchId = applicableFee.branchId;
        } else if (branchId) {
            const [selectedBranch] = await db.select({ id: branches.id })
                .from(branches)
                .where(
                    and(
                        eq(branches.id, branchId),
                        eq(branches.restaurantId, restaurantId),
                        eq(branches.status, "active")
                    )
                )
                .limit(1);

            if (!selectedBranch) {
                throw new BadRequest("Selected branch not found or inactive.");
            }
            resolvedBranchId = selectedBranch.id;
        } else {
            const [matchedBranch] = await db.select({ id: branches.id })
                .from(branches)
                .where(
                    and(
                        eq(branches.restaurantId, restaurantId),
                        eq(branches.zoneId, genericZoneId),
                        eq(branches.status, "active")
                    )
                )
                .limit(1);

            if (!matchedBranch) {
                throw new BadRequest("No active branch found serving your delivery zone.");
            }

            resolvedBranchId = matchedBranch.id;
        }
    } else {
        // For takeaway or dine_in: branchId is required (already validated in step 5)
        if (!branchId) throw new BadRequest("Branch is required for takeaway or dine-in orders.");

        const [branch] = await db.select({ id: branches.id, zoneId: branches.zoneId })
            .from(branches)
            .where(
                and(
                    eq(branches.id, branchId),
                    eq(branches.restaurantId, restaurantId),
                    eq(branches.status, "active")
                )
            )
            .limit(1);

        if (!branch) throw new BadRequest("Invalid or inactive branch selected.");

        resolvedBranchId = branch.id;
        resolvedZoneId = branch.zoneId;
    }

    const calculatedDeliveryFee = deliveryFee;
    if (isFreeDelivery) deliveryFee = 0;

    // ==========================================
    // 6.5 Free Delivery Offer Check (schema-based)
    // ==========================================
    if (!isFreeDelivery && resolvedOrderType === "delivery") {
        const nowForOffer = new Date();
        const [freeDeliveryOffer] = await db
            .select()
            .from(freeDeliveryOffers)
            .where(
                and(
                    eq(freeDeliveryOffers.restaurantId, restaurantId),
                    eq(freeDeliveryOffers.status, "active")
                )
            )
            .limit(1);

        if (freeDeliveryOffer) {
            const startOk = !freeDeliveryOffer.startDate || new Date(freeDeliveryOffer.startDate) <= nowForOffer;
            const endOk = !freeDeliveryOffer.endDate || new Date(freeDeliveryOffer.endDate) >= nowForOffer;
            const minAmount = parseFloat(freeDeliveryOffer.minOrderAmount as string || "0");

            if (startOk && endOk && subtotal >= minAmount) {
                isFreeDelivery = true;
                deliveryFee = 0;
            }
        }
    }

    let totalAmount = roundMoney(subtotal + deliveryFee + serviceFee - totalDiscount);
    if (totalAmount < 0) totalAmount = 0;

    const orderId = uuidv4();
    const orderNumber = `ORD-${Date.now()}`;

    const [userInfo] = await db.select({ id: users.id, name: users.name, phone: users.phone, email: users.email })
        .from(users).where(eq(users.id, userId)).limit(1);

    // ==========================================
    // 🛡️ 10. Execute Order (Transaction)
    // ==========================================
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    let createdDailyOrderNumber = 1;

    await db.transaction(async (tx) => {
        // 🔒 1. Wallet deduction with FOR UPDATE
        if (isWalletPayment) {
            const [userWallet] = await tx.select()
                .from(userWallets)
                .where(eq(userWallets.userId, userId))
                .for("update");

            const currentBalance = parseFloat(userWallet?.balance as string || "0");
            if (!userWallet || currentBalance < totalAmount) {
                throw new BadRequest("Insufficient wallet balance");
            }

            const newBalance = roundMoney(currentBalance - totalAmount);

            await tx.update(userWallets)
                .set({ balance: newBalance.toFixed(2) })
                .where(eq(userWallets.userId, userId));

            await tx.insert(userWalletTransactions).values({
                id: uuidv4(),
                userId,
                type: "debit",
                transactionType: "order_payment",
                amount: totalAmount.toFixed(2),
                balanceBefore: currentBalance.toFixed(2),
                reference: orderNumber,
                status: "approved",
                createdAt: now
            });
        }

        // 🔒 2. Daily order number calculation
        const [ordersCountResult] = await tx
            .select({ count: sql<number>`count(${orders.id})` })
            .from(orders)
            .where(
                and(
                    eq(orders.restaurantId, restaurantId),
                    gte(orders.createdAt, startOfToday)
                )
            );

        createdDailyOrderNumber = Number(ordersCountResult?.count || 0) + 1;

        // 3. Create order record
        await tx.insert(orders).values({
            id: orderId,
            orderNumber,
            idempotencyKey,
            userId,
            restaurantId,
            branchId: resolvedBranchId,
            zoneId: resolvedZoneId,
            addressId: addressId || null,
            orderSource,
            paymentMethod,
            orderType: resolvedOrderType,
            subtotal: subtotal.toFixed(2),
            deliveryFee: deliveryFee.toFixed(2),
            serviceFee: serviceFee.toFixed(2),
            appCommission: appCommission.toFixed(2),
            discountAmount: totalDiscount.toFixed(2),
            couponCode: couponCode || null,
            totalAmount: totalAmount.toFixed(2),
            note: note || null,
            status: "pending",
            dailyOrderNumber: createdDailyOrderNumber,
            durationOrderPreparing: defaultPreparingDuration,
            createdAt: now
        });

        await tx.insert(orderItems).values(itemsToInsert.map(i => ({ ...i, orderId })));
        await tx.delete(cartItems).where(eq(cartItems.userId, userId));

        // Superadmin notification
        await tx.insert(notifications).values({
            recipientType: "superadmin",
            recipientId: "superadmin",
            title: "New Order",
            body: `Order #${createdDailyOrderNumber} has been placed at ${restaurant?.name}.`,
            data: { orderId, orderNumber, createdDailyOrderNumber, restaurantName: restaurant?.name }
        });

        // 4. Coupons and Discounts tracking
        if (appliedCoupon) {
            await tx.insert(couponUsages).values({
                id: uuidv4(),
                couponId: appliedCoupon.id,
                userId,
                orderId,
                discountAmount: appliedCoupon.discountType === "free_delivery"
                    ? calculatedDeliveryFee.toFixed(2)
                    : totalDiscount.toFixed(2)
            });

            await tx.update(coupons)
                .set({ usedCount: sql`used_count + 1` })
                .where(eq(coupons.id, appliedCoupon.id));
        }

        if (discountState.appliedDiscounts.size > 0) {
            for (const dId of Array.from(discountState.appliedDiscounts)) {
                await tx.update(discounts)
                    .set({ usedCount: sql`used_count + 1` })
                    .where(eq(discounts.id, dId));
            }
        }

        // 5. Restaurant wallet calculations
        let [restaurantWallet] = await tx.select().from(restaurantWallets).where(eq(restaurantWallets.restaurantId, restaurantId)).for("update");

        if (!restaurantWallet) {
            await tx.insert(restaurantWallets).values({
                id: uuidv4(),
                restaurantId: restaurantId,
                balance: "0.00",
                collectedCash: "0.00",
                totalEarning: "0.00"
            });
            restaurantWallet = { balance: "0.00", collectedCash: "0.00", totalEarning: "0.00" } as any;
        }

        const currentRestBalance = parseFloat(restaurantWallet.balance as string);
        const currentCollectedCash = parseFloat(restaurantWallet.collectedCash as string);
        const currentTotalEarning = parseFloat(restaurantWallet.totalEarning as string);

        const restaurantEarning = roundMoney(subtotal + deliveryFee - appCommission);
        const appDues = roundMoney(appCommission + serviceFee);

        let newRestBalance = currentRestBalance;
        let newCollectedCash = currentCollectedCash;

        if (isCashPayment) {
            newRestBalance = roundMoney(newRestBalance - appDues);
            newCollectedCash = roundMoney(newCollectedCash + totalAmount);
        } else {
            newRestBalance = roundMoney(newRestBalance + restaurantEarning);
        }

        await tx.update(restaurantWallets)
            .set({
                balance: newRestBalance.toFixed(2),
                collectedCash: newCollectedCash.toFixed(2),
                totalEarning: roundMoney(currentTotalEarning + restaurantEarning).toFixed(2)
            })
            .where(eq(restaurantWallets.restaurantId, restaurantId));

        await tx.insert(restaurantWalletTransactions).values({
            id: uuidv4(),
            restaurantId,
            type: "order_payment",
            amount: isCashPayment ? `-${appDues.toFixed(2)}` : `${restaurantEarning.toFixed(2)}`,
            balanceBefore: currentRestBalance.toFixed(2),
            balanceAfter: newRestBalance.toFixed(2),
            method: paymentMethodName,
            reference: orderNumber,
            note: isCashPayment ? "Commission deducted from cash order" : "Earnings added from digital payment",
            createdAt: now
        });
    });

    // ==========================================
    // 11. Send Notification to Restaurant
    // ==========================================
    const cairoTimeFormatted = new Intl.DateTimeFormat("ar-EG", {
        timeZone: "Africa/Cairo",
        hour: "numeric",
        minute: "numeric",
        hour12: true
    }).format(now);

    await sendPushNotification({
        recipientType: "restaurant",
        recipientId: restaurantId,
        branchId: resolvedBranchId || null,
        title: "طلب جديد! 🛒",
        body: `تم استلام طلب جديد #${createdDailyOrderNumber} بقيمة ${totalAmount} ج.م الساعة ${cairoTimeFormatted}.`,
        data: {
            orderId,
            orderNumber,
            branchId: resolvedBranchId || null,
            type: "new_order",
            createdAt: now.toISOString(),
            dailyOrderNumber: createdDailyOrderNumber
        }
    });

    return SuccessResponse(res, {
        message: "Order created successfully",
        order_level: {
            orderDetails: {
                orderId,
                orderNumber,
                zoneId: resolvedZoneId,
                subtotal,
                deliveryFee,
                serviceFee,
                discountAmount: totalDiscount,
                couponCode: couponCode || null,
                totalAmount,
                createdAt: now.toISOString(),
                dailyOrderNumber: createdDailyOrderNumber,
                durationOrderPreparing: defaultPreparingDuration,
            },
            customerDetails: userInfo
        }
    });
};
// ==========================================
// 2. جلب الطلبات النشطة (الحالية)
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
            cancelReasonType: selectReasons.type,
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
            addons: orderItems.addons
        })
            .from(orderItems)
            .leftJoin(food, eq(orderItems.foodId, food.id))
            .where(inArray(orderItems.orderId, orderIds));
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
// 3. جلب سجل الطلبات (History) - المكتملة والملغية
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
            cancelReasonType: selectReasons.type,
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
            addons: orderItems.addons
        })
            .from(orderItems)
            .leftJoin(food, eq(orderItems.foodId, food.id))
            .where(inArray(orderItems.orderId, orderIds));
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
// 4. تفاصيل الطلب (Order Details)
// ==========================================
export const getOrderDetails = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;

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
            cancelReasonType: selectReasons.type,
        })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(paymentMethods, eq(orders.paymentMethod, paymentMethods.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(addresses, eq(orders.addressId, addresses.id))
        .leftJoin(deliveryMen, eq(orders.deliveryManId, deliveryMen.id))
        .leftJoin(selectReasons, eq(orders.cancelReasonId, selectReasons.id))
        .where(eq(orders.id, orderId))
        .limit(1);

    if (!orderInfo.length) {
        throw new NotFound("Order not found");
    }

    const o = orderInfo[0];

    const items = await db
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
            addons: orderItems.addons
        })
        .from(orderItems)
        .leftJoin(food, eq(orderItems.foodId, food.id))
        .where(eq(orderItems.orderId, orderId));

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
            items
        }
    });
};

// ==========================================
// 5. متطلبات الطلب المسبقة (Order Prerequisites)
// ==========================================
export const getOrderPrerequisites = async (req: Request | any, res: Response) => {
    if (!req.user) {
        throw new UnauthorizedError("Unauthenticated: Token is missing or invalid");
    }

    const userId = req.user.id;
    const restaurantId = req.query.restaurantId as string;
    const orderSource = req.query.orderSource as string;

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
        zoneFees,
        activePaymentMethods,
        getCancelReasons,
        businessPlans,
        freeDeliveryOfferRows
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
            deliveryFee: restaurantZoneDeliveryFees.deliveryFee,
            coverageType: restaurantZoneDeliveryFees.coverageType,
            customCoordinates: restaurantZoneDeliveryFees.customCoordinates,
            customRadiusKm: restaurantZoneDeliveryFees.customRadiusKm,
            defaultCoordinates: zones.coordinates,
            defaultRadiusKm: zones.coverageAreaRadiusKm,
        })
            .from(restaurantZoneDeliveryFees)
            .leftJoin(zones, eq(restaurantZoneDeliveryFees.zoneId, zones.id))
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
                    eq(restaurantBusinessPlans.platformType, orderSource as any)
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
            .limit(1)
    ]);

    const plan = businessPlans[0];
    if (!plan) {
        throw new BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }

    // 2. معالجة كل عنوان عند المستخدم ومعرفة هل هو قابل للتوصيل ومعرفة zoneId الخاص به
    const addressesWithDeliveryInfo = userAddresses.map((addr) => {
        let isDeliverable = false;
        let applicableDeliveryFee: number | null = null;
        let matchedZoneId: string | null = null; // 👈 generic zoneId
        let matchedRestaurantDeliveryZoneId: string | null = null; // 👈 restaurantZoneDeliveryFees.id

        const addrLat = parseFloat(addr.lat || "0");
        const addrLng = parseFloat(addr.lng || "0");

        // لو العنوان مفيش فيه إحداثيات سليمة
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
                isDeliverable = true;
                const currentFee = parseFloat((fee.deliveryFee || "0") as string);

                // 🚀 اختيار السعر الأعلى والـ zoneId التابع له في حالة مطابقة أكثر من نطاق
                if (applicableDeliveryFee === null || currentFee > applicableDeliveryFee) {
                    applicableDeliveryFee = currentFee;
                    matchedZoneId = fee.zoneId;
                    matchedRestaurantDeliveryZoneId = fee.id; // 👈 تحديث id الخاص بنطاق المطعم
                }
            }
        }

        return {
            ...addr,
            isDeliverable,
            deliveryFee: applicableDeliveryFee,
            // restaurantDeliveryZoneId: matchedRestaurantDeliveryZoneId, // 👈 id الخاص بنطاق المطعم (restaurantZoneDeliveryFees)
            //zoneId: matchedZoneId, // 👈 إرجاع zoneId داخل العنوان
            zoneId: matchedRestaurantDeliveryZoneId, // 👈 generic zoneId
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
    } | null = null;

    if (activeFreeDeliveryOffer) {
        const startOk = !activeFreeDeliveryOffer.startDate || new Date(activeFreeDeliveryOffer.startDate) <= nowForPrereq;
        const endOk = !activeFreeDeliveryOffer.endDate || new Date(activeFreeDeliveryOffer.endDate) >= nowForPrereq;
        if (startOk && endOk) {
            freeDeliveryOfferData = {
                minOrderAmount: parseFloat(activeFreeDeliveryOffer.minOrderAmount as string || "0"),
                startDate: activeFreeDeliveryOffer.startDate ? activeFreeDeliveryOffer.startDate.toISOString() : null,
                endDate: activeFreeDeliveryOffer.endDate ? activeFreeDeliveryOffer.endDate.toISOString() : null,
            };
        }
    }

    return SuccessResponse(res, {
        data: {
            addresses: addressesWithDeliveryInfo,
            branches: restaurantBranches,
            zones: zoneFees, // 👈 إرجاع مناطق التوصيل وأسعارها الخاصة بالمطعم
            paymentMethods: activePaymentMethods,
            reasons: getCancelReasons,
            serviceFee: serviceFee.toFixed(2),
            freeDeliveryOffer: freeDeliveryOfferData,
        }
    });
};

// ==========================================
// 6. إلغاء الطلب من قبل المستخدم (Cancel Order)
// ==========================================
export const cancelOrder = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;
    const { cancelReasonId } = req.body;

    if (!cancelReasonId) throw new BadRequest("Cancel reason ID is required");

    // 1. جلب الطلب والتأكد أنه للمستخدم وأنه قابل للإلغاء
    const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).limit(1);
    if (!order) throw new NotFound("Order not found");
    if (!["pending", "accepted"].includes(order.status as string)) {
        throw new BadRequest("Order cannot be cancelled at this stage");
    }

    // 2. التحقق من سبب الإلغاء
    const [reason] = await db.select().from(selectReasons).where(and(eq(selectReasons.id, cancelReasonId), eq(selectReasons.type, "user"))).limit(1);
    if (!reason) throw new BadRequest("Invalid cancel reason for user");

    // 3. تحديث حالة الطلب وإرجاع المبالغ المالية (إلغاء أرباح المطعم والعمولة)
    await db.transaction(async (tx) => {
        // تحديث الطلب
        await tx.update(orders)
            .set({
                status: "cancelled",
                cancelReasonId: reason.id,
                cancelReason: reason.name
            })
            .where(eq(orders.id, orderId));

        // حسابات المبالغ التي تم دفعها أو خصمها
        const totalAmount = parseFloat(order.totalAmount as string || "0");
        const appCommission = parseFloat(order.appCommission as string || "0");
        const serviceFee = parseFloat(order.serviceFee as string || "0");
        const subtotal = parseFloat(order.subtotal as string || "0");
        const deliveryFee = parseFloat(order.deliveryFee as string || "0");
        const appDues = appCommission + serviceFee;
        const restaurantEarning = subtotal + deliveryFee - appCommission;

        const isCashPayment = order.paymentMethod === "cash_on_delivery" || order.paymentMethod === "cash"; // Assuming ID handling elsewhere or this is resolved

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

        // إرجاع الفلوس/العمولات من المطعم (حيث أن الإلغاء من المستخدم، المطعم لا يتحمل العمولة)
        const [restaurantWallet] = await tx.select().from(restaurantWallets).where(eq(restaurantWallets.restaurantId, order.restaurantId)).limit(1);
        if (restaurantWallet) {
            let currentRestBalance = parseFloat(restaurantWallet.balance as string || "0");
            let currentCollectedCash = parseFloat(restaurantWallet.collectedCash as string || "0");
            let currentTotalEarning = parseFloat(restaurantWallet.totalEarning as string || "0");

            if (isCashPayment) {
                // نلغي خصم العمولة من رصيد المطعم، ونلغي الكاش المحصل
                currentRestBalance += appDues;
                currentCollectedCash -= totalAmount;
            } else {
                // نلغي الأرباح اللي انضافت للمطعم
                currentRestBalance -= restaurantEarning;
            }

            await tx.update(restaurantWallets)
                .set({
                    balance: currentRestBalance.toString(),
                    collectedCash: currentCollectedCash.toString(),
                    totalEarning: (currentTotalEarning - restaurantEarning).toString()
                })
                .where(eq(restaurantWallets.restaurantId, order.restaurantId));

            // تسجيل العملية
            await tx.insert(restaurantWalletTransactions).values({
                id: uuidv4(),
                restaurantId: order.restaurantId,
                type: "order_payment", // Or create a new type "refund"
                amount: isCashPayment ? `${appDues}` : `-${restaurantEarning}`,
                balanceBefore: restaurantWallet.balance as string,
                balanceAfter: currentRestBalance.toString(),
                method: order.paymentMethod,
                reference: order.orderNumber,
                note: "Refund/Revert due to user cancellation"
            });
        }
    });

    // 4. إرسال إشعارات إلغاء الطلب (Type: cancel)
    await sendPushNotification({
        recipientType: "restaurant",
        recipientId: order.restaurantId,
        branchId: order.branchId || null,
        title: "إلغاء الطلب ❌",
        body: `تم إلغاء الطلب #${order.dailyOrderNumber} من قبل العميل. السبب: ${reason.name}`,
        data: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            dailyOrderNumber: order.dailyOrderNumber,
            branchId: order.branchId || null,
            type: "cancel",
            reason: reason.name
        }
    });

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

