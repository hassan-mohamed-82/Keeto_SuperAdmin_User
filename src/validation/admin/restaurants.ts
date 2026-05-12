import { z } from "zod";

export const createRestaurantSchema = z.object({
    // 1. Restaurant Info & Location
    name: z.string().min(1, "Name is required").max(255),
    nameAr: z.string().max(255).optional(),
    nameFr: z.string().max(255).optional(),
    address: z.string().min(1, "Address is required"),
    addressAr: z.string().optional(),
    addressFr: z.string().optional(),
    
    cuisineId: z.string().uuid("Invalid Cuisine ID").optional(), // Optional حسب الـ Schema
    zoneId: z.string().uuid("Invalid Zone ID"),
    
    logo: z.string().min(1, "Logo is required").max(500),
    cover: z.string().max(500).optional(),

    // 2. Delivery & Owner Info
    minDeliveryTime: z.string().max(50).optional(),
    maxDeliveryTime: z.string().max(50).optional(),
    deliveryTimeUnit: z.string().max(50).optional(),
    
    ownerFirstName: z.string().min(1, "Owner first name is required").max(255),
    ownerLastName: z.string().min(1, "Owner last name is required").max(255),
    ownerPhone: z.string().min(1, "Owner phone is required").max(50),
    
    // التاجز (مصفوفة من النصوص)
    tags: z.array(z.string()).optional(),

    // 3. Business TIN & Account Info
    taxNumber: z.string().max(255).optional(),
    taxExpireDate: z.coerce.date().optional(), // بيحول النص لتاريخ
    taxCertificate: z.string().max(255).optional(),
    
    email: z.string().email("Invalid email address").max(255),
    password: z.string().min(6, "Password must be at least 6 characters").max(255),
    
    // 💡 ممكن تزود تأكيد الباسورد كده وتعمل Refine لو هتستخدمها في الـ Controller مباشرة
    // confirmPassword: z.string().optional(),
    
    type: z.enum(["restaurantadmin", "superadmin"]).optional(),
    addhome: z.boolean().optional(),
    status: z.enum(["active", "inactive"]).optional(),
});

export const updateRestaurantSchema = createRestaurantSchema.partial();