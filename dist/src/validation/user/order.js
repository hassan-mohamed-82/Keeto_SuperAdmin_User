"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrderPrerequisitesQuerySchema = exports.checkoutSchema = exports.guestAddressSchema = exports.guestInfoSchema = void 0;
const zod_1 = require("zod");
const phone_1 = require("./phone");
// ============================================================
// Guest Info & Address Schemas
// ============================================================
exports.guestInfoSchema = zod_1.z.object({
    name: zod_1.z.string().min(2, { message: "Guest name must be at least 2 characters" }).nullable().optional(),
    phone: phone_1.optionalEgyptPhoneSchema,
    alternatePhone: phone_1.optionalEgyptPhoneSchema,
    alternativePhone: phone_1.optionalEgyptPhoneSchema,
});
exports.guestAddressSchema = zod_1.z.object({
    title: zod_1.z.string().nullable().optional().default("Guest Address"),
    street: zod_1.z.string().min(1, { message: "Street is required" }),
    number: zod_1.z.string().min(1, { message: "Building/House number is required" }),
    floor: zod_1.z.string().nullable().optional(),
    apartment: zod_1.z.string().nullable().optional(),
    landmark: zod_1.z.string().nullable().optional(),
    location: zod_1.z.string().nullable().optional(),
    fulladdress: zod_1.z.string().nullable().optional(),
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
    idempotencyKey: zod_1.z.string().nullable().optional(),
    zoneId: zod_1.z.string().nullable().optional(),
    branchId: zod_1.z.string().nullable().optional(),
    addressId: zod_1.z.string().nullable().optional(),
    note: zod_1.z.string().max(500).nullable().optional(),
    couponCode: zod_1.z.string().nullable().optional(),
    // Contact Phone Fields (can be supplied directly or via guestInfo)
    phone: phone_1.optionalEgyptPhoneSchema,
    alternatePhone: phone_1.optionalEgyptPhoneSchema,
    alternativePhone: phone_1.optionalEgyptPhoneSchema,
    // Guest Flow Fields
    guestInfo: exports.guestInfoSchema.nullable().optional(),
    guestAddress: exports.guestAddressSchema.nullable().optional(),
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
    // If guestInfo is explicitly provided, verify that at least one phone field is present
    if (data.guestInfo) {
        const hasPhone = Boolean(data.guestInfo.phone ||
            data.guestInfo.alternatePhone ||
            data.guestInfo.alternativePhone ||
            data.phone ||
            data.alternatePhone ||
            data.alternativePhone);
        if (!hasPhone) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: "Phone number or alternative phone number is required.",
                path: ["guestInfo", "phone"],
            });
        }
    }
});
// ============================================================
// Order Prerequisites Validation Schema
// ============================================================
exports.getOrderPrerequisitesQuerySchema = zod_1.z.object({
    restaurantId: zod_1.z.string({ required_error: "restaurantId is required" }),
    orderSource: zod_1.z.enum(["online_order_app", "online_order_web", "food_aggregator", "mykeeto", "pos"], {
        required_error: "Invalid or missing order source",
    }),
    addressId: zod_1.z.string().nullable().optional(),
    addressid: zod_1.z.string().nullable().optional(),
});
