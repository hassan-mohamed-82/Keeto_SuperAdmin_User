// import { Request, Response } from "express";
// import { db } from "../../models/connection";
// import {
//     cartItems,
//     food,
//     restaurants,
//     variationOptions,
//     foodVariations,
//     addons,
//     freeDeliveryOffers
// } from "../../models/schema";

// import { eq, and, inArray } from "drizzle-orm";
// import { SuccessResponse } from "../../utils/response";
// import { BadRequest } from "../../Errors/BadRequest";
// import { v4 as uuidv4 } from "uuid";
// import { getAvailableDiscounts, applyPriorityDiscount } from "../../utils/discount";
// import { validateUserNotBlocked } from "../../utils/userBlockCheck";
// import { type BranchInfo, getUnavailableBranchesForFoods } from "../../helpers/food.helper";
// import { resolveBranchIdForCart, validateFoodAvailabilityForCart } from "../../helpers/cart.helper";

// /* =========================================
//    Helpers
// ========================================= */
// const normalizeVariations = (variations: any) => {
//     const safe = Array.isArray(variations) ? variations : [];
//     return safe
//         .filter(v => v?.optionId)
//         .sort((a, b) => String(a.optionId).localeCompare(String(b.optionId)));
// };

// const normalizeAddons = (addonsInput: any) => {
//     const safe = Array.isArray(addonsInput) ? addonsInput : [];
//     return safe
//         .filter(a => a?.addonId)
//         .sort((a, b) => String(a.addonId).localeCompare(String(b.addonId)));
// };

// const deepParseJSON = (data: any): any => {
//     if (typeof data === 'string') {
//         try {
//             return deepParseJSON(JSON.parse(data));
//         } catch {
//             return data;
//         }
//     }
//     return data;
// };

// const parseCartSnapshot = (raw: any): { variations: any[]; addons: any[] } => {
//     const parsed = deepParseJSON(raw);
//     if (Array.isArray(parsed)) {
//         return { variations: parsed, addons: [] };
//     }
//     if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
//         return {
//             variations: Array.isArray(parsed.variations) ? parsed.variations : [],
//             addons: Array.isArray(parsed.addons) ? parsed.addons : []
//         };
//     }
//     return { variations: [], addons: [] };
// };

// // resolveBranchIdForCart and validateFoodAvailabilityForCart are now in:
// // src/helpers/cart.helper.ts — uses restaurant-specific delivery zones (restaurant_zone_delivery_fees)
// // instead of the generic zones table, for accurate per-restaurant coverage checks.

// /* =========================================
//    1. ADD TO CART
// ========================================= */
// export const addToCart = async (req: Request | any, res: Response) => {
//     const userId = req.user?.id;
//     const { foodId, quantity = 1, variations = [], addons: requestAddons = [], note, branchId, addressId } = req.body;

//     const safeVariations = Array.isArray(variations) ? variations : [];
//     const safeAddons = Array.isArray(requestAddons) ? requestAddons : [];

//     const [itemFood] = await db.select().from(food).where(eq(food.id, foodId)).limit(1);
//     if (!itemFood) throw new BadRequest("Food not found");


//     // 🛡️ Block check: Verify user is not blocked globally or by this restaurant
//     await validateUserNotBlocked(userId, itemFood.restaurantid);

//     if (itemFood.isOutOfStock || itemFood.status === "inactive") {
//         throw new BadRequest("This item is currently out of stock.");
//     }

//     // Verify branch/address availability for the single item being added
//     await validateFoodAvailabilityForCart(foodId, branchId, addressId, itemFood.restaurantid);

//     const existingCart = await db.select().from(cartItems)
//         .where(eq(cartItems.userId, userId))
//         .limit(1);

//     if (existingCart.length > 0 && existingCart[0].restaurantId !== itemFood.restaurantid) {
//         return res.status(409).json({
//             success: false,
//             message: "You have food from another restaurant",
//             clearCartRequired: true
//         });
//     }

//     const dbVariations = await db
//         .select()
//         .from(foodVariations)
//         .where(eq(foodVariations.foodId, foodId));

//     let totalExtraPrice = 0;

//     // 1. Check variations
//     for (const selected of safeVariations) {
//         const validDbVariation = dbVariations.find(v => v.id === selected.variationId);

//         if (!validDbVariation) {
//             throw new BadRequest(`Invalid variation ID sent: ${selected.variationId}`);
//         }
//         if (validDbVariation.status === false) {
//             throw new BadRequest(`Variation ${validDbVariation.name} is currently unavailable`);
//         }

//         const dbOptions = await db
//             .select()
//             .from(variationOptions)
//             .where(eq(variationOptions.variationId, validDbVariation.id));

//         const foundOption = dbOptions.find(o => o.id === selected.optionId);
//         if (!foundOption) {
//             throw new BadRequest(`Invalid option selected for variation: ${validDbVariation.name}`);
//         }
//         if (foundOption.status === false) {
//             throw new BadRequest(`Option ${foundOption.optionName} is currently unavailable`);
//         }

//         totalExtraPrice += Number(foundOption.additionalPrice || 0);
//     }

//     // 2. Mandatory variations check
//     for (const v of dbVariations) {
//         if (v.isRequired) {
//             const isProvided = safeVariations.some(x => x.variationId === v.id);
//             if (!isProvided) throw new BadRequest(`${v.name} is required`);
//         }
//     }

//     // 3. Addons validation
//     let addonSnapshot: { addonId: string; name: string; nameAr: string; price: string }[] = [];
//     if (safeAddons.length > 0) {
//         const allowedAddonIds: string[] = Array.isArray(itemFood.addonsId) ? itemFood.addonsId : [];
//         if (allowedAddonIds.length > 0) {
//             for (const a of safeAddons) {
//                 if (!allowedAddonIds.includes(a.addonId)) {
//                     throw new BadRequest(`Addon ${a.addonId} is not available for this food item`);
//                 }
//             }
//         }

//         const requestedAddonIds = safeAddons.map((a: any) => a.addonId);
//         const dbAddons = await db
//             .select()
//             .from(addons)
//             .where(inArray(addons.id, requestedAddonIds));

//         for (const a of safeAddons) {
//             const dbAddon = dbAddons.find(d => d.id === a.addonId);
//             if (!dbAddon) throw new BadRequest(`Addon not found: ${a.addonId}`);
//             if (dbAddon.status === "inactive") throw new BadRequest(`Addon "${dbAddon.name}" is currently unavailable`);

//             totalExtraPrice += Number(dbAddon.price || 0);
//             addonSnapshot.push({
//                 addonId: dbAddon.id,
//                 name: dbAddon.name,
//                 nameAr: dbAddon.nameAr,
//                 price: dbAddon.price
//             });
//         }
//     }

//     // 4. Calculate total price
//     const unitPrice = Number(itemFood.price) + totalExtraPrice;

//     const normalizedVariationsList = normalizeVariations(safeVariations);
//     const normalizedAddonsList = normalizeAddons(addonSnapshot);
//     const key = JSON.stringify({ variations: normalizedVariationsList, addons: normalizedAddonsList });

//     const snapshot = { variations: normalizedVariationsList };

//     const existingItems = await db.select().from(cartItems)
//         .where(and(eq(cartItems.userId, userId), eq(cartItems.foodId, foodId)));

//     const existingSame = existingItems.find(item => {
//         const { variations: dbVars } = parseCartSnapshot(item.variations);
//         const dbAddons = deepParseJSON(item.addons);
//         const normalizedDbAddons = normalizeAddons(Array.isArray(dbAddons) ? dbAddons : []);
//         const existingKey = JSON.stringify({
//             variations: normalizeVariations(dbVars),
//             addons: normalizedDbAddons
//         });
//         return existingKey === key;
//     });

//     if (existingSame) {
//         const newQty = existingSame.quantity + quantity;

//         await db.update(cartItems)
//             .set({
//                 quantity: newQty,
//                 unitPrice: unitPrice.toString(),
//                 totalPrice: (unitPrice * newQty).toString(),
//                 variations: JSON.stringify(snapshot),
//                 addons: JSON.stringify(addonSnapshot),
//                 ...(note !== undefined ? { note: note || null } : {})
//             })
//             .where(eq(cartItems.id, existingSame.id));

//     } else {
//         await db.insert(cartItems).values({
//             id: uuidv4(),
//             userId,
//             restaurantId: itemFood.restaurantid,
//             foodId,
//             quantity,
//             unitPrice: unitPrice.toString(),
//             totalPrice: (unitPrice * quantity).toString(),
//             variations: JSON.stringify(snapshot),
//             addons: JSON.stringify(addonSnapshot),
//             note: note || null
//         });
//     }

//     return SuccessResponse(res, {
//         message: "Added to cart successfully",
//         data: {
//             unitPrice,
//             totalPrice: unitPrice * quantity
//         }
//     });
// };

// /* =========================================
//    2. GET CART
// ========================================= */
// export const getCart = async (req: Request | any, res: Response) => {
//     const userId = req.user?.id;
//     const queryRestaurantId = req.query.restaurantId as string | undefined;
//     const branchId = req.query.branchId as string | undefined;
//     const addressId = req.query.addressId as string | undefined;

