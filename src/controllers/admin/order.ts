import { eq, desc, and, inArray, or } from "drizzle-orm";
import { addons, foodVariations, addresses, branches, deliveryMen, food, orderItems, orders, paymentMethods, pointsProducts, restaurants, restaurantWallets, restaurantWalletTransactions, restaurantZoneDeliveryFees, selectReasons, userPointsTransactions, userRestaurantPoints, users, userWallets, userWalletTransactions, variationOptions, zones, restaurantSettings } from "../../models/schema";
import { SuccessResponse } from "../../utils/response";
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { BadRequest, NotFound } from "../../Errors";
import { sendPushNotification } from "../../utils/notifications";
import { v4 as uuidv4 } from "uuid";
import PDFDocument from "pdfkit";

// ==========================================
// Helper: استنتاج الزون من إحداثيات العنوان
// يُستخدم عندما يكون zoneId في العنوان فارغاً (null) أو لتحديد الزون بدقة
// ==========================================

/**
 * دالة مساعدة لفك واستخراج مصفوفة النقاط {lat, lng} من أي شكل محتمل (JSON string, GeoJSON, Array, Objects)
 */
function parseAndNormalizeCoordinates(raw: any): { lat: number; lng: number }[] {
    if (!raw) return [];
    let parsed = raw;

    // في حال كانت الداتا مشفرة كـ JSON string مرة أو أكثر
    while (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed);
        } catch (e) {
            break;
        }
    }

    // إذا كانت مغلفة بمصفوفات إضافية (مثل GeoJSON Polygon coordinates: [[[lng, lat], ...]])
    while (Array.isArray(parsed) && parsed.length === 1 && Array.isArray(parsed[0])) {
        parsed = parsed[0];
    }

    if (!Array.isArray(parsed)) return [];

    const result: { lat: number; lng: number }[] = [];
    for (const item of parsed) {
        if (!item) continue;
        let pLat: number | null = null;
        let pLng: number | null = null;

        if (Array.isArray(item) && item.length >= 2) {
            pLng = Number(item[0]);
            pLat = Number(item[1]);
        } else if (typeof item === "object") {
            pLat = item.lat !== undefined ? Number(item.lat) : (item.latitude !== undefined ? Number(item.latitude) : (item.latitud !== undefined ? Number(item.latitud) : null));
            pLng = item.lng !== undefined ? Number(item.lng) : (item.longitude !== undefined ? Number(item.longitude) : (item.long !== undefined ? Number(item.long) : null));
        }

        if (pLat !== null && pLng !== null && !isNaN(pLat) && !isNaN(pLng)) {
            result.push({ lat: pLat, lng: pLng });
        }
    }

    return result;
}

/**
 * خوارزمية Ray-Casting للتأكد من وقوع النقطة داخل مضلع (Polygon)
 */
