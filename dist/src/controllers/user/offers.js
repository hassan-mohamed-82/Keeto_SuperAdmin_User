"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllOffers = exports.getRestaurantOffers = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const connection_1 = require("../../models/connection"); // مسار الاتصال بقاعدة البيانات
const schema_1 = require("../../models/schema");
const getRestaurantOffers = async (req, res) => {
    try {
        const { restaurantId } = req.params;
        const now = new Date();
        const offers = await connection_1.db
            .select({
            foodId: schema_1.food.id,
            foodName: schema_1.food.name, // أو nameAr / nameEn حسب الداتابيز عندك
            originalPrice: schema_1.food.price,
            // تفاصيل الخصم
            discountId: schema_1.discounts.id,
            discountName: schema_1.discounts.name,
            discountType: schema_1.discounts.discountType,
            discountValue: schema_1.discounts.discountValue,
        })
            .from(schema_1.discountFoods)
            .innerJoin(schema_1.discounts, (0, drizzle_orm_1.eq)(schema_1.discountFoods.discountId, schema_1.discounts.id))
            .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.discountFoods.foodId, schema_1.food.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, restaurantId), // فلترة بالمطعم
        (0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true), // الخصم مفعل
        // التأكد إن تاريخ الخصم ساري (لو التواريخ موجودة)
        (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.startDate), (0, drizzle_orm_1.lte)(schema_1.discounts.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.endDate), (0, drizzle_orm_1.gte)(schema_1.discounts.endDate, now))));
        return res.status(200).json({
            success: true,
            message: "Restaurant offers retrieved successfully",
            data: offers,
        });
    }
    catch (error) {
        console.error("Error fetching restaurant offers:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
exports.getRestaurantOffers = getRestaurantOffers;
const getAllOffers = async (req, res) => {
    try {
        const now = new Date();
        const globalOffers = await connection_1.db
            .select({
            foodId: schema_1.food.id,
            foodName: schema_1.food.name,
            originalPrice: schema_1.food.price,
            restaurantId: schema_1.food.restaurantid, // مهم هنا عشان اليوزر يعرف المطعم
            // تفاصيل الخصم
            discountId: schema_1.discounts.id,
            discountName: schema_1.discounts.name,
            discountType: schema_1.discounts.discountType,
            discountValue: schema_1.discounts.discountValue,
            isGlobal: schema_1.discounts.isGlobal,
        })
            .from(schema_1.discountFoods)
            .innerJoin(schema_1.discounts, (0, drizzle_orm_1.eq)(schema_1.discountFoods.discountId, schema_1.discounts.id))
            .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.discountFoods.foodId, schema_1.food.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true), // الخصم مفعل
        // التأكد إن تاريخ الخصم ساري
        (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.startDate), (0, drizzle_orm_1.lte)(schema_1.discounts.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.endDate), (0, drizzle_orm_1.gte)(schema_1.discounts.endDate, now))));
        return res.status(200).json({
            success: true,
            message: "All platform offers retrieved successfully",
            data: globalOffers,
        });
    }
    catch (error) {
        console.error("Error fetching all offers:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
exports.getAllOffers = getAllOffers;
