"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDeliveryAndZones = exports.checkSubcategoryBranchAvailability = exports.resolveBranchForPricing = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const BadRequest_1 = require("../../Errors/BadRequest");
const geo_1 = require("../../utils/geo");
const pricing_helper_1 = require("../../helpers/pricing.helper");
const foodConditions_1 = require("../../helpers/foodConditions");
/**
 * Resolves the branch ID to be used for channel pricing.
 */
const resolveBranchForPricing = async (orderType, addressId, branchId, restaurantId, pendingGuestAddress, settings, userCart) => {
    let pricingBranchId = branchId || null;
    if (orderType === "delivery") {
        if (!addressId)
            throw new BadRequest_1.BadRequest("Delivery address is required.");
        if (!pricingBranchId) {
            try {
                if (pendingGuestAddress)
                    throw new Error("GUEST_ADDRESS_NOT_SAVED_YET");
                pricingBranchId = await (0, pricing_helper_1.resolveBranchIdFromAddress)(addressId, restaurantId);
            }
            catch (err) {
                const storedBranch = userCart.find((c) => c.branchId);
                pricingBranchId = storedBranch?.branchId || null;
                if (!pricingBranchId && (settings?.shippingCompanyId || pendingGuestAddress)) {
                    let addr;
                    if (pendingGuestAddress) {
                        addr = { lat: pendingGuestAddress.lat, lng: pendingGuestAddress.lng };
                    }
                    else {
                        [addr] = await connection_1.db
                            .select({ lat: schema_1.addresses.lat, lng: schema_1.addresses.lng })
                            .from(schema_1.addresses)
                            .where((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId))
                            .limit(1);
                    }
                    const cLat = parseFloat(addr?.lat || "0");
                    const cLng = parseFloat(addr?.lng || "0");
                    const activeBranches = await connection_1.db
                        .select({ id: schema_1.branches.id, lat: schema_1.branches.lat, lng: schema_1.branches.lng })
                        .from(schema_1.branches)
                        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")));
                    if (activeBranches.length > 0) {
                        let closest = activeBranches[0];
                        let minDist = Infinity;
                        for (const b of activeBranches) {
                            const bLat = parseFloat(b.lat || "0");
                            const bLng = parseFloat(b.lng || "0");
                            if (bLat && bLng && cLat && cLng) {
                                const dist = (0, geo_1.calculateDistance)(cLat, cLng, bLat, bLng);
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
    }
    else {
        if (!branchId)
            throw new BadRequest_1.BadRequest("Branch is required for takeaway or dine-in orders.");
    }
    return pricingBranchId;
};
exports.resolveBranchForPricing = resolveBranchForPricing;
/**
 * Checks branch-subcategory availability guard.
 * Returns array of unavailable food IDs if blocked, or null if all good.
 */
const checkSubcategoryBranchAvailability = async (pricingBranchId, userCart) => {
    if (!pricingBranchId)
        return null;
    const cartFoodIds = userCart.filter((c) => !c.offerId).map((c) => c.foodId).filter(Boolean);
    const cartFoods = cartFoodIds.length > 0
        ? await connection_1.db
            .select({
            id: schema_1.food.id,
            subcategoryid: schema_1.food.subcategoryid,
            sold_by: schema_1.food.sold_by,
            weight_unit: schema_1.food.weight_unit,
        })
            .from(schema_1.food)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.food.id, cartFoodIds), foodConditions_1.activeFoodCondition))
        : [];
    const subcatIdsInCart = [...new Set(cartFoods.map((f) => f.subcategoryid).filter(Boolean))];
    if (subcatIdsInCart.length > 0) {
        const inactiveSubcats = await connection_1.db
            .select({ subcategoryId: schema_1.branchSubcategories.subcategoryId })
            .from(schema_1.branchSubcategories)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branchSubcategories.branchId, pricingBranchId), (0, drizzle_orm_1.inArray)(schema_1.branchSubcategories.subcategoryId, subcatIdsInCart), (0, drizzle_orm_1.eq)(schema_1.branchSubcategories.status, "inactive")));
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
exports.checkSubcategoryBranchAvailability = checkSubcategoryBranchAvailability;
/**
 * Resolves delivery fee, target zone, shipping company matching,
 * branch snapshot, and schema-based free delivery offers.
 */
const resolveDeliveryAndZones = async (params) => {
    const { resolvedOrderType, addressId, pendingGuestAddress, userId, restaurantId, branchId, zoneId, settings, guestPhone, registeredPhone, isGuestUser, subtotal, initialIsFreeDelivery, } = params;
    let deliveryFee = 0;
    let resolvedZoneId = zoneId || null;
    let resolvedBranchId = branchId || null;
    let deliveryGenericZoneId = null;
    let shippingAddressSnapshot = null;
    let targetShippingCompanyId = null;
    let isCompanyActive = false;
    let isFreeDelivery = initialIsFreeDelivery;
    if (resolvedOrderType === "delivery") {
        if (!addressId)
            throw new BadRequest_1.BadRequest("Delivery address is required");
        let userAddress;
        if (pendingGuestAddress) {
            userAddress = pendingGuestAddress;
        }
        else {
            [userAddress] = await connection_1.db
                .select()
                .from(schema_1.addresses)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId), (0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId)))
                .limit(1);
        }
        if (!userAddress)
            throw new BadRequest_1.BadRequest("Invalid delivery address");
        const lat = parseFloat(userAddress.lat || "0");
        const lng = parseFloat(userAddress.lng || "0");
        if (!lat || !lng) {
            throw new BadRequest_1.BadRequest("Delivery address requires valid latitude and longitude coordinates.");
        }
        targetShippingCompanyId = settings?.shippingCompanyId || null;
        if (!targetShippingCompanyId) {
            const [junctionLink] = await connection_1.db
                .select({
                shippingCompanyId: schema_1.shippingCompanyRestaurants.shippingCompanyId,
                shippingCompanyStatus: schema_1.shippingCompanies.status,
            })
                .from(schema_1.shippingCompanyRestaurants)
                .innerJoin(schema_1.shippingCompanies, (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, schema_1.shippingCompanies.id))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.status, "active"), (0, drizzle_orm_1.eq)(schema_1.shippingCompanies.status, "active")))
                .limit(1);
            if (junctionLink) {
                targetShippingCompanyId = junctionLink.shippingCompanyId;
                isCompanyActive = true;
            }
        }
        else {
            const [company] = await connection_1.db
                .select({ id: schema_1.shippingCompanies.id, status: schema_1.shippingCompanies.status })
                .from(schema_1.shippingCompanies)
                .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanies.id, targetShippingCompanyId))
                .limit(1);
            if (company && company.status === "active") {
                isCompanyActive = true;
            }
            else {
                targetShippingCompanyId = null;
            }
        }
        let applicableFee = null;
        let maxDeliveryFee = -1;
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
            for (const sz of companyZones) {
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
                if ((0, geo_1.isLocationInZone)(lat, lng, feeObj.zoneId, feeObj)) {
                    const currentFee = parseFloat(feeObj.deliveryFee || "0");
                    if (currentFee > maxDeliveryFee) {
                        maxDeliveryFee = currentFee;
                        applicableFee = feeObj;
                    }
                }
            }
        }
        if (!applicableFee) {
            const restaurantFees = await connection_1.db
                .select({
                id: schema_1.restaurantZoneDeliveryFees.id,
                zoneId: schema_1.restaurantZoneDeliveryFees.zoneId,
                branchId: schema_1.restaurantZoneDeliveryFees.branchId,
                deliveryFee: schema_1.restaurantZoneDeliveryFees.deliveryFee,
                coverageType: schema_1.restaurantZoneDeliveryFees.coverageType,
                customCoordinates: schema_1.restaurantZoneDeliveryFees.customCoordinates,
                customRadiusKm: schema_1.restaurantZoneDeliveryFees.customRadiusKm,
                defaultCoordinates: schema_1.zones.coordinates,
                defaultRadiusKm: schema_1.zones.coverageAreaRadiusKm,
                zoneName: schema_1.zones.name,
                zoneNameAr: schema_1.zones.nameAr,
            })
                .from(schema_1.restaurantZoneDeliveryFees)
                .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.zoneId, schema_1.zones.id))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.status, "active"), branchId ? (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.branchId, branchId) : undefined));
            for (const fee of restaurantFees) {
                if ((0, geo_1.isLocationInZone)(lat, lng, fee.zoneId, fee)) {
                    const currentFee = parseFloat(fee.deliveryFee || "0");
                    if (currentFee > maxDeliveryFee) {
                        maxDeliveryFee = currentFee;
                        applicableFee = fee;
                    }
                }
            }
        }
        if (!applicableFee) {
            throw new BadRequest_1.BadRequest("Your delivery address is outside our covered delivery zones.");
        }
        const genericZoneId = applicableFee.zoneId;
        deliveryGenericZoneId = genericZoneId;
        resolvedZoneId = applicableFee.id;
        if (!resolvedZoneId) {
            throw new BadRequest_1.BadRequest("No delivery zone found for this address.");
        }
        deliveryFee = parseFloat(applicableFee.deliveryFee || "0");
        if (applicableFee.branchId) {
            resolvedBranchId = applicableFee.branchId;
        }
        else if (branchId) {
            const [selectedBranch] = await connection_1.db
                .select({ id: schema_1.branches.id })
                .from(schema_1.branches)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.id, branchId), (0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")))
                .limit(1);
            if (!selectedBranch)
                throw new BadRequest_1.BadRequest("Selected branch not found or inactive.");
            resolvedBranchId = selectedBranch.id;
        }
        else if (targetShippingCompanyId && isCompanyActive) {
            const activeBranches = await connection_1.db
                .select({
                id: schema_1.branches.id,
                name: schema_1.branches.name,
                lat: schema_1.branches.lat,
                lng: schema_1.branches.lng,
            })
                .from(schema_1.branches)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")));
            if (!activeBranches || activeBranches.length === 0) {
                throw new BadRequest_1.BadRequest("No active branch found for this restaurant.");
            }
            if (activeBranches.length === 1) {
                resolvedBranchId = activeBranches[0].id;
            }
            else {
                let closestBranch = activeBranches[0];
                let minDistance = Infinity;
                for (const b of activeBranches) {
                    const bLat = parseFloat(b.lat || "0");
                    const bLng = parseFloat(b.lng || "0");
                    if (bLat && bLng) {
                        const dist = (0, geo_1.calculateDistance)(lat, lng, bLat, bLng);
                        if (dist < minDistance) {
                            minDistance = dist;
                            closestBranch = b;
                        }
                    }
                }
                resolvedBranchId = closestBranch.id;
            }
        }
        else {
            const [matchedBranch] = await connection_1.db
                .select({ id: schema_1.branches.id })
                .from(schema_1.branches)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId), genericZoneId ? (0, drizzle_orm_1.eq)(schema_1.branches.zoneId, genericZoneId) : undefined, (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")))
                .limit(1);
            if (!matchedBranch)
                throw new BadRequest_1.BadRequest("No active branch found serving your delivery zone.");
            resolvedBranchId = matchedBranch.id;
        }
        const snapshotPhone = isGuestUser ? guestPhone : registeredPhone;
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
    }
    else {
        if (!branchId)
            throw new BadRequest_1.BadRequest("Branch is required for takeaway or dine-in orders.");
        const [branch] = await connection_1.db
            .select({ id: schema_1.branches.id, zoneId: schema_1.branches.zoneId })
            .from(schema_1.branches)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.branches.id, branchId), (0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.branches.status, "active")))
            .limit(1);
        if (!branch)
            throw new BadRequest_1.BadRequest("Invalid or inactive branch selected.");
        resolvedBranchId = branch.id;
        resolvedZoneId = branch.zoneId;
    }
    // Branch Snapshot
    let branchSnapshotData = null;
    if (resolvedBranchId) {
        const [branchDetails] = await connection_1.db
            .select({
            id: schema_1.branches.id,
            name: schema_1.branches.name,
            nameAr: schema_1.branches.nameAr,
            nameFr: schema_1.branches.nameFr,
            address: schema_1.branches.address,
            addressAr: schema_1.branches.addressAr,
            addressFr: schema_1.branches.addressFr,
            phoneNumber: schema_1.branches.phoneNumber,
            status: schema_1.branches.status,
            cityId: schema_1.branches.cityId,
            cityName: schema_1.cities.name,
            cityNameAr: schema_1.cities.nameAr,
            zoneId: deliveryGenericZoneId ? schema_1.restaurantZoneDeliveryFees.zoneId : schema_1.branches.zoneId,
            zoneName: schema_1.zones.name,
            zoneNameAr: schema_1.zones.nameAr,
            zoneDeliveryFee: schema_1.restaurantZoneDeliveryFees.deliveryFee,
        })
            .from(schema_1.branches)
            .leftJoin(schema_1.cities, (0, drizzle_orm_1.eq)(schema_1.branches.cityId, schema_1.cities.id))
            .leftJoin(schema_1.restaurantZoneDeliveryFees, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.branchId, schema_1.branches.id), (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.restaurantId, restaurantId), deliveryGenericZoneId ? (0, drizzle_orm_1.eq)(schema_1.restaurantZoneDeliveryFees.zoneId, deliveryGenericZoneId) : (0, drizzle_orm_1.sql) `1=0`))
            .leftJoin(schema_1.zones, (0, drizzle_orm_1.eq)(schema_1.zones.id, deliveryGenericZoneId ? schema_1.restaurantZoneDeliveryFees.zoneId : schema_1.branches.zoneId))
            .where((0, drizzle_orm_1.eq)(schema_1.branches.id, resolvedBranchId))
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
                    ? parseFloat(branchDetails.zoneDeliveryFee)
                    : null,
                cityId: branchDetails.cityId || null,
                cityName: branchDetails.cityName || null,
                cityNameAr: branchDetails.cityNameAr || null,
            };
        }
    }
    const calculatedDeliveryFee = deliveryFee;
    if (isFreeDelivery)
        deliveryFee = 0;
    // Free delivery offer schema check
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
            const minAmountOk = !freeDeliveryOffer.minOrderAmount ||
                subtotal >= parseFloat(freeDeliveryOffer.minOrderAmount);
            let offerBranchIds = [];
            const rawBranchIds = freeDeliveryOffer.branchIds;
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
            const branchOk = offerBranchIds.length === 0 || (resolvedBranchId ? offerBranchIds.includes(resolvedBranchId) : false);
            let userLimitOk = true;
            if (freeDeliveryOffer.maxOrdersPerUser && freeDeliveryOffer.maxOrdersPerUser > 0) {
                const [userOrdersRow] = await connection_1.db
                    .select({ cnt: (0, drizzle_orm_1.sql) `count(*)` })
                    .from(schema_1.orders)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId), (0, drizzle_orm_1.sql) `${schema_1.orders.status} NOT IN ('cancelled', 'failed')`));
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
exports.resolveDeliveryAndZones = resolveDeliveryAndZones;
