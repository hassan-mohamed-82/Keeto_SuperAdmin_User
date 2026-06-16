import { Request, Response } from "express";
import { eq, and, or, isNull, lte, gte } from "drizzle-orm";
import { db } from "../../models/connection"; // مسار الاتصال بقاعدة البيانات
import { discounts, discountFoods, food } from "../../models/schema"; 

export const getRestaurantOffers = async (req: Request, res: Response) => {
    try {
        const { restaurantId } = req.params;
        const now = new Date();

        const offers = await db
            .select({
                foodId: food.id,
                foodName: food.name, // أو nameAr / nameEn حسب الداتابيز عندك
                originalPrice: food.price,
                
                // تفاصيل الخصم
                discountId: discounts.id,
                discountName: discounts.name,
                discountType: discounts.discountType,
                discountValue: discounts.discountValue,
            })
            .from(discountFoods)
            .innerJoin(discounts, eq(discountFoods.discountId, discounts.id))
            .innerJoin(food, eq(discountFoods.foodId, food.id))
            .where(
                and(
                    eq(food.restaurantid, restaurantId), // فلترة بالمطعم
                    eq(discounts.isActive, true), // الخصم مفعل
                    
                    // التأكد إن تاريخ الخصم ساري (لو التواريخ موجودة)
                    or(isNull(discounts.startDate), lte(discounts.startDate, now)),
                    or(isNull(discounts.endDate), gte(discounts.endDate, now))
                )
            );

        return res.status(200).json({
            success: true,
            message: "Restaurant offers retrieved successfully",
            data: offers,
        });

    } catch (error) {
        console.error("Error fetching restaurant offers:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};



export const getAllOffers = async (req: Request, res: Response) => {
    try {
        const now = new Date();

        const globalOffers = await db
            .select({
                foodId: food.id,
                foodName: food.name,
                originalPrice: food.price,
                restaurantId: food.restaurantid, // مهم هنا عشان اليوزر يعرف المطعم
                
                // تفاصيل الخصم
                discountId: discounts.id,
                discountName: discounts.name,
                discountType: discounts.discountType,
                discountValue: discounts.discountValue,
                isGlobal: discounts.isGlobal,
            })
            .from(discountFoods)
            .innerJoin(discounts, eq(discountFoods.discountId, discounts.id))
            .innerJoin(food, eq(discountFoods.foodId, food.id))
            .where(
                and(
                    eq(discounts.isActive, true), // الخصم مفعل
                    
                    // التأكد إن تاريخ الخصم ساري
                    or(isNull(discounts.startDate), lte(discounts.startDate, now)),
                    or(isNull(discounts.endDate), gte(discounts.endDate, now))
                )
            );

        return res.status(200).json({
            success: true,
            message: "All platform offers retrieved successfully",
            data: globalOffers,
        });

    } catch (error) {
        console.error("Error fetching all offers:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};