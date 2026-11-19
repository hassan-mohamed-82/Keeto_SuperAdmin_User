import { db } from "../../models/connection";
import {
    addresses,
    branches,
    cities,
    zones,
    restaurantZoneDeliveryFees,
    shippingCompanies,
    shippingZones,
    shippingCompanyRestaurants,
    freeDeliveryOffers,
    orders,
    branchSubcategories,
    food,
} from "../../models/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { BadRequest } from "../../Errors/BadRequest";
import { calculateDistance, isLocationInZone } from "../../utils/geo";
import { resolveBranchIdFromAddress } from "../../helpers/pricing.helper";
import { activeFoodCondition } from "../../helpers/foodConditions";
import { GuestAddressRow, DeliveryResolutionResult } from "./checkout.types";

/**
 * Resolves the branch ID to be used for channel pricing.
 */
export const resolveBranchForPricing = async (
    orderType: "delivery" | "takeaway" | "dine_in",
    addressId: string | null,
    branchId: string | undefined,
    restaurantId: string,
    pendingGuestAddress: GuestAddressRow | null,
    settings: any,
    userCart: any[]
): Promise<string | null> => {
    let pricingBranchId: string | null = branchId || null;

    if (orderType === "delivery") {
        if (!addressId) throw new BadRequest("Delivery address is required.");
        if (!pricingBranchId) {
            try {
                if (pendingGuestAddress) throw new Error("GUEST_ADDRESS_NOT_SAVED_YET");
                pricingBranchId = await resolveBranchIdFromAddress(addressId, restaurantId);
            } catch (err: any) {
                const storedBranch = userCart.find((c) => c.branchId);
                pricingBranchId = storedBranch?.branchId || null;

                if (!pricingBranchId && (settings?.shippingCompanyId || pendingGuestAddress)) {
                    let addr: { lat: string | null; lng: string | null } | undefined;
                    if (pendingGuestAddress) {
                        addr = { lat: pendingGuestAddress.lat, lng: pendingGuestAddress.lng };
                    } else {
                        [addr] = await db
                            .select({ lat: addresses.lat, lng: addresses.lng })
                            .from(addresses)
                            .where(eq(addresses.id, addressId))
                            .limit(1);
                    }

                    const cLat = parseFloat(addr?.lat || "0");
                    const cLng = parseFloat(addr?.lng || "0");

                    const activeBranches = await db
                        .select({ id: branches.id, lat: branches.lat, lng: branches.lng })
                        .from(branches)
                        .where(and(eq(branches.restaurantId, restaurantId), eq(branches.status, "active")));

                    if (activeBranches.length > 0) {
                        let closest = activeBranches[0];
                        let minDist = Infinity;
                        for (const b of activeBranches) {
                            const bLat = parseFloat(b.lat || "0");
                            const bLng = parseFloat(b.lng || "0");
                            if (bLat && bLng && cLat && cLng) {
                                const dist = calculateDistance(cLat, cLng, bLat, bLng);
                                if (dist < minDist) {
                                    minDist = dist;
                                    closest = b;
                                }
                            }
                        }
                        pricingBranchId = closest.id;
                    }
                }
            }
        }
    } else {
        if (!branchId) throw new BadRequest("Branch is required for takeaway or dine-in orders.");
    }

    return pricingBranchId;
};

/**
 * Checks branch-subcategory availability guard.
 * Returns array of unavailable food IDs if blocked, or null if all good.
 */
export const checkSubcategoryBranchAvailability = async (
    pricingBranchId: string | null,
    userCart: any[]
): Promise<string[] | null> => {
    if (!pricingBranchId) return null;

    const cartFoodIds = userCart.filter((c) => !c.offerId).map((c) => c.foodId).filter(Boolean) as string[];
    const cartFoods =
        cartFoodIds.length > 0
            ? await db
                .select({
                    id: food.id,
                    subcategoryid: food.subcategoryid,
                    sold_by: food.sold_by,
                    weight_unit: food.weight_unit,
                })
                .from(food)
                .where(and(inArray(food.id, cartFoodIds), activeFoodCondition))
            : [];

    const subcatIdsInCart = [...new Set(cartFoods.map((f) => f.subcategoryid).filter(Boolean))] as string[];

    if (subcatIdsInCart.length > 0) {
        const inactiveSubcats = await db
            .select({ subcategoryId: branchSubcategories.subcategoryId })
            .from(branchSubcategories)
            .where(
                and(
                    eq(branchSubcategories.branchId, pricingBranchId),
                    inArray(branchSubcategories.subcategoryId, subcatIdsInCart),
                    eq(branchSubcategories.status, "inactive")
                )
            );

        if (inactiveSubcats.length > 0) {
            const inactiveSet = new Set(inactiveSubcats.map((r) => r.subcategoryId));
            const blockedFoodIds = cartFoods
                .filter((f) => f.subcategoryid && inactiveSet.has(f.subcategoryid))
                .map((f) => f.id);

            return blockedFoodIds;
        }
    }

    return null;
};

