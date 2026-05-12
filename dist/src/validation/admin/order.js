"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateOrderItemSchema = exports.createOrderItemSchema = exports.updateOrderSchema = exports.createOrderSchema = void 0;
const zod_1 = require("zod");
exports.createOrderSchema = zod_1.z.object({
    // الحقول الأساسية (Required)
    orderNumber: zod_1.z.string().min(1, "Order number is required").max(20),
    orderSource: zod_1.z.enum(["online_order", "food_aggregator"], { required_error: "Order source is required" }),
    paymentMethod: zod_1.z.enum(["cash_on_delivery", "visa", "wallet"], { required_error: "Payment method is required" }),
    // المبالغ المالية (Required)
    subtotal: zod_1.z.coerce.string().min(1, "Subtotal is required"),
    totalAmount: zod_1.z.coerce.string().min(1, "Total amount is required"),
    // العلاقات (Required)
    userId: zod_1.z.string().uuid("Invalid User ID"),
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID"),
    branchId: zod_1.z.string().uuid("Invalid Branch ID"),
    // الحقول الاختيارية والـ Defaults
    idempotencyKey: zod_1.z.string().max(100).optional(),
    addressId: zod_1.z.string().uuid("Invalid Address ID").optional(),
    orderType: zod_1.z.enum(["delivery", "takeaway", "dine_in"]).optional(),
    deliveryFee: zod_1.z.coerce.string().optional(),
    serviceFee: zod_1.z.coerce.string().optional(),
    appCommission: zod_1.z.coerce.string().optional(),
    status: zod_1.z.enum([
        "pending",
        "accepted",
        "preparing",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "rejected",
        "refund"
    ]).optional(),
    cancelReason: zod_1.z.string().optional(),
});
exports.updateOrderSchema = exports.createOrderSchema.partial();
exports.createOrderItemSchema = zod_1.z.object({
    // العلاقات (Required)
    orderId: zod_1.z.string().uuid("Invalid Order ID"),
    foodId: zod_1.z.string().uuid("Invalid Food ID"),
    // الكمية (Required - يجب أن تكون رقم صحيح وموجب)
    quantity: zod_1.z.coerce.number().int().min(1, "Quantity must be at least 1"),
    // الأسعار (Required)
    basePrice: zod_1.z.coerce.string().min(1, "Base price is required"),
    totalPrice: zod_1.z.coerce.string().min(1, "Total price is required"),
    // الحقول الاختيارية (ليها Default)
    variationsPrice: zod_1.z.coerce.string().optional(),
});
// في الغالب الـ Order Items مش بيتعملها Update (بتتحذف وتتضاف من جديد)، 
// بس لو محتاجها تقدر تستخدم الـ Partial
exports.updateOrderItemSchema = exports.createOrderItemSchema.partial();
