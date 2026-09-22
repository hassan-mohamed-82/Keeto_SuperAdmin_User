import { z } from "zod";

// ============================================================
// Guest Info & Address Schemas
// ============================================================
export const guestInfoSchema = z.object({
    name: z.string().min(2, { message: "Guest name must be at least 2 characters" }),
    phone: z.string().min(7, { message: "Phone number must be at least 7 digits" }).max(20),
});

export const guestAddressSchema = z.object({
    title: z.string().optional().default("Guest Address"),
    street: z.string().min(1, { message: "Street is required" }),
    number: z.string().min(1, { message: "Building/House number is required" }),
    floor: z.string().optional(),
    apartment: z.string().optional(),
    landmark: z.string().optional(),
    location: z.string().optional(),
    fulladdress: z.string().optional(),
    lat: z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(Number),
    lng: z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(Number),
});

// ============================================================
// Checkout Validation Schema
// ============================================================
export const checkoutSchema = z.object({
    orderSource: z.enum(
        ["online_order_app", "online_order_web", "food_aggregator", "mykeeto", "pos"],
        { required_error: "orderSource is required" }
    ),
    paymentMethod: z.string({ required_error: "paymentMethod is required" }),
    orderType: z.enum(["delivery", "takeaway", "dine_in"], {
        required_error: "orderType is required and must be one of: delivery, takeaway, dine_in",
    }),
    idempotencyKey: z.string().optional(),
    zoneId: z.string().optional(),
    branchId: z.string().optional(),
    addressId: z.string().optional(),
    note: z.string().max(500).optional(),
    couponCode: z.string().optional(),

    // Guest Flow Fields
    guestInfo: guestInfoSchema.optional(),
    guestAddress: guestAddressSchema.optional(),
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
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
