"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSliders = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const subcategory_1 = require("../../models/schema/admin/subcategory");
const food_1 = require("../../models/schema/admin/food");
const discount_1 = require("../../models/schema/admin/discount");
const drizzle_orm_1 = require("drizzle-orm");
const Errors_1 = require("../../Errors");
const response_1 = require("../../utils/response");
// ─── Helper: resolve linked entity based on linkType ───
async function resolveLinkData(linkType, subcategoryId, foodId, discountId) {
    if (linkType === "subcategory" && subcategoryId) {
        const [sub] = await connection_1.db
            .select({
            id: subcategory_1.subcategories.id,
            name: subcategory_1.subcategories.name,
            nameAr: subcategory_1.subcategories.nameAr,
            nameFr: subcategory_1.subcategories.nameFr,
            image: subcategory_1.subcategories.image,
            status: subcategory_1.subcategories.status,
        })
            .from(subcategory_1.subcategories)
            .where((0, drizzle_orm_1.eq)(subcategory_1.subcategories.id, subcategoryId))
            .limit(1);
        return sub ?? null;
    }
    if (linkType === "product" && foodId) {
        const [item] = await connection_1.db
            .select({
            id: food_1.food.id,
            name: food_1.food.name,
            nameAr: food_1.food.nameAr,
            nameFr: food_1.food.nameFr,
            image: food_1.food.image,
            price: food_1.food.price,
            offerPrice: food_1.food.offer_price,
            status: food_1.food.status,
        })
            .from(food_1.food)
            .where((0, drizzle_orm_1.eq)(food_1.food.id, foodId))
            .limit(1);
        return item ?? null;
    }
    if (linkType === "discount" && discountId) {
        const [disc] = await connection_1.db
            .select({
            id: discount_1.discounts.id,
            name: discount_1.discounts.name,
            nameAr: discount_1.discounts.nameAr,
            nameFr: discount_1.discounts.nameFr,
            discountType: discount_1.discountGroups.discountType,
            discountValue: discount_1.discountGroups.discountValue,
            maxDiscount: discount_1.discountGroups.maxDiscount,
            minOrderAmount: discount_1.discounts.minOrderAmount,
            logo: discount_1.discounts.logo,
            startDate: discount_1.discounts.startDate,
            endDate: discount_1.discounts.endDate,
            isActive: discount_1.discounts.isActive,
        })
            .from(discount_1.discounts)
            .leftJoin(discount_1.discountGroups, (0, drizzle_orm_1.eq)(discount_1.discounts.id, discount_1.discountGroups.discountId))
            .where((0, drizzle_orm_1.eq)(discount_1.discounts.id, discountId))
            .limit(1);
        return disc ?? null;
    }
    return null;
}
// ─── Get All Sliders by Restaurant ───
const getSliders = async (req, res) => {
    const { resId } = req.params;
    if (!resId) {
        throw new Errors_1.NotFound("restaurant id");
    }
    const rows = await connection_1.db
        .select({
        id: schema_1.sliders.id,
        img: schema_1.sliders.img,
        periorty: schema_1.sliders.periorty,
        linkType: schema_1.sliders.linkType,
        link: schema_1.sliders.link,
        subcategoryId: schema_1.sliders.subcategoryId,
        foodId: schema_1.sliders.foodId,
        discountId: schema_1.sliders.discountId,
    })
        .from(schema_1.sliders)
        .where((0, drizzle_orm_1.eq)(schema_1.sliders.restaurantid, resId));
    // resolve linked entity for each slider
    const result = await Promise.all(rows.map(async (s) => {
        const linkData = await resolveLinkData(s.linkType ?? null, s.subcategoryId ?? null, s.foodId ?? null, s.discountId ?? null);
        return {
            id: s.id,
            img: s.img,
            periorty: s.periorty,
            linkType: s.linkType,
            link: s.linkType === "link" ? s.link : null,
            linkData: linkData,
        };
    }));
    return (0, response_1.SuccessResponse)(res, { data: result });
};
exports.getSliders = getSliders;