//     const conditions = [eq(cartItems.userId, userId)];
//     if (queryRestaurantId) {
//         conditions.push(eq(cartItems.restaurantId, queryRestaurantId));
//     }

//     const items = await db
//         .select({
//             cartId: cartItems.id,
//             foodId: food.id,
//             name: food.name,
//             nameAr: food.nameAr,
//             nameFr: food.nameFr,
//             description: food.description,
//             descriptionAr: food.descriptionAr,
//             descriptionFr: food.descriptionFr,
//             image: food.image,
//             price: food.price,
//             discountType: food.discount_type,
//             discountValue: food.discount_value,
//             isOutOfStock: food.isOutOfStock,
//             status: food.status,
//             restaurantId: restaurants.id,
//             restaurantName: restaurants.name,
//             quantity: cartItems.quantity,
//             unitPrice: cartItems.unitPrice,
//             totalPrice: cartItems.totalPrice,
//             variations: cartItems.variations,
//             addons: cartItems.addons,
//             note: cartItems.note
//         })
//         .from(cartItems)
//         .leftJoin(food, eq(cartItems.foodId, food.id))
//         .leftJoin(restaurants, eq(cartItems.restaurantId, restaurants.id))
//         .where(and(...conditions));

//     if (items.length === 0) {
//         return SuccessResponse(res, { data: { items: [], unavailableItems: [], hasUnavailableItems: false, totalSummary: { subtotal: 0 } } });
//     }

//     const restaurantId = items[0].restaurantId;
//     let availableCartItems: typeof items = [];
//     let unavailableCartItemsData: typeof items = [];

//     const allFoodIds = items
//         .map(i => i.foodId)
//         .filter((id): id is string => id !== null && id !== undefined);

//     const unavailableMap = allFoodIds.length > 0
//         ? await getUnavailableBranchesForFoods(allFoodIds)
//         : new Map<string, BranchInfo[]>();

//     let targetBranchId: string | undefined = undefined;
//     if (branchId || addressId) {
//         targetBranchId = (await resolveBranchIdForCart(branchId, addressId, restaurantId || undefined)) || undefined;
//     }

//     for (const item of items) {
//         const isGeneralUnavailable = Boolean(item.isOutOfStock) || item.status === "inactive";
//         const unavailableBranches = item.foodId ? (unavailableMap.get(item.foodId) || []) : [];
//         const isBranchUnavailable = Boolean(targetBranchId && unavailableBranches.some(b => b.id === targetBranchId));

//         if (isGeneralUnavailable || isBranchUnavailable) {
//             unavailableCartItemsData.push(item);
//         } else {
//             availableCartItems.push(item);
//         }
//     }
//     let initialSubtotal = 0;
//     const itemsData = availableCartItems.map(item => {
//         const originalBasePrice = parseFloat(item.price as string || "0");
//         const { variations: parsedVariations } = parseCartSnapshot(item.variations);
//         const parsedAddons = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];

//         let initialDiscountPrice = originalBasePrice;
//         if (item.discountType && Number(item.discountValue) > 0) {
//             if (item.discountType === "percentage") {
//                 initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(item.discountValue) / 100));
//             } else if (item.discountType === "amount" || item.discountType === "fixed") {
//                 initialDiscountPrice = Math.max(0, originalBasePrice - Number(item.discountValue));
//             }
//         }

//         const dbUnitPrice = parseFloat(item.unitPrice as string || "0");
//         const varPrice = dbUnitPrice - originalBasePrice;

//         initialSubtotal += (initialDiscountPrice + varPrice) * item.quantity;
//         return { item, originalBasePrice, varPrice, parsedVariations, parsedAddons };
//     });

//     const availableDiscounts = await getAvailableDiscounts(restaurantId!);
//     const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };

//     let finalSubtotal = 0;

//     const formattedAvailableItems = await Promise.all(
//         itemsData.map(async (data: any) => {
//             const { item, originalBasePrice, varPrice, parsedVariations, parsedAddons } = data;

//             const variationDetails: any[] = [];
//             for (const v of parsedVariations) {
//                 if (!v.variationId || !v.optionId) continue;
//                 const [variation] = await db.select().from(foodVariations).where(eq(foodVariations.id, v.variationId)).limit(1);
//                 const [option] = await db.select().from(variationOptions).where(eq(variationOptions.id, v.optionId)).limit(1);
//                 if (variation && option) {
//                     variationDetails.push({
//                         variationId: variation.id,
//                         variationName: variation.name,
//                         variationNameAr: variation.nameAr,
//                         optionId: option.id,
//                         optionName: option.optionName,
//                         optionNameAr: option.optionNameAr,
//                         additionalPrice: option.additionalPrice
//                     });
//                 }
//             }

//             const addonDetails = parsedAddons.map((a: any) => ({
//                 addonId: a.addonId,
//                 name: a.name,
//                 nameAr: a.nameAr,
//                 price: a.price
//             }));

//             const { price: discountedBasePrice } = applyPriorityDiscount(
//                 { id: item.foodId, discountType: item.discountType, discountValue: item.discountValue },
//                 originalBasePrice,
//                 initialSubtotal,
//                 availableDiscounts,
//                 discountState,
//                 true
//             );

//             const finalUnitPrice = discountedBasePrice + varPrice;
//             const finalTotalPrice = finalUnitPrice * item.quantity;

//             finalSubtotal += finalTotalPrice;

//             return {
//                 cartId: item.cartId,
//                 foodId: item.foodId,
//                 name: item.name,
//                 nameAr: item.nameAr,
//                 nameFr: item.nameFr,
//                 description: item.description,
//                 descriptionAr: item.descriptionAr,
//                 descriptionFr: item.descriptionFr,
//                 discountType: item.discountType,
//                 discountValue: item.discountValue,
//                 image: item.image,
//                 restaurantId: item.restaurantId,
//                 restaurantName: item.restaurantName,
//                 quantity: item.quantity,
//                 price: (originalBasePrice + varPrice).toString(),
//                 unitPrice: finalUnitPrice,
//                 totalPrice: finalTotalPrice,
//                 variations: variationDetails,
//                 addons: addonDetails,
//                 note: item.note || null,
//                 isAvailable: true
//             };
//         })
//     );

//     const formattedUnavailableItems = unavailableCartItemsData.map(item => {
//         const { variations: parsedVariations } = parseCartSnapshot(item.variations);
//         const parsedAddons = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];

//         return {
//             cartId: item.cartId,
//             foodId: item.foodId,
//             name: item.name,
//             nameAr: item.nameAr,
//             image: item.image,
//             quantity: item.quantity,
//             variations: parsedVariations,
//             addons: parsedAddons,
//             isAvailable: false,
//             reason: "Out of stock or unavailable at selected location"
//         };
//     });

//     // ==========================================
//     // Free Delivery Offer check
//     // ==========================================
//     const now = new Date();
//     const [freeDeliveryOffer] = await db
//         .select()
//         .from(freeDeliveryOffers)
//         .where(
//             and(
//                 eq(freeDeliveryOffers.restaurantId, restaurantId!),
//                 eq(freeDeliveryOffers.status, "active")
//             )
//         )
//         .limit(1);

//     let freeDeliveryInfo: {
//         isEligible: boolean;
//         minOrderAmount: number;
//         remainingAmount: number;
//     } | null = null;

//     if (freeDeliveryOffer) {
//         const startOk = !freeDeliveryOffer.startDate || new Date(freeDeliveryOffer.startDate) <= now;
//         const endOk = !freeDeliveryOffer.endDate || new Date(freeDeliveryOffer.endDate) >= now;

//         if (startOk && endOk) {
//             const minAmount = parseFloat(freeDeliveryOffer.minOrderAmount as string || "0");
//             const isEligible = finalSubtotal >= minAmount;
//             freeDeliveryInfo = {
//                 isEligible,
//                 minOrderAmount: minAmount,
//                 remainingAmount: isEligible ? 0 : parseFloat((minAmount - finalSubtotal).toFixed(2))
//             };
//         }
//     }

//     return SuccessResponse(res, {
//         message: "Cart fetched successfully",
//         data: {
//             items: formattedAvailableItems,
//             unavailableItems: formattedUnavailableItems,
//             hasUnavailableItems: formattedUnavailableItems.length > 0,
//             totalSummary: {
//                 subtotal: finalSubtotal,
//                 freeDelivery: freeDeliveryInfo
//             }
//         }
//     });
// };

// // export const getCart = async (req: Request | any, res: Response) => {
// //     const userId = req.user?.id;
// //     const queryRestaurantId = req.query.restaurantId as string | undefined;

// //     const conditions = [eq(cartItems.userId, userId)];
// //     if (queryRestaurantId) {
// //         conditions.push(eq(cartItems.restaurantId, queryRestaurantId));
// //     }

