"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveRestaurants = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const getActiveRestaurants = async (req, res) => {
    try {
        const activeRestaurants = await connection_1.db.select({
            name: schema_1.restaurants.name,
            nameAr: schema_1.restaurants.nameAr,
            nameFr: schema_1.restaurants.nameFr,
            orderLink: schema_1.restaurants.orderLink,
            logo: schema_1.restaurants.logo
        })
            .from(schema_1.restaurants)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active"));
        return (0, response_1.SuccessResponse)(res, {
            message: "Active restaurants fetched successfully",
            data: activeRestaurants
        });
    }
    catch (error) {
        console.error("Error fetching active restaurants:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
exports.getActiveRestaurants = getActiveRestaurants;
