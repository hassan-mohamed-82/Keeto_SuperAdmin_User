import { Request, Response } from "express";
import { db } from "../../models/connection";
import { popup } from "../../models/schema/admin/popup";
import { subcategories } from "../../models/schema/admin/subcategory";
import { food } from "../../models/schema/admin/food";
import { discounts, discountGroups } from "../../models/schema/admin/discount";
import { eq, and, gte, lte, isNotNull } from "drizzle-orm";
import { NotFound } from "../../Errors";
import { SuccessResponse } from "../../utils/response";

// ─── Helper: resolve linked entity based on linkType ───
async function resolveLinkData(
    linkType: string | null,
    subcategoryId: string | null,
    foodId: string | null,
    discountId: string | null
) {
    if (linkType === "subcategory" && subcategoryId) {
        const [sub] = await db
            .select({
                id: subcategories.id,
                name: subcategories.name,
                nameAr: subcategories.nameAr,
                nameFr: subcategories.nameFr,
                image: subcategories.image,
                status: subcategories.status,
            })
            .from(subcategories)
            .where(eq(subcategories.id, subcategoryId))
            .limit(1);
        return sub ?? null;
    }

    if (linkType === "product" && foodId) {
        const [item] = await db
            .select({
                id: food.id,
                name: food.name,
                nameAr: food.nameAr,
                nameFr: food.nameFr,
                image: food.image,
                price: food.price,
                offerPrice: food.offer_price,
                status: food.status,
            })
            .from(food)
            .where(eq(food.id, foodId))
            .limit(1);
        return item ?? null;
    }

    if (linkType === "discount" && discountId) {
        const [disc] = await db
            .select({
                id: discounts.id,
                name: discounts.name,
                nameAr: discounts.nameAr,
                nameFr: discounts.nameFr,
                discountType: discountGroups.discountType,
                discountValue: discountGroups.discountValue,
                maxDiscount: discountGroups.maxDiscount,
                minOrderAmount: discounts.minOrderAmount,
                logo: discounts.logo,
                startDate: discounts.startDate,
                endDate: discounts.endDate,
                isActive: discounts.isActive,
            })
            .from(discounts)
            .leftJoin(discountGroups, eq(discounts.id, discountGroups.discountId))
            .where(eq(discounts.id, discountId))
            .limit(1);
        return disc ?? null;
    }

    return null;
}

// ─── Get All Active Popups (filtered by date and status) ───
export const getActivePopups = async (req: Request, res: Response) => {
    const now = new Date();
    const { restaurantId } = req.params;

    const activePopups = await db
        .select({
            id: popup.id,
            Title: popup.Title,
            TitleAr: popup.TitleAr,
            TitleFr: popup.TitleFr,
            description: popup.description,
            descriptionAr: popup.descriptionAr,
            descriptionFr: popup.descriptionFr,
            image: popup.image,
            imageAr: popup.imageAr,
            imageFr: popup.imageFr,
            type: popup.type,
            linkType: popup.linkType,
            link: popup.link,
            subcategoryId: popup.subcategoryId,
            foodId: popup.foodId,
            discountId: popup.discountId,
            startDate: popup.startDate,
            endDate: popup.endDate,
        })
        .from(popup)
        .where(
            and(
                eq(popup.status, "active"),
                lte(popup.startDate, now),
                gte(popup.endDate, now),
                eq(popup.restaurantId, restaurantId)
            )
        );

    // resolve linked entity for each popup
    const result = await Promise.all(
        activePopups.map(async (p) => {
            const linkData = await resolveLinkData(
                p.linkType ?? null,
                p.subcategoryId ?? null,
                p.foodId ?? null,
                p.discountId ?? null
            );
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
        })
    );

    return SuccessResponse(res, { message: "Get active popups success", data: result });
};

// ─── Get Active Popup By ID ───
export const getPopupById = async (req: Request, res: Response) => {
    const { restaurantId, id } = req.params;

    const rows = await db
        .select({
            id: popup.id,
            Title: popup.Title,
            TitleAr: popup.TitleAr,
            TitleFr: popup.TitleFr,
            description: popup.description,
            descriptionAr: popup.descriptionAr,
            descriptionFr: popup.descriptionFr,
            image: popup.image,
            imageAr: popup.imageAr,
            imageFr: popup.imageFr,
            type: popup.type,
            linkType: popup.linkType,
            link: popup.link,
            subcategoryId: popup.subcategoryId,
            foodId: popup.foodId,
            discountId: popup.discountId,
            startDate: popup.startDate,
            endDate: popup.endDate,
        })
        .from(popup)
        .where(
            and(
                eq(popup.id, id),
                eq(popup.status, "active"),
                eq(popup.restaurantId, restaurantId)
            )
        )
        .limit(1);

    if (!rows[0]) {
        throw new NotFound("Popup not found");
    }

    const p = rows[0];
    const linkData = await resolveLinkData(
        p.linkType ?? null,
        p.subcategoryId ?? null,
        p.foodId ?? null,
        p.discountId ?? null
    );

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

    return SuccessResponse(res, { message: "Get popup by id success", data: result });
};