// //     const items = await db
// //         .select({
// //             cartId: cartItems.id,
// //             foodId: food.id,
// //             name: food.name,
// //             nameAr: food.nameAr,
// //             nameFr: food.nameFr,
// //             description: food.description,
// //             descriptionAr: food.descriptionAr,
// //             descriptionFr: food.descriptionFr,
// //             image: food.image,
// //             price: food.price,
// //             discountType: food.discount_type,
// //             discountValue: food.discount_value,
// //             restaurantId: restaurants.id,
// //             restaurantName: restaurants.name,
// //             quantity: cartItems.quantity,
// //             unitPrice: cartItems.unitPrice,
// //             totalPrice: cartItems.totalPrice,
// //             variations: cartItems.variations,
// //             addons: cartItems.addons,
// //             note: cartItems.note
// //         })
// //         .from(cartItems)
// //         .leftJoin(food, eq(cartItems.foodId, food.id))
// //         .leftJoin(restaurants, eq(cartItems.restaurantId, restaurants.id))
// //         .where(and(...conditions));

// //     if (items.length === 0) {
// //         return SuccessResponse(res, { data: { items: [], totalSummary: { subtotal: 0 } } });
// //     }

// //     const restaurantId = items[0].restaurantId;

// //     // 1. حساب الـ subtotal الأولي (السعر الأصلي + variations + addons) لتقييم الـ discount بشكل صحيح
// //     let initialSubtotal = 0;
// //     const itemsData = items.map(item => {
// //         const originalBasePrice = parseFloat(item.price as string || "0");
// //         const { variations: parsedVariations } = parseCartSnapshot(item.variations);
// //         const parsedAddons = Array.isArray(deepParseJSON(item.addons)) ? deepParseJSON(item.addons) : [];

// //         let initialDiscountPrice = originalBasePrice;
// //         if (item.discountType && Number(item.discountValue) > 0) {
// //             if (item.discountType === "percentage") {
// //                 initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(item.discountValue) / 100));
// //             } else if (item.discountType === "amount" || item.discountType === "fixed") {
// //                 initialDiscountPrice = Math.max(0, originalBasePrice - Number(item.discountValue));
// //             }
// //         }

// //         const dbUnitPrice = parseFloat(item.unitPrice as string || "0");
// //         // varPrice = كل زيادة على السعر الأصلي (variations + addons)
// //         const varPrice = dbUnitPrice - originalBasePrice;

// //         initialSubtotal += (initialDiscountPrice + varPrice) * item.quantity;
// //         return { item, originalBasePrice, varPrice, parsedVariations, parsedAddons };
// //     });

// //     const availableDiscounts = await getAvailableDiscounts(restaurantId!);
// //     const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };

// //     let finalSubtotal = 0;

// //     const formatted = await Promise.all(
// //         itemsData.map(async (data: any) => {
// //             const { item, originalBasePrice, varPrice, parsedVariations, parsedAddons } = data;

// //             // جلب تفاصيل الـ Variations
// //             const variationDetails: any[] = [];
// //             for (const v of parsedVariations) {
// //                 if (!v.variationId || !v.optionId) continue;
// //                 const [variation] = await db.select().from(foodVariations).where(eq(foodVariations.id, v.variationId)).limit(1);
// //                 const [option] = await db.select().from(variationOptions).where(eq(variationOptions.id, v.optionId)).limit(1);
// //                 if (variation && option) {
// //                     variationDetails.push({
// //                         variationId: variation.id,
// //                         variationName: variation.name,
// //                         variationNameAr: variation.nameAr,
// //                         optionId: option.id,
// //                         optionName: option.optionName,
// //                         optionNameAr: option.optionNameAr,
// //                         additionalPrice: option.additionalPrice
// //                     });
// //                 }
// //             }

// //             // جلب تفاصيل الـ Addons من الـ snapshot المخزن
// //             const addonDetails = parsedAddons.map((a: any) => ({
// //                 addonId: a.addonId,
// //                 name: a.name,
// //                 nameAr: a.nameAr,
// //                 price: a.price
// //             }));

// //             const { price: discountedBasePrice } = applyPriorityDiscount(
// //                 { id: item.foodId, discountType: item.discountType, discountValue: item.discountValue },
// //                 originalBasePrice,
// //                 initialSubtotal,
// //                 availableDiscounts,
// //                 discountState,
// //                 true
// //             );

// //             const finalUnitPrice = discountedBasePrice + varPrice;
// //             const finalTotalPrice = finalUnitPrice * item.quantity;

// //             finalSubtotal += finalTotalPrice;

// //             return {
// //                 cartId: item.cartId,
// //                 foodId: item.foodId,
// //                 name: item.name,
// //                 nameAr: item.nameAr,
// //                 nameFr: item.nameFr,
// //                 description: item.description,
// //                 descriptionAr: item.descriptionAr,
// //                 descriptionFr: item.descriptionFr,
// //                 discountType: item.discountType,
// //                 discountValue: item.discountValue,
// //                 image: item.image,
// //                 restaurantId: item.restaurantId,
// //                 restaurantName: item.restaurantName,
// //                 quantity: item.quantity,
// //                 price: (originalBasePrice + varPrice).toString(), // السعر الأصلي شامل الـ variations والـ addons
// //                 unitPrice: finalUnitPrice, // السعر بعد الخصم
// //                 totalPrice: finalTotalPrice,
// //                 variations: variationDetails,
// //                 addons: addonDetails,
// //                 note: item.note || null
// //             };
// //         })
// //     );

// //     return SuccessResponse(res, {
// //         message: "Cart fetched successfully",
// //         data: {
// //             items: formatted,
// //             totalSummary: {
// //                 subtotal: finalSubtotal,
// //             }
// //         }
// //     });
// // };

// /* =========================================
//    3. UPDATE CART ITEM
// ========================================= */
// export const updateCartItem = async (req: Request | any, res: Response) => {
//     const userId = req.user?.id;
//     const { cartItemId } = req.params;
//     const { quantity, variations, addons: requestAddons, note, branchId, addressId } = req.body;

//     const [cartItem] = await db
//         .select()
//         .from(cartItems)
//         .where(and(eq(cartItems.id, cartItemId), eq(cartItems.userId, userId)))
//         .limit(1);

//     if (!cartItem) throw new BadRequest("Cart item not found");

//     // 🛡️ Block check: Verify user is not blocked globally or by this restaurant
//     await validateUserNotBlocked(userId, cartItem.restaurantId);

//     const [itemFood] = await db
//         .select()
//         .from(food)
//         .where(eq(food.id, cartItem.foodId))
//         .limit(1);

//     // Verify branch/address availability
//     await validateFoodAvailabilityForCart(cartItem.foodId, branchId, addressId, itemFood.restaurantid);

//     let safeVariations: any[] = [];
//     if (variations !== undefined) {
//         safeVariations = normalizeVariations(variations);
//     } else {
//         const { variations: existingVars } = parseCartSnapshot(cartItem.variations);
//         safeVariations = normalizeVariations(existingVars);
//     }

//     let safeAddons: any[] = [];
//     if (requestAddons !== undefined) {
//         safeAddons = Array.isArray(requestAddons) ? requestAddons : [];
//     } else {
//         const existingAddons = deepParseJSON(cartItem.addons);
//         safeAddons = Array.isArray(existingAddons) ? existingAddons : [];
//     }

//     const qty = quantity ?? cartItem.quantity;

//     const dbVariations = await db
//         .select()
//         .from(foodVariations)
//         .where(eq(foodVariations.foodId, itemFood.id));

//     let totalExtraPrice = 0;

//     for (const selected of safeVariations) {
//         const validDbVariation = dbVariations.find(v => v.id === selected.variationId);
//         if (!validDbVariation) throw new BadRequest("Invalid variation ID");
//         if (validDbVariation.status === false) throw new BadRequest(`Variation ${validDbVariation.name} is currently unavailable`);

//         const dbOptions = await db
//             .select()
//             .from(variationOptions)
//             .where(eq(variationOptions.variationId, validDbVariation.id));

//         const foundOption = dbOptions.find(o => o.id === selected.optionId);
//         if (!foundOption) throw new BadRequest("Invalid option selected");
//         if (foundOption.status === false) throw new BadRequest(`Option ${foundOption.optionName} is currently unavailable`);

//         totalExtraPrice += Number(foundOption.additionalPrice || 0);
//     }

//     let addonSnapshot: { addonId: string; name: string; nameAr: string; price: string }[] = [];
//     if (safeAddons.length > 0) {
//         const allowedAddonIds: string[] = Array.isArray(itemFood.addonsId) ? itemFood.addonsId : [];
//         if (allowedAddonIds.length > 0) {
//             for (const a of safeAddons) {
//                 if (!allowedAddonIds.includes(a.addonId)) {
//                     throw new BadRequest(`Addon ${a.addonId} is not available for this food item`);
//                 }
//             }
//         }

//         const requestedAddonIds = safeAddons.map((a: any) => a.addonId);
//         const dbAddons = await db
//             .select()
//             .from(addons)
//             .where(inArray(addons.id, requestedAddonIds));

//         for (const a of safeAddons) {
//             const dbAddon = dbAddons.find(d => d.id === a.addonId);
//             if (!dbAddon) throw new BadRequest(`Addon not found: ${a.addonId}`);
//             if (dbAddon.status === "inactive") throw new BadRequest(`Addon "${dbAddon.name}" is currently unavailable`);

//             totalExtraPrice += Number(dbAddon.price || 0);
//             addonSnapshot.push({
//                 addonId: dbAddon.id,
//                 name: dbAddon.name,
//                 nameAr: dbAddon.nameAr,
//                 price: dbAddon.price
//             });
//         }
//     } else if (requestAddons === undefined) {
//         const existingAddonSnapshot = deepParseJSON(cartItem.addons);
//         const addonsList = Array.isArray(existingAddonSnapshot) ? existingAddonSnapshot : [];
//         addonSnapshot = addonsList.map((a: any) => ({
//             addonId: a.addonId,
//             name: a.name,
//             nameAr: a.nameAr,
//             price: a.price
//         }));
//         for (const a of addonSnapshot) {
//             totalExtraPrice += Number(a.price || 0);
//         }
//     }

//     const unitPrice = Number(itemFood.price) + totalExtraPrice;

//     await db.update(cartItems)
//         .set({
//             quantity: qty,
//             unitPrice: unitPrice.toString(),
//             totalPrice: (unitPrice * qty).toString(),
//             variations: JSON.stringify({ variations: safeVariations }),
//             addons: JSON.stringify(addonSnapshot),
//             ...(note !== undefined ? { note: note || null } : {})
//         })
//         .where(and(eq(cartItems.id, cartItemId), eq(cartItems.userId, userId)));

//     return SuccessResponse(res, {
//         message: "Cart updated successfully",
//         data: {
//             unitPrice,
//             totalPrice: unitPrice * qty
//         }
//     });
// };

// /* =========================================
//    4. REMOVE ITEM
// ========================================= */
// export const removeCartItem = async (req: Request | any, res: Response) => {
//     const userId = req.user?.id;
//     const { cartItemId } = req.params;

//     await db.delete(cartItems)
//         .where(and(eq(cartItems.id, cartItemId), eq(cartItems.userId, userId)));

//     return SuccessResponse(res, {
//         message: "The item has been removed from the cart"
//     });
// };

// /* =========================================
//    5. CLEAR CART
// ========================================= */
// export const clearCart = async (req: Request | any, res: Response) => {
//     const userId = req.user?.id;

//     await db.delete(cartItems)
//         .where(eq(cartItems.userId, userId));

//     return SuccessResponse(res, {
//         message: "The cart has been cleared successfully"
//     });
// };





















// //checout
// import { Request, Response } from "express";
// import { db } from "../../models/connection";
// import {
//     restaurantWallets, restaurantWalletTransactions,
//     restaurantZoneDeliveryFees, zoneDeliveryFees, restaurantSettings,
//     restaurantSchedules, cartItems, users, addresses, branches,
//     userWallets, userWalletTransactions, paymentMethods,
//     coupons, couponUsages, couponRestaurants, discounts, discountRestaurants, discountFoods,
//     selectReasons,
//     orders,
//     restaurants,
//     orderItems,
//     notifications,
//     restaurantBusinessPlans, food,
//     variationOptions,
//     addons,
//     zones,
//     deliveryMen,
//     freeDeliveryOffers
// } from "../../models/schema";
// import { eq, and, inArray, sql, desc, gte } from "drizzle-orm";
// import { SuccessResponse } from "../../utils/response";
// import { BadRequest } from "../../Errors/BadRequest";
// import { NotFound } from "../../Errors/NotFound";
// import { v4 as uuidv4 } from "uuid";
// import { UnauthorizedError } from "../../Errors";
// import { sendPushNotification } from "../../utils/notifications";
// import { calculateDistance, isLocationInZone } from "../../utils/geo";
// import { getAvailableDiscounts, applyPriorityDiscount } from "../../utils/discount";
// import { validateUserNotBlocked } from "../../utils/userBlockCheck";
// import { calculateCurrentStatus } from "./restaurantFeatures";
// import * as turf from "@turf/turf";
// export const checkout = async (req: Request | any, res: Response) => {
//     if (!req.user) throw new UnauthorizedError("Unauthenticated");
//     const userId = req.user.id;

//     const {
//         orderSource,
//         paymentMethod,
//         orderType,
//         idempotencyKey,
//         zoneId,
//         branchId,
//         addressId,
//         note,
//         couponCode
//     } = req.body;

//     // ==========================================
//     // 🛡️ 1. Validation
//     // ==========================================
//     const validOrderSources = ["online_order_app", "online_order_web", "food_aggregator", "mykeeto", "pos"];
//     if (!validOrderSources.includes(orderSource)) {
//         throw new BadRequest("Invalid order source");
//     }

//     const [selectedPayment] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, paymentMethod)).limit(1);
//     if (!selectedPayment || !selectedPayment.isActive) {
//         throw new BadRequest("Invalid or inactive payment method");
//     }
//     const paymentMethodName = selectedPayment.name;
//     const paymentMethodNameAr = selectedPayment.nameAr;
//     const isWalletPayment = paymentMethodName === "wallet" || paymentMethodNameAr === "محفظتى";
//     const isCashPayment = paymentMethodName === "cash_on_delivery" || paymentMethodNameAr === "الدفع عند الاستلام" || paymentMethodName === "cash";

//     // ==========================================
//     // 2. Idempotency Check
//     // ==========================================
//     if (idempotencyKey) {
//         const [existing] = await db.select().from(orders).where(eq(orders.idempotencyKey, idempotencyKey)).limit(1);
//         if (existing) return SuccessResponse(res, { message: "Order already processed", data: existing });
//     }

//     // ==========================================
//     // 3. Get Cart Items
//     // ==========================================
//     const userCart = await db.select().from(cartItems).where(eq(cartItems.userId, userId));
//     if (!userCart.length) throw new BadRequest("Your cart is empty");

//     const restaurantId = userCart[0].restaurantId;

//     // 🛡️ Block check: Verify user is not blocked globally or by this restaurant
//     await validateUserNotBlocked(userId, restaurantId);

//     // ==========================================
//     // 4. Get Restaurant & Business Plan
//     // ==========================================
//     const [restaurant] = await db.select().from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
//     if (!restaurant) throw new BadRequest("Restaurant not found");

//     const [plan] = await db.select()
//         .from(restaurantBusinessPlans)
//         .where(
//             and(
//                 eq(restaurantBusinessPlans.restaurantId, restaurantId),
//                 eq(restaurantBusinessPlans.platformType, orderSource as any)
//             )
//         )
//         .limit(1);

//     if (!plan) {
//         throw new BadRequest(`Order failed. This restaurant has no active business plan for ${orderSource}.`);
//     }

//     // ==========================================
//     // 🛡️ 4.5 فحص مواعيد المطعم وإعدادات التشغيل
//     // ==========================================
//     const schedulesList = await db.select().from(restaurantSchedules).where(eq(restaurantSchedules.restaurantId, restaurantId));
//     const [settings] = await db.select().from(restaurantSettings).where(eq(restaurantSettings.restaurantId, restaurantId)).limit(1);

//     const validOrderTypes = ["delivery", "takeaway", "dine_in"];
//     if (!orderType || !validOrderTypes.includes(orderType)) {
//         throw new BadRequest("orderType is required and must be one of: delivery, takeaway, dine_in");
//     }
//     const resolvedOrderType = orderType;
//     const status = calculateCurrentStatus(settings, schedulesList);

//     if (!status.isOpenNow) throw new BadRequest(`Order failed. ${status.reason}`);
//     if (resolvedOrderType === "delivery" && !status.canDeliveryNow) throw new BadRequest("Order failed. Delivery service is currently disabled for this restaurant.");
//     if (resolvedOrderType === "takeaway" && !status.canTakeawayNow) throw new BadRequest("Order failed. Takeaway service is currently disabled for this restaurant.");

//     const defaultPreparingDuration = settings?.maxDeliveryTime ?? 30;
//     // ==========================================
//     // ⚡ 5. Batch Fetching
//     // ==========================================
//     const foodIds = [...new Set(userCart.map(item => item.foodId))];

//     const allOptionIds: string[] = [];
//     const allAddonIds: string[] = [];

//     userCart.forEach(item => {
//         let safeVars = typeof item.variations === 'string' ? JSON.parse(item.variations) : item.variations;
//         if (typeof safeVars === 'string') safeVars = JSON.parse(safeVars);

//         let parsedVars: any[] = [];
//         let parsedAddons: any[] = [];

//         if (Array.isArray(safeVars)) {
//             parsedVars = safeVars;
//         } else if (safeVars && typeof safeVars === 'object') {
//             parsedVars = Array.isArray(safeVars.variations) ? safeVars.variations : [];
//             parsedAddons = Array.isArray(safeVars.addons) ? safeVars.addons : [];
//         }

//         let safeAddons = typeof item.addons === 'string' ? JSON.parse(item.addons) : item.addons;
//         if (typeof safeAddons === 'string') safeAddons = JSON.parse(safeAddons);
//         if (Array.isArray(safeAddons)) {
//             parsedAddons = [...parsedAddons, ...safeAddons];
//         }

