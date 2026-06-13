"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrderDetails = exports.getOrdersByRestaurant = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../models/schema");
const response_1 = require("../../utils/response");
const connection_1 = require("../../models/connection");
const Errors_1 = require("../../Errors");
const getOrdersByRestaurant = async (req, res) => {
    const { restaurantId } = req.params; // الأيدي بتاع المطعم اللي باعتينه في اللينك
    const { status } = req.query; // لو عايز تفلتر بـ Pending أو Delivered مثلاً
    // بناء الكويري بشكل ديناميكي
    const baseQuery = connection_1.db
        .select({
        orderId: schema_1.orders.orderNumber, // الرقم العشوائي (ORD-123)
        internalId: schema_1.orders.id,
        orderDate: schema_1.orders.createdAt,
        totalAmount: schema_1.orders.totalAmount,
        orderStatus: schema_1.orders.status,
        customerName: schema_1.users.name, // اسم العميل من جدول اليوزرز
        customerPhone: schema_1.users.phone
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.orders.userId, schema_1.users.id)); // ربطنا الأوردر باليوزر
    // لو الأدمن داس على تابة معينة (مثلاً Pending فقط)
    let condition = (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId);
    if (status) {
        condition = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.orders.status, status));
    }
    const result = await baseQuery.where(condition).orderBy((0, drizzle_orm_1.desc)(schema_1.orders.createdAt));
    return (0, response_1.SuccessResponse)(res, {
        message: "Fetched restaurant orders successfully",
        data: result
    });
};
exports.getOrdersByRestaurant = getOrdersByRestaurant;
const getOrderDetails = async (req, res) => {
    // 👈 هنجيب الـ orderId والـ restaurantId من الـ params
    const { orderId, restaurantId } = req.params;
    const result = await connection_1.db
        .select({
        orderNumber: schema_1.orders.orderNumber,
        internalId: schema_1.orders.id,
        restaurantId: schema_1.orders.restaurantId, // 👈 ضفنا الـ restaurantId في النتيجة برضه لو محتاجه
        orderDate: schema_1.orders.createdAt,
        totalAmount: schema_1.orders.totalAmount,
        orderStatus: schema_1.orders.status,
        subtotal: schema_1.orders.subtotal,
        deliveryFee: schema_1.orders.deliveryFee,
        serviceFee: schema_1.orders.serviceFee,
        paymentMethod: schema_1.orders.paymentMethod,
        customerName: schema_1.users.name,
        customerPhone: schema_1.users.phone,
        addressTitle: schema_1.addresses.title,
        street: schema_1.addresses.street,
        buildingNumber: schema_1.addresses.number,
        floor: schema_1.addresses.floor,
        lat: schema_1.addresses.lat,
        lng: schema_1.addresses.lng,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.orders.userId, schema_1.users.id))
        .leftJoin(schema_1.addresses, (0, drizzle_orm_1.eq)(schema_1.orders.addressId, schema_1.addresses.id))
        .where(
    // 👈 شرط الأمان: لازم الـ id بتاع الأوردر يطابق، وكمان يكون تبع المطعم ده
    (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId), (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId)))
        .limit(1);
    if (!result || result.length === 0) {
        // رسالة الخطأ دلوقتي بتغطي الحالتين (مش موجود أصلاً، أو موجود بس بتاع مطعم تاني)
        throw new Errors_1.NotFound("Order not found");
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "Order details fetched successfully",
        data: result[0]
    });
};
exports.getOrderDetails = getOrderDetails;