/**
 * Resolves delivery fee, target zone, shipping company matching,
 * branch snapshot, and schema-based free delivery offers.
 */
export const resolveDeliveryAndZones = async (params: {
    resolvedOrderType: "delivery" | "takeaway" | "dine_in";
    addressId: string | null;
    pendingGuestAddress: GuestAddressRow | null;
    userId: string;
    restaurantId: string;
    branchId: string | undefined;
    zoneId: string | undefined;
    settings: any;
    guestPhone: string | null;
    registeredPhone: string | null;
    isGuestUser: boolean;
    subtotal: number;
    initialIsFreeDelivery: boolean;
}): Promise<DeliveryResolutionResult> => {
    const {
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
        initialIsFreeDelivery,
    } = params;

    let deliveryFee = 0;
    let resolvedZoneId: string | null = zoneId || null;
    let resolvedBranchId: string | null = branchId || null;
    let deliveryGenericZoneId: string | null = null;
    let shippingAddressSnapshot: any = null;
    let targetShippingCompanyId: string | null = null;
    let isCompanyActive = false;
    let isFreeDelivery = initialIsFreeDelivery;

    if (resolvedOrderType === "delivery") {
        if (!addressId) throw new BadRequest("Delivery address is required");

        let userAddress: any;
        if (pendingGuestAddress) {
            userAddress = pendingGuestAddress;
        } else {
            [userAddress] = await db
                .select()
                .from(addresses)
                .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
                .limit(1);
        }
        if (!userAddress) throw new BadRequest("Invalid delivery address");

        const lat = parseFloat((userAddress.lat as string) || "0");
        const lng = parseFloat((userAddress.lng as string) || "0");

        if (!lat || !lng) {
            throw new BadRequest("Delivery address requires valid latitude and longitude coordinates.");
        }

        targetShippingCompanyId = settings?.shippingCompanyId || null;

        if (!targetShippingCompanyId) {
            const [junctionLink] = await db
                .select({
                    shippingCompanyId: shippingCompanyRestaurants.shippingCompanyId,
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
                isCompanyActive = true;
            }
        } else {
            const [company] = await db
                .select({ id: shippingCompanies.id, status: shippingCompanies.status })
                .from(shippingCompanies)
                .where(eq(shippingCompanies.id, targetShippingCompanyId))
                .limit(1);

            if (company && company.status === "active") {
                isCompanyActive = true;
            } else {
                targetShippingCompanyId = null;
            }
        }

        let applicableFee: any = null;
        let maxDeliveryFee = -1;

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

            for (const sz of companyZones) {
                let coords = sz.coordinates as any;
                if (typeof coords === "string") {
                    try {
                        coords = JSON.parse(coords);
                    } catch {
                        coords = [];
                    }
                }
                const isPolygon = Array.isArray(coords) && coords.length >= 3;
                const feeObj = {
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
                    zoneName: sz.name,
                    zoneNameAr: sz.nameAr,
                };

                if (isLocationInZone(lat, lng, feeObj.zoneId, feeObj)) {
                    const currentFee = parseFloat((feeObj.deliveryFee as string) || "0");
                    if (currentFee > maxDeliveryFee) {
                        maxDeliveryFee = currentFee;
                        applicableFee = feeObj;
                    }
                }
            }
        }

        if (!applicableFee) {
            const restaurantFees = await db
                .select({
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
                    zoneNameAr: zones.nameAr,
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

            for (const fee of restaurantFees) {
                if (isLocationInZone(lat, lng, fee.zoneId, fee)) {
                    const currentFee = parseFloat((fee.deliveryFee as string) || "0");
                    if (currentFee > maxDeliveryFee) {
                        maxDeliveryFee = currentFee;
                        applicableFee = fee;
                    }
                }
            }
        }

        if (!applicableFee) {
            throw new BadRequest("Your delivery address is outside our covered delivery zones.");
        }

        const genericZoneId = applicableFee.zoneId;
        deliveryGenericZoneId = genericZoneId;
        resolvedZoneId = applicableFee.id;
        if (!resolvedZoneId) {
            throw new BadRequest("No delivery zone found for this address.");
        }
        deliveryFee = parseFloat((applicableFee.deliveryFee as string) || "0");

        if (applicableFee.branchId) {
            resolvedBranchId = applicableFee.branchId;
        } else if (branchId) {
            const [selectedBranch] = await db
                .select({ id: branches.id })
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
        } else if (targetShippingCompanyId && isCompanyActive) {
            const activeBranches = await db
                .select({
                    id: branches.id,
                    name: branches.name,
                    lat: branches.lat,
                    lng: branches.lng,
                })
                .from(branches)
                .where(and(eq(branches.restaurantId, restaurantId), eq(branches.status, "active")));

            if (!activeBranches || activeBranches.length === 0) {
                throw new BadRequest("No active branch found for this restaurant.");
            }

            if (activeBranches.length === 1) {
                resolvedBranchId = activeBranches[0].id;
            } else {
                let closestBranch = activeBranches[0];
                let minDistance = Infinity;

                for (const b of activeBranches) {
                    const bLat = parseFloat((b.lat as string) || "0");
                    const bLng = parseFloat((b.lng as string) || "0");
                    if (bLat && bLng) {
                        const dist = calculateDistance(lat, lng, bLat, bLng);
                        if (dist < minDistance) {
                            minDistance = dist;
                            closestBranch = b;
                        }
                    }
                }
                resolvedBranchId = closestBranch.id;
            }
        } else {
            const [matchedBranch] = await db
                .select({ id: branches.id })
                .from(branches)
                .where(
                    and(
                        eq(branches.restaurantId, restaurantId),
                        genericZoneId ? eq(branches.zoneId, genericZoneId) : undefined,
                        eq(branches.status, "active")
                    )
                )
                .limit(1);

            if (!matchedBranch) throw new BadRequest("No active branch found serving your delivery zone.");
            resolvedBranchId = matchedBranch.id;
        }

        const snapshotPhone: string | null = isGuestUser ? guestPhone : registeredPhone;

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
            phone: snapshotPhone,
            addressZoneId: genericZoneId || null,
            restaurantZoneId: resolvedZoneId || null,
            addressZoneName: applicableFee.zoneName || null,
            addressZoneNameAr: applicableFee.zoneNameAr || null,
        };
    } else {
        if (!branchId) throw new BadRequest("Branch is required for takeaway or dine-in orders.");

        const [branch] = await db
            .select({ id: branches.id, zoneId: branches.zoneId })
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
                cityId: branches.cityId,
                cityName: cities.name,
                cityNameAr: cities.nameAr,
                zoneId: deliveryGenericZoneId ? restaurantZoneDeliveryFees.zoneId : branches.zoneId,
                zoneName: zones.name,
                zoneNameAr: zones.nameAr,
                zoneDeliveryFee: restaurantZoneDeliveryFees.deliveryFee,
            })
            .from(branches)
            .leftJoin(cities, eq(branches.cityId, cities.id))
            .leftJoin(
                restaurantZoneDeliveryFees,
                and(
                    eq(restaurantZoneDeliveryFees.branchId, branches.id),
                    eq(restaurantZoneDeliveryFees.restaurantId, restaurantId),
                    deliveryGenericZoneId ? eq(restaurantZoneDeliveryFees.zoneId, deliveryGenericZoneId) : sql`1=0`
                )
            )
            .leftJoin(
                zones,
                eq(zones.id, deliveryGenericZoneId ? restaurantZoneDeliveryFees.zoneId : branches.zoneId)
            )
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
                zoneDeliveryFee: branchDetails.zoneDeliveryFee
                    ? parseFloat(branchDetails.zoneDeliveryFee as string)
                    : null,
                cityId: branchDetails.cityId || null,
                cityName: branchDetails.cityName || null,
                cityNameAr: branchDetails.cityNameAr || null,
            };
        }
    }

    const calculatedDeliveryFee = deliveryFee;
    if (isFreeDelivery) deliveryFee = 0;

    // Free delivery offer schema check
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
            const minAmountOk =
                !freeDeliveryOffer.minOrderAmount ||
                subtotal >= parseFloat(freeDeliveryOffer.minOrderAmount as string);

            let offerBranchIds: string[] = [];
            const rawBranchIds = freeDeliveryOffer.branchIds;
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
            const branchOk =
                offerBranchIds.length === 0 || (resolvedBranchId ? offerBranchIds.includes(resolvedBranchId) : false);

            let userLimitOk = true;
            if (freeDeliveryOffer.maxOrdersPerUser && freeDeliveryOffer.maxOrdersPerUser > 0) {
                const [userOrdersRow] = await db
                    .select({ cnt: sql<number>`count(*)` })
                    .from(orders)
                    .where(
                        and(
                            eq(orders.userId, userId),
                            eq(orders.restaurantId, restaurantId),
                            sql`${orders.status} NOT IN ('cancelled', 'failed')`
                        )
                    );
                const userOrderCount = Number(userOrdersRow?.cnt ?? 0);
                if (userOrderCount >= freeDeliveryOffer.maxOrdersPerUser) {
                    userLimitOk = false;
                }
            }

            if (startOk && endOk && minAmountOk && userLimitOk && branchOk) {
                deliveryFee = 0;
                isFreeDelivery = true;
            }
        }
    }

    return {
        deliveryFee,
        calculatedDeliveryFee,
        resolvedZoneId,
        resolvedBranchId,
        deliveryGenericZoneId,
        shippingAddressSnapshot,
        targetShippingCompanyId,
        isCompanyActive,
        branchSnapshotData,
        isFreeDelivery,
    };
};