//         parsedVars.forEach((v: any) => { if (v.optionId) allOptionIds.push(v.optionId); });
//         parsedAddons.forEach((a: any) => { if (a.addonId || a.id) allAddonIds.push(a.addonId || a.id); });
//     });

//     const [foodList, optionsList, addonsListDb] = await Promise.all([
//         db.select().from(food).where(inArray(food.id, foodIds)),
//         allOptionIds.length > 0
//             ? db.select().from(variationOptions).where(inArray(variationOptions.id, [...new Set(allOptionIds)]))
//             : [],
//         allAddonIds.length > 0
//             ? db.select().from(addons).where(inArray(addons.id, [...new Set(allAddonIds)]))
//             : []
//     ]);

//     const foodMap = new Map(foodList.map(f => [f.id, f]));
//     const optionsMap = new Map(optionsList.map(o => [o.id, o]));
//     const addonsMap = new Map(addonsListDb.map(a => [a.id, a]));

//     // ==========================================
//     // 5.1 Calculate Subtotal, Variations & Addons
//     // ==========================================
//     let subtotal = 0;
//     let initialSubtotal = 0;
//     const itemsWithData = [];

//     for (const item of userCart) {
//         const foodItem = foodMap.get(item.foodId);
//         if (!foodItem) throw new BadRequest(`Food item with ID ${item.foodId} not found`);

//         const originalBasePrice = parseFloat(foodItem.price as string || "0");

//         let safeVars = typeof item.variations === 'string' ? JSON.parse(item.variations) : item.variations;
//         if (typeof safeVars === 'string') safeVars = JSON.parse(safeVars);

//         let parsedVariations: any[] = [];
//         let parsedAddons: any[] = [];

//         if (Array.isArray(safeVars)) {
//             parsedVariations = safeVars;
//         } else if (safeVars && typeof safeVars === 'object') {
//             parsedVariations = Array.isArray(safeVars.variations) ? safeVars.variations : [];
//             parsedAddons = Array.isArray(safeVars.addons) ? safeVars.addons : [];
//         }

//         let safeAddons = typeof item.addons === 'string' ? JSON.parse(item.addons) : item.addons;
//         if (typeof safeAddons === 'string') safeAddons = JSON.parse(safeAddons);
//         if (Array.isArray(safeAddons)) {
//             parsedAddons = [...parsedAddons, ...safeAddons];
//         }

//         let varPrice = 0;
//         let addonPrice = 0;

//         for (const v of parsedVariations) {
//             if (v.optionId) {
//                 const dbOption = optionsMap.get(v.optionId);
//                 if (dbOption) {
//                     const dbOptionPrice = parseFloat((dbOption.additionalPrice || "0") as string);
//                     varPrice += dbOptionPrice;
//                     v.additionalPrice = dbOptionPrice.toString();
//                 }
//             } else {
//                 varPrice += parseFloat(v.additionalPrice || v.price || v.amount || "0");
//             }
//         }

//         for (const a of parsedAddons) {
//             const addonId = a.addonId || a.id;
//             const dbAddon = addonsMap.get(addonId);
//             if (dbAddon) {
//                 const dbAddonPrice = parseFloat((dbAddon.price || "0") as string);
//                 addonPrice += dbAddonPrice;
//                 a.price = dbAddonPrice.toString();
//             } else {
//                 addonPrice += parseFloat(a.price || "0");
//             }
//         }

//         let initialDiscountPrice = originalBasePrice;
//         if (foodItem.discount_value && Number(foodItem.discount_value) > 0) {
//             if (foodItem.discount_type === "percentage") {
//                 initialDiscountPrice = Math.max(0, originalBasePrice - (originalBasePrice * Number(foodItem.discount_value) / 100));
//             } else if (foodItem.discount_type === "amount" || foodItem.discount_type === "fixed") {
//                 initialDiscountPrice = Math.max(0, originalBasePrice - Number(foodItem.discount_value));
//             }
//         }

//         initialSubtotal += (initialDiscountPrice + varPrice + addonPrice) * item.quantity;
//         itemsWithData.push({ cartItem: item, foodItem, originalBasePrice, varPrice, addonPrice, vars: parsedVariations, addonsList: parsedAddons });
//     }

//     const availableDiscounts = await getAvailableDiscounts(restaurantId);
//     const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };
//     const itemsToInsert: any[] = [];

//     for (const data of itemsWithData) {
//         const { cartItem, foodItem, originalBasePrice, varPrice, addonPrice, vars, addonsList } = data;

//         const { price: discountedBasePrice } = applyPriorityDiscount(
//             { id: foodItem.id, discountType: foodItem.discount_type, discountValue: foodItem.discount_value },
//             originalBasePrice,
//             initialSubtotal,
//             availableDiscounts,
//             discountState,
//             true
//         );

//         const itemTotal = roundMoney((discountedBasePrice + varPrice + addonPrice) * cartItem.quantity);
//         subtotal += itemTotal;

//         itemsToInsert.push({
//             id: uuidv4(),
//             foodId: cartItem.foodId,
//             quantity: cartItem.quantity,
//             basePrice: discountedBasePrice.toFixed(2),
//             variationsPrice: varPrice.toFixed(2),
//             addonsPrice: addonPrice.toFixed(2),
//             totalPrice: itemTotal.toFixed(2),
//             variations: vars,
//             addons: addonsList,
//             note: cartItem.note || null
//         });
//     }

//     subtotal = roundMoney(subtotal);

//     // ==========================================
//     // 5.2 Fees & Commission
//     // ==========================================
//     const serviceFee = parseFloat(plan.serviceFee as string || "0");
//     const commissionRate = parseFloat(plan.commissionRate as string || "0");
//     const appCommission = roundMoney(subtotal * (commissionRate / 100));

//     // ==========================================
//     // 5.5 Check Coupons
//     // ==========================================
//     const nowTemp = new Date();
//     let totalDiscount = 0;
//     let appliedCoupon: any = null;
//     let isFreeDelivery = false;

//     if (couponCode) {
//       const couponResult = await validateAndCalculateCoupon(
//     couponCode,
//     userId,
//     restaurantId,
//     subtotal,
//     0 // Delivery fee is resolved in step 6; if free_delivery, isFreeDelivery flag is set
// );

// appliedCoupon = couponResult.coupon;
// totalDiscount = couponResult.discountAmount;
// isFreeDelivery = couponResult.isFreeDelivery;
//     }

//     totalDiscount = roundMoney(totalDiscount);

//     // ==========================================
//     // 6. Dynamic Delivery & Turf Zone Logic (Updated)
//     // ==========================================
//     let deliveryFee = 0;
//     let resolvedZoneId: string | null = zoneId || null;
//     let resolvedBranchId: string | null = branchId || null;

//     if (resolvedOrderType === "delivery") {
//         if (!addressId) throw new BadRequest("Delivery address is required");

//         const [userAddress] = await db.select().from(addresses)
//             .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId))).limit(1);
//         if (!userAddress) throw new BadRequest("Invalid delivery address");

//         const lat = parseFloat(userAddress.lat as string || "0");
//         const lng = parseFloat(userAddress.lng as string || "0");

//         if (!lat || !lng) {
//             throw new BadRequest("Delivery address requires valid latitude and longitude coordinates.");
//         }

//         // Fetch all active delivery fees for this restaurant (including branchId)
//         const restaurantFees = await db.select({
//             id: restaurantZoneDeliveryFees.id,
//             zoneId: restaurantZoneDeliveryFees.zoneId,
//             branchId: restaurantZoneDeliveryFees.branchId,
//             deliveryFee: restaurantZoneDeliveryFees.deliveryFee,
//             coverageType: restaurantZoneDeliveryFees.coverageType,
//             customCoordinates: restaurantZoneDeliveryFees.customCoordinates,
//             customRadiusKm: restaurantZoneDeliveryFees.customRadiusKm,
//             defaultCoordinates: zones.coordinates,
//             defaultRadiusKm: zones.coverageAreaRadiusKm
//         })
//             .from(restaurantZoneDeliveryFees)
//             .leftJoin(zones, eq(restaurantZoneDeliveryFees.zoneId, zones.id))
//             .where(
//                 and(
//                     eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
//                     eq(restaurantZoneDeliveryFees.status, "active"),
//                     branchId ? eq(restaurantZoneDeliveryFees.branchId, branchId) : undefined
//                 )
//             );

//         let applicableFee: any = null;
//         let maxDeliveryFee = -1;

//         for (const fee of restaurantFees) {
//             if (isLocationInZone(lat, lng, fee.zoneId, fee)) {
//                 const currentFee = parseFloat(fee.deliveryFee as string || "0");
//                 if (currentFee > maxDeliveryFee) {
//                     maxDeliveryFee = currentFee;
//                     applicableFee = fee;
//                 }
//             }
//         }

//         if (!applicableFee) {
//             throw new BadRequest("Your delivery address is outside our covered delivery zones.");
//         }

