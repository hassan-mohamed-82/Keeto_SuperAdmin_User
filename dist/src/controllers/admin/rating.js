"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rejectRatingModerationRequest = exports.approveRatingModerationRequest = exports.getAllRatingModerationRequests = exports.getAllCustomerRatings = exports.updateRating = exports.deleteRating = exports.getAllRestaurantRatings = exports.getRestaurantRatings = exports.getRestaurantRatingStats = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const mysql_core_1 = require("drizzle-orm/mysql-core");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const restaurantschedule_helper_1 = require("../../helpers/restaurantschedule.helper");
const dayjs_1 = __importDefault(require("dayjs"));
const utc_1 = __importDefault(require("dayjs/plugin/utc"));
const timezone_1 = __importDefault(require("dayjs/plugin/timezone"));
dayjs_1.default.extend(utc_1.default);
dayjs_1.default.extend(timezone_1.default);
// ==========================================
// 1. Get Restaurant Rating Stats (Admin)
// ==========================================
const getRestaurantRatingStats = async (req, res) => {
    const { restaurantId } = req.params;
    // تأكد المطعم موجود
    const [restaurant] = await connection_1.db.select({ id: schema_1.restaurants.id, name: schema_1.restaurants.name })
        .from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId)).limit(1);
    if (!restaurant)
        throw new NotFound_1.NotFound("Restaurant not found");
    // إجمالي عدد التقييمات ومتوسط التقييم
    const [stats] = await connection_1.db.select({
        totalRatings: (0, drizzle_orm_1.count)(schema_1.restaurantRatings.id),
        averageRating: (0, drizzle_orm_1.avg)(schema_1.restaurantRatings.rating),
    })
        .from(schema_1.restaurantRatings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantRatings.restaurantId, restaurantId));
    // نسب كل نجمة (1-5)
    const breakdown = await connection_1.db.select({
        rating: schema_1.restaurantRatings.rating,
        count: (0, drizzle_orm_1.count)(schema_1.restaurantRatings.id),
    })
        .from(schema_1.restaurantRatings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantRatings.restaurantId, restaurantId))
        .groupBy(schema_1.restaurantRatings.rating);
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
    return (0, response_1.SuccessResponse)(res, {
        data: {
            restaurant: { id: restaurant.id, name: restaurant.name },
            totalRatings: total,
            averageRating: stats.averageRating ? parseFloat(Number(stats.averageRating).toFixed(1)) : 0,
            breakdown: ratingBreakdown,
        }
    });
};
exports.getRestaurantRatingStats = getRestaurantRatingStats;
// ==========================================
// 2. Get All Ratings for a Restaurant (Admin - with user info)
// ==========================================
const getRestaurantRatings = async (req, res) => {
    const { restaurantId } = req.params;
    //const page = parseInt(req.query.page as string) || 1;
    // const limit = parseInt(req.query.limit as string) || 10;
    // const offset = (page - 1) * limit;
    // const [totalRatingsData] = await db.select({ count: sql`count(*)` }).from(restaurantRatings).where(eq(restaurantRatings.restaurantId, restaurantId));
    // const totalRatings = Number(totalRatingsData.count);
    // const totalPages = Math.ceil(totalRatings / limit);
    const ratings = await connection_1.db.select({
        id: schema_1.restaurantRatings.id,
        rating: schema_1.restaurantRatings.rating,
        comment: schema_1.restaurantRatings.comment,
        createdAt: schema_1.restaurantRatings.createdAt,
        userName: schema_1.users.name,
        userEmail: schema_1.users.email,
        userPhoto: schema_1.users.photo,
    })
        .from(schema_1.restaurantRatings)
        .leftJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.restaurantRatings.userId, schema_1.users.id))
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantRatings.restaurantId, restaurantId));
    // .limit(limit)
    // .offset(offset);
    return (0, response_1.SuccessResponse)(res, { data: ratings });
};
exports.getRestaurantRatings = getRestaurantRatings;
const getAllRestaurantRatings = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const restaurantId = req.query.restaurantId;
    // Define the filter condition if restaurantId is provided
    const restaurantFilter = restaurantId ? (0, drizzle_orm_1.eq)(schema_1.restaurantRatings.restaurantId, restaurantId) : undefined;
    // 1. Get the total count based on the filter (essential for correct pagination)
    const countQuery = connection_1.db.select({ count: (0, drizzle_orm_1.sql) `count(*)` }).from(schema_1.restaurantRatings);
    if (restaurantFilter) {
        countQuery.where(restaurantFilter);
    }
    const [totalRatingsData] = await countQuery;
    const totalRatings = Number(totalRatingsData.count);
    const totalPages = Math.ceil(totalRatings / limit);
    // 2. Build the main query with joins, optional filter, and pagination
    const ratingsQuery = connection_1.db.select({
        id: schema_1.restaurantRatings.id,
        rating: schema_1.restaurantRatings.rating,
        comment: schema_1.restaurantRatings.comment,
        createdAt: schema_1.restaurantRatings.createdAt,
        userName: schema_1.users.name,
        userEmail: schema_1.users.email,
        userPhoto: schema_1.users.photo,
        restaurantName: schema_1.restaurants.name,
        restaurantNameAr: schema_1.restaurants.nameAr,
    })
        .from(schema_1.restaurantRatings)
        .leftJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.restaurantRatings.userId, schema_1.users.id))
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.restaurantRatings.restaurantId, schema_1.restaurants.id));
    if (restaurantFilter) {
        ratingsQuery.where(restaurantFilter);
    }
    const ratings = await ratingsQuery.limit(limit).offset(offset);
    return (0, response_1.SuccessResponse)(res, {
        data: ratings,
        pagination: { total: totalRatings, page, limit, totalPages }
    });
};
exports.getAllRestaurantRatings = getAllRestaurantRatings;
const deleteRating = async (req, res) => {
    const { id } = req.params;
    const [rating] = await connection_1.db.select().from(schema_1.restaurantRatings).where((0, drizzle_orm_1.eq)(schema_1.restaurantRatings.id, id)).limit(1);
    if (!rating)
        throw new NotFound_1.NotFound("Rating not found");
    await connection_1.db.delete(schema_1.restaurantRatings).where((0, drizzle_orm_1.eq)(schema_1.restaurantRatings.id, id));
    return (0, response_1.SuccessResponse)(res, { data: null });
};
exports.deleteRating = deleteRating;
const updateRating = async (req, res) => {
    const { id } = req.params;
    const { rating, comment } = req.body;
    const [existingRating] = await connection_1.db.select().from(schema_1.restaurantRatings).where((0, drizzle_orm_1.eq)(schema_1.restaurantRatings.id, id)).limit(1);
    if (!existingRating)
        throw new NotFound_1.NotFound("Rating not found");
    await connection_1.db.update(schema_1.restaurantRatings)
        .set({
        rating: rating !== undefined ? rating : existingRating.rating,
        comment: comment !== undefined ? comment : existingRating.comment,
    })
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantRatings.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Rating updated successfully" });
};
exports.updateRating = updateRating;
const getAllCustomerRatings = async (req, res) => {
    const restaurantId = req.query.restaurantId;
    let dateConditions = [];
    if (restaurantId) {
        // If restaurantId is provided, we can use the existing shift-based helper
        dateConditions = await (0, restaurantschedule_helper_1.buildOrderDateConditions)(req, restaurantId);
    }
    else {
        // Build generic date conditions with default to current day
        const rawStartDate = (req.query?.startDate ||
            req.query?.start_date ||
            req.query?.date);
        const rawEndDate = (req.query?.endDate ||
            req.query?.end_date);
        let startDate;
        let endDate;
        // Default: Start of current day in Cairo time
        if (rawStartDate) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(rawStartDate)) {
                startDate = dayjs_1.default.tz(rawStartDate, "Africa/Cairo").startOf("day").toDate();
            }
            else {
                startDate = (0, dayjs_1.default)(rawStartDate).toDate();
            }
        }
        else {
            startDate = (0, dayjs_1.default)().tz("Africa/Cairo").startOf("day").toDate();
        }
        // Default: End of current day in Cairo time
        if (rawEndDate) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(rawEndDate)) {
                endDate = dayjs_1.default.tz(rawEndDate, "Africa/Cairo").endOf("day").toDate();
            }
            else {
                endDate = (0, dayjs_1.default)(rawEndDate).toDate();
            }
        }
        else {
            endDate = (0, dayjs_1.default)().tz("Africa/Cairo").endOf("day").toDate();
        }
        if (startDate > endDate) {
            throw new BadRequest_1.BadRequest("startDate cannot be after endDate");
        }
        dateConditions.push((0, drizzle_orm_1.gte)(schema_1.orders.createdAt, startDate));
        dateConditions.push((0, drizzle_orm_1.lte)(schema_1.orders.createdAt, endDate));
    }
    const whereConditions = [(0, drizzle_orm_1.isNotNull)(schema_1.orders.rating), ...dateConditions];
    if (restaurantId) {
        whereConditions.push((0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId));
    }
    // Fetch orders with Customer & Restaurant details
    const ratedOrders = await connection_1.db
        .select({
        orderId: schema_1.orders.id,
        orderNumber: schema_1.orders.dailyOrderNumber,
        orderCreatedAt: schema_1.orders.createdAt,
        orderTotalAmount: schema_1.orders.totalAmount,
        orderStatus: schema_1.orders.status,
        rating: schema_1.orders.rating,
        ratingComment: schema_1.orders.ratingComment,
        restaurant: {
            id: schema_1.restaurants.id,
            name: schema_1.restaurants.name,
            nameAr: schema_1.restaurants.nameAr,
            logo: schema_1.restaurants.logo,
        },
        customer: {
            id: schema_1.users.id,
            name: schema_1.users.name,
            email: schema_1.users.email,
            phone: schema_1.users.phone,
            photo: schema_1.users.photo,
        },
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.orders.userId, schema_1.users.id))
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurants.id)) // Join with restaurants table
        .where((0, drizzle_orm_1.and)(...whereConditions))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.orders.createdAt));
    // Group by customer
    const customerMap = new Map();
    for (const row of ratedOrders) {
        if (!row.customer?.id || row.rating === null || row.rating === undefined)
            continue;
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
        const entry = customerMap.get(customerId);
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
    const overallAverage = totalRatedOrders > 0
        ? parseFloat((ratedOrders.reduce((sum, o) => sum + (o.rating ?? 0), 0) /
            totalRatedOrders).toFixed(1))
        : 0;
    return (0, response_1.SuccessResponse)(res, {
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
exports.getAllCustomerRatings = getAllCustomerRatings;
// ==========================================
// 7. Get All Rating Moderation Requests (Pending List & History)
// يتيح للسوبر أدمن فلترة الطلبات المعلقة (pending) والمطاعم والنوع (restaurant / order)
// ==========================================
const getAllRatingModerationRequests = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const status = req.query.status || "all";
    const targetType = req.query.targetType || "restaurant";
    const restaurantId = req.query.restaurantId;
    const conditions = [];
    if (status && status !== "all") {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.ratingRequests.status, status));
    }
    if (targetType && targetType !== "all") {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.ratingRequests.targetType, targetType));
    }
    if (restaurantId) {
        conditions.push((0, drizzle_orm_1.eq)(schema_1.ratingRequests.restaurantId, restaurantId));
    }
    const whereClause = conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined;
    const [totalData] = await connection_1.db
        .select({ count: (0, drizzle_orm_1.sql) `count(*)` })
        .from(schema_1.ratingRequests)
        .where(whereClause);
    const total = Number(totalData?.count ?? 0);
    const totalPages = Math.ceil(total / limit);
    const customerUser = (0, mysql_core_1.alias)(schema_1.users, "customer_user");
    const requests = await connection_1.db
        .select({
        id: schema_1.ratingRequests.id,
        targetType: schema_1.ratingRequests.targetType,
        requestType: schema_1.ratingRequests.requestType,
        ratingId: schema_1.ratingRequests.ratingId,
        orderId: schema_1.ratingRequests.orderId,
        newRating: schema_1.ratingRequests.newRating,
        newComment: schema_1.ratingRequests.newComment,
        reason: schema_1.ratingRequests.reason,
        status: schema_1.ratingRequests.status,
        adminNotes: schema_1.ratingRequests.adminNotes,
        resolvedAt: schema_1.ratingRequests.resolvedAt,
        createdAt: schema_1.ratingRequests.createdAt,
        restaurant: {
            id: schema_1.restaurants.id,
            name: schema_1.restaurants.name,
            nameAr: schema_1.restaurants.nameAr,
            logo: schema_1.restaurants.logo,
        },
        restaurantRating: {
            id: schema_1.restaurantRatings.id,
            rating: schema_1.restaurantRatings.rating,
            comment: schema_1.restaurantRatings.comment,
            createdAt: schema_1.restaurantRatings.createdAt,
        },
        order: {
            id: schema_1.orders.id,
            orderNumber: schema_1.orders.dailyOrderNumber,
            orderTotalAmount: schema_1.orders.totalAmount,
            rating: schema_1.orders.rating,
            ratingComment: schema_1.orders.ratingComment,
            createdAt: schema_1.orders.createdAt,
        },
        customer: {
            id: customerUser.id,
            name: customerUser.name,
            email: customerUser.email,
            phone: customerUser.phone,
            photo: customerUser.photo,
        },
    })
        .from(schema_1.ratingRequests)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.ratingRequests.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.restaurantRatings, (0, drizzle_orm_1.eq)(schema_1.ratingRequests.ratingId, schema_1.restaurantRatings.id))
        .leftJoin(schema_1.orders, (0, drizzle_orm_1.eq)(schema_1.ratingRequests.orderId, schema_1.orders.id))
        .leftJoin(customerUser, (0, drizzle_orm_1.sql) `${customerUser.id} = COALESCE(${schema_1.restaurantRatings.userId}, ${schema_1.orders.userId})`)
        .where(whereClause)
        .orderBy((0, drizzle_orm_1.desc)(schema_1.ratingRequests.createdAt))
        .limit(limit)
        .offset(offset);
    return (0, response_1.SuccessResponse)(res, {
        message: "Rating moderation requests fetched successfully",
        data: requests,
        pagination: {
            total,
            page,
            limit,
            totalPages,
        },
    });
};
exports.getAllRatingModerationRequests = getAllRatingModerationRequests;
// ==========================================
// 8. قبول طلب التعديل أو الحذف (Approve Request)
// إذا كان الطلب حذف: يتم حذف التقييم / تصفيره
// إذا كان الطلب تعديل: يتم تعديل التقييم والتعليق
// ==========================================
const approveRatingModerationRequest = async (req, res) => {
    const { id } = req.params;
    const { adminNotes } = req.body;
    const [request] = await connection_1.db
        .select()
        .from(schema_1.ratingRequests)
        .where((0, drizzle_orm_1.eq)(schema_1.ratingRequests.id, id))
        .limit(1);
    if (!request)
        throw new NotFound_1.NotFound("Rating moderation request not found");
    if (request.status !== "pending") {
        throw new BadRequest_1.BadRequest(`This request has already been ${request.status}`);
    }
    if (request.targetType === "restaurant") {
        if (!request.ratingId) {
            throw new BadRequest_1.BadRequest("Rating ID is missing on this request");
        }
        const [existingRating] = await connection_1.db
            .select()
            .from(schema_1.restaurantRatings)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantRatings.id, request.ratingId))
            .limit(1);
        if (existingRating) {
            if (request.requestType === "delete") {
                await connection_1.db.delete(schema_1.restaurantRatings).where((0, drizzle_orm_1.eq)(schema_1.restaurantRatings.id, request.ratingId));
            }
            else if (request.requestType === "edit") {
                await connection_1.db
                    .update(schema_1.restaurantRatings)
                    .set({
                    rating: request.newRating ?? existingRating.rating,
                    comment: request.newComment !== undefined ? request.newComment : existingRating.comment,
                    updatedAt: new Date(),
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.restaurantRatings.id, request.ratingId));
            }
        }
    }
    else if (request.targetType === "order") {
        if (!request.orderId) {
            throw new BadRequest_1.BadRequest("Order ID is missing on this request");
        }
        const [existingOrder] = await connection_1.db
            .select({ id: schema_1.orders.id, rating: schema_1.orders.rating, ratingComment: schema_1.orders.ratingComment })
            .from(schema_1.orders)
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, request.orderId))
            .limit(1);
        if (existingOrder) {
            if (request.requestType === "delete") {
                await connection_1.db
                    .update(schema_1.orders)
                    .set({ rating: null, ratingComment: null })
                    .where((0, drizzle_orm_1.eq)(schema_1.orders.id, request.orderId));
            }
            else if (request.requestType === "edit") {
                await connection_1.db
                    .update(schema_1.orders)
                    .set({
                    rating: request.newRating ?? existingOrder.rating,
                    ratingComment: request.newComment !== undefined ? request.newComment : existingOrder.ratingComment,
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.orders.id, request.orderId));
            }
        }
    }
    await connection_1.db
        .update(schema_1.ratingRequests)
        .set({
        status: "approved",
        adminNotes: adminNotes ?? null,
        resolvedAt: new Date(),
    })
        .where((0, drizzle_orm_1.eq)(schema_1.ratingRequests.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Rating moderation request approved and applied successfully",
        data: {
            id,
            status: "approved",
            resolvedAt: new Date(),
        },
    });
};
exports.approveRatingModerationRequest = approveRatingModerationRequest;
// ==========================================
// 9. رفض طلب التعديل أو الحذف (Reject Request)
// يظل التقييم كما هو مع حفظ سبب الرفض
// ==========================================
const rejectRatingModerationRequest = async (req, res) => {
    const { id } = req.params;
    const { adminNotes } = req.body;
    const [request] = await connection_1.db
        .select()
        .from(schema_1.ratingRequests)
        .where((0, drizzle_orm_1.eq)(schema_1.ratingRequests.id, id))
        .limit(1);
    if (!request)
        throw new NotFound_1.NotFound("Rating moderation request not found");
    if (request.status !== "pending") {
        throw new BadRequest_1.BadRequest(`This request has already been ${request.status}`);
    }
    await connection_1.db
        .update(schema_1.ratingRequests)
        .set({
        status: "rejected",
        adminNotes: adminNotes ?? null,
        resolvedAt: new Date(),
    })
        .where((0, drizzle_orm_1.eq)(schema_1.ratingRequests.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Rating moderation request rejected successfully",
        data: {
            id,
            status: "rejected",
            resolvedAt: new Date(),
        },
    });
};
exports.rejectRatingModerationRequest = rejectRatingModerationRequest;
