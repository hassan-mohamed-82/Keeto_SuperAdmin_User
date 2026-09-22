"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllPolicy = void 0;
const response_1 = require("../../utils/response");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const Errors_1 = require("../../Errors");
const connection_1 = require("../../models/connection");
const getAllPolicy = async (req, res) => {
    const { restaurantId } = req.params;
    if (!restaurantId)
        throw new Errors_1.BadRequest("Please provide restaurant id");
    const restaurantPolicies = await connection_1.db
        .select()
        .from(schema_1.policy)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.policy.type, "restaurant"), (0, drizzle_orm_1.eq)(schema_1.policy.restaurantId, restaurantId)));
    // 🟢 التحقق من طول المصفوفة للتأكد من وجود سياسات
    if (!restaurantPolicies || restaurantPolicies.length === 0) {
        throw new Errors_1.BadRequest("Policies not found");
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Policies fetched successfully",
        data: restaurantPolicies,
    });
};
exports.getAllPolicy = getAllPolicy;