//         const genericZoneId = applicableFee.zoneId;
//         resolvedZoneId = applicableFee.id; // 👈 حفظ id الخاص بـ restaurantZoneDeliveryFees في الـ order
//         if (!resolvedZoneId) {
//             throw new BadRequest("No delivery zone found for this address.");
//         }
//         deliveryFee = parseFloat(applicableFee.deliveryFee as string || "0");

//         // 🏪 تحديد/التحقق من الفرع المخصص للـ Delivery
//         if (applicableFee.branchId) {
//             resolvedBranchId = applicableFee.branchId;
//         } else if (branchId) {
//             const [selectedBranch] = await db.select({ id: branches.id })
//                 .from(branches)
//                 .where(
//                     and(
//                         eq(branches.id, branchId),
//                         eq(branches.restaurantId, restaurantId),
//                         eq(branches.status, "active")
//                     )
//                 )
//                 .limit(1);

//             if (!selectedBranch) {
//                 throw new BadRequest("Selected branch not found or inactive.");
//             }
//             resolvedBranchId = selectedBranch.id;
//         } else {
//             const [matchedBranch] = await db.select({ id: branches.id })
//                 .from(branches)
//                 .where(
//                     and(
//                         eq(branches.restaurantId, restaurantId),
//                         eq(branches.zoneId, genericZoneId),
//                         eq(branches.status, "active")
//                     )
//                 )
//                 .limit(1);

//             if (!matchedBranch) {
//                 throw new BadRequest("No active branch found serving your delivery zone.");
//             }

//             resolvedBranchId = matchedBranch.id;
//         }
//     } else {
//         // For takeaway or dine_in: branchId is required
//         if (!branchId) throw new BadRequest("Branch is required for takeaway or dine-in orders.");

//         const [branch] = await db.select({ id: branches.id, zoneId: branches.zoneId })
//             .from(branches)
//             .where(
//                 and(
//                     eq(branches.id, branchId),
//                     eq(branches.restaurantId, restaurantId),
//                     eq(branches.status, "active")
//                 )
//             )
//             .limit(1);

//         if (!branch) throw new BadRequest("Invalid or inactive branch selected.");

//         resolvedBranchId = branch.id;
//         resolvedZoneId = branch.zoneId;
//     }

//   const calculatedDeliveryFee = deliveryFee;

//     if (isFreeDelivery) deliveryFee = 0;

//     // ==========================================
//     // 6.5 Free Delivery Offer Check (schema-based)
//     // ==========================================
//     if (!isFreeDelivery && resolvedOrderType === "delivery") {
//         const nowForOffer = new Date();
//         const [freeDeliveryOffer] = await db
//             .select()
//             .from(freeDeliveryOffers)
//             .where(
//                 and(
//                     eq(freeDeliveryOffers.restaurantId, restaurantId),
//                     eq(freeDeliveryOffers.status, "active")
//                 )
//             )
//             .limit(1);

//         if (freeDeliveryOffer) {
//             const startOk = !freeDeliveryOffer.startDate || new Date(freeDeliveryOffer.startDate) <= nowForOffer;
//             const endOk = !freeDeliveryOffer.endDate || new Date(freeDeliveryOffer.endDate) >= nowForOffer;
//             const minAmount = parseFloat(freeDeliveryOffer.minOrderAmount as string || "0");

//             if (startOk && endOk && subtotal >= minAmount) {
//                 isFreeDelivery = true;
//                 deliveryFee = 0;
//             }
//         }
//     }

//     let totalAmount = roundMoney(subtotal + deliveryFee + serviceFee - totalDiscount);
//     if (totalAmount < 0) totalAmount = 0;

//     const orderId = uuidv4();
//     const orderNumber = `ORD-${Date.now()}`;

//     const [userInfo] = await db.select({ id: users.id, name: users.name, phone: users.phone, email: users.email })
//         .from(users).where(eq(users.id, userId)).limit(1);

//     // ==========================================
//     // 🛡️ 10. Execute Order (Transaction)
//     // ==========================================
//     const now = new Date();
//     const startOfToday = new Date(now);
//     startOfToday.setHours(0, 0, 0, 0);

//     let createdDailyOrderNumber = 1;

//     await db.transaction(async (tx) => {
//         // 🔒 1. Wallet deduction with FOR UPDATE
//         if (isWalletPayment) {
//             const [userWallet] = await tx.select()
//                 .from(userWallets)
//                 .where(eq(userWallets.userId, userId))
//                 .for("update");

//             const currentBalance = parseFloat(userWallet?.balance as string || "0");
//             if (!userWallet || currentBalance < totalAmount) {
//                 throw new BadRequest("Insufficient wallet balance");
//             }

//             const newBalance = roundMoney(currentBalance - totalAmount);

//             await tx.update(userWallets)
//                 .set({ balance: newBalance.toFixed(2) })
//                 .where(eq(userWallets.userId, userId));

//             await tx.insert(userWalletTransactions).values({
//                 id: uuidv4(),
//                 userId,
//                 type: "debit",
//                 transactionType: "order_payment",
//                 amount: totalAmount.toFixed(2),
//                 balanceBefore: currentBalance.toFixed(2),
//                 reference: orderNumber,
//                 status: "approved",
//                 createdAt: now
//             });
//         }

//         // 🔒 2. Daily order number calculation
//         const [ordersCountResult] = await tx
//             .select({ count: sql<number>`count(${orders.id})` })
//             .from(orders)
//             .where(
//                 and(
//                     eq(orders.restaurantId, restaurantId),
//                     gte(orders.createdAt, startOfToday)
//                 )
//             );

//         createdDailyOrderNumber = Number(ordersCountResult?.count || 0) + 1;

//         // 3. Create order record
//         await tx.insert(orders).values({
//             id: orderId,
//             orderNumber,
//             idempotencyKey,
//             userId,
//             restaurantId,
//             branchId: resolvedBranchId,
//             zoneId: resolvedZoneId,
//             addressId: addressId || null,
//             orderSource,
//             paymentMethod,
//             orderType: resolvedOrderType,
//             subtotal: subtotal.toFixed(2),
//             deliveryFee: deliveryFee.toFixed(2),
//             serviceFee: serviceFee.toFixed(2),
//             appCommission: appCommission.toFixed(2),
//             discountAmount: totalDiscount.toFixed(2),
//             couponCode: couponCode || null,
//             totalAmount: totalAmount.toFixed(2),
//             note: note || null,
//             status: "pending",
//             dailyOrderNumber: createdDailyOrderNumber,
//             durationOrderPreparing: defaultPreparingDuration,
//             createdAt: now
//         });

//         await tx.insert(orderItems).values(itemsToInsert.map(i => ({ ...i, orderId })));
//         await tx.delete(cartItems).where(eq(cartItems.userId, userId));

//         // Superadmin notification
//         await tx.insert(notifications).values({
//             recipientType: "superadmin",
//             recipientId: "superadmin",
//             title: "New Order",
//             body: `Order #${createdDailyOrderNumber} has been placed at ${restaurant?.name}.`,
//             data: { orderId, orderNumber, createdDailyOrderNumber, restaurantName: restaurant?.name }
//         });

//         // 4. Coupons and Discounts tracking
//         if (appliedCoupon) {
//             await tx.insert(couponUsages).values({
//                 id: uuidv4(),
//                 couponId: appliedCoupon.id,
//                 userId,
//                 orderId,
//                  discountAmount: appliedCoupon.discountType === "free_delivery"
// ? calculatedDeliveryFee.toFixed(2)
// : totalDiscount.toFixed(2)
//             });

//             await tx.update(coupons)
//                 .set({ usedCount: sql`used_count + 1` })
//                 .where(eq(coupons.id, appliedCoupon.id));
//         }

//         if (discountState.appliedDiscounts.size > 0) {
//             for (const dId of Array.from(discountState.appliedDiscounts)) {
//                 await tx.update(discounts)
//                     .set({ usedCount: sql`used_count + 1` })
//                     .where(eq(discounts.id, dId));
//             }
//         }

//         // 5. Restaurant wallet calculations
//         let [restaurantWallet] = await tx.select().from(restaurantWallets).where(eq(restaurantWallets.restaurantId, restaurantId)).for("update");

//         if (!restaurantWallet) {
//             await tx.insert(restaurantWallets).values({
//                 id: uuidv4(),
//                 restaurantId: restaurantId,
//                 balance: "0.00",
//                 collectedCash: "0.00",
//                 totalEarning: "0.00"
//             });
//             restaurantWallet = { balance: "0.00", collectedCash: "0.00", totalEarning: "0.00" } as any;
//         }

//         const currentRestBalance = parseFloat(restaurantWallet.balance as string);
//         const currentCollectedCash = parseFloat(restaurantWallet.collectedCash as string);
//         const currentTotalEarning = parseFloat(restaurantWallet.totalEarning as string);

//         const restaurantEarning = roundMoney(subtotal + deliveryFee - appCommission);
//         const appDues = roundMoney(appCommission + serviceFee);

