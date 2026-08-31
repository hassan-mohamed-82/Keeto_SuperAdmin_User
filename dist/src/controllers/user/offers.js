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
        const userId = req.user?.id || req.user?._id;
        const favoriteFoodIds = new Set();
        if (userId) {
            const userFavorites = await connection_1.db
                .select({ foodId: schema_1.favorites.foodId })
                .from(schema_1.favorites)
                .where((0, drizzle_orm_1.eq)(schema_1.favorites.userId, userId));
            userFavorites.forEach(f => {
                if (f.foodId)
                    favoriteFoodIds.add(f.foodId);
            });
        }
        const offersData = await connection_1.db
            .select({
            foodId: schema_1.food.id,
            foodName: schema_1.food.name,
            foodNameAr: schema_1.food.nameAr,
            foodNameFr: schema_1.food.nameFr,
            description: schema_1.food.description,
            descriptionAr: schema_1.food.descriptionAr,
            descriptionFr: schema_1.food.descriptionFr,
            price: schema_1.food.price,
            foodDiscountType: schema_1.food.discount_type,
            foodDiscountValue: schema_1.food.discount_value,
            image: schema_1.food.image,
            points: schema_1.food.points,
            categoryId: schema_1.categories.id,
            categoryName: schema_1.categories.name,
            categoryNameAr: schema_1.categories.nameAr,
            categoryNameFr: schema_1.categories.nameFr,
            subcategoryId: schema_1.subcategories.id,
            subcategoryName: schema_1.subcategories.name,
            subcategoryNameAr: schema_1.subcategories.nameAr,
            subcategoryNameFr: schema_1.subcategories.nameFr,
            order_level: schema_1.subcategories.order_Level,
        })
            .from(schema_1.discountFoods)
            .innerJoin(schema_1.discounts, (0, drizzle_orm_1.eq)(schema_1.discountFoods.discountId, schema_1.discounts.id))
            .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.discountFoods.foodId, schema_1.food.id))
            .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
            .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, restaurantId), // فلترة بالمطعم
        (0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true), // الخصم مفعل
        // التأكد إن تاريخ الخصم ساري (لو التواريخ موجودة)
        (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.startDate), (0, drizzle_orm_1.lte)(schema_1.discounts.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.endDate), (0, drizzle_orm_1.gte)(schema_1.discounts.endDate, now))));
        const formattedOffers = offersData.map(row => {
            let calculatedDiscountPrice = Number(row.price);
            let discountNote = "";
            if (row.foodDiscountType === "percentage" && row.foodDiscountValue) {
                calculatedDiscountPrice = Number(row.price) - (Number(row.price) * Number(row.foodDiscountValue) / 100);
            }
            else if (row.foodDiscountType === "amount" && row.foodDiscountValue) {
                calculatedDiscountPrice = Math.max(0, Number(row.price) - Number(row.foodDiscountValue));
            }
            return {
                id: row.foodId,
                name: row.foodName,
                nameAr: row.foodNameAr,
                nameFr: row.foodNameFr,
                description: row.description,
                descriptionAr: row.descriptionAr,
                descriptionFr: row.descriptionFr,
                price: Number(row.price),
                discountType: row.foodDiscountType ?? null,
                discountValue: row.foodDiscountValue !== null ? Number(row.foodDiscountValue) : null,
                discountPrice: calculatedDiscountPrice,
                discountNote,
                image: row.image,
                points: userId ? row.points : null,
                isFavorite: userId ? favoriteFoodIds.has(row.foodId) : false,
                variations: {},
                addons: {},
                category: row.categoryId ? {
                    id: row.categoryId,
                    name: row.categoryName,
                    nameAr: row.categoryNameAr,
                    nameFr: row.categoryNameFr,
                } : null,
                subcategory: row.subcategoryId ? {
                    id: row.subcategoryId,
                    name: row.subcategoryName,
                    nameAr: row.subcategoryNameAr,
                    nameFr: row.subcategoryNameFr,
                    order_level: row.order_level,
                } : null,
            };
        });
        return res.status(200).json({
            success: true,
            message: "Restaurant offers retrieved successfully",
            data: formattedOffers,
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
        const userId = req.user?.id || req.user?._id;
        const favoriteFoodIds = new Set();
        if (userId) {
            const userFavorites = await connection_1.db
                .select({ foodId: schema_1.favorites.foodId })
                .from(schema_1.favorites)
                .where((0, drizzle_orm_1.eq)(schema_1.favorites.userId, userId));
            userFavorites.forEach(f => {
                if (f.foodId)
                    favoriteFoodIds.add(f.foodId);
            });
        }
        const globalOffers = await connection_1.db
            .select({
            foodId: schema_1.food.id,
            foodName: schema_1.food.name,
            foodNameAr: schema_1.food.nameAr,
            foodNameFr: schema_1.food.nameFr,
            description: schema_1.food.description,
            descriptionAr: schema_1.food.descriptionAr,
            descriptionFr: schema_1.food.descriptionFr,
            price: schema_1.food.price,
            foodDiscountType: schema_1.food.discount_type,
            foodDiscountValue: schema_1.food.discount_value,
            image: schema_1.food.image,
            points: schema_1.food.points,
            // تفاصيل الخصم
            discountId: schema_1.discounts.id,
            discountName: schema_1.discounts.name,
            discountType: schema_1.discounts.discountType,
            discountValue: schema_1.discounts.discountValue,
            isGlobal: schema_1.discounts.isGlobal,
            logo: schema_1.discounts.logo,
            categoryId: schema_1.categories.id,
            categoryName: schema_1.categories.name,
            categoryNameAr: schema_1.categories.nameAr,
            categoryNameFr: schema_1.categories.nameFr,
            subcategoryId: schema_1.subcategories.id,
            subcategoryName: schema_1.subcategories.name,
            subcategoryNameAr: schema_1.subcategories.nameAr,
            subcategoryNameFr: schema_1.subcategories.nameFr,
            order_level: schema_1.subcategories.order_Level,
            // تفاصيل المطعم
            restaurant: {
                id: schema_1.restaurants.id,
                name: schema_1.restaurants.name,
                nameAr: schema_1.restaurants.nameAr,
                nameFr: schema_1.restaurants.nameFr,
                logo: schema_1.restaurants.logo,
                cover: schema_1.restaurants.cover,
                address: schema_1.restaurants.address,
                minDeliveryTime: schema_1.restaurants.minDeliveryTime,
                maxDeliveryTime: schema_1.restaurants.maxDeliveryTime,
                deliveryTimeUnit: schema_1.restaurants.deliveryTimeUnit,
            }
        })
            .from(schema_1.discountFoods)
            .innerJoin(schema_1.discounts, (0, drizzle_orm_1.eq)(schema_1.discountFoods.discountId, schema_1.discounts.id))
            .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.discountFoods.foodId, schema_1.food.id))
            .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.food.restaurantid, schema_1.restaurants.id))
            .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
            .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true), (0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active"), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.startDate), (0, drizzle_orm_1.lte)(schema_1.discounts.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.endDate), (0, drizzle_orm_1.gte)(schema_1.discounts.endDate, now))));
        const formattedOffers = globalOffers.map(row => {
            let calculatedDiscountPrice = Number(row.price);
            let discountNote = "";
            if (row.foodDiscountType === "percentage" && row.foodDiscountValue) {
                calculatedDiscountPrice = Number(row.price) - (Number(row.price) * Number(row.foodDiscountValue) / 100);
            }
            else if (row.foodDiscountType === "amount" && row.foodDiscountValue) {
                calculatedDiscountPrice = Math.max(0, Number(row.price) - Number(row.foodDiscountValue));
            }
            return {
                id: row.foodId,
                name: row.foodName,
                nameAr: row.foodNameAr,
                nameFr: row.foodNameFr,
                description: row.description,
                descriptionAr: row.descriptionAr,
                descriptionFr: row.descriptionFr,
                price: Number(row.price),
                discountType: row.foodDiscountType ?? null,
                discountValue: row.foodDiscountValue !== null ? Number(row.foodDiscountValue) : null,
                discountPrice: calculatedDiscountPrice,
                discountNote,
                image: row.image,
                points: userId ? row.points : null,
                isFavorite: userId ? favoriteFoodIds.has(row.foodId) : false,
                variations: {},
                addons: {},
                category: row.categoryId ? {
                    id: row.categoryId,
                    name: row.categoryName,
                    nameAr: row.categoryNameAr,
                    nameFr: row.categoryNameFr,
                } : null,
                subcategory: row.subcategoryId ? {
                    id: row.subcategoryId,
                    name: row.subcategoryName,
                    nameAr: row.subcategoryNameAr,
                    nameFr: row.subcategoryNameFr,
                    order_level: row.order_level,
                } : null,
                discountId: row.discountId,
                discountName: row.discountName,
                isGlobal: row.isGlobal,
                discountLogo: row.logo,
                restaurant: row.restaurant,
            };
        });
        return res.status(200).json({
            success: true,
            message: "All platform offers retrieved successfully",
            data: formattedOffers,
        });
    }
    catch (error) {
        console.error("Error fetching all offers:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
exports.getAllOffers = getAllOffers;
