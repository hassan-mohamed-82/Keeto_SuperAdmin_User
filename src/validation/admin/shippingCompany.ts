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
    nameAr: z.string().max(255).optional(),
    email: z.string().email("Invalid email format").max(255),
    password: z.string().min(6, "Password must be at least 6 characters").max(255),
    phone: z.string().min(1, "Phone number is required").max(50),
    address: z.string().optional(),
    logo: z.string().max(500).optional(),
    status: z.enum(["active", "inactive"]).optional().default("active"),
    restaurantIds: restaurantIdsValidator,
});

export const updateShippingCompanySchema = z.object({
    name: z.string().min(1).max(255).optional(),
    nameAr: z.string().max(255).optional(),
    email: z.string().email("Invalid email format").max(255).optional(),
    password: z.string().min(6, "Password must be at least 6 characters").max(255).optional(),
    phone: z.string().min(1).max(50).optional(),
    address: z.string().optional(),
    logo: z.string().max(500).optional(),
    status: z.enum(["active", "inactive"]).optional(),
    restaurantIds: restaurantIdsValidator,
});

export const assignRestaurantsSchema = z.object({
    restaurantIds: z.array(z.string().uuid("Invalid Restaurant ID")).min(1, "At least one restaurant is required"),
});

export const removeRestaurantSchema = z.object({
    restaurantId: z.string().uuid("Invalid Restaurant ID"),
});