//         let newRestBalance = currentRestBalance;
//         let newCollectedCash = currentCollectedCash;

//         if (isCashPayment) {
//             newRestBalance = roundMoney(newRestBalance - appDues);
//             newCollectedCash = roundMoney(newCollectedCash + totalAmount);
//         } else {
//             newRestBalance = roundMoney(newRestBalance + restaurantEarning);
//         }

//         await tx.update(restaurantWallets)
//             .set({
//                 balance: newRestBalance.toFixed(2),
//                 collectedCash: newCollectedCash.toFixed(2),
//                 totalEarning: roundMoney(currentTotalEarning + restaurantEarning).toFixed(2)
//             })
//             .where(eq(restaurantWallets.restaurantId, restaurantId));

//         await tx.insert(restaurantWalletTransactions).values({
//             id: uuidv4(),
//             restaurantId,
//             type: "order_payment",
//             amount: isCashPayment ? `-${appDues.toFixed(2)}` : `${restaurantEarning.toFixed(2)}`,
//             balanceBefore: currentRestBalance.toFixed(2),
//             balanceAfter: newRestBalance.toFixed(2),
//             method: paymentMethodName,
//             reference: orderNumber,
//             note: isCashPayment ? "Commission deducted from cash order" : "Earnings added from digital payment",
//             createdAt: now
//         });
//     });

//     // ==========================================
//     // 11. Send Notification to Restaurant
//     // ==========================================
//     const cairoTimeFormatted = new Intl.DateTimeFormat("ar-EG", {
//         timeZone: "Africa/Cairo",
//         hour: "numeric",
//         minute: "numeric",
//         hour12: true
//     }).format(now);

//     await sendPushNotification({
//         recipientType: "restaurant",
//         recipientId: restaurantId,
//         branchId: resolvedBranchId || null,
//         title: "طلب جديد! 🛒",
//         body: `تم استلام طلب جديد #${createdDailyOrderNumber} بقيمة ${totalAmount} ج.م الساعة ${cairoTimeFormatted}.`,
//         data: {
//             orderId,
//             orderNumber,
//             branchId: resolvedBranchId || null,
//             type: "new_order",
//             createdAt: now.toISOString(),
//             dailyOrderNumber: createdDailyOrderNumber
//         }
//     });

//     return SuccessResponse(res, {
//         message: "Order created successfully",
//         order_level: {
//             orderDetails: {
//                 orderId,
//                 orderNumber,
//                 zoneId: resolvedZoneId,
//                 subtotal,
//                 deliveryFee,
//                 serviceFee,
//                 discountAmount: totalDiscount,
//                 couponCode: couponCode || null,
//                 totalAmount,
//                 createdAt: now.toISOString(),
//                 dailyOrderNumber: createdDailyOrderNumber,
//                 durationOrderPreparing: defaultPreparingDuration,
//             },
//             customerDetails: userInfo
//         }
//     });
// };





// ==========================================
// 4. Restaurant Details + Menu
// ==========================================
// export const getRestaurantDetails = async (req: Request, res: Response) => {
//     const { restaurantId } = req.params;
//     const userId = req.user?.id;

//     const { favoriteFoodIds, favoriteRestaurantIds } = await getUserFavoritesSets(userId);

//     // 1. Fetch Restaurant Info
//     const [restaurantInfo] = await db
//         .select({
//             id: restaurants.id,
//             name: restaurants.name,
//             nameAr: restaurants.nameAr,
//             nameFr: restaurants.nameFr,
//             minDeliveryTime: restaurants.minDeliveryTime,
//             maxDeliveryTime: restaurants.maxDeliveryTime,
//             deliveryTimeUnit: restaurants.deliveryTimeUnit,
//             logo: restaurants.logo,
//             cover: restaurants.cover,
//             iosApp: restaurants.iosApp,
//             androidApp: restaurants.androidApp,
//         })
//         .from(restaurants)
//         .where(eq(restaurants.id, restaurantId));

//     if (!restaurantInfo) throw new Error("Restaurant not found");

//     const restaurantWithFav = {
//         ...restaurantInfo,
//         isFavorite: userId ? favoriteRestaurantIds.has(restaurantId) : false,
//     };

//     // 2. Fetch Active Foods and main relations
//     const rawMenu = await db
//         .select({
//             foodId: food.id,
//             foodName: food.name,
//             foodNameAr: food.nameAr,
//             foodNameFr: food.nameFr,
//             description: food.description,
//             descriptionAr: food.descriptionAr,
//             descriptionFr: food.descriptionFr,
//             price: food.price,
//             foodDiscountType: food.discount_type,
//             foodDiscountValue: food.discount_value,
//             isOutOfStock: food.isOutOfStock,
//             image: food.image,
//             points: food.points,
//             addonsId: food.addonsId,

//             categoryId: categories.id,
//             categoryName: categories.name,
//             categoryNameAr: categories.nameAr,
//             categoryNameFr: categories.nameFr,

//             subcategoryId: subcategories.id,
//             subcategoryName: subcategories.name,
//             subcategoryNameAr: subcategories.nameAr,
//             subcategoryNameFr: subcategories.nameFr,
//             order_level: subcategories.order_Level,
//         })
//         .from(food)
//         .leftJoin(categories, eq(food.categoryid, categories.id))
//         .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
//         .where(
//             and(
//                 eq(food.restaurantid, restaurantId),
//                 eq(food.status, "active"),
//                 or(isNull(categories.id), eq(categories.status, "active")),
//                 or(isNull(subcategories.id), eq(subcategories.status, "active"))
//             )
//         );

//     if (rawMenu.length === 0) {
//         return SuccessResponse(res, {
//             data: {
//                 restaurant: restaurantWithFav,
//                 menu: [],
//                 addons: []
//             }
//         });
//     }

//     const foodIds = rawMenu.map(r => r.foodId);

//     // 3. Batch Fetch Variations & Options
//     const variationsList = foodIds.length > 0
//         ? await db
//             .select({
//                 variationId: foodVariations.id,
//                 foodId: foodVariations.foodId,
//                 variationName: foodVariations.name,
//                 variationNameAr: foodVariations.nameAr,
//                 variationNameFr: foodVariations.nameFr,
//                 isRequired: foodVariations.isRequired,
//                 selectionType: foodVariations.selectionType,
//                 min: foodVariations.min,
//                 max: foodVariations.max,
//                 optionId: variationOptions.id,
//                 optionName: variationOptions.optionName,
//                 optionNameAr: variationOptions.optionNameAr,
//                 optionNameFr: variationOptions.optionNameFr,
//                 additionalPrice: variationOptions.additionalPrice,
//             })
//             .from(foodVariations)
//             .leftJoin(variationOptions, eq(foodVariations.id, variationOptions.variationId))
//             .where(inArray(foodVariations.foodId, foodIds))
//         : [];

//     // Group variations by foodId
//     const foodVariationsMap = new Map<string, any[]>();
//     for (const v of variationsList) {
//         if (!v.foodId) continue;
//         if (!foodVariationsMap.has(v.foodId)) foodVariationsMap.set(v.foodId, []);

//         const currentVars = foodVariationsMap.get(v.foodId)!;
//         let existingVar = currentVars.find(x => x.id === v.variationId);

//         if (!existingVar) {
//             existingVar = {
//                 id: v.variationId,
//                 name: v.variationName,
//                 nameAr: v.variationNameAr,
//                 nameFr: v.variationNameFr,
//                 isRequired: v.isRequired,
//                 selectionType: v.selectionType,
//                 min: v.min,
//                 max: v.max,
//                 options: []
//             };
//             currentVars.push(existingVar);
//         }

//         if (v.optionId) {
//             existingVar.options.push({
//                 id: v.optionId,
//                 name: v.optionName,
//                 nameAr: v.optionNameAr,
//                 nameFr: v.optionNameFr,
//                 additionalPrice: v.additionalPrice
//             });
//         }
//     }

//     // 4. Batch Fetch Restaurant Active Addons
//     const rawAddons = await db
//         .select({
//             addonId: addons.id,
//             addonName: addons.name,
//             addonNameAr: addons.nameAr,
//             addonNameFr: addons.nameFr,
//             addonPrice: addons.price,
//             addonStockType: addons.stock_type,
//             addonStatus: addons.status,
//             addonRestaurantId: addons.restaurantid,
//             addonCreatedAt: addons.createdAt,
//             addonUpdatedAt: addons.updatedAt,
//             categoryId: adonescategory.id,
//             categoryName: adonescategory.name,
//             categoryNameAr: adonescategory.nameAr,
//             categoryNameFr: adonescategory.nameFr,
//         })
//         .from(addons)
//         .leftJoin(adonescategory, eq(addons.adonescategoryid, adonescategory.id))
//         .where(
//             and(
//                 eq(addons.restaurantid, restaurantId),
//                 eq(addons.status, "active")
//             )
//         );

