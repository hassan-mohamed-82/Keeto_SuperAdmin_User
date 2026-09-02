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
    freeDeliveryOffers,
    branchSubcategories,
    foodVariations,
    userRestaurantPoints,
    cities
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
        return { item, cleanVariations };
    });

    const allOldOptionIds = new Set<string>();
    for (const { cleanVariations } of parsedItems) {
        if (Array.isArray(cleanVariations) && cleanVariations.length > 0) {
            const hasFullDetails = cleanVariations.every((v: any) => v.variationName && v.optionName);
            if (!hasFullDetails) {
                for (const v of cleanVariations) {
                    const optId = v.optionId || v.id;
                    if (optId) {
                        allOldOptionIds.add(optId);
                    }
                }
            }
        }
    }

    const optionsMap = new Map<string, any>();
    if (allOldOptionIds.size > 0) {
        const optionsWithParent = await db
            .select({
                optionId: variationOptions.id,
                optionName: variationOptions.optionName,
                optionNameAr: variationOptions.optionNameAr,
                optionNameFr: variationOptions.optionNameFr,
                additionalPrice: variationOptions.additionalPrice,
                variationId: foodVariations.id,
                variationName: foodVariations.name,
                variationNameAr: foodVariations.nameAr,
                variationNameFr: foodVariations.nameFr,
            })
            .from(variationOptions)
            .leftJoin(foodVariations, eq(variationOptions.variationId, foodVariations.id))
            .where(inArray(variationOptions.id, Array.from(allOldOptionIds)));

        for (const opt of optionsWithParent) {
            optionsMap.set(opt.optionId, opt);
        }
    }

    return parsedItems.map(({ item, cleanVariations }) => {
        let variationDetails: any[] = [];
        if (Array.isArray(cleanVariations) && cleanVariations.length > 0) {
            const hasFullDetails = cleanVariations.every((v: any) => v.variationName && v.optionName);
            if (hasFullDetails) {
                variationDetails = cleanVariations.map((v: any) => ({
                    optionId: v.optionId,
                    optionName: v.optionName,
                    optionNameAr: v.optionNameAr,
                    optionNameFr: v.optionNameFr || '',
                    additionalPrice: v.price || v.additionalPrice || '0',
                    variationId: v.variationId,
                    variationName: v.variationName,
                    variationNameAr: v.variationNameAr,
                    variationNameFr: v.variationNameFr || '',
                }));
            } else {
                for (const v of cleanVariations) {
                    const optId = v.optionId || v.id;
                    const optDetails = optId ? optionsMap.get(optId) : null;
                    if (optDetails) {
                        variationDetails.push(optDetails);
                    }
                }
            }
        }
        return {
            ...item,
            variations: variationDetails
        };
    });
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
    // 3. Get Cart Items & User Verification (Parallelized)
    // ==========================================
    const userCart = await db.select().from(cartItems).where(eq(cartItems.userId, userId));
    if (!userCart.length) throw new BadRequest("Your cart is empty");

    const restaurantId = userCart[0].restaurantId;

    // Run block check in parallel with cart retrieval setup
    await validateUserNotBlocked(userId, restaurantId);

    // ==========================================
    // 4. Get Restaurant, Business Plan, Schedules & Settings (Parallelized)
    // ==========================================
    const [
        [restaurant],
        [plan],
        schedulesList,
        [settings]
    ] = await Promise.all([
        db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1),
        db.select()
            .from(restaurantBusinessPlans)
            .where(
                and(
                    eq(restaurantBusinessPlans.restaurantId, restaurantId),
                    eq(restaurantBusinessPlans.platformType, orderSource as any)
                )
            )
            .limit(1),
        db.select().from(restaurantSchedules).where(eq(restaurantSchedules.restaurantId, restaurantId)),
        db.select().from(restaurantSettings).where(eq(restaurantSettings.restaurantId, restaurantId)).limit(1)
    ]);

    if (!restaurant) throw new BadRequest("Restaurant not found");
    if (!plan) {
        throw new BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }

    // ==========================================
    // 🛡️ 4.5 Operating Hours & Channel Validation
    // ==========================================
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

    // ─── Subcategory-branch availability guard ──────────────────────────
    // Block checkout if any cart item belongs to a subcategory that is
    // inactive at the resolved branch (independent of food-level locks)
    if (pricingBranchId) {
        const cartFoodIds = userCart.map(c => c.foodId).filter(Boolean) as string[];
        const cartFoods = cartFoodIds.length > 0
            ? await db
                .select({ id: food.id, subcategoryid: food.subcategoryid })
                .from(food)
                .where(inArray(food.id, cartFoodIds))
            : [];

        const subcatIdsInCart = [...new Set(cartFoods.map(f => f.subcategoryid).filter(Boolean))] as string[];

        if (subcatIdsInCart.length > 0) {
            const inactiveSubcats = await db
                .select({ subcategoryId: branchSubcategories.subcategoryId })
                .from(branchSubcategories)
                .where(and(
                    eq(branchSubcategories.branchId, pricingBranchId),
                    inArray(branchSubcategories.subcategoryId, subcatIdsInCart),
                    eq(branchSubcategories.status, "inactive")
                ));

            if (inactiveSubcats.length > 0) {
                const inactiveSet = new Set(inactiveSubcats.map(r => r.subcategoryId));
                const blockedFoodIds = cartFoods
                    .filter(f => f.subcategoryid && inactiveSet.has(f.subcategoryid))
                    .map(f => f.id);

                return res.status(422).json({
                    success: false,
                    message: "One or more items in your cart are not available at the selected branch or location.",
                    data: {
                        unavailableItems: blockedFoodIds.map(foodId => ({ foodId })),
                    },
                });
            }
        }
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

    // Batch fetch variation details for snapshot storage
    const allCheckoutOptionIds = new Set<string>();
    for (const { parsedVariations } of cartParsed) {
        for (const v of parsedVariations) {
            if (v.optionId) {
                allCheckoutOptionIds.add(v.optionId);
            }
        }
    }

    const uniqueFoodIds = [...new Set(userCart.map(c => c.foodId))];

    const [optionsWithParent, addonsListDb, foodItemsDb] = await Promise.all([
        allCheckoutOptionIds.size > 0
            ? db
                .select({
                    optionId: variationOptions.id,
                    optionName: variationOptions.optionName,
                    optionNameAr: variationOptions.optionNameAr,
                    optionNameFr: variationOptions.optionNameFr,
                    additionalPrice: variationOptions.additionalPrice,
                    variationId: foodVariations.id,
                    variationName: foodVariations.name,
                    variationNameAr: foodVariations.nameAr,
                    variationNameFr: foodVariations.nameFr,
                })
                .from(variationOptions)
                .leftJoin(foodVariations, eq(variationOptions.variationId, foodVariations.id))
                .where(inArray(variationOptions.id, Array.from(allCheckoutOptionIds)))
            : [],
        allAddonIds.length > 0
            ? db.select().from(addons).where(inArray(addons.id, [...new Set(allAddonIds)]))
            : [],
        uniqueFoodIds.length > 0
            ? db.select({ id: food.id, price: food.price, status: food.status, isOutOfStock: food.isOutOfStock, discount_type: food.discount_type, discount_value: food.discount_value })
                .from(food).where(inArray(food.id, uniqueFoodIds))
            : []
    ]);

    const optionsWithParentMap = new Map(optionsWithParent.map(o => [o.optionId, o]));
    const addonsMap = new Map(addonsListDb.map(a => [a.id, a]));
    const foodMap = new Map(foodItemsDb.map(f => [f.id, f]));

    // ─── Calculate pricing per item ───
    let subtotal = 0;
    let initialSubtotal = 0;
    const itemsWithData: any[] = [];
    let checkoutHasUnavailable = false;
    let checkoutPriceChanged = false;
    const priceChangedItems: any[] = [];
    let hasFoodLevelDiscount = false;

    for (const { cartItem, parsedVariations, parsedAddons } of cartParsed) {
        const optionIds = parsedVariations.map((v: any) => v.optionId).filter(Boolean);

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
            const priceResult = await calculateCalculatedPrice(
                cartItem.foodId,
                optionIds,
                pricingBranchId,
                serviceModule
            );

            channelBasePrice = priceResult.basePrice;
            varPrice = priceResult.variants.reduce((s, v) => s + v.price, 0);
            itemIsAvailable = priceResult.isAvailable;

            for (const v of parsedVariations) {
                if (v.optionId) {
                    const resolved = priceResult.variants.find(r => r.variantOptionId === v.optionId);
                    if (resolved) v.additionalPrice = resolved.price.toString();
                }
            }

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
            const foodRow = foodMap.get(cartItem.foodId);
            if (!foodRow) throw new BadRequest(`Food item with ID ${cartItem.foodId} not found`);

            channelBasePrice = parseFloat(foodRow.price as string || "0");
            itemIsAvailable = foodRow.status !== "inactive" && !foodRow.isOutOfStock;

            varPrice = 0;
            if (optionIds.length > 0) {
                for (const v of parsedVariations) {
                    if (v.optionId) {
                        const opt = optionsWithParentMap.get(v.optionId);
                        if (opt) {
                            const resolvedPrice = (opt.additionalPrice as string || "0");
                            varPrice += parseFloat(resolvedPrice);
                            v.additionalPrice = resolvedPrice;
                        }
                    }
                }
            }
        }

        if (!itemIsAvailable) checkoutHasUnavailable = true;

        const originalBasePrice = channelBasePrice;
        const foodItem = foodMap.get(cartItem.foodId);

        let initialDiscountPrice = originalBasePrice;
        if (foodItem?.discount_value && Number(foodItem.discount_value) > 0) {
            hasFoodLevelDiscount = true;
            if (foodItem.discount_type === "percentage") {
                initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(foodItem.discount_value) / 100));
            } else if (foodItem.discount_type === "amount" || foodItem.discount_type === "fixed") {
                initialDiscountPrice = Math.max(0, originalBasePrice - Number(foodItem.discount_value));
            }
        }

        initialSubtotal += (initialDiscountPrice + varPrice + addonPrice) * cartItem.quantity;

        const detailedVariations = parsedVariations.map((v: any) => {
            const optDetails = optionsWithParentMap.get(v.optionId);
            const resolvedPrice = (optDetails?.additionalPrice ?? v.additionalPrice ?? v.price ?? "0.00");

            return {
                variationId: optDetails?.variationId ?? v.variationId ?? null,
                variationName: optDetails?.variationName ?? v.variationName ?? null,
                variationNameAr: optDetails?.variationNameAr ?? v.variationNameAr ?? null,
                variationNameFr: optDetails?.variationNameFr ?? v.variationNameFr ?? null,
                optionId: optDetails?.optionId ?? v.optionId ?? null,
                optionName: optDetails?.optionName ?? v.optionName ?? null,
                optionNameAr: optDetails?.optionNameAr ?? v.optionNameAr ?? null,
                optionNameFr: optDetails?.optionNameFr ?? v.optionNameFr ?? null,
                price: Number(resolvedPrice).toFixed(2)
            };
        });

        const hasMissingDetails = detailedVariations.some(v => !v.variationName && !v.optionName);

        if (hasMissingDetails) {
            return res.status(422).json({
                success: false,
                message: "Some selected options are no longer available. Please refresh your cart.",
                data: {
                    affectedFoodId: cartItem.foodId,
                },
            });
        }

        itemsWithData.push({
            cartItem,
            foodItem,
            originalBasePrice,
            varPrice,
            addonPrice,
            vars: detailedVariations,
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
    // 5.5 Check Coupons & Order Level Discounts
    // ==========================================
    let totalDiscount = 0;
    let appliedCoupon: any = null;
    let isFreeDelivery = false;

    let orderDiscountId: string | null = null;
    let orderCouponId: string | null = null;
    let orderDiscountType: "percentage" | "fixed_amount" | null = null;
    let orderDiscountValue: string | null = null;
    let orderDiscountSource: "food_level" | "restaurant_discount" | "global_discount" | "coupon" | null = null;

    // 1️⃣ تتبع الخصم المطبق (إما خصم عام/مطعم أو خصم مباشر على الصنف)
    if (discountState.appliedDiscounts.size > 0) {
        const appliedDiscountId = Array.from(discountState.appliedDiscounts)[0];
        const matchedItem = availableDiscounts.find(item => item.discount.id === appliedDiscountId);

        if (matchedItem) {
            const activeDiscount = matchedItem.discount as any;

            orderDiscountId = activeDiscount.id;
            const isGlobalDiscount = Boolean(activeDiscount.isGlobal);
            orderDiscountSource = isGlobalDiscount ? "global_discount" : "restaurant_discount";
            orderDiscountType = activeDiscount.discountType === "percentage" ? "percentage" : "fixed_amount";
            orderDiscountValue = activeDiscount.discountValue ? activeDiscount.discountValue.toString() : "0";
        }
    } else if (hasFoodLevelDiscount) {
        // حالة الخصم المباشر من الصنف نفسه
        orderDiscountId = null;
        orderDiscountSource = "food_level";
        orderDiscountType = null;
        orderDiscountValue = roundMoney(initialSubtotal - subtotal).toFixed(2);
    }

    // 2️⃣ تطبيق الكوبون وتجميعه مع الخصم (بدون إلغاء بيانات الخصم الأصلي)
    if (couponCode) {
        const couponResult = await validateAndCalculateCoupon(
            couponCode,
            userId,
            restaurantId,
            subtotal,
            0
        );

        appliedCoupon = couponResult.coupon;
        const couponDiscountAmount = couponResult.discountAmount;
        isFreeDelivery = couponResult.isFreeDelivery;

        if (appliedCoupon) {
            orderCouponId = appliedCoupon.id || null;
            // إضافة قيمة خصم الكوبون على المجموع الكلي للخصومات
            totalDiscount += couponDiscountAmount;

            // إذا لم يكن هناك خصم سابق على الأصناف، يتم تعيين الكوبون كمصدر رئيسي للخصم
            if (!orderDiscountSource) {
                orderDiscountSource = "coupon";
                orderDiscountType = appliedCoupon.discountType === "percentage" ? "percentage" : "fixed_amount";
                orderDiscountValue = appliedCoupon.discountValue ? appliedCoupon.discountValue.toString() : couponDiscountAmount.toFixed(2);
            }
        }
    }

    totalDiscount = roundMoney(totalDiscount);

    // ==========================================
    // 6. Dynamic Delivery & Turf Zone Logic (Optimized Single Fetch)
    // ==========================================
    let deliveryFee = 0;
    let resolvedZoneId: string | null = zoneId || null;
    let resolvedBranchId: string | null = branchId || null;
    let shippingAddressSnapshot: any = null;

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

        const restaurantFees = await db.select({
            id: restaurantZoneDeliveryFees.id,
            zoneId: restaurantZoneDeliveryFees.zoneId,
            branchId: restaurantZoneDeliveryFees.branchId,
            deliveryFee: restaurantZoneDeliveryFees.deliveryFee,
            coverageType: restaurantZoneDeliveryFees.coverageType,
            customCoordinates: restaurantZoneDeliveryFees.customCoordinates,
            customRadiusKm: restaurantZoneDeliveryFees.customRadiusKm,
            defaultCoordinates: zones.coordinates,
            defaultRadiusKm: zones.coverageAreaRadiusKm,
            zoneName: zones.name,
            zoneNameAr: zones.nameAr
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
        resolvedZoneId = applicableFee.id;
        if (!resolvedZoneId) {
            throw new BadRequest("No delivery zone found for this address.");
        }
        deliveryFee = parseFloat(applicableFee.deliveryFee as string || "0");

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

            if (!selectedBranch) throw new BadRequest("Selected branch not found or inactive.");
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

            if (!matchedBranch) throw new BadRequest("No active branch found serving your delivery zone.");
            resolvedBranchId = matchedBranch.id;
        }

        const [userInfoForAddress] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);

        // Snapshot build using pre-fetched applicableFee values (NO SECOND QUERY TO DB)
        shippingAddressSnapshot = {
            title: userAddress.title,
            street: userAddress.street,
            building: userAddress.number || null,
            floor: userAddress.floor || null,
            apartment: userAddress.apartment || null,
            landmark: userAddress.landmark || null,
            location: userAddress.location || null,
            fulladdress: userAddress.fulladdress || null,
            lat: lat,
            lng: lng,
            phone: userInfoForAddress?.phone || null,
            addressZoneId: genericZoneId || null,
            restaurantZoneId: resolvedZoneId || null,
            addressZoneName: applicableFee.zoneName || null,
            addressZoneNameAr: applicableFee.zoneNameAr || null,
        };
    } else {
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

    // Branch Snapshot
    let branchSnapshotData: any = null;
    if (resolvedBranchId) {
        const [branchDetails] = await db
            .select({
                id: branches.id,
                name: branches.name,
                nameAr: branches.nameAr,
                nameFr: branches.nameFr,
                address: branches.address,
                addressAr: branches.addressAr,
                addressFr: branches.addressFr,
                phoneNumber: branches.phoneNumber,
                status: branches.status,
                zoneId: branches.zoneId,
                zoneName: zones.name,
                zoneNameAr: zones.nameAr,
                cityId: branches.cityId,
                cityName: cities.name,
                cityNameAr: cities.nameAr,
            })
            .from(branches)
            .leftJoin(cities, eq(branches.cityId, cities.id))
            .leftJoin(zones, eq(branches.zoneId, zones.id))
            .where(eq(branches.id, resolvedBranchId))
            .limit(1);

        if (branchDetails) {
            branchSnapshotData = {
                id: branchDetails.id,
                name: branchDetails.name,
                nameAr: branchDetails.nameAr || null,
                nameFr: branchDetails.nameFr || null,
                address: branchDetails.address,
                addressAr: branchDetails.addressAr || null,
                addressFr: branchDetails.addressFr || null,
                phone: branchDetails.phoneNumber || null,
                status: branchDetails.status,
                zoneId: branchDetails.zoneId || null,
                zoneName: branchDetails.zoneName || null,
                zoneNameAr: branchDetails.zoneNameAr || null,
                cityId: branchDetails.cityId || null,
                cityName: branchDetails.cityName || null,
                cityNameAr: branchDetails.cityNameAr || null,
            };
        }
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
            const minAmountOk = !freeDeliveryOffer.minOrderAmount || subtotal >= parseFloat(freeDeliveryOffer.minOrderAmount as string);

            if (startOk && endOk && minAmountOk) {
                deliveryFee = 0;
                isFreeDelivery = true;
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

    // ⏰ 1. Fetch value from settings (Handles real `null` gracefully)
    const resetTimeStr = (settings as any)?.resetDailyOrderNumberTime || "00:00";

    const [resetHourRaw, resetMinuteRaw] = resetTimeStr.split(":").map(Number);
    const resetHour = isNaN(resetHourRaw) ? 0 : resetHourRaw;
    const resetMinute = isNaN(resetMinuteRaw) ? 0 : resetMinuteRaw;

    // 🌍 2. Timezone Handling (Egypt UTC+3)
    const EGYPT_OFFSET_HOURS = 3;

    const nowUtc = new Date();
    const nowLocal = new Date(nowUtc.getTime() + EGYPT_OFFSET_HOURS * 60 * 60 * 1000);

    const startOfTodayLocal = new Date(nowLocal);
    startOfTodayLocal.setHours(resetHour, resetMinute, 0, 0);

    if (nowLocal < startOfTodayLocal) {
        startOfTodayLocal.setDate(startOfTodayLocal.getDate() - 1);
    }

    const startOfTodayQuery = new Date(startOfTodayLocal.getTime() - EGYPT_OFFSET_HOURS * 60 * 60 * 1000);

    // 🔒 3. Fetch Last Order
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

        // 🔒 Daily order number calculation
        const [lastOrder] = await tx
            .select({ dailyOrderNumber: orders.dailyOrderNumber })
            .from(orders)
            .where(
                and(
                    eq(orders.restaurantId, restaurantId),
                    gte(orders.createdAt, startOfTodayQuery)
                )
            )
            .orderBy(desc(orders.dailyOrderNumber))
            .limit(1)
            .for("update");

        createdDailyOrderNumber = (lastOrder?.dailyOrderNumber || 0) + 1;

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

            discountId: orderDiscountId,
            couponId: orderCouponId,
            discountAmount: totalDiscount.toFixed(2),
            discountType: orderDiscountType,
            discountValue: orderDiscountValue,
            discountSource: orderDiscountSource,

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

        // Increment user's total orders count
        await tx.update(users)
            .set({ totalOrders: sql`${users.totalOrders} + 1` })
            .where(eq(users.id, userId));

        // Increment user's total orders count for this restaurant
        const [existingPointRecord] = await tx.select().from(userRestaurantPoints)
            .where(and(eq(userRestaurantPoints.userId, userId), eq(userRestaurantPoints.restaurantId, restaurantId))).for("update");

        if (existingPointRecord) {
            await tx.update(userRestaurantPoints)
                .set({ totalOrders: sql`${userRestaurantPoints.totalOrders} + 1` })
                .where(eq(userRestaurantPoints.id, existingPointRecord.id));
        } else {
            await tx.insert(userRestaurantPoints).values({
                id: uuidv4(),
                userId,
                restaurantId,
                totalOrders: 1,
                points: 0
            });
        }

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
            restaurantId,
            orderId,
            orderNumber,
            branchId: resolvedBranchId || null,
            type: "new_order",
            createdAt: now.toISOString(),
            dailyOrderNumber: createdDailyOrderNumber
        }
    });

    // ==========================================
    // 📤 إرجاع البيانات في الـ Response
    // ==========================================
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
            discountDetails: {
                discountId: orderDiscountId,
                couponId: orderCouponId,
                discountAmount: totalDiscount,
                discountType: orderDiscountType,
                discountValue: orderDiscountValue,
                discountSource: orderDiscountSource,
                couponCode: couponCode || null,
                isFreeDelivery
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
            cancelReasonType: orders.cancelReasonType ? orders.cancelReasonType : selectReasons.type,
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
            addons: orderItems.addons
        })
        .from(orderItems)
        .leftJoin(food, eq(orderItems.foodId, food.id))
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
            // restaurantDeliveryZoneId: matchedRestaurantDeliveryZoneId, // 👈 id الخاص بنطاق المطعم (restaurantZoneDeliveryFees)
            //zoneId: matchedZoneId, // 👈 إرجاع zoneId داخل العنوان
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
                cancelReasonId: finalReasonId,
                cancelReason: finalReasonText,
                cancelReasonType: "user",
                updatedAt: new Date()
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

