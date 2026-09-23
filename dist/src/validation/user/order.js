"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkoutSchema = exports.guestAddressSchema = exports.guestInfoSchema = void 0;
const zod_1 = require("zod");
// ============================================================
// Guest Info & Address Schemas
// ============================================================
exports.guestInfoSchema = zod_1.z.object({
    name: zod_1.z.string().min(2, { message: "Guest name must be at least 2 characters" }),
    phone: zod_1.z.string().min(7, { message: "Phone number must be at least 7 digits" }).max(20),
});
exports.guestAddressSchema = zod_1.z.object({
    title: zod_1.z.string().optional().default("Guest Address"),
    street: zod_1.z.string().min(1, { message: "Street is required" }),
    number: zod_1.z.string().min(1, { message: "Building/House number is required" }),
    floor: zod_1.z.string().optional(),
    apartment: zod_1.z.string().optional(),
    landmark: zod_1.z.string().optional(),
    location: zod_1.z.string().optional(),
    fulladdress: zod_1.z.string().optional(),
    lat: zod_1.z.union([zod_1.z.number(), zod_1.z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(Number),
    lng: zod_1.z.union([zod_1.z.number(), zod_1.z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(Number),
});
// ============================================================
// Checkout Validation Schema
// ============================================================
exports.checkoutSchema = zod_1.z.object({
    orderSource: zod_1.z.enum(["online_order_app", "online_order_web", "food_aggregator", "mykeeto", "pos"], { required_error: "orderSource is required" }),
    paymentMethod: zod_1.z.string({ required_error: "paymentMethod is required" }),
    orderType: zod_1.z.enum(["delivery", "takeaway", "dine_in"], {
        required_error: "orderType is required and must be one of: delivery, takeaway, dine_in",
    }),
    idempotencyKey: zod_1.z.string().optional(),
    zoneId: zod_1.z.string().optional(),
    branchId: zod_1.z.string().optional(),
    addressId: zod_1.z.string().optional(),
    note: zod_1.z.string().max(500).optional(),
    couponCode: zod_1.z.string().optional(),
    // Guest Flow Fields
    guestInfo: exports.guestInfoSchema.optional(),
    guestAddress: exports.guestAddressSchema.optional(),
}).superRefine((data, ctx) => {
    // If delivery, either addressId or guestAddress with lat/lng must be provided
    if (data.orderType === "delivery") {
        if (!data.addressId && !data.guestAddress) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: "Delivery address (addressId or guestAddress) is required for delivery orders.",
                path: ["addressId"],
            });
        }
    }
    // Takeaway or Dine-in requires branchId
    if ((data.orderType === "takeaway" || data.orderType === "dine_in") && !data.branchId) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: "Branch ID is required for takeaway or dine-in orders.",
            path: ["branchId"],
        });
    }
});
