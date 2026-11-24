import { z } from "zod";

const restaurantIdsValidator = z.preprocess(
    (val) => {
        if (typeof val === "string") {
            try {
                return JSON.parse(val);
            } catch {
                return val;
            }
        }
        return val;
    },
    z.array(z.string().uuid("Invalid Restaurant ID")).optional()
);

export const createShippingCompanySchema = z.object({
    name: z.string().min(1, "Name is required").max(255),
    nameAr: z.string().max(255).nullable().optional(),
    email: z.string().email("Invalid email format").max(255),
    password: z.string().min(6, "Password must be at least 6 characters").max(255),
    phone: z.string().min(1, "Phone number is required").max(50),
    address: z.string().nullable().optional(),
    logo: z.string().nullable().optional(),
    status: z.enum(["active", "inactive"]).optional().default("active"),
    maxSearchRadius: z.number().int().min(1).max(50).default(10),
    maxActiveOrders: z.number().int().min(1).max(10).default(3),
    maxAttempts: z.number().int().min(1).max(10).default(3),
    commissionType: z.enum(["percentage", "fixed"]).default("percentage"),
    commissionValue: z.number().min(0).default(0),
    restaurantIds: restaurantIdsValidator,
});

export const updateShippingCompanySchema = z.object({
    name: z.string().min(1).max(255).nullable().optional(),
    nameAr: z.string().max(255).nullable().optional(),
    email: z.string().email("Invalid email format").max(255).nullable().optional(),
    password: z.string().min(6, "Password must be at least 6 characters").max(255).nullable().optional(),
    phone: z.string().min(1).max(50).nullable().optional(),
    address: z.string().nullable().optional(),
    logo: z.string().nullable().optional(),
    status: z.enum(["active", "inactive"]).nullable().optional(),
    maxSearchRadius: z.number().int().min(1).max(50).nullable().optional(),
    maxActiveOrders: z.number().int().min(1).max(10).nullable().optional(),
    maxAttempts: z.number().int().min(1).max(10).nullable().optional(),
    commissionType: z.enum(["percentage", "fixed"]).nullable().optional(),
    commissionValue: z.number().min(0).nullable().optional(),
    restaurantIds: restaurantIdsValidator,
});

export const assignRestaurantsSchema = z.object({
    restaurantIds: z.array(z.string().uuid("Invalid Restaurant ID")).min(1, "At least one restaurant is required"),
});

export const removeRestaurantSchema = z.object({
    restaurantId: z.string().uuid("Invalid Restaurant ID"),
});