function isPointInPolygon(pLat: number, pLng: number, polygon: { lat: number; lng: number }[]): boolean {
    if (!polygon || polygon.length < 3) return false;
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = Number(polygon[i].lng), yi = Number(polygon[i].lat);
        const xj = Number(polygon[j].lng), yj = Number(polygon[j].lat);
        if (isNaN(xi) || isNaN(yi) || isNaN(xj) || isNaN(yj)) continue;
        const intersect = ((yi > pLat) !== (yj > pLat)) &&
            (pLng < ((xj - xi) * (pLat - yi)) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * حساب المسافة بين نقطتين جغرافيتين بالكيلومتر (Haversine Formula)
 */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


/**
 * يحدد أنسب zone لنقطة جغرافية معينة بناءً على zones المطعم النشطة، مع fallback للـ zones العامة إن لم توجد.
 *
 * @param lat خط عرض العنوان
 * @param lng خط طول العنوان
 * @param restaurantId معرف المطعم
 * @returns بيانات الـ zone المُستنتجة، أو null إن لم تتوافق أي zone
 */
async function resolveZoneFromCoords(
    lat: number | string | null | undefined,
    lng: number | string | null | undefined,
    restaurantId?: string | null
): Promise<{ id: string; name: string; nameAr: string | null; nameFr: string | null; deliveryFee: string } | null> {
    if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
    const numLat = typeof lat === "number" ? lat : parseFloat(String(lat));
    const numLng = typeof lng === "number" ? lng : parseFloat(String(lng));
    if (isNaN(numLat) || isNaN(numLng)) return null;

    let bestMatch: { id: string; name: string; nameAr: string | null; nameFr: string | null; deliveryFee: string } | null = null;
    let bestFee = -1;

    // 1. فحص الـ zones المخصصة للمطعم أولاً (في حال وجود restaurantId)
    if (restaurantId) {
        const feesWithZones = await db
            .select({
                fee: {
                    id: restaurantZoneDeliveryFees.id,
                    zoneId: restaurantZoneDeliveryFees.zoneId,
                    coverageType: restaurantZoneDeliveryFees.coverageType,
                    customCoordinates: restaurantZoneDeliveryFees.customCoordinates,
                    customRadiusKm: restaurantZoneDeliveryFees.customRadiusKm,
                    deliveryFee: restaurantZoneDeliveryFees.deliveryFee,
                },
                zone: {
                    id: zones.id,
                    name: zones.name,
                    nameAr: zones.nameAr,
                    nameFr: zones.nameFr,
                    coordinates: zones.coordinates,
                    coverageAreaRadiusKm: zones.coverageAreaRadiusKm,
                    deliveryFee: zones.deliveryFee,
                },
            })
            .from(restaurantZoneDeliveryFees)
            .leftJoin(zones, eq(restaurantZoneDeliveryFees.zoneId, zones.id))
            .where(
                and(
                    eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
                    eq(restaurantZoneDeliveryFees.status, "active")
                )
            );

        for (const row of feesWithZones) {
            if (!row.zone) continue;

            const coverageType = row.fee.coverageType || "POLYGON";
            const rawCoords = row.fee.customCoordinates || row.zone.coordinates;
            const coords = parseAndNormalizeCoordinates(rawCoords);
            const radiusKm = parseFloat(String(row.fee.customRadiusKm || row.zone.coverageAreaRadiusKm || "0"));

            let isInside = false;

            if (coverageType === "RADIUS" && radiusKm > 0 && coords.length > 0) {
                const center = coords.length === 1 ? coords[0] : {
                    lat: coords.reduce((sum, p) => sum + p.lat, 0) / coords.length,
                    lng: coords.reduce((sum, p) => sum + p.lng, 0) / coords.length,
                };
                const distKm = haversineKm(numLat, numLng, center.lat, center.lng);
                isInside = distKm <= radiusKm;
            } else if (coords.length >= 3) {
                isInside = isPointInPolygon(numLat, numLng, coords);
            } else if (radiusKm > 0 && coords.length > 0) {
                const center = coords[0];
                const distKm = haversineKm(numLat, numLng, center.lat, center.lng);
                isInside = distKm <= radiusKm;
            }

            if (isInside) {
                const fee = parseFloat(String(row.fee.deliveryFee || "0"));
                if (fee > bestFee || bestMatch === null) {
                    bestFee = fee;
                    bestMatch = {
                        id: row.zone.id,
                        name: row.zone.name,
                        nameAr: row.zone.nameAr ?? null,
                        nameFr: row.zone.nameFr ?? null,
                        deliveryFee: String(row.fee.deliveryFee || "0"),
                    };
                }
            }
        }
    }

    // 2. إذا لم نجد تطابق في إعدادات المطعم، نبحث في الـ zones العامة بالنظام
    if (!bestMatch) {
        const allActiveZones = await db
            .select({
                id: zones.id,
                name: zones.name,
                nameAr: zones.nameAr,
                nameFr: zones.nameFr,
                coordinates: zones.coordinates,
                coverageAreaRadiusKm: zones.coverageAreaRadiusKm,
                deliveryFee: zones.deliveryFee,
            })
            .from(zones)
            .where(eq(zones.status, "active"));

        for (const zoneRow of allActiveZones) {
            const coords = parseAndNormalizeCoordinates(zoneRow.coordinates);
            const radiusKm = parseFloat(String(zoneRow.coverageAreaRadiusKm || "0"));

            let isInside = false;

            if (coords.length >= 3) {
                isInside = isPointInPolygon(numLat, numLng, coords);
            }
            if (!isInside && radiusKm > 0 && coords.length > 0) {
                const center = coords.length === 1 ? coords[0] : {
                    lat: coords.reduce((sum, p) => sum + p.lat, 0) / coords.length,
                    lng: coords.reduce((sum, p) => sum + p.lng, 0) / coords.length,
                };
                const distKm = haversineKm(numLat, numLng, center.lat, center.lng);
                isInside = distKm <= radiusKm;
            }

            if (isInside) {
                const fee = parseFloat(String(zoneRow.deliveryFee || "0"));
                if (fee > bestFee || bestMatch === null) {
                    bestFee = fee;
                    bestMatch = {
                        id: zoneRow.id,
                        name: zoneRow.name,
                        nameAr: zoneRow.nameAr ?? null,
                        nameFr: zoneRow.nameFr ?? null,
                        deliveryFee: String(zoneRow.deliveryFee || "0"),
                    };
                }
            }
        }
    }

    return bestMatch;
}

export const getOrdersByRestaurant = async (req: Request, res: Response) => {
    const { restaurantId } = req.params; // الأيدي بتاع المطعم اللي باعتينه في اللينك
    const { status } = req.query; // لو عايز تفلتر بـ Pending أو Delivered مثلاً

    // بناء الكويري بشكل ديناميكي
    const baseQuery = db
        .select({
            orderId: orders.orderNumber, // الرقم العشوائي (ORD-123)
            internalId: orders.id,
            orderDate: orders.createdAt,
            totalAmount: orders.totalAmount,
            orderStatus: orders.status,
            customerName: users.name, // اسم العميل من جدول اليوزرز
            customerPhone: users.phone,
            branchName: branches.name,
            branchId: branches.id,
            zoneName: zones.name,
            zoneNameAr: zones.nameAr,
            zoneId: orders.zoneId,
            orderType: orders.orderType,
            deliveryFee: orders.deliveryFee,
        })
        .from(orders)
        .leftJoin(users, eq(orders.userId, users.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(restaurantZoneDeliveryFees, eq(orders.zoneId, restaurantZoneDeliveryFees.id))
        .leftJoin(zones, or(eq(restaurantZoneDeliveryFees.zoneId, zones.id), eq(orders.zoneId, zones.id)));

    // لو الأدمن داس على تابة معينة (مثلاً Pending فقط)
    let condition = eq(orders.restaurantId, restaurantId);
    if (status) {
        condition = and(eq(orders.restaurantId, restaurantId), eq(orders.status, status as any)) as any;
    }

    const result = await baseQuery.where(condition).orderBy(desc(orders.createdAt));

    return SuccessResponse(res, {
        message: "Fetched restaurant orders successfully",
        data: result
    });
};

export const getOrderDetails = async (req: Request, res: Response) => {
    const id = req.params.orderId || req.params.id;
    const isSuperAdmin = req.user?.type === "super_admin";
    const adminRestaurantId = req.user?.restaurantId || req.user?.id || req.params.restaurantId;
    const adminBranchId = req.user?.branchId;

    // 1. جلب البيانات الأساسية للأوردر
    const [orderDetail] = await db.select({
        order: orders,
        customer: {
            id: users.id,
            name: users.name,
            phone: users.phone,
            email: users.email,
        },
        branch: {
            id: branches.id,
            name: branches.name,
        },
        restaurant: {
            id: restaurants.id,
            name: restaurants.name,
        },
        address: {
            id: addresses.id,
            type: addresses.type,
            title: addresses.title,
            lat: addresses.lat,
            lng: addresses.lng,
            street: addresses.street,
            number: addresses.number,
            floor: addresses.floor,
            apartment: addresses.apartment,
            landmark: addresses.landmark,
            location: addresses.location,
            zoneId: addresses.zoneId,
        },
        zone: {
            id: zones.id,
            name: zones.name,
            nameAr: zones.nameAr,
            nameFr: zones.nameFr,
        },
        driver: {
            id: deliveryMen.id,
            name: deliveryMen.name,
            phone: deliveryMen.phone,
        },
    })
        .from(orders)
        .leftJoin(users, eq(orders.userId, users.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(deliveryMen, eq(orders.deliveryManId, deliveryMen.id))
        .leftJoin(addresses, eq(orders.addressId, addresses.id))
        .leftJoin(restaurantZoneDeliveryFees, eq(orders.zoneId, restaurantZoneDeliveryFees.id))
        .leftJoin(zones, or(eq(restaurantZoneDeliveryFees.zoneId, zones.id), eq(orders.zoneId, zones.id), eq(addresses.zoneId, zones.id)))
        .where(eq(orders.id, id))
        .limit(1);

    if (!orderDetail) throw new NotFound("Order not found");

    // 🛡️ حماية الصلاحيات
    if (!isSuperAdmin) {
        if (adminRestaurantId && orderDetail.order.restaurantId !== adminRestaurantId) {
            throw new BadRequest("Unauthorized: Order does not belong to your restaurant");
        }
        if (adminBranchId && orderDetail.order.branchId !== adminBranchId) {
            throw new BadRequest("Unauthorized: Order does not belong to your branch");
        }
    }

    // ==========================================
    // 🗺️ Fallback: استنتاج الزون من إحداثيات العنوان إذا كان zone فارغاً
    // ==========================================
    let resolvedZone = (orderDetail.zone && orderDetail.zone.id)
        ? orderDetail.zone
        : null;

    const restaurantId = orderDetail.order.restaurantId;
    const addrLat = orderDetail.address?.lat ? parseFloat(String(orderDetail.address.lat)) : null;
    const addrLng = orderDetail.address?.lng ? parseFloat(String(orderDetail.address.lng)) : null;

    if (!resolvedZone && addrLat !== null && addrLng !== null && !isNaN(addrLat) && !isNaN(addrLng)) {
        const detected = await resolveZoneFromCoords(addrLat, addrLng, restaurantId);
        if (detected) {
            resolvedZone = {
                id: detected.id,
                name: detected.name,
                nameAr: detected.nameAr ?? "",
                nameFr: detected.nameFr ?? "",
            };
        }
    }

    // ==========================================
    // 🏢 استنتاج الفرع (Branch) بناءً على الـ Zone إذا لم يكن محدداً في الأوردر
    // ==========================================
    let resolvedBranch = (orderDetail.branch && orderDetail.branch.id)
        ? orderDetail.branch
        : null;

    const targetZoneId = resolvedZone?.id || orderDetail.address?.zoneId;

    if ((!resolvedBranch || !resolvedBranch.id) && targetZoneId && restaurantId) {
        const [matchedBranch] = await db
            .select({
                id: branches.id,
                name: branches.name,
            })
            .from(branches)
            .where(
                and(
                    eq(branches.restaurantId, restaurantId),
                    eq(branches.zoneId, targetZoneId),
                    eq(branches.status, "active")
                )
            )
            .limit(1);

        if (matchedBranch) {
            resolvedBranch = matchedBranch;
        }
    }

    // Fallback: إذا لم نجد فرعاً خاصاً بالزون، نجلب أي فرع نشط للمطعم
    if ((!resolvedBranch || !resolvedBranch.id) && restaurantId) {
        const [fallbackBranch] = await db
            .select({
                id: branches.id,
                name: branches.name,
            })
            .from(branches)
            .where(
                and(
                    eq(branches.restaurantId, restaurantId),
                    eq(branches.status, "active")
                )
            )
            .limit(1);

        if (fallbackBranch) {
            resolvedBranch = fallbackBranch;
        }
    }

    // 2. جلب أصناف الأكل (Order Items)
    const items = await db.select({
        id: orderItems.id,
        foodId: orderItems.foodId,
        quantity: orderItems.quantity,
        basePrice: orderItems.basePrice,
        variationsPrice: orderItems.variationsPrice,
        addonsPrice: orderItems.addonsPrice,
        totalPrice: orderItems.totalPrice,
        note: orderItems.note,
        variations: orderItems.variations,
        addons: orderItems.addons,
        foodName: food.name,
        foodNameAr: food.nameAr,
        foodNameFr: food.nameFr,
        foodImage: food.image,
        foodDescription: food.description,
    })
        .from(orderItems)
        .leftJoin(food, eq(orderItems.foodId, food.id))
        .where(eq(orderItems.orderId, id));

    // ✅ 3. تنظيف الـ Variations وجلب الأسماء وحساب السعر ديناميكياً
    const formattedItems = await Promise.all(items.map(async (item) => {
        let cleanVariations = item.variations;

        if (typeof cleanVariations === 'string') {
            try {
                cleanVariations = JSON.parse(cleanVariations);
                if (typeof cleanVariations === 'string') {
                    cleanVariations = JSON.parse(cleanVariations);
                }
            } catch (error) {
                console.error("Error parsing variations for item ID:", item.id);
            }
        }

        let totalCalculatedVarPrice = 0;

        if (Array.isArray(cleanVariations) && cleanVariations.length > 0) {
            cleanVariations = await Promise.all(cleanVariations.map(async (v: any) => {
                let variationName = v.variationName || "Unknown";
                let variationNameAr = v.variationNameAr || "غير معروف";
                let optionName = v.optionName || "Unknown";
                let optionNameAr = v.optionNameAr || "غير معروف";
                let price = parseFloat(v.price || v.additionalPrice || "0");

                const hasSnapshotDetails = Boolean(v.variationName && v.optionName);

                if (!hasSnapshotDetails) {
                    if (v.variationId) {
                        const [varDb] = await db.select().from(foodVariations).where(eq(foodVariations.id, v.variationId)).limit(1);
                        if (varDb) {
                            variationName = varDb.name || variationName;
                            variationNameAr = varDb.nameAr || variationNameAr;
                        }
                    }

                    if (v.optionId) {
                        const [optDb] = await db.select().from(variationOptions).where(eq(variationOptions.id, v.optionId)).limit(1);
                        if (optDb) {
                            optionName = optDb.optionName || optionName;
                            optionNameAr = optDb.optionNameAr || optionNameAr;
                            price = parseFloat((optDb as any).price || optDb.additionalPrice || "0");
                        }
                    }
                }

                totalCalculatedVarPrice += price;

                return {
                    ...v,
                    variationName,
                    variationNameAr,
                    optionName,
                    optionNameAr,
                    price: price.toString()
                };
            }));
        }

        const finalVarPrice = parseFloat(item.variationsPrice || "0") > 0 ? parseFloat(item.variationsPrice || "0") : totalCalculatedVarPrice;
        const finalAddonsPrice = parseFloat(item.addonsPrice || "0");
        const finalTotalPrice = (parseFloat(item.basePrice || "0") + finalVarPrice + finalAddonsPrice) * item.quantity;

        // 🌟 جلب تفاصيل الـ Addons اللي اختارها العميل فعلاً
        let foodAddons: any[] = [];
        let selectedAddonIds = item.addons;
        if (typeof selectedAddonIds === "string") {
            try {
                selectedAddonIds = JSON.parse(selectedAddonIds);
            } catch {
                selectedAddonIds = [];
            }
        }
        if (Array.isArray(selectedAddonIds) && selectedAddonIds.length > 0) {
            // استخراج معرفات الإضافات (IDs) في حال كانت مصفوفة من الكائنات
            const extractedIds = selectedAddonIds.map((addon: any) => {
                if (typeof addon === "string") return addon;
                if (addon && addon.addonId) return String(addon.addonId);
                if (addon && addon.id) return String(addon.id);
                return String(addon);
            }).filter(id => id && id.trim() !== "" && id !== "[object Object]");

            if (extractedIds.length > 0) {
                foodAddons = await db
                    .select({
                        id: addons.id,
                        name: addons.name,
                        nameAr: addons.nameAr,
                        nameFr: addons.nameFr,
                        price: addons.price,
                        status: addons.status,
                        categoryId: addons.adonescategoryid,
                    })
                    .from(addons)
                    .where(inArray(addons.id, extractedIds));
            }
        }

        return {
            ...item,
            addons: foodAddons,
            variationsPrice: finalVarPrice.toFixed(2),
            addonsPrice: finalAddonsPrice.toFixed(2),
            totalPrice: finalTotalPrice.toFixed(2),
            variations: cleanVariations,
        };
    }));

    // 4. جلب بيانات وسيلة الدفع من جدول payment_methods
    let pmDetails: any = null;
    const pmValue = orderDetail.order.paymentMethod;

    if (pmValue && pmValue.length === 36) {
        try {
            const [pm] = await db.select({
                id: paymentMethods.id,
                name: paymentMethods.name,
                nameAr: paymentMethods.nameAr
            }).from(paymentMethods).where(eq(paymentMethods.id, pmValue)).limit(1);

            if (pm) {
                pmDetails = {
                    id: pm.id,
                    name: pm.name,
                    nameAr: pm.nameAr,
                };
            } else {
                pmDetails = { id: pmValue, name: "Unknown", nameAr: "غير معروف" };
            }
        } catch (error) {
            console.error("Error fetching payment method:", error);
            pmDetails = { id: pmValue, name: "Unknown", nameAr: "غير معروف" };
        }
    } else {
        switch (pmValue) {
            case "cash_on_delivery":
                pmDetails = { id: pmValue, name: "Cash on Delivery", nameAr: "الدفع عند الاستلام", nameFr: "Paiement à la livraison" };
                break;
            case "visa":
                pmDetails = { id: pmValue, name: "Credit Card", nameAr: "بطاقة", nameFr: "Carte de crédit" };
                break;
            case "wallet":
                pmDetails = { id: pmValue, name: "Wallet", nameAr: "محفظتي", nameFr: "Portefeuille" };
                break;
            default:
                pmDetails = { id: pmValue, name: pmValue, nameAr: pmValue };
        }
    }

    return SuccessResponse(res, {
        message: "Get order details success",
        data: {
            id: orderDetail.order.id,
            orderNumber: orderDetail.order.orderNumber,
            dailyOrderNumber: orderDetail.order.dailyOrderNumber,
            orderType: orderDetail.order.orderType,
            orderSource: orderDetail.order.orderSource,
            status: orderDetail.order.status,
            cancelReason: orderDetail.order.cancelReason,
            note: orderDetail.order.note,
            subtotal: orderDetail.order.subtotal,
            deliveryFee: orderDetail.order.deliveryFee,
            serviceFee: orderDetail.order.serviceFee,
            appCommission: orderDetail.order.appCommission,
            totalAmount: orderDetail.order.totalAmount,
            createdAt: orderDetail.order.createdAt,
            updatedAt: orderDetail.order.updatedAt,
            durationOrderPreparing: orderDetail.order.durationOrderPreparing,
            customer: orderDetail.customer,

            paymentMethod: typeof pmDetails === "object" && pmDetails !== null ? pmDetails.id : pmDetails,
            paymentMethodName: typeof pmDetails === "object" && pmDetails !== null ? pmDetails.name : pmDetails,
            paymentMethodNameAr: typeof pmDetails === "object" && pmDetails !== null ? pmDetails.nameAr : pmDetails,

            branchId: resolvedBranch?.id || orderDetail.order.branchId || null,
            branch: resolvedBranch || orderDetail.branch || null,
            restaurant: orderDetail.restaurant,
            address: orderDetail.address,
            zone: resolvedZone,
            driver: orderDetail.driver,
            items: formattedItems
        }
    });
};

export const getAllOrders = async (req: Request, res: Response) => {
    const result = await db.select({
        orderId: orders.orderNumber,
        internalId: orders.id,
        orderDate: orders.createdAt,
        totalAmount: orders.totalAmount,
        orderStatus: orders.status,
        customerName: users.name,
        customerPhone: users.phone,
        restaurantName: restaurants.name,
        restaurantId: restaurants.id,
        branchName: branches.name,
        branchId: branches.id,
        zoneName: zones.name,
        zoneNameAr: zones.nameAr,
        zoneId: orders.zoneId,
        paymentMethod: orders.paymentMethod,
        orderType: orders.orderType,
        deliveryFee: orders.deliveryFee,
        serviceFee: orders.serviceFee,
        appCommission: orders.appCommission,
        discountAmount: orders.discountAmount,
        rating: orders.rating,
        ratingComment: orders.ratingComment,
        cancelReason: orders.cancelReason,
        cancelReasonId: orders.cancelReasonId,
        note: orders.note,
        dailyOrderNumber: orders.dailyOrderNumber,
    })
        .from(orders)
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(users, eq(orders.userId, users.id))
        .leftJoin(restaurantZoneDeliveryFees, eq(orders.zoneId, restaurantZoneDeliveryFees.id))
        .leftJoin(zones, or(eq(restaurantZoneDeliveryFees.zoneId, zones.id), eq(orders.zoneId, zones.id)))
        .orderBy(desc(orders.createdAt));
    return SuccessResponse(res, {
        message: "All orders fetched successfully",
        data: result
    });
};


// ==========================================
// 3. تحديث حالة الأوردر (مع إرجاع الفلوس والعمولة لو المطعم كنسل)
// تحديث حالة الأوردر (إرجاع المحفظة + التسوية + إضافة النقاط عند delivered)
// ==========================================
export const updateOrderStatus = async (req: Request, res: Response) => {
    const { orderId } = req.params;
    const { status, cancelReasonId } = req.body;

    const adminRestaurantId = req.user?.restaurantId || req.user?.id;
    const adminBranchId = req.user?.branchId;

    if (!status) throw new BadRequest("Status is required");

    if (status === "cancelled" && !cancelReasonId) {
        throw new BadRequest("Cancel reason ID is required when cancelling an order");
    }

    const [existingOrder] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!existingOrder) throw new NotFound("Order not found");

    // Only restaurant admins are restricted to their own restaurant/branch.
    // SuperAdmins (type === "super_admin") can update any order.
    const isSuperAdmin = req.user?.type === "super_admin";
    if (!isSuperAdmin) {
        if (existingOrder.restaurantId !== adminRestaurantId) throw new BadRequest("Unauthorized");
        if (adminBranchId && existingOrder.branchId !== adminBranchId) throw new BadRequest("Unauthorized");
    }

    const currentStatus = existingOrder.status as string;

    const finalStatuses = ["delivered", "cancelled", "refund"];
    if (finalStatuses.includes(currentStatus)) {
        throw new BadRequest(`Order is already ${currentStatus} and cannot be changed`);
    }

    const statusFlowOrder: Record<string, number> = {
        "pending": 1,
        "accepted": 2,
        "preparing": 3,
        "out_for_delivery": 4,
        "delivered": 5,
    };

    if (statusFlowOrder[currentStatus] && statusFlowOrder[status]) {
        if (statusFlowOrder[status] === statusFlowOrder[currentStatus]) {
            throw new BadRequest(`Order is already ${currentStatus}`);
        }
        if (statusFlowOrder[status] < statusFlowOrder[currentStatus]) {
            throw new BadRequest(`Cannot revert status from ${currentStatus} to ${status}`);
        }
    } else if (currentStatus === status) {
        throw new BadRequest(`Order is already ${currentStatus}`);
    }

    let reason: any = null;
    if (status === "cancelled") {
        const [found] = await db.select().from(selectReasons)
            .where(and(eq(selectReasons.id, cancelReasonId), eq(selectReasons.type, "restaurant")))
            .limit(1);
        if (!found) throw new BadRequest("Invalid cancel reason for restaurant");
        reason = found;
    }

    await db.transaction(async (tx) => {
        // 1. تحديث حالة الطلب
        await tx.update(orders)
            .set({
                status: status,
                cancelReasonId: status === "cancelled" ? reason.id : null,
                cancelReason: status === "cancelled" ? reason.name : null,
                updatedAt: new Date()
            })
            .where(eq(orders.id, orderId));

        // ==========================================
        // 💰 2. الـ Refund لمحفظة العميل (User Wallet) عند الإلغاء
        // ==========================================
        if (status === "cancelled" || status === "rejected") {
            // البحث هل تم الدفع سابقاً بواسطة المحفظة
            const [walletTx] = await tx.select().from(userWalletTransactions)
                .where(and(
                    eq(userWalletTransactions.reference, existingOrder.orderNumber),
                    eq(userWalletTransactions.transactionType, "order_payment")
                )).limit(1);

            if (walletTx) {
                const [userWallet] = await tx.select().from(userWallets)
                    .where(eq(userWallets.userId, existingOrder.userId)).limit(1);

                if (userWallet) {
                    const balanceBefore = parseFloat(userWallet.balance ?? "0.00");
                    const amountToRefund = parseFloat(existingOrder.totalAmount as string || "0.00");
                    const newBalance = balanceBefore + amountToRefund;

                    // تحديث رصيد محفظة العميل
                    await tx.update(userWallets)
                        .set({
                            balance: newBalance.toFixed(2),
                            updatedAt: new Date()
                        })
                        .where(eq(userWallets.id, userWallet.id));

                    // إضافة حركة إرجاع الرصيد (Refund Transaction)
                    await tx.insert(userWalletTransactions).values({
                        id: uuidv4(),
                        userId: existingOrder.userId,
                        paymentMethodId: existingOrder.paymentMethod ?? null,
                        type: "credit",
                        transactionType: "refund",
                        amount: amountToRefund.toFixed(2),
                        balanceBefore: balanceBefore.toFixed(2),
                        reference: existingOrder.orderNumber,
                        status: "approved",
                        createdAt: new Date()
                    });
                }
            }

            // ==========================================
            // 💰 3. التسوية العكسية لمحفظة المطعم (Restaurant Wallet Reversal)
            // ==========================================
            let payment = null;

            if (existingOrder.paymentMethod) {
                [payment] = await tx
                    .select()
                    .from(paymentMethods)
                    .where(eq(paymentMethods.id, existingOrder.paymentMethod))
                    .limit(1);
            }
            const pmName = (payment?.name || "").toLowerCase();
            const isCashPayment = pmName.includes("cash") || pmName.includes("استلام");

            const appCommission = parseFloat(existingOrder.appCommission as string || "0");
            const serviceFee = parseFloat(existingOrder.serviceFee as string || "0");
            const totalAmount = parseFloat(existingOrder.totalAmount as string || "0");
            const subtotal = parseFloat(existingOrder.subtotal as string || "0");
            const deliveryFee = parseFloat(existingOrder.deliveryFee as string || "0");

            const appDues = appCommission + serviceFee;
            const restaurantEarning = subtotal + deliveryFee - appCommission;

            let [restWallet] = await tx.select().from(restaurantWallets)
                .where(eq(restaurantWallets.restaurantId, existingOrder.restaurantId)).limit(1);

            if (!restWallet) {
                await tx.insert(restaurantWallets).values({ id: uuidv4(), restaurantId: existingOrder.restaurantId });
                [restWallet] = await tx.select().from(restaurantWallets)
                    .where(eq(restaurantWallets.restaurantId, existingOrder.restaurantId)).limit(1);
            }

            let currentBalance = parseFloat(restWallet.balance as string || "0");
            let currentCollectedCash = parseFloat(restWallet.collectedCash as string || "0");
            let currentTotalEarning = parseFloat(restWallet.totalEarning as string || "0");

            if (isCashPayment) {
                currentBalance += appDues;
                currentCollectedCash -= totalAmount;
            } else {
                currentBalance -= restaurantEarning;
            }
            currentTotalEarning -= restaurantEarning;

            const balanceAfterPenalty = currentBalance - appDues;

            await tx.update(restaurantWallets)
                .set({
                    balance: balanceAfterPenalty.toFixed(2),
                    collectedCash: currentCollectedCash.toFixed(2),
                    totalEarning: currentTotalEarning.toFixed(2),
                    updatedAt: new Date()
                })
                .where(eq(restaurantWallets.restaurantId, existingOrder.restaurantId));

            await tx.insert(restaurantWalletTransactions).values({
                id: uuidv4(),
                restaurantId: existingOrder.restaurantId,
                type: "order_payment",
                amount: `-${appDues.toFixed(2)}`,
                balanceBefore: currentBalance.toFixed(2),
                balanceAfter: balanceAfterPenalty.toFixed(2),
                method: existingOrder.paymentMethod,
                reference: existingOrder.orderNumber,
                note: `Order Reversal & Penalty: Cancelled by restaurant. Commission deducted: ${appDues}`,
                createdAt: new Date()
            });
        }

        // ==========================================
        // ⭐ LOYALTY POINTS: إضافة نقاط المطعم عند التوصيل (DELIVERED)
        // ==========================================
        if (status === "delivered") {
            const items = await tx
                .select({ foodId: orderItems.foodId, quantity: orderItems.quantity })
                .from(orderItems)
                .where(eq(orderItems.orderId, orderId));

            if (items.length > 0) {
                const foodIds = items.map(i => i.foodId);

                const enrolledRows = await tx
                    .select({ foodId: pointsProducts.foodId, isActive: pointsProducts.isActive })
                    .from(pointsProducts)
                    .where(
                        and(
                            eq(pointsProducts.restaurantId, existingOrder.restaurantId),
                            inArray(pointsProducts.foodId, foodIds)
                        )
                    );

                const enrolledMap = new Map(
                    enrolledRows.filter(r => r.isActive).map(r => [r.foodId, true])
                );

                if (enrolledMap.size > 0) {
                    const enrolledFoodIds = foodIds.filter(id => enrolledMap.has(id));
                    const foodPoints = await tx
                        .select({ id: food.id, points: food.points })
                        .from(food)
                        .where(inArray(food.id, enrolledFoodIds));

                    const foodPointsMap = new Map(foodPoints.map(f => [f.id, f.points ?? 0]));

                    let totalPointsEarned = 0;
                    for (const item of items) {
                        if (enrolledMap.has(item.foodId)) {
                            totalPointsEarned += (foodPointsMap.get(item.foodId) ?? 0) * item.quantity;
                        }
                    }

                    if (totalPointsEarned > 0) {
                        let [userPointRecord] = await tx
                            .select()
                            .from(userRestaurantPoints)
                            .where(
                                and(
                                    eq(userRestaurantPoints.userId, existingOrder.userId),
                                    eq(userRestaurantPoints.restaurantId, existingOrder.restaurantId)
                                )
                            )
                            .limit(1);

                        if (!userPointRecord) {
                            const newPointId = uuidv4();
                            await tx.insert(userRestaurantPoints).values({
                                id: newPointId,
                                userId: existingOrder.userId,
                                restaurantId: existingOrder.restaurantId,
                                points: 0,
                            });
                            [userPointRecord] = await tx
                                .select()
                                .from(userRestaurantPoints)
                                .where(eq(userRestaurantPoints.id, newPointId))
                                .limit(1);
                        }

                        const pointsBefore = userPointRecord.points ?? 0;
                        const pointsAfter = pointsBefore + totalPointsEarned;

                        await tx
                            .update(userRestaurantPoints)
                            .set({ points: pointsAfter, updatedAt: new Date() })
                            .where(eq(userRestaurantPoints.id, userPointRecord.id));

                        await tx.insert(userPointsTransactions).values({
                            id: uuidv4(),
                            userId: existingOrder.userId,
                            restaurantId: existingOrder.restaurantId,
                            type: "earn",
                            points: totalPointsEarned,
                            balanceBefore: pointsBefore,
                            balanceAfter: pointsAfter,
                            orderId: orderId,
                            note: `Earned ${totalPointsEarned} points from order #${existingOrder.orderNumber}`,
                            createdAt: new Date(),
                        });
                    }
                }
            }
        }
    });

    // ==========================================
    // 4. إرسال الإشعارات للعميل
    // ==========================================
    let messageBody = `Your order ${existingOrder.dailyOrderNumber} is now ${status}.`;
    if (status === "cancelled") {
        messageBody = `Your order ${existingOrder.dailyOrderNumber} was cancelled. Reason: ${reason?.name || "Not specified"}`;
    }

    await sendPushNotification({
        recipientType: "user",
        recipientId: existingOrder.userId,
        title: "Order Update",
        body: messageBody,
        data: {
            orderId: existingOrder.id,
            orderNumber: existingOrder.orderNumber,
            dailyOrderNumber: existingOrder.dailyOrderNumber,
            status: status,
            type: "ORDER_STATUS_UPDATE"
        }
    });

    return SuccessResponse(res, { message: `Order status successfully updated to ${status}` });
};

// جلب أسباب الإلغاء حسب النوع (user أو restaurant)
export const getReasons = async (req: Request, res: Response) => {
    const type = req.query.type as string;

    const targetType = type === "user" ? "user" : "restaurant";

    const reasons = await db
        .select()
        .from(selectReasons)
        .where(
            and(
                eq(selectReasons.status, "active"),
                eq(selectReasons.type, targetType)
            )
        );

    return SuccessResponse(res, {
        message: "Active reasons fetched successfully",
        data: reasons
    });
};

// ==========================================
// 5. إنشاء فاتورة (PDF) لطلب معين
// ==========================================
export const generateOrderInvoicePDF = async (req: Request, res: Response) => {
    const { orderId } = req.params;
    const adminRestaurantId = req.user?.restaurantId || req.user?.id;
    const adminBranchId = req.user?.branchId;

    // 1. جلب البيانات الأساسية للأوردر
    const [orderDetail] = await db.select({
        order: orders,
        customer: {
            id: users.id,
            name: users.name,
            phone: users.phone,
        },
        branch: {
            id: branches.id,
            name: branches.name,
        },
        restaurant: {
            id: restaurants.id,
            name: restaurants.name,
        },
        address: addresses,
        zone: {
            name: zones.name
        }
    })
        .from(orders)
        .leftJoin(users, eq(orders.userId, users.id))
        .leftJoin(branches, eq(orders.branchId, branches.id))
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .leftJoin(addresses, eq(orders.addressId, addresses.id))
        .leftJoin(zones, eq(addresses.zoneId, zones.id))
        .where(eq(orders.id, orderId))
        .limit(1);

    if (!orderDetail) throw new NotFound("Order not found");

    // 🛡️ حماية الصلاحيات
    if (orderDetail.order.restaurantId !== adminRestaurantId) {
        throw new BadRequest("Unauthorized: Order does not belong to your restaurant");
    }
    if (adminBranchId && orderDetail.order.branchId !== adminBranchId) {
        throw new BadRequest("Unauthorized: Order does not belong to your branch");
    }

    // ==========================================
    // 🗺️ Fallback: استنتاج الزون والفرع للـ PDF إذا كانت فارغة
    // ==========================================
    let pdfZoneName = orderDetail.zone?.name || "";
    let pdfZoneId = (orderDetail.zone as any)?.id || (orderDetail.address as any)?.zoneId;

    if (!pdfZoneName && orderDetail.address?.lat && orderDetail.address?.lng) {
        const addrLat = parseFloat(String((orderDetail.address as any).lat));
        const addrLng = parseFloat(String((orderDetail.address as any).lng));
        if (!isNaN(addrLat) && !isNaN(addrLng)) {
            const detected = await resolveZoneFromCoords(addrLat, addrLng, orderDetail.order.restaurantId);
            if (detected) {
                pdfZoneName = detected.name;
                pdfZoneId = detected.id;
            }
        }
    }

    let pdfBranchName = orderDetail.branch?.name || "";
    if (!pdfBranchName && pdfZoneId && orderDetail.order.restaurantId) {
        const [matchedBranch] = await db
            .select({ name: branches.name })
            .from(branches)
            .where(
                and(
                    eq(branches.restaurantId, orderDetail.order.restaurantId),
                    eq(branches.zoneId, pdfZoneId),
                    eq(branches.status, "active")
                )
            )
            .limit(1);
        if (matchedBranch) {
            pdfBranchName = matchedBranch.name;
        }
    }

    // 2. جلب أصناف الأكل والتفاصيل (Variations)
    const items = await db.select({
        quantity: orderItems.quantity,
        basePrice: orderItems.basePrice,
        variationsPrice: orderItems.variationsPrice,
        totalPrice: orderItems.totalPrice,
        variations: orderItems.variations,
        foodName: food.name,
        foodNameAr: food.nameAr,
    })
        .from(orderItems)
        .leftJoin(food, eq(orderItems.foodId, food.id))
        .where(eq(orderItems.orderId, orderId));

    // تجهيز تفاصيل الفارييشنز وحساب السعر وربطه بالاسم
    const formattedItems = await Promise.all(items.map(async (item) => {
        let cleanVariations = item.variations;
        if (typeof cleanVariations === 'string') {
            try {
                cleanVariations = JSON.parse(cleanVariations);
                if (typeof cleanVariations === 'string') cleanVariations = JSON.parse(cleanVariations);
            } catch (error) { }
        }

        let varDetails: { name: string, price: number }[] = [];
        let totalCalculatedVarPrice = 0;

        if (Array.isArray(cleanVariations) && cleanVariations.length > 0) {
            await Promise.all(cleanVariations.map(async (v: any) => {
                if (v.optionName) {
                    const name = v.optionName;
                    const price = parseFloat(v.price || v.additionalPrice || "0");
                    varDetails.push({ name, price });
                    totalCalculatedVarPrice += price;
                } else if (v.optionId) {
                    const [optDb] = await db.select().from(variationOptions).where(eq(variationOptions.id, v.optionId)).limit(1);
                    if (optDb) {
                        const name = optDb.optionName || "Extra";
                        const price = parseFloat((optDb as any).price || optDb.additionalPrice || "0");
                        varDetails.push({ name, price });
                        totalCalculatedVarPrice += price;
                    }
                }
            }));
        }

        const finalVarPrice = parseFloat(item.variationsPrice as string || "0") > 0 ? parseFloat(item.variationsPrice as string || "0") : totalCalculatedVarPrice;
        const finalTotalPrice = (parseFloat(item.basePrice as string || "0") + finalVarPrice) * item.quantity;

        return {
            ...item,
            finalTotalPrice,
            variationDetails: varDetails
        };
    }));

    // 3. جلب اسم وسيلة الدفع بدل الـ ID
    let paymentName = "Unknown";
    const pmValue = orderDetail.order.paymentMethod;

    if (pmValue && pmValue.length === 36) {
        try {
            const [pm] = await db.select({ name: paymentMethods.name }).from(paymentMethods).where(eq(paymentMethods.id, pmValue)).limit(1);
            if (pm) paymentName = pm.name;
            else paymentName = pmValue;
        } catch (error) {
            console.error("Error fetching payment method for PDF:", error);
            paymentName = "Cash";
        }
    } else {
        switch (pmValue) {
            case "cash_on_delivery": paymentName = "Cash on Delivery"; break;
            case "visa": paymentName = "Credit Card"; break;
            case "wallet": paymentName = "Wallet"; break;
            default: paymentName = pmValue || "Unknown";
        }
    }

    // 4. إنشاء الـ PDF بحجم إيصال حراري
    const doc = new PDFDocument({ margin: 20, size: [250, 600] });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Receipt_${orderDetail.order.dailyOrderNumber}.pdf"`);

    doc.pipe(res);

    // Header
    doc.fontSize(16).text(orderDetail.restaurant?.name || 'Restaurant', { align: 'center' });
    if (pdfBranchName) {
        doc.fontSize(12).text(pdfBranchName, { align: 'center' });
    }

    doc.moveDown(0.5);
    doc.moveTo(10, doc.y).lineTo(240, doc.y).dash(2, { space: 2 }).stroke();
    doc.undash();
    doc.moveDown(0.5);

    // Order Info
    doc.fontSize(10);
    doc.text(`Order #: ${orderDetail.order.dailyOrderNumber}`);

    const orderDate = new Date(orderDetail.order.createdAt || new Date());

    // ✅ تحويل الوقت والتاريخ لتوقيت القاهرة بشكل صريح
    const cairoTimeStr = orderDate.toLocaleTimeString("en-US", { timeZone: "Africa/Cairo" });
    const cairoDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(orderDate);

    doc.text(`Date: ${cairoDateStr}`);
    doc.text(`Time: ${cairoTimeStr}`);

    doc.text(`Branch: ${pdfBranchName || 'N/A'}`);
    doc.text(`Client: ${orderDetail.customer?.name || 'Guest'}`);
    doc.text(`Phone: ${orderDetail.customer?.phone || 'N/A'}`);
    doc.text(`Order Type: ${orderDetail.order.orderType}`);
    doc.text(`Payment: ${paymentName}`);

    doc.moveDown(0.5);
    doc.moveTo(10, doc.y).lineTo(240, doc.y).dash(2, { space: 2 }).stroke();
    doc.undash();
    doc.moveDown(0.5);

    // Delivery Address if applicable
    if (orderDetail.order.orderType === 'delivery' && orderDetail.address) {
        doc.text('Delivery Address:', { underline: true });
        doc.text(`Zone: ${pdfZoneName}`);
        doc.text(`Street: ${orderDetail.address.street || ''}`);
        let details = `Bldg: ${orderDetail.address.number || ''}`;
        if (orderDetail.address.floor) details += ` | Floor: ${orderDetail.address.floor}`;
        doc.text(details);

        doc.moveDown(0.5);
        doc.moveTo(10, doc.y).lineTo(240, doc.y).dash(2, { space: 2 }).stroke();
        doc.undash();
        doc.moveDown(0.5);
    }

    // Items Header
    const itemStartY = doc.y;
    doc.text('Item', 10, itemStartY, { width: 100 });
    doc.text('Qty', 110, itemStartY, { width: 30, align: 'right' });
    doc.text('Price', 140, itemStartY, { width: 45, align: 'right' });
    doc.text('Total', 185, itemStartY, { width: 55, align: 'right' });
    doc.moveDown(0.2);

    doc.moveTo(10, doc.y).lineTo(240, doc.y).stroke();
    doc.moveDown(0.5);

    // Items Loop
    for (const item of formattedItems) {
        const currentY = doc.y;
        const name = item.foodName || item.foodNameAr || 'Item';

        doc.text(name, 10, currentY, { width: 100 });
        const nextY = doc.y;

        doc.text(item.quantity.toString(), 110, currentY, { width: 30, align: 'right' });
        doc.text(parseFloat(item.basePrice as string).toFixed(2), 140, currentY, { width: 45, align: 'right' });
        doc.text(item.finalTotalPrice.toFixed(2), 185, currentY, { width: 55, align: 'right' });

        doc.y = nextY;

        // طباعة الفارييشنز تحت الصنف مع عرض السعر
        if (item.variationDetails.length > 0) {
            doc.fontSize(8);
            for (const v of item.variationDetails) {
                const vY = doc.y;
                doc.text(`  + ${v.name}`, 10, vY, { width: 120 });
                if (v.price > 0) {
                    doc.text(v.price.toFixed(2), 140, vY, { width: 45, align: 'right' });
                }
            }
            doc.fontSize(10);
        }

        doc.moveDown(0.5);
    }

    doc.moveTo(10, doc.y).lineTo(240, doc.y).stroke();
    doc.moveDown(0.5);

    // Totals
    const subtotal = parseFloat(orderDetail.order.subtotal as string).toFixed(2);
    const deliveryFee = parseFloat(orderDetail.order.deliveryFee as string).toFixed(2);
    const serviceFee = parseFloat(orderDetail.order.serviceFee as string).toFixed(2);
    const total = parseFloat(orderDetail.order.totalAmount as string).toFixed(2);

    doc.text(`Total Product Price`, 10, doc.y, { continued: true }).text(`${subtotal}`, { align: 'right' });
    doc.text(`Delivery Fee`, 10, doc.y, { continued: true }).text(`${deliveryFee}`, { align: 'right' });
    doc.text(`Service Fee`, 10, doc.y, { continued: true }).text(`${serviceFee}`, { align: 'right' });

    doc.moveDown(0.5);
    doc.moveTo(10, doc.y).lineTo(240, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(14).text(`Grand Total`, 10, doc.y, { continued: true }).text(`${total}`, { align: 'right' });

    doc.moveDown(1);
    doc.fontSize(10).text('Thank you for your order', { align: 'center' });
    doc.fontSize(8).text('Powered by keeto', { align: 'center' });

    doc.end();
};

// ==========================================
// 6. تعيين مندوب توصيل لطلب (Assign Delivery)
// ==========================================
export const assignDelivery = async (req: Request, res: Response) => {
    const { orderId } = req.params;
    const { deliveryManId } = req.body;

    const adminRestaurantId = req.user?.restaurantId || req.user?.id;
    const adminBranchId = req.user?.branchId;

    if (!deliveryManId) throw new BadRequest("Delivery Man ID is required");

    // 1. تحقق من الطلب
    const [existingOrder] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!existingOrder) throw new NotFound("Order not found");

    if (existingOrder.restaurantId !== adminRestaurantId) throw new BadRequest("Unauthorized");
    if (adminBranchId && existingOrder.branchId !== adminBranchId) throw new BadRequest("Unauthorized");

    const orderType = existingOrder.orderType || (existingOrder as any).type;
    if (orderType !== "delivery") {
        throw new BadRequest("Cannot assign a delivery man to a non-delivery order");
    }
    const [deliveryMan] = await db.select().from(deliveryMen).where(eq(deliveryMen.id, deliveryManId)).limit(1);
    if (!deliveryMan) throw new NotFound("Delivery Man not found");
    if (deliveryMan.restaurantId !== adminRestaurantId) {
        throw new BadRequest("Unauthorized: Delivery man does not belong to your restaurant");
    }

    // 3. تحديث الطلب وإسناد المندوب
    await db.update(orders)
        .set({ deliveryManId, updatedAt: new Date() })
        .where(eq(orders.id, orderId));

    return SuccessResponse(res, { message: "Delivery man successfully assigned to order" });
};

//=======================================
//  select delivery men
//=======================================
export const selectDeliveryMan = async (req: Request, res: Response) => {
    const adminRestaurantId = req.user?.restaurantId || req.user?.id;
    const adminBranchId = req.user?.branchId;

    if (!adminRestaurantId) {
        throw new BadRequest("Restaurant ID not found");
    }

    const conditions: any[] = [
        eq(deliveryMen.restaurantId, adminRestaurantId),
        eq(deliveryMen.isActive, true),
    ];

    if (adminBranchId) {
        conditions.push(eq(deliveryMen.branchId, adminBranchId));
    }

    const deliveryMenList = await db.select({
        id: deliveryMen.id,
        name: deliveryMen.name,
        phone: deliveryMen.phone,
    })
        .from(deliveryMen)
        .where(and(...conditions));

    return SuccessResponse(res, { message: "Get delivery men success", data: deliveryMenList });
};

// ==========================================
// تحديث مدة تحضير الأوردر (بـ دقائق)
// ==========================================
export const setOrderPreparingDuration = async (req: Request, res: Response) => {
    const { orderId } = req.params;
    const { duration } = req.body;

    const adminRestaurantId = req.user?.restaurantId || req.user?.id;
    const adminBranchId = req.user?.branchId;

    const [existingOrder] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!existingOrder) throw new NotFound('Order not found');

    if (existingOrder.restaurantId !== adminRestaurantId) throw new BadRequest('Unauthorized');
    if (adminBranchId && existingOrder.branchId !== adminBranchId) throw new BadRequest('Unauthorized');

    let finalDuration = duration;

    // إذا لم يرسل الآدمن duration، نعتمد maxDeliveryTime للمطعم
    if (typeof finalDuration !== 'number') {
        const [settings] = await db
            .select({ maxDeliveryTime: restaurantSettings.maxDeliveryTime })
            .from(restaurantSettings)
            .where(eq(restaurantSettings.restaurantId, existingOrder.restaurantId))
            .limit(1);

        finalDuration = settings?.maxDeliveryTime ?? 30;
    }

    if (finalDuration < 0) {
        throw new BadRequest('Invalid duration value');
    }

    await db.update(orders)
        .set({ durationOrderPreparing: finalDuration, updatedAt: new Date() })
        .where(eq(orders.id, orderId));

    return SuccessResponse(res, { 
        message: 'Order preparing duration updated successfully',
        durationOrderPreparing: finalDuration 
    });
};
