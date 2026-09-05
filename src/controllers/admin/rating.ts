import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurantRatings, restaurants, users, orders } from "../../models/schema";
import { eq, sql, count, avg, and, isNotNull, desc, gte, lte } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";
import { buildOrderDateConditions } from "../../helpers/restaurantschedule.helper";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

// ==========================================
// 1. Get Restaurant Rating Stats (Admin)
// ==========================================
export const getRestaurantRatingStats = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;

    // تأكد المطعم موجود
    const [restaurant] = await db.select({ id: restaurants.id, name: restaurants.name })
        .from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
    if (!restaurant) throw new NotFound("Restaurant not found");

    // إجمالي عدد التقييمات ومتوسط التقييم
    const [stats] = await db.select({
        totalRatings: count(restaurantRatings.id),
        averageRating: avg(restaurantRatings.rating),
    })
        .from(restaurantRatings)
        .where(eq(restaurantRatings.restaurantId, restaurantId));

    // نسب كل نجمة (1-5)
    const breakdown = await db.select({
        rating: restaurantRatings.rating,
        count: count(restaurantRatings.id),
    })
        .from(restaurantRatings)
        .where(eq(restaurantRatings.restaurantId, restaurantId))
        .groupBy(restaurantRatings.rating);

    const total = Number(stats.totalRatings) || 0;

    // بناء النسب لكل نجمة (1-5)
    const ratingBreakdown = [1, 2, 3, 4, 5].map(star => {
        const found = breakdown.find(b => b.rating === star);
        const starCount = found ? Number(found.count) : 0;
        return {
            star,
            count: starCount,
            percentage: total > 0 ? parseFloat(((starCount / total) * 100).toFixed(1)) : 0,
        };
    });

    return SuccessResponse(res, {
        data: {
            restaurant: { id: restaurant.id, name: restaurant.name },
            totalRatings: total,
            averageRating: stats.averageRating ? parseFloat(Number(stats.averageRating).toFixed(1)) : 0,
            breakdown: ratingBreakdown,
        }
    });
};

// ==========================================
// 2. Get All Ratings for a Restaurant (Admin - with user info)
// ==========================================
export const getRestaurantRatings = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;

    const ratings = await db.select({
        id: restaurantRatings.id,
        rating: restaurantRatings.rating,
        comment: restaurantRatings.comment,
        createdAt: restaurantRatings.createdAt,
        userName: users.name,
        userEmail: users.email,
        userPhoto: users.photo,
    })
        .from(restaurantRatings)
        .leftJoin(users, eq(restaurantRatings.userId, users.id))
        .where(eq(restaurantRatings.restaurantId, restaurantId));

    return SuccessResponse(res, { data: ratings });
};