//     const addonsMap = new Map<string, any>();
//     for (const a of rawAddons) {
//         addonsMap.set(a.addonId, {
//             id: a.addonId,
//             name: a.addonName,
//             nameAr: a.addonNameAr,
//             nameFr: a.addonNameFr,
//             price: a.addonPrice,
//             status: a.addonStatus,
//             stockType: a.addonStockType,
//             restaurantId: a.addonRestaurantId,
//             createdAt: a.addonCreatedAt,
//             updatedAt: a.addonUpdatedAt,
//             category: a.categoryId ? {
//                 id: a.categoryId,
//                 name: a.categoryName,
//                 nameAr: a.categoryNameAr,
//                 nameFr: a.categoryNameFr
//             } : null
//         });
//     }

//     // 5. Check Food & Subcategory Branch Availability
//     const menuActiveFoodIds = rawMenu
//         .filter(f => !f.isOutOfStock)
//         .map(f => f.foodId);

//     const menuUnavailableBranchesMap = menuActiveFoodIds.length > 0
//         ? await getUnavailableBranchesForFoods(menuActiveFoodIds)
//         : new Map<string, BranchInfo[]>();

//     const activeSubcategoryIds = [...new Set(
//         rawMenu
//             .filter(f => !f.isOutOfStock && f.subcategoryId)
//             .map(f => f.subcategoryId!)
//     )];

//     const subcategoryUnavailableBranchesMap = new Map<string, BranchInfo[]>();
//     if (activeSubcategoryIds.length > 0) {
//         const inactiveSubcats = await db
//             .select({
//                 subcategoryId: branchSubcategories.subcategoryId,
//                 branchId: branches.id,
//                 branchName: branches.name,
//                 branchNameAr: branches.nameAr,
//                 branchNameFr: branches.nameFr,
//             })
//             .from(branchSubcategories)
//             .leftJoin(branches, eq(branchSubcategories.branchId, branches.id))
//             .where(
//                 and(
//                     inArray(branchSubcategories.subcategoryId, activeSubcategoryIds),
//                     eq(branchSubcategories.status, "inactive")
//                 )
//             );

//         for (const row of inactiveSubcats) {
//             if (!row.branchId) continue;
//             if (!subcategoryUnavailableBranchesMap.has(row.subcategoryId)) {
//                 subcategoryUnavailableBranchesMap.set(row.subcategoryId, []);
//             }
//             subcategoryUnavailableBranchesMap.get(row.subcategoryId)!.push({
//                 id: row.branchId,
//                 name: row.branchName || "",
//                 nameAr: row.branchNameAr,
//                 nameFr: row.branchNameFr,
//             });
//         }
//     }

//     // 6. Process Menu & Discounts
//     const availableDiscounts = await getAvailableDiscounts(restaurantId);
//     const categoriesMap = new Map<string, any>();

//     for (const row of rawMenu) {
//         const catId = row.categoryId || "uncategorized";

//         if (!categoriesMap.has(catId)) {
//             categoriesMap.set(catId, {
//                 id: catId === "uncategorized" ? null : catId,
//                 name: row.categoryName || "Other",
//                 nameAr: row.categoryNameAr || "أخرى",
//                 nameFr: row.categoryNameFr || "Autre",
//                 foods: []
//             });
//         }

//         const discountState = {
//             remainingMaxDiscounts: new Map<string, number>(),
//             appliedDiscounts: new Set<string>()
//         };

//         const {
//             price: calculatedDiscountPrice,
//             appliedDiscount,
//             discountNote
//         } = applyPriorityDiscount(
//             { id: row.foodId ?? "", discountType: row.foodDiscountType, discountValue: row.foodDiscountValue },
//             Number(row.price),
//             0,
//             availableDiscounts,
//             discountState,
//             false
//         );

//         let activeDiscountInfo = null;

//         // إذا وُجد خصم مطبق وله id فهو خصم مطعم أو خصم عام من جدول الخصومات
//         if (appliedDiscount && appliedDiscount.id) {
//             activeDiscountInfo = {
//                 id: appliedDiscount.id,
//                 name: appliedDiscount.name,
//                 nameAr: appliedDiscount.nameAr,
//                 type: appliedDiscount.discountType,
//                 value: Number(appliedDiscount.discountValue),
//                 maxDiscount: appliedDiscount.maxDiscount ? Number(appliedDiscount.maxDiscount) : null,
//                 isGlobal: Boolean(appliedDiscount.isGlobal),
//                 source: appliedDiscount.isGlobal ? "global_discount" : "restaurant_discount"
//             };
//         }
//         // إذا كان الخصم قادماً من الصنف نفسه (سواء تم حسابه عبر الدالة أو من قيم الوجبة مباشرة)
//         else if (row.foodDiscountType && Number(row.foodDiscountValue) > 0) {
//             activeDiscountInfo = {
//                 id: null,
//                 name: "Item Discount",
//                 nameAr: "خصم على الصنف",
//                 type: row.foodDiscountType,
//                 value: Number(row.foodDiscountValue),
//                 maxDiscount: null,
//                 isGlobal: false,
//                 source: "food_level" // سيعود الآن بشكل صحيح
//             };
//         }

//         // ==========================================
//         // Safe Addons Parsing
//         // ==========================================
//         let foodAddonIds: string[] = [];

//         if (Array.isArray(row.addonsId)) {
//             foodAddonIds = row.addonsId;
//         } else if (row.addonsId) {
//             const rawAddonsId = row.addonsId as any; // Caste to bypass 'never' type checking

//             if (typeof rawAddonsId === 'string') {
//                 try {
//                     const parsed = JSON.parse(rawAddonsId);
//                     if (Array.isArray(parsed)) {
//                         foodAddonIds = parsed;
//                     } else if (typeof parsed === 'string') {
//                         foodAddonIds = [parsed];
//                     }
//                 } catch {
//                     foodAddonIds = rawAddonsId.split(',').map((s: string) => s.trim());
//                 }
//             }
//         }

//         const foodAddons = foodAddonIds
//             .map(id => addonsMap.get(String(id).trim()))
//             .filter(Boolean);

//         // Branch Unavailability calculations
//         let unavailableBranches: BranchInfo[] | null = [];
//         if (row.isOutOfStock) {
//             unavailableBranches = null;
//         } else {
//             const foodUnavailable = menuUnavailableBranchesMap.get(row.foodId) || [];
//             const subcatUnavailable = row.subcategoryId
//                 ? (subcategoryUnavailableBranchesMap.get(row.subcategoryId) || [])
//                 : [];

//             const combinedBranches = new Map<string, BranchInfo>();
//             [...foodUnavailable, ...subcatUnavailable].forEach(b => combinedBranches.set(b.id, b));
//             unavailableBranches = Array.from(combinedBranches.values());
//         }

//         const foodObject = {
//             id: row.foodId,
//             name: row.foodName,
//             nameAr: row.foodNameAr,
//             nameFr: row.foodNameFr,
//             description: row.description,
//             descriptionAr: row.descriptionAr,
//             descriptionFr: row.descriptionFr,
//             price: Number(row.price),
//             discountType: activeDiscountInfo?.type ?? null,
//             discountValue: activeDiscountInfo?.value ?? null,
//             discountPrice: calculatedDiscountPrice,
//             discountNote,
//             discountDetails: activeDiscountInfo,
//             image: row.image,
//             isOutOfStock: row.isOutOfStock,
//             points: userId ? row.points : null,
//             isFavorite: userId ? favoriteFoodIds.has(row.foodId) : false,
//             variations: foodVariationsMap.get(row.foodId) || [],
//             addons: foodAddons,
//             unavailableBranches,
//             category: row.categoryId ? {
//                 id: row.categoryId,
//                 name: row.categoryName,
//                 nameAr: row.categoryNameAr,
//                 nameFr: row.categoryNameFr,
//             } : null,
//             subcategory: row.subcategoryId ? {
//                 id: row.subcategoryId,
//                 name: row.subcategoryName,
//                 nameAr: row.subcategoryNameAr,
//                 nameFr: row.subcategoryNameFr,
//                 order_level: row.order_level,
//             } : null,
//         };

//         categoriesMap.get(catId).foods.push(foodObject);
//     }

//     // 7. Format General Addons Response
//     const addonsCategoryMap = new Map<string, any>();
//     for (const addon of rawAddons) {
//         const catId = addon.categoryId || "uncategorized";
//         if (!addonsCategoryMap.has(catId)) {
//             addonsCategoryMap.set(catId, {
//                 id: catId === "uncategorized" ? null : catId,
//                 name: addon.categoryName || "Other",
//                 nameAr: addon.categoryNameAr || "أخرى",
//                 nameFr: addon.categoryNameFr || "Autre",
//                 addons: []
//             });
//         }
//         addonsCategoryMap.get(catId).addons.push({
//             id: addon.addonId,
//             name: addon.addonName,
//             nameAr: addon.addonNameAr,
//             nameFr: addon.addonNameFr,
//             price: addon.addonPrice,
//             stockType: addon.addonStockType
//         });
//     }

//     return SuccessResponse(res, {
//         data: {
//             restaurant: restaurantWithFav,
//             menu: Array.from(categoriesMap.values()),
//             addons: Array.from(addonsCategoryMap.values())
//         }
//     });
// };
