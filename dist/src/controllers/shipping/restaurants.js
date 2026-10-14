"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRestaurantBranches = exports.getAssignedRestaurants = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const catchAsync_1 = require("../../utils/catchAsync");
// D3: Read strictly from restaurantSettings.shippingCompanyId
exports.getAssignedRestaurants = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const assigned = await connection_1.db
        .select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        nameAr: schema_1.restaurants.nameAr,
        logo: schema_1.restaurants.logo,
        cover: schema_1.restaurants.cover,
        address: schema_1.restaurants.address,
        phone: schema_1.restaurants.ownerPhone,
        lat: schema_1.restaurants.lat,
        lng: schema_1.restaurants.lng,
        status: schema_1.restaurants.status,
        homeDelivery: schema_1.restaurantSettings.homeDelivery,
        selfDelivery: schema_1.restaurantSettings.selfDelivery,
    })
        .from(schema_1.restaurantSettings)
        .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.shippingCompanyId, companyId));
    return (0, response_1.SuccessResponse)(res, {
        message: "Assigned restaurants retrieved successfully",
        data: assigned,
    });
});
exports.getRestaurantBranches = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { restaurantId } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    // Verify restaurant is linked to this shipping company
    const [settings] = await connection_1.db
        .select({ id: schema_1.restaurantSettings.id })
        .from(schema_1.restaurantSettings)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantSettings.shippingCompanyId, companyId)))
        .limit(1);
    if (!settings) {
        throw new Errors_1.UnauthorizedError("Restaurant is not assigned to this shipping company");
    }
    const branchList = await connection_1.db
        .select()
        .from(schema_1.branches)
        .where((0, drizzle_orm_1.eq)(schema_1.branches.restaurantId, restaurantId));
    return (0, response_1.SuccessResponse)(res, {
        message: "Restaurant branches retrieved successfully",
        data: branchList,
    });
});