export const deleteRating = async (req: Request, res: Response) => {
    const { id } = req.params;
    const [rating] = await db.select().from(restaurantRatings).where(eq(restaurantRatings.id, id)).limit(1);
    if (!rating) throw new NotFound("Rating not found");
    await db.delete(restaurantRatings).where(eq(restaurantRatings.id, id));
    return SuccessResponse(res, { data: null });
}
export const getAllCustomerRatings = async (req: Request, res: Response) => {
    const restaurantId = req.query.restaurantId as string | undefined;

    let dateConditions: any[] = [];

    if (restaurantId) {
        // If restaurantId is provided, we can use the existing shift-based helper
        dateConditions = await buildOrderDateConditions(req, restaurantId);
    } else {
        // Build generic date conditions with default to current day
        const rawStartDate = (
            req.query?.startDate ||
            req.query?.start_date ||
            req.query?.date
        ) as string | undefined;

        const rawEndDate = (
            req.query?.endDate ||
            req.query?.end_date
        ) as string | undefined;

        let startDate: Date;
        let endDate: Date;

        // Default: Start of current day in Cairo time
        if (rawStartDate) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(rawStartDate)) {
                startDate = dayjs.tz(rawStartDate, "Africa/Cairo").startOf("day").toDate();
            } else {
                startDate = dayjs(rawStartDate).toDate();
            }
        } else {
            startDate = dayjs().tz("Africa/Cairo").startOf("day").toDate();
        }

        // Default: End of current day in Cairo time
        if (rawEndDate) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(rawEndDate)) {
                endDate = dayjs.tz(rawEndDate, "Africa/Cairo").endOf("day").toDate();
            } else {
                endDate = dayjs(rawEndDate).toDate();
            }
        } else {
            endDate = dayjs().tz("Africa/Cairo").endOf("day").toDate();
        }

        if (startDate > endDate) {
            throw new BadRequest("startDate cannot be after endDate");
        }

        dateConditions.push(gte(orders.createdAt, startDate));
        dateConditions.push(lte(orders.createdAt, endDate));
    }

    const whereConditions = [isNotNull(orders.rating), ...dateConditions];
    if (restaurantId) {
        whereConditions.push(eq(orders.restaurantId, restaurantId));
    }

    // Fetch orders with Customer & Restaurant details
    const ratedOrders = await db
        .select({
            orderId: orders.id,
            orderNumber: orders.dailyOrderNumber,
            orderCreatedAt: orders.createdAt,
            orderTotalAmount: orders.totalAmount,
            orderStatus: orders.status,
            rating: orders.rating,
            ratingComment: orders.ratingComment,
            restaurant: {
                id: restaurants.id,
                name: restaurants.name,
                nameAr: restaurants.nameAr,
                logo: restaurants.logo,
            },
            customer: {
                id: users.id,
                name: users.name,
                email: users.email,
                phone: users.phone,
                photo: users.photo,
            },
        })
        .from(orders)
        .leftJoin(users, eq(orders.userId, users.id))
        .leftJoin(restaurants, eq(orders.restaurantId, restaurants.id)) // Join with restaurants table
        .where(and(...whereConditions))
        .orderBy(desc(orders.createdAt));

    // Group by customer
    const customerMap = new Map<
        string,
        {
            customer: { id: string; name: string; email: string | null; phone: string | null; photo: string | null };
            totalOrders: number;
            averageRating: number;
            orders: Array<{
                orderId: string;
                orderNumber: number | null;
                orderCreatedAt: Date | null;
                orderTotalAmount: string;
                orderStatus: string | null;
                rating: number;
                ratingComment: string | null;
                restaurant: {
                    id: string | null;
                    name: string | null;
                    nameAr: string | null;
                    logo: string | null;
                } | null;
            }>;
        }
    >();

    for (const row of ratedOrders) {
        if (!row.customer?.id || row.rating === null || row.rating === undefined) continue;

        const customerId = row.customer.id;

        if (!customerMap.has(customerId)) {
            customerMap.set(customerId, {
                customer: {
                    id: row.customer.id,
                    name: row.customer.name ?? "",
                    email: row.customer.email ?? null,
                    phone: row.customer.phone ?? null,
                    photo: row.customer.photo ?? null,
                },
                totalOrders: 0,
                averageRating: 0,
                orders: [],
            });
        }

        const entry = customerMap.get(customerId)!;
        entry.orders.push({
            orderId: row.orderId,
            orderNumber: row.orderNumber,
            orderCreatedAt: row.orderCreatedAt,
            orderTotalAmount: row.orderTotalAmount,
            orderStatus: row.orderStatus,
            rating: row.rating,
            ratingComment: row.ratingComment ?? null,
            restaurant: row.restaurant?.id ? row.restaurant : null, // Include restaurant details per order
        });
    }

    // Calculate averages
    const result = Array.from(customerMap.values()).map((entry) => {
        const totalRating = entry.orders.reduce((sum, o) => sum + o.rating, 0);
        entry.totalOrders = entry.orders.length;
        entry.averageRating = parseFloat((totalRating / entry.orders.length).toFixed(1));
        return entry;
    });

    const totalRatedOrders = ratedOrders.length;
    const overallAverage =
        totalRatedOrders > 0
            ? parseFloat(
                (
                    ratedOrders.reduce((sum, o) => sum + (o.rating ?? 0), 0) /
                    totalRatedOrders
                ).toFixed(1)
            )
            : 0;

    return SuccessResponse(res, {
        message: "Get all customer ratings success",
        data: {
            summary: {
                totalRatedOrders,
                totalUniqueCustomers: result.length,
                overallAverageRating: overallAverage,
            },
            customers: result,
        },
    });
};