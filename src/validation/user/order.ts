import { z } from "zod";
import { CHECKOUT_ORDER_SOURCES } from "../../types/orderSources";
import { egyptPhoneSchema, optionalEgyptPhoneSchema } from "./phone";

// ============================================================
// Guest Info & Address Schemas
// ============================================================
export const guestInfoSchema = z.object({
    name: z.string().min(2, { message: "Guest name must be at least 2 characters" }).nullable().optional(),
    phone: optionalEgyptPhoneSchema,
    alternatePhone: optionalEgyptPhoneSchema,
    alternativePhone: optionalEgyptPhoneSchema,
});

export const guestAddressSchema = z.object({
    title: z.string().nullable().optional().default("Guest Address"),
    street: z.string().min(1, { message: "Street is required" }),
    number: z.string().min(1, { message: "Building/House number is required" }),
    floor: z.string().nullable().optional(),
    apartment: z.string().nullable().optional(),
    landmark: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    fulladdress: z.string().nullable().optional(),
    lat: z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(Number),
    lng: z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(Number),
});

// ============================================================
// Checkout Validation Schema
// ============================================================
export const checkoutSchema = z.object({
    orderSource: z.enum(
        CHECKOUT_ORDER_SOURCES,
        { required_error: "orderSource is required" }
    ),
    paymentMethod: z.string({ required_error: "paymentMethod is required" }),
    orderType: z.enum(["delivery", "takeaway", "dine_in"], {
        required_error: "orderType is required and must be one of: delivery, takeaway, dine_in",
    }),
    idempotencyKey: z.string().nullable().optional(),
    zoneId: z.string().nullable().optional(),
    branchId: z.string().nullable().optional(),
    addressId: z.string().nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    couponCode: z.string().nullable().optional(),

    // Contact Phone Fields (can be supplied directly or via guestInfo)
    phone: optionalEgyptPhoneSchema,
    alternatePhone: optionalEgyptPhoneSchema,
    alternativePhone: optionalEgyptPhoneSchema,

    // Guest Flow Fields
    guestInfo: guestInfoSchema.nullable().optional(),
    guestAddress: guestAddressSchema.nullable().optional(),
}).superRefine((data, ctx) => {
    // If delivery, either addressId or guestAddress with lat/lng must be provided
    if (data.orderType === "delivery") {
        if (!data.addressId && !data.guestAddress) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Delivery address (addressId or guestAddress) is required for delivery orders.",
                path: ["addressId"],
            });
        }
    }

    // Takeaway or Dine-in requires branchId
    if ((data.orderType === "takeaway" || data.orderType === "dine_in") && !data.branchId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Branch ID is required for takeaway or dine-in orders.",
            path: ["branchId"],
        });
    }

    // If guestInfo is explicitly provided, verify that at least one phone field is present
    if (data.guestInfo) {
        const hasPhone = Boolean(
            data.guestInfo.phone ||
            data.guestInfo.alternatePhone ||
            data.guestInfo.alternativePhone ||
            data.phone ||
            data.alternatePhone ||
            data.alternativePhone
        );
        if (!hasPhone) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Phone number or alternative phone number is required.",
                path: ["guestInfo", "phone"],
            });
        }
    }
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

// ============================================================
// Order Prerequisites Validation Schema
// ============================================================
export const getOrderPrerequisitesQuerySchema = z.object({
    restaurantId: z.string({ required_error: "restaurantId is required" }),
    orderSource: z.enum(CHECKOUT_ORDER_SOURCES, {
        required_error: "Invalid or missing order source",
    }),
    addressId: z.string().nullable().optional(),
    addressid: z.string().nullable().optional(),
});

