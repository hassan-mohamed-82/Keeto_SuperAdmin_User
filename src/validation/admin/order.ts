import { z } from "zod";

export const createOrderSchema = z.object({
    // الحقول الأساسية (Required)
    orderNumber: z.string().min(1, "Order number is required").max(20),
    orderSource: z.enum(["online_order", "food_aggregator"], { required_error: "Order source is required" }),
    paymentMethod: z.enum(["cash_on_delivery", "visa", "wallet"], { required_error: "Payment method is required" }),
    
    // المبالغ المالية (Required)
    subtotal: z.coerce.string().min(1, "Subtotal is required"),
    totalAmount: z.coerce.string().min(1, "Total amount is required"),

    // العلاقات (Required)
    userId: z.string().uuid("Invalid User ID"),
    restaurantId: z.string().uuid("Invalid Restaurant ID"),
    branchId: z.string().uuid("Invalid Branch ID"),

    // الحقول الاختيارية والـ Defaults
    idempotencyKey: z.string().max(100).optional(),
    addressId: z.string().uuid("Invalid Address ID").optional(),
    orderType: z.enum(["delivery", "takeaway", "dine_in"]).optional(),
    
    deliveryFee: z.coerce.string().optional(),
    serviceFee: z.coerce.string().optional(),
    appCommission: z.coerce.string().optional(),
    
    status: z.enum([
        "pending", 
        "accepted", 
        "preparing", 
        "out_for_delivery", 
        "delivered", 
        "cancelled", 
        "rejected", 
        "refund"
    ]).optional(),
    
    cancelReason: z.string().optional(),
});

export const updateOrderSchema = createOrderSchema.partial();





export const createOrderItemSchema = z.object({
    // العلاقات (Required)
    orderId: z.string().uuid("Invalid Order ID"),
    foodId: z.string().uuid("Invalid Food ID"),

    // الكمية (Required - يجب أن تكون رقم صحيح وموجب)
    quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),

    // الأسعار (Required)
    basePrice: z.coerce.string().min(1, "Base price is required"),
    totalPrice: z.coerce.string().min(1, "Total price is required"),

    // الحقول الاختيارية (ليها Default)
    variationsPrice: z.coerce.string().optional(),
});

// في الغالب الـ Order Items مش بيتعملها Update (بتتحذف وتتضاف من جديد)، 
// بس لو محتاجها تقدر تستخدم الـ Partial
export const updateOrderItemSchema = createOrderItemSchema.partial();