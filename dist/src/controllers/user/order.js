"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateOrder = exports.getCancelReasons = exports.cancelOrder = exports.getOrderPrerequisites = exports.getOrderDetails = exports.getOrderHistory = exports.getActiveOrders = exports.checkout = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const uuid_1 = require("uuid");
const Errors_1 = require("../../Errors");
const notifications_1 = require("../../utils/notifications");
const geo_1 = require("../../utils/geo");
const discount_1 = require("../../utils/discount");
const userBlockCheck_1 = require("../../utils/userBlockCheck");
const restaurantFeatures_1 = require("./restaurantFeatures");
const pricing_helper_1 = require("../../helpers/pricing.helper");
const coupon_helper_1 = require("../../helpers/coupon.helper");
// 👇 1. دالة تظبيط الوقت لتوقيت مصر عشان نص الإشعار
const formatToEgyptTime = (date) => {
    return new Intl.DateTimeFormat("ar-EG", {
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
        return { item, cleanVariations };
    });
    const allOldOptionIds = new Set();
    for (const { cleanVariations } of parsedItems) {
        if (Array.isArray(cleanVariations) && cleanVariations.length > 0) {
            const hasFullDetails = cleanVariations.every((v) => v.variationName && v.optionName);
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
    const optionsMap = new Map();
    if (allOldOptionIds.size > 0) {
        const optionsWithParent = await connection_1.db
            .select({
            optionId: schema_1.variationOptions.id,
            optionName: schema_1.variationOptions.optionName,
            optionNameAr: schema_1.variationOptions.optionNameAr,
            optionNameFr: schema_1.variationOptions.optionNameFr,
            additionalPrice: schema_1.variationOptions.additionalPrice,
            variationId: schema_1.foodVariations.id,
            variationName: schema_1.foodVariations.name,
            variationNameAr: schema_1.foodVariations.nameAr,
            variationNameFr: schema_1.foodVariations.nameFr,
        })
            .from(schema_1.variationOptions)
            .leftJoin(schema_1.foodVariations, (0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, schema_1.foodVariations.id))
            .where((0, drizzle_orm_1.inArray)(schema_1.variationOptions.id, Array.from(allOldOptionIds)));
        for (const opt of optionsWithParent) {
            optionsMap.set(opt.optionId, opt);
        }
    }
    return parsedItems.map(({ item, cleanVariations }) => {
        let variationDetails = [];
        if (Array.isArray(cleanVariations) && cleanVariations.length > 0) {
            const hasFullDetails = cleanVariations.every((v) => v.variationName && v.optionName);
            if (hasFullDetails) {
                variationDetails = cleanVariations.map((v) => ({
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
            }
            else {
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
const roundMoney = (amount) => Math.round(amount * 100) / 100;
const checkout = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderSource, paymentMethod, orderType, idempotencyKey, zoneId, branchId, addressId, note, couponCode } = req.body;
    // ==========================================
    // 🛡️ 1. Validation
    // ==========================================
    const validOrderSources = ["online_order_app", "online_order_web", "food_aggregator", "mykeeto", "pos"];
    if (!validOrderSources.includes(orderSource)) {
        throw new BadRequest_1.BadRequest("Invalid order source");
    }
    const [selectedPayment] = await connection_1.db.select().from(schema_1.paymentMethods).where((0, drizzle_orm_1.eq)(schema_1.paymentMethods.id, paymentMethod)).limit(1);
    if (!selectedPayment || !selectedPayment.isActive) {
        throw new BadRequest_1.BadRequest("Invalid or inactive payment method");
    }
    const paymentMethodName = selectedPayment.name;
    const paymentMethodNameAr = selectedPayment.nameAr;
    const isWalletPayment = paymentMethodName === "wallet" || paymentMethodNameAr === "محفظتى";
    const isCashPayment = paymentMethodName === "cash_on_delivery" || paymentMethodNameAr === "الدفع عند الاستلام" || paymentMethodName === "cash";
    // ==========================================
    // 2. Idempotency Check
    // ==========================================
    if (idempotencyKey) {
        const [existing] = await connection_1.db.select().from(schema_1.orders).where((0, drizzle_orm_1.eq)(schema_1.orders.idempotencyKey, idempotencyKey)).limit(1);
        if (existing)
            return (0, response_1.SuccessResponse)(res, { message: "Order already processed", data: existing });
    }
    // ==========================================
    // 3. Get Cart Items
    // ==========================================
    const userCart = await connection_1.db.select().from(schema_1.cartItems).where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId));
    if (!userCart.length)
        throw new BadRequest_1.BadRequest("Your cart is empty");
    const restaurantId = userCart[0].restaurantId;
    // 🛡️ Block check: Verify user is not blocked globally or by this restaurant
    await (0, userBlockCheck_1.validateUserNotBlocked)(userId, restaurantId);
    // ==========================================
    // 4. Get Restaurant & Business Plan
    // ==========================================
    const [restaurant] = await connection_1.db.select().from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId)).limit(1);
    if (!restaurant)
        throw new BadRequest_1.BadRequest("Restaurant not found");
    const [plan] = await connection_1.db.select()
        .from(schema_1.restaurantBusinessPlans)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.platformType, orderSource)))
        .limit(1);
    if (!plan) {
        throw new BadRequest_1.BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }
    // ==========================================
    // 🛡️ 4.5 فحص مواعيد المطعم وإعدادات التشغيل
    // ==========================================
    const schedulesList = await connection_1.db.select().from(schema_1.restaurantSchedules).where((0, drizzle_orm_1.eq)(schema_1.restaurantSchedules.restaurantId, restaurantId));
    const [settings] = await connection_1.db.select().from(schema_1.restaurantSettings).where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId)).limit(1);
    const validOrderTypes = ["delivery", "takeaway", "dine_in"];
    if (!orderType || !validOrderTypes.includes(orderType)) {
        throw new BadRequest_1.BadRequest("orderType is required and must be one of: delivery, takeaway, dine_in");
    }
    const resolvedOrderType = orderType;
    const status = (0, restaurantFeatures_1.calculateCurrentStatus)(settings, schedulesList);
    if (!status.isOpenNow)
        throw new BadRequest_1.BadRequest(`Order failed. ${status.reason}`);
    if (resolvedOrderType === "delivery" && !status.canDeliveryNow)
        throw new BadRequest_1.BadRequest("Order failed. Delivery service is currently disabled for this restaurant.");
    if (resolvedOrderType === "takeaway" && !status.canTakeawayNow)
        throw new BadRequest_1.BadRequest("Order failed. Takeaway service is currently disabled for this restaurant.");
    const defaultPreparingDuration = settings?.maxDeliveryTime ?? 30;
    // ==========================================
    // ⚡ 5. Channel Pricing Engine — Subtotal, Variations & Addons
    // orderType IS the serviceModule (they are the same concept)
    // ==========================================
    const serviceModule = resolvedOrderType;
    // We need the resolvedBranchId from step 6, but step 6 runs after step 5 in the
    // original flow. We pre-resolve it here so the pricing engine can run first.
    // Branch resolution for pricing purposes (full resolution happens again in step 6 for delivery fee).
    let pricingBranchId = branchId || null;
    if (resolvedOrderType === "delivery") {
        if (!addressId)
            throw new BadRequest_1.BadRequest("Delivery address is required.");
        if (!pricingBranchId) {
            try {
                pricingBranchId = await (0, pricing_helper_1.resolveBranchIdFromAddress)(addressId, restaurantId);
            }
            catch (err) {
                const storedBranch = userCart.find(c => c.branchId);
                pricingBranchId = storedBranch?.branchId || null;
            }
        }
    }
    else {
        // Takeaway / dine_in: branchId is required
        if (!branchId)
            throw new BadRequest_1.BadRequest("Branch is required for takeaway or dine-in orders.");
    }
    // ─── Subcategory-branch availability guard ──────────────────────────
    // Block checkout if any cart item belongs to a subcategory that is
    // inactive at the resolved branch (independent of food-level locks)
    if (pricingBranchId) {
        const cartFoodIds = userCart.map(c => c.foodId).filter(Boolean);
        const cartFoods = cartFoodIds.length > 0
            ? await connection_1.db
                .select({ id: schema_1.food.id, subcategoryid: schema_1.food.subcategoryid })
                .from(schema_1.food)
                .where((0, drizzle_orm_1.inArray)(schema_1.food.id, cartFoodIds))
            : [];
        const subcatIdsInCart = [...new Set(cartFoods.map(f => f.subcategoryid).filter(Boolean))];
        if (subcatIdsInCart.length > 0) {
            const inactiveSubcats = await connection_1.db
                .select({ subcategoryId: schema_1.branchSubcategories.subcategoryId })
                .from(schema_1.branchSubcategories)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branchSubcategories.branchId, pricingBranchId), (0, drizzle_orm_1.inArray)(schema_1.branchSubcategories.subcategoryId, subcatIdsInCart), (0, drizzle_orm_1.eq)(schema_1.branchSubcategories.status, "inactive")));
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
    const allAddonIds = [];
    const cartParsed = userCart.map(item => {
        let safeVars = typeof item.variations === "string" ? JSON.parse(item.variations) : item.variations;
        if (typeof safeVars === "string")
            safeVars = JSON.parse(safeVars);
        let parsedVariations = [];
        let parsedAddons = [];
        if (Array.isArray(safeVars)) {
            parsedVariations = safeVars;
        }
        else if (safeVars && typeof safeVars === "object") {
            parsedVariations = Array.isArray(safeVars.variations) ? safeVars.variations : [];
            parsedAddons = Array.isArray(safeVars.addons) ? safeVars.addons : [];
        }
        let safeAddons = typeof item.addons === "string" ? JSON.parse(item.addons) : item.addons;
        if (typeof safeAddons === "string")
            safeAddons = JSON.parse(safeAddons);
        if (Array.isArray(safeAddons)) {
            parsedAddons = [...parsedAddons, ...safeAddons];
        }
        parsedAddons.forEach((a) => { if (a.addonId || a.id)
            allAddonIds.push(a.addonId || a.id); });
        return { cartItem: item, parsedVariations, parsedAddons };
    });
    // Batch fetch variation details for snapshot storage
    const allCheckoutOptionIds = new Set();
    for (const { parsedVariations } of cartParsed) {
        for (const v of parsedVariations) {
            if (v.optionId) {
                allCheckoutOptionIds.add(v.optionId);
            }
        }
    }
    const optionsWithParent = allCheckoutOptionIds.size > 0
        ? await connection_1.db
            .select({
            optionId: schema_1.variationOptions.id,
            optionName: schema_1.variationOptions.optionName,
            optionNameAr: schema_1.variationOptions.optionNameAr,
            optionNameFr: schema_1.variationOptions.optionNameFr,
            additionalPrice: schema_1.variationOptions.additionalPrice,
            variationId: schema_1.foodVariations.id,
            variationName: schema_1.foodVariations.name,
            variationNameAr: schema_1.foodVariations.nameAr,
            variationNameFr: schema_1.foodVariations.nameFr,
        })
            .from(schema_1.variationOptions)
            .leftJoin(schema_1.foodVariations, (0, drizzle_orm_1.eq)(schema_1.variationOptions.variationId, schema_1.foodVariations.id))
            .where((0, drizzle_orm_1.inArray)(schema_1.variationOptions.id, Array.from(allCheckoutOptionIds)))
        : [];
    const optionsWithParentMap = new Map(optionsWithParent.map(o => [o.optionId, o]));
    // Batch fetch addon prices (channel pricing does not cover addons)
    const addonsListDb = allAddonIds.length > 0
        ? await connection_1.db.select().from(schema_1.addons).where((0, drizzle_orm_1.inArray)(schema_1.addons.id, [...new Set(allAddonIds)]))
        : [];
    const addonsMap = new Map(addonsListDb.map(a => [a.id, a]));
    // ─── Per-item pricing via 4-tier cascade ────────────────────────────
    let subtotal = 0;
    let initialSubtotal = 0;
    const itemsWithData = [];
    let checkoutHasUnavailable = false;
    let checkoutPriceChanged = false;
    const priceChangedItems = [];
    let hasFoodLevelDiscount = false; // 💡 Flag لتتبع وجود خصومات على مستوى الصنف نفسه
    for (const { cartItem, parsedVariations, parsedAddons } of cartParsed) {
        const optionIds = parsedVariations.map((v) => v.optionId).filter(Boolean);
        // Resolve addon prices (not covered by channel pricing)
        let addonPrice = 0;
        for (const a of parsedAddons) {
            const addonId = a.addonId || a.id;
            const dbAddon = addonsMap.get(addonId);
            if (dbAddon) {
                const p = parseFloat((dbAddon.price || "0"));
                addonPrice += p;
                a.price = p.toString();
            }
            else {
                addonPrice += parseFloat(a.price || "0");
            }
        }
        let channelBasePrice;
        let varPrice;
        let itemIsAvailable = true;
        if (pricingBranchId) {
            // ── Channel pricing cascade ──────────────────────────────
            const priceResult = await (0, pricing_helper_1.calculateCalculatedPrice)(cartItem.foodId, optionIds, pricingBranchId, serviceModule);
            channelBasePrice = priceResult.basePrice;
            varPrice = priceResult.variants.reduce((s, v) => s + v.price, 0);
            itemIsAvailable = priceResult.isAvailable;
            // Sync resolved variant prices back into snapshot for order record
            for (const v of parsedVariations) {
                if (v.optionId) {
                    const resolved = priceResult.variants.find(r => r.variantOptionId === v.optionId);
                    if (resolved)
                        v.additionalPrice = resolved.price.toString();
                }
            }
            // Detect price drift vs stored cart snapshot
            const storedUnit = parseFloat(cartItem.unitPrice || "0");
            const liveUnit = channelBasePrice + varPrice + addonPrice;
            if (Math.abs(liveUnit - storedUnit) > 0.01) {
                checkoutPriceChanged = true;
                priceChangedItems.push({
                    foodId: cartItem.foodId,
                    oldUnitPrice: storedUnit,
                    newUnitPrice: liveUnit,
                });
            }
        }
        else {
            // ── Fallback: no channel context — use food.price + option additionalPrice ──
            const [foodRow] = await connection_1.db.select({ price: schema_1.food.price, status: schema_1.food.status, isOutOfStock: schema_1.food.isOutOfStock })
                .from(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.id, cartItem.foodId)).limit(1);
            if (!foodRow)
                throw new BadRequest_1.BadRequest(`Food item with ID ${cartItem.foodId} not found`);
            channelBasePrice = parseFloat(foodRow.price || "0");
            itemIsAvailable = foodRow.status !== "inactive" && !foodRow.isOutOfStock;
            varPrice = 0;
            if (optionIds.length > 0) {
                const opts = await connection_1.db.select({ id: schema_1.variationOptions.id, additionalPrice: schema_1.variationOptions.additionalPrice })
                    .from(schema_1.variationOptions).where((0, drizzle_orm_1.inArray)(schema_1.variationOptions.id, optionIds));
                const optMap = new Map(opts.map(o => [o.id, o]));
                for (const v of parsedVariations) {
                    if (v.optionId) {
                        const opt = optMap.get(v.optionId);
                        if (opt) {
                            const resolvedPrice = (opt.additionalPrice || "0");
                            varPrice += parseFloat(resolvedPrice);
                            v.additionalPrice = resolvedPrice;
                        }
                    }
                }
            }
        }
        if (!itemIsAvailable)
            checkoutHasUnavailable = true;
        // Build initial subtotal for discount engine
        const originalBasePrice = channelBasePrice;
        const foodMeta = await connection_1.db.select({ id: schema_1.food.id, discount_type: schema_1.food.discount_type, discount_value: schema_1.food.discount_value })
            .from(schema_1.food).where((0, drizzle_orm_1.eq)(schema_1.food.id, cartItem.foodId)).limit(1);
        const foodItem = foodMeta[0];
        let initialDiscountPrice = originalBasePrice;
        if (foodItem?.discount_value && Number(foodItem.discount_value) > 0) {
            hasFoodLevelDiscount = true; // 💡 تحديد وجود خصم على الصنف
            if (foodItem.discount_type === "percentage") {
                initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(foodItem.discount_value) / 100));
            }
            else if (foodItem.discount_type === "amount" || foodItem.discount_type === "fixed") {
                initialDiscountPrice = Math.max(0, originalBasePrice - Number(foodItem.discount_value));
            }
        }
        initialSubtotal += (initialDiscountPrice + varPrice + addonPrice) * cartItem.quantity;
        const detailedVariations = parsedVariations.map((v) => {
            const optDetails = optionsWithParentMap.get(v.optionId);
            if (!optDetails)
                return v;
            const resolvedPrice = v.additionalPrice || optDetails.additionalPrice || "0.00";
            return {
                variationId: optDetails.variationId,
                variationName: optDetails.variationName,
                variationNameAr: optDetails.variationNameAr,
                variationNameFr: optDetails.variationNameFr,
                optionId: optDetails.optionId,
                optionName: optDetails.optionName,
                optionNameAr: optDetails.optionNameAr,
                optionNameFr: optDetails.optionNameFr,
                price: Number(resolvedPrice).toFixed(2)
            };
        });
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
    const availableDiscounts = await (0, discount_1.getAvailableDiscounts)(restaurantId);
    const discountState = { remainingMaxDiscounts: new Map(), appliedDiscounts: new Set() };
    const itemsToInsert = [];
    for (const data of itemsWithData) {
        const { cartItem, foodItem, originalBasePrice, varPrice, addonPrice, vars, addonsList } = data;
        const { price: discountedBasePrice } = (0, discount_1.applyPriorityDiscount)({ id: foodItem.id, discountType: foodItem.discount_type, discountValue: foodItem.discount_value }, originalBasePrice, initialSubtotal, availableDiscounts, discountState, true);
        const itemTotal = roundMoney((discountedBasePrice + varPrice + addonPrice) * cartItem.quantity);
        subtotal += itemTotal;
        itemsToInsert.push({
            id: (0, uuid_1.v4)(),
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
    const serviceFee = parseFloat(plan.serviceFee || "0");
    const commissionRate = parseFloat(plan.commissionRate || "0");
    const appCommission = roundMoney(subtotal * (commissionRate / 100));
    // ==========================================
    // 5.5 Check Coupons & Order Level Discounts
    // ==========================================
    let totalDiscount = 0;
    let appliedCoupon = null;
    let isFreeDelivery = false;
    let orderDiscountId = null;
    let orderCouponId = null;
    let orderDiscountType = null;
    let orderDiscountValue = null;
    let orderDiscountSource = null;
    // 1️⃣ تتبع الخصم المطبق (إما خصم عام/مطعم أو خصم مباشر على الصنف)
    if (discountState.appliedDiscounts.size > 0) {
        const appliedDiscountId = Array.from(discountState.appliedDiscounts)[0];
        const matchedItem = availableDiscounts.find(item => item.discount.id === appliedDiscountId);
        if (matchedItem) {
            const activeDiscount = matchedItem.discount;
            orderDiscountId = activeDiscount.id;
            const isGlobalDiscount = Boolean(activeDiscount.isGlobal);
            orderDiscountSource = isGlobalDiscount ? "global_discount" : "restaurant_discount";
            orderDiscountType = activeDiscount.discountType === "percentage" ? "percentage" : "fixed_amount";
            orderDiscountValue = activeDiscount.discountValue ? activeDiscount.discountValue.toString() : "0";
        }
    }
    else if (hasFoodLevelDiscount) {
        // حالة الخصم المباشر من الصنف نفسه
        orderDiscountId = null;
        orderDiscountSource = "food_level";
        orderDiscountType = null;
        orderDiscountValue = roundMoney(initialSubtotal - subtotal).toFixed(2);
    }
    // 2️⃣ تطبيق الكوبون وتجميعه مع الخصم (بدون إلغاء بيانات الخصم الأصلي)
    if (couponCode) {
        const couponResult = await (0, coupon_helper_1.validateAndCalculateCoupon)(couponCode, userId, restaurantId, subtotal, 0);
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
    // 6. Dynamic Delivery & Turf Zone Logic
    // ==========================================
    let deliveryFee = 0;
    let resolvedZoneId = zoneId || null;
    let resolvedBranchId = branchId || null;
    if (resolvedOrderType === "delivery") {
        if (!addressId)
            throw new BadRequest_1.BadRequest("Delivery address is required");
        const [userAddress] = await connection_1.db.select().from(schema_1.addresses)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId), (0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId))).limit(1);
        if (!userAddress)
            throw new BadRequest_1.BadRequest("Invalid delivery address");
        const lat = parseFloat(userAddress.lat || "0");
        const lng = parseFloat(userAddress.lng || "0");
        if (!lat || !lng) {
            throw new BadRequest_1.BadRequest("Delivery address requires valid latitude and longitude coordinates.");
        }
        const restaurantFees = await connection_1.db.select({
            id: schema_1.restaurantZoneDeliveryFees.id,
            zoneId: schema_1.restaurantZoneDeliveryFees.zoneId,
            branchId: schema_1.restaurantZoneDeliveryFees.branchId,
            deliveryFee: schema_1.restaurantZoneDeliveryFees.deliveryFee,
            coverageType: schema_1.restaurantZoneDeliveryFees.coverageType,
            customCoordinates: schema_1.restaurantZoneDeliveryFees.customCoordinates,
            customRadiusKm: schema_1.restaurantZoneDeliveryFees.customRadiusKm,
            defaultCoordinates: schema_1.zones.coordinates,
            defaultRadiusKm: schema_1.zones.coverageAreaRadiusKm
        })
            .from(schema_1.restaurantZoneDeliveryFees)
            .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.zoneId, schema_1.zones.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.status, "active"), branchId ? (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.branchId, branchId) : undefined));
        let applicableFee = null;
        let maxDeliveryFee = -1;
        for (const fee of restaurantFees) {
            if ((0, geo_1.isLocationInZone)(lat, lng, fee.zoneId, fee)) {
                const currentFee = parseFloat(fee.deliveryFee || "0");
                if (currentFee > maxDeliveryFee) {
                    maxDeliveryFee = currentFee;
                    applicableFee = fee;
                }
            }
        }
        if (!applicableFee) {
            throw new BadRequest_1.BadRequest("Your delivery address is outside our covered delivery zones.");
        }
        const genericZoneId = applicableFee.zoneId;
        resolvedZoneId = applicableFee.id;
        if (!resolvedZoneId) {
            throw new BadRequest_1.BadRequest("No delivery zone found for this address.");
        }
        deliveryFee = parseFloat(applicableFee.deliveryFee || "0");
        if (applicableFee.branchId) {
            resolvedBranchId = applicableFee.branchId;
        }
        else if (branchId) {
            const [selectedBranch] = await connection_1.db.select({ id: schema_1.branches.id })
                .from(schema_1.branches)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.id, branchId), (0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")))
                .limit(1);
            if (!selectedBranch) {
                throw new BadRequest_1.BadRequest("Selected branch not found or inactive.");
            }
            resolvedBranchId = selectedBranch.id;
        }
        else {
            const [matchedBranch] = await connection_1.db.select({ id: schema_1.branches.id })
                .from(schema_1.branches)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.branches.zoneId, genericZoneId), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")))
                .limit(1);
            if (!matchedBranch) {
                throw new BadRequest_1.BadRequest("No active branch found serving your delivery zone.");
            }
            resolvedBranchId = matchedBranch.id;
        }
    }
    else {
        if (!branchId)
            throw new BadRequest_1.BadRequest("Branch is required for takeaway or dine-in orders.");
        const [branch] = await connection_1.db.select({ id: schema_1.branches.id, zoneId: schema_1.branches.zoneId })
            .from(schema_1.branches)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.id, branchId), (0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")))
            .limit(1);
        if (!branch)
            throw new BadRequest_1.BadRequest("Invalid or inactive branch selected.");
        resolvedBranchId = branch.id;
        resolvedZoneId = branch.zoneId;
    }
    const calculatedDeliveryFee = deliveryFee;
    if (isFreeDelivery)
        deliveryFee = 0;
    // ==========================================
    // 6.5 Free Delivery Offer Check (schema-based)
    // ==========================================
    if (!isFreeDelivery && resolvedOrderType === "delivery") {
        const nowForOffer = new Date();
        const [freeDeliveryOffer] = await connection_1.db
            .select()
            .from(schema_1.freeDeliveryOffers)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.freeDeliveryOffers.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.freeDeliveryOffers.status, "active")))
            .limit(1);
        if (freeDeliveryOffer) {
            const startOk = !freeDeliveryOffer.startDate || new Date(freeDeliveryOffer.startDate) <= nowForOffer;
            const endOk = !freeDeliveryOffer.endDate || new Date(freeDeliveryOffer.endDate) >= nowForOffer;
            const minAmount = parseFloat(freeDeliveryOffer.minOrderAmount || "0");
            if (startOk && endOk && subtotal >= minAmount) {
                isFreeDelivery = true;
                deliveryFee = 0;
            }
        }
    }
    let totalAmount = roundMoney(subtotal + deliveryFee + serviceFee - totalDiscount);
    if (totalAmount < 0)
        totalAmount = 0;
    const orderId = (0, uuid_1.v4)();
    const orderNumber = `ORD-${Date.now()}`;
    const [userInfo] = await connection_1.db.select({ id: schema_1.users.id, name: schema_1.users.name, phone: schema_1.users.phone, email: schema_1.users.email })
        .from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, userId)).limit(1);
    // ==========================================
    // 🛡️ 10. Execute Order (Transaction)
    // ==========================================
    const now = new Date();
    // ⏰ Calculate the start of the current daily order numbering cycle using resetDailyOrderNumberTime.
    // If the restaurant hasn't configured a reset time, default to midnight (00:00).
    // If the current time is BEFORE the reset time today, the cycle started at yesterday's reset time.
    const resetTimeStr = settings?.resetDailyOrderNumberTime || "00:00";
    const [resetHour, resetMinute] = resetTimeStr.split(":").map(Number);
    const safeResetHour = isNaN(resetHour) ? 0 : resetHour;
    const safeResetMinute = isNaN(resetMinute) ? 0 : resetMinute;
    const startOfToday = new Date(now);
    startOfToday.setHours(safeResetHour, safeResetMinute, 0, 0);
    // If we haven't yet reached today's reset time, step back to yesterday's reset time
    if (now < startOfToday) {
        startOfToday.setDate(startOfToday.getDate() - 1);
    }
    let createdDailyOrderNumber = 1;
    await connection_1.db.transaction(async (tx) => {
        // 🔒 1. Wallet deduction with FOR UPDATE
        if (isWalletPayment) {
            const [userWallet] = await tx.select()
                .from(schema_1.userWallets)
                .where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId))
                .for("update");
            const currentBalance = parseFloat(userWallet?.balance || "0");
            if (!userWallet || currentBalance < totalAmount) {
                throw new BadRequest_1.BadRequest("Insufficient wallet balance");
            }
            const newBalance = roundMoney(currentBalance - totalAmount);
            await tx.update(schema_1.userWallets)
                .set({ balance: newBalance.toFixed(2) })
                .where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId));
            await tx.insert(schema_1.userWalletTransactions).values({
                id: (0, uuid_1.v4)(),
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
            .select({ count: (0, drizzle_orm_1.sql) `count(${schema_1.orders.id})` })
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId), (0, drizzle_orm_1.gte)(schema_1.orders.createdAt, startOfToday)));
        createdDailyOrderNumber = Number(ordersCountResult?.count || 0) + 1;
        // 3. Create order record
        await tx.insert(schema_1.orders).values({
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
        await tx.insert(schema_1.orderItems).values(itemsToInsert.map(i => ({ ...i, orderId })));
        await tx.delete(schema_1.cartItems).where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId));
        // Superadmin notification
        await tx.insert(schema_1.notifications).values({
            recipientType: "superadmin",
            recipientId: "superadmin",
            title: "New Order",
            body: `Order #${createdDailyOrderNumber} has been placed at ${restaurant?.name}.`,
            data: { orderId, orderNumber, createdDailyOrderNumber, restaurantName: restaurant?.name }
        });
        // 4. Coupons and Discounts tracking
        if (appliedCoupon) {
            await tx.insert(schema_1.couponUsages).values({
                id: (0, uuid_1.v4)(),
                couponId: appliedCoupon.id,
                userId,
                orderId,
                discountAmount: appliedCoupon.discountType === "free_delivery"
                    ? calculatedDeliveryFee.toFixed(2)
                    : totalDiscount.toFixed(2)
            });
            await tx.update(schema_1.coupons)
                .set({ usedCount: (0, drizzle_orm_1.sql) `used_count + 1` })
                .where((0, drizzle_orm_1.eq)(schema_1.coupons.id, appliedCoupon.id));
        }
        if (discountState.appliedDiscounts.size > 0) {
            for (const dId of Array.from(discountState.appliedDiscounts)) {
                await tx.update(schema_1.discounts)
                    .set({ usedCount: (0, drizzle_orm_1.sql) `used_count + 1` })
                    .where((0, drizzle_orm_1.eq)(schema_1.discounts.id, dId));
            }
        }
        // 5. Restaurant wallet calculations
        let [restaurantWallet] = await tx.select().from(schema_1.restaurantWallets).where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId)).for("update");
        if (!restaurantWallet) {
            await tx.insert(schema_1.restaurantWallets).values({
                id: (0, uuid_1.v4)(),
                restaurantId: restaurantId,
                balance: "0.00",
                collectedCash: "0.00",
                totalEarning: "0.00"
            });
            restaurantWallet = { balance: "0.00", collectedCash: "0.00", totalEarning: "0.00" };
        }
        const currentRestBalance = parseFloat(restaurantWallet.balance);
        const currentCollectedCash = parseFloat(restaurantWallet.collectedCash);
        const currentTotalEarning = parseFloat(restaurantWallet.totalEarning);
        const restaurantEarning = roundMoney(subtotal + deliveryFee - appCommission);
        const appDues = roundMoney(appCommission + serviceFee);
        let newRestBalance = currentRestBalance;
        let newCollectedCash = currentCollectedCash;
        if (isCashPayment) {
            newRestBalance = roundMoney(newRestBalance - appDues);
            newCollectedCash = roundMoney(newCollectedCash + totalAmount);
        }
        else {
            newRestBalance = roundMoney(newRestBalance + restaurantEarning);
        }
        await tx.update(schema_1.restaurantWallets)
            .set({
            balance: newRestBalance.toFixed(2),
            collectedCash: newCollectedCash.toFixed(2),
            totalEarning: roundMoney(currentTotalEarning + restaurantEarning).toFixed(2)
        })
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId));
        await tx.insert(schema_1.restaurantWalletTransactions).values({
            id: (0, uuid_1.v4)(),
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
    await (0, notifications_1.sendPushNotification)({
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
    return (0, response_1.SuccessResponse)(res, {
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
exports.checkout = checkout;
// ==========================================
// 2. جلب الطلبات النشطة (الحالية)
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
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), restaurantId ? (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, String(restaurantId)) : undefined, (0, drizzle_orm_1.inArray)(schema_1.orders.status, ["pending", "accepted", "preparing", "out_for_delivery"])))
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
            addons: schema_1.orderItems.addons
        })
            .from(schema_1.orderItems)
            .leftJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.orderItems.foodId, schema_1.food.id))
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
// 3. جلب سجل الطلبات (History) - المكتملة والملغية
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
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), restaurantId ? (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, String(restaurantId)) : undefined, (0, drizzle_orm_1.inArray)(schema_1.orders.status, ["delivered", "cancelled", "refund"])))
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
            addons: schema_1.orderItems.addons
        })
            .from(schema_1.orderItems)
            .leftJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.orderItems.foodId, schema_1.food.id))
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
// 4. تفاصيل الطلب (Order Details)
// ==========================================
const getOrderDetails = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { orderId } = req.params;
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
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId))
        .limit(1);
    if (!orderInfo.length) {
        throw new NotFound_1.NotFound("Order not found");
    }
    const o = orderInfo[0];
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
        addons: schema_1.orderItems.addons
    })
        .from(schema_1.orderItems)
        .leftJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.orderItems.foodId, schema_1.food.id))
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
// ==========================================
// 5. متطلبات الطلب المسبقة (Order Prerequisites)
// ==========================================
const getOrderPrerequisites = async (req, res) => {
    if (!req.user) {
        throw new Errors_1.UnauthorizedError("Unauthenticated: Token is missing or invalid");
    }
    const userId = req.user.id;
    const restaurantId = req.query.restaurantId;
    const orderSource = req.query.orderSource;
    if (!restaurantId) {
        throw new BadRequest_1.BadRequest("restaurantId is required");
    }
    const validOrderSources = ["online_order_app", "online_order_web", "food_aggregator", "mykeeto", "pos"];
    if (!orderSource || !validOrderSources.includes(orderSource)) {
        throw new BadRequest_1.BadRequest("Invalid or missing order source");
    }
    // 1. جلب البيانات من الداتا بيز بالتوازي
    const [userAddresses, restaurantBranches, zoneFees, activePaymentMethods, getCancelReasons, businessPlans, freeDeliveryOfferRows] = await Promise.all([
        connection_1.db.select().from(schema_1.addresses).where((0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId)),
        connection_1.db.select().from(schema_1.branches).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active"))),
        connection_1.db.select({
            id: schema_1.restaurantZoneDeliveryFees.id,
            zoneId: schema_1.restaurantZoneDeliveryFees.zoneId,
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
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.platformType, orderSource)))
            .limit(1),
        connection_1.db.select()
            .from(schema_1.freeDeliveryOffers)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.freeDeliveryOffers.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.freeDeliveryOffers.status, "active")))
            .limit(1)
    ]);
    const plan = businessPlans[0];
    if (!plan) {
        throw new BadRequest_1.BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
    }
    // 2. معالجة كل عنوان عند المستخدم ومعرفة هل هو قابل للتوصيل ومعرفة zoneId الخاص به
    const addressesWithDeliveryInfo = userAddresses.map((addr) => {
        let isDeliverable = false;
        let applicableDeliveryFee = null;
        let matchedZoneId = null;
        let matchedRestaurantDeliveryZoneId = null;
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
            let matchesZone = (0, geo_1.isLocationInZone)(addrLat, addrLng, addr.zoneId, fee);
            // لو النطاق ده طابق موقع العميل
            if (matchesZone) {
                const isBranchActive = !fee.branchId || fee.branchStatus === "active";
                if (!isBranchActive) {
                    continue;
                }
                isDeliverable = true;
                const currentFee = parseFloat((fee.deliveryFee || "0"));
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
    const serviceFee = parseFloat((plan.serviceFee || "0"));
    // Free delivery offer — check validity window
    const nowForPrereq = new Date();
    const activeFreeDeliveryOffer = freeDeliveryOfferRows[0] ?? null;
    let freeDeliveryOfferData = null;
    if (activeFreeDeliveryOffer) {
        const startOk = !activeFreeDeliveryOffer.startDate || new Date(activeFreeDeliveryOffer.startDate) <= nowForPrereq;
        const endOk = !activeFreeDeliveryOffer.endDate || new Date(activeFreeDeliveryOffer.endDate) >= nowForPrereq;
        if (startOk && endOk) {
            freeDeliveryOfferData = {
                minOrderAmount: parseFloat(activeFreeDeliveryOffer.minOrderAmount || "0"),
                startDate: activeFreeDeliveryOffer.startDate ? activeFreeDeliveryOffer.startDate.toISOString() : null,
                endDate: activeFreeDeliveryOffer.endDate ? activeFreeDeliveryOffer.endDate.toISOString() : null,
            };
        }
    }
    return (0, response_1.SuccessResponse)(res, {
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
exports.getOrderPrerequisites = getOrderPrerequisites;
// ==========================================
// 6. إلغاء الطلب من قبل المستخدم (Cancel Order)
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
            cancelReasonId: finalReasonId,
            cancelReason: finalReasonText,
            cancelReasonType: "user",
            updatedAt: new Date()
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId));
        // حسابات المبالغ التي تم دفعها أو خصمها
        const totalAmount = parseFloat(order.totalAmount || "0");
        const appCommission = parseFloat(order.appCommission || "0");
        const serviceFee = parseFloat(order.serviceFee || "0");
        const subtotal = parseFloat(order.subtotal || "0");
        const deliveryFee = parseFloat(order.deliveryFee || "0");
        const appDues = appCommission + serviceFee;
        const restaurantEarning = subtotal + deliveryFee - appCommission;
        const isCashPayment = order.paymentMethod === "cash_on_delivery" || order.paymentMethod === "cash"; // Assuming ID handling elsewhere or this is resolved
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
        // إرجاع الفلوس/العمولات من المطعم (حيث أن الإلغاء من المستخدم، المطعم لا يتحمل العمولة)
        const [restaurantWallet] = await tx.select().from(schema_1.restaurantWallets).where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, order.restaurantId)).limit(1);
        if (restaurantWallet) {
            let currentRestBalance = parseFloat(restaurantWallet.balance || "0");
            let currentCollectedCash = parseFloat(restaurantWallet.collectedCash || "0");
            let currentTotalEarning = parseFloat(restaurantWallet.totalEarning || "0");
            if (isCashPayment) {
                // نلغي خصم العمولة من رصيد المطعم، ونلغي الكاش المحصل
                currentRestBalance += appDues;
                currentCollectedCash -= totalAmount;
            }
            else {
                // نلغي الأرباح اللي انضافت للمطعم
                currentRestBalance -= restaurantEarning;
            }
            await tx.update(schema_1.restaurantWallets)
                .set({
                balance: currentRestBalance.toString(),
                collectedCash: currentCollectedCash.toString(),
                totalEarning: (currentTotalEarning - restaurantEarning).toString()
            })
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, order.restaurantId));
            // تسجيل العملية
            await tx.insert(schema_1.restaurantWalletTransactions).values({
                id: (0, uuid_1.v4)(),
                restaurantId: order.restaurantId,
                type: "order_payment", // Or create a new type "refund"
                amount: isCashPayment ? `${appDues}` : `-${restaurantEarning}`,
                balanceBefore: restaurantWallet.balance,
                balanceAfter: currentRestBalance.toString(),
                method: order.paymentMethod,
                reference: order.orderNumber,
                note: "Refund/Revert due to user cancellation"
            });
        }
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
