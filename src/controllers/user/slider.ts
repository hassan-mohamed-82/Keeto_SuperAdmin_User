import { Request, Response } from "express";
import { db } from "../../models/connection";
import { sliders } from "../../models/schema";
import { subcategories } from "../../models/schema/admin/subcategory";
import { food } from "../../models/schema/admin/food";
import { discounts } from "../../models/schema/admin/discount";
import { eq } from "drizzle-orm";
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
                discountType: discounts.discountType,
                discountValue: discounts.discountValue,
                maxDiscount: discounts.maxDiscount,
                minOrderAmount: discounts.minOrderAmount,
                logo: discounts.logo,
                startDate: discounts.startDate,
                endDate: discounts.endDate,
                isActive: discounts.isActive,
            })
            .from(discounts)
            .where(eq(discounts.id, discountId))
            .limit(1);
        return disc ?? null;
    }

    return null;
}

// ─── Get All Sliders by Restaurant ───
export const getSliders = async (req: Request, res: Response) => {
    const { resId } = req.params;
    if (!resId) {
        throw new NotFound("restaurant id");
    }

    const rows = await db
        .select({
            id: sliders.id,
            img: sliders.img,
            periorty: sliders.periorty,
            linkType: sliders.linkType,
            link: sliders.link,
            subcategoryId: sliders.subcategoryId,
            foodId: sliders.foodId,
            discountId: sliders.discountId,
        })
        .from(sliders)
        .where(eq(sliders.restaurantid, resId));

    // resolve linked entity for each slider
    const result = await Promise.all(
        rows.map(async (s) => {
            const linkData = await resolveLinkData(
                s.linkType ?? null,
                s.subcategoryId ?? null,
                s.foodId ?? null,
                s.discountId ?? null
            );
            return {
                id: s.id,
                img: s.img,
                periorty: s.periorty,
                linkType: s.linkType,
                link: s.linkType === "link" ? s.link : null,
                linkData: linkData,
            };
        })
    );

    return SuccessResponse(res, { data: result });
};