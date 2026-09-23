"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPopupById = exports.getActivePopups = void 0;
const connection_1 = require("../../models/connection");
const popup_1 = require("../../models/schema/admin/popup");
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
// ─── Get All Active Popups (filtered by date and status) ───
const getActivePopups = async (req, res) => {
    const now = new Date();
    const { restaurantId } = req.params;
    const activePopups = await connection_1.db
        .select({
        id: popup_1.popup.id,
        Title: popup_1.popup.Title,
        TitleAr: popup_1.popup.TitleAr,
        TitleFr: popup_1.popup.TitleFr,
        description: popup_1.popup.description,
        descriptionAr: popup_1.popup.descriptionAr,
        descriptionFr: popup_1.popup.descriptionFr,
        image: popup_1.popup.image,
        imageAr: popup_1.popup.imageAr,
        imageFr: popup_1.popup.imageFr,
        type: popup_1.popup.type,
        linkType: popup_1.popup.linkType,
        link: popup_1.popup.link,
        subcategoryId: popup_1.popup.subcategoryId,
        foodId: popup_1.popup.foodId,
        discountId: popup_1.popup.discountId,
        startDate: popup_1.popup.startDate,
        endDate: popup_1.popup.endDate,
    })
        .from(popup_1.popup)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(popup_1.popup.status, "active"), (0, drizzle_orm_1.lte)(popup_1.popup.startDate, now), (0, drizzle_orm_1.gte)(popup_1.popup.endDate, now), (0, drizzle_orm_1.eq)(popup_1.popup.restaurantId, restaurantId)));
    // resolve linked entity for each popup
    const result = await Promise.all(activePopups.map(async (p) => {
        const linkData = await resolveLinkData(p.linkType ?? null, p.subcategoryId ?? null, p.foodId ?? null, p.discountId ?? null);
        return {
            id: p.id,
            Title: p.Title,
            TitleAr: p.TitleAr,
            TitleFr: p.TitleFr,
            description: p.description,
            descriptionAr: p.descriptionAr,
            descriptionFr: p.descriptionFr,
            image: p.image,
            imageAr: p.imageAr,
            imageFr: p.imageFr,
            type: p.type,
            startDate: p.startDate,
            endDate: p.endDate,
            linkType: p.linkType,
            link: p.linkType === "link" ? p.link : null,
            linkData: linkData,
        };
    }));
    return (0, response_1.SuccessResponse)(res, { message: "Get active popups success", data: result });
};
exports.getActivePopups = getActivePopups;
// ─── Get Active Popup By ID ───
const getPopupById = async (req, res) => {
    const { restaurantId, id } = req.params;
    const rows = await connection_1.db
        .select({
        id: popup_1.popup.id,
        Title: popup_1.popup.Title,
        TitleAr: popup_1.popup.TitleAr,
        TitleFr: popup_1.popup.TitleFr,
        description: popup_1.popup.description,
        descriptionAr: popup_1.popup.descriptionAr,
        descriptionFr: popup_1.popup.descriptionFr,
        image: popup_1.popup.image,
        imageAr: popup_1.popup.imageAr,
        imageFr: popup_1.popup.imageFr,
        type: popup_1.popup.type,
        linkType: popup_1.popup.linkType,
        link: popup_1.popup.link,
        subcategoryId: popup_1.popup.subcategoryId,
        foodId: popup_1.popup.foodId,
        discountId: popup_1.popup.discountId,
        startDate: popup_1.popup.startDate,
        endDate: popup_1.popup.endDate,
    })
        .from(popup_1.popup)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(popup_1.popup.id, id), (0, drizzle_orm_1.eq)(popup_1.popup.status, "active"), (0, drizzle_orm_1.eq)(popup_1.popup.restaurantId, restaurantId)))
        .limit(1);
    if (!rows[0]) {
        throw new Errors_1.NotFound("Popup not found");
    }
    const p = rows[0];
    const linkData = await resolveLinkData(p.linkType ?? null, p.subcategoryId ?? null, p.foodId ?? null, p.discountId ?? null);
    const result = {
        id: p.id,
        Title: p.Title,
        TitleAr: p.TitleAr,
        TitleFr: p.TitleFr,
        description: p.description,
        descriptionAr: p.descriptionAr,
        descriptionFr: p.descriptionFr,
        image: p.image,
        imageAr: p.imageAr,
        imageFr: p.imageFr,
        type: p.type,
        startDate: p.startDate,
        endDate: p.endDate,
        linkType: p.linkType,
        link: p.linkType === "link" ? p.link : null,
        linkData: linkData,
    };
    return (0, response_1.SuccessResponse)(res, { message: "Get popup by id success", data: result });
};
exports.getPopupById = getPopupById;
