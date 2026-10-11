"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAssignedRestaurants = getAssignedRestaurants;
exports.getRestaurantBranches = getRestaurantBranches;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
async function getAssignedRestaurants(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
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
        assignedAt: schema_1.shippingCompanyRestaurants.createdAt,
    })
        .from(schema_1.shippingCompanyRestaurants)
        .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.restaurantSettings, (0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.restaurantSettings.restaurantId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.status, "active")));
    return (0, response_1.SuccessResponse)(res, {
        message: "Assigned restaurants retrieved successfully",
        data: assigned,
    });
}
async function getRestaurantBranches(req, res) {
    const companyId = req.user?.shippingCompanyId || req.user?.id;
    const { restaurantId } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    // التأكد أن المطعم تابع لشركة الشحن
    const isAssigned = await connection_1.db
        .select({ id: schema_1.shippingCompanyRestaurants.id })
        .from(schema_1.shippingCompanyRestaurants)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.shippingCompanyId, companyId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyRestaurants.status, "active")))
        .limit(1);
    if (isAssigned.length === 0) {
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
}
