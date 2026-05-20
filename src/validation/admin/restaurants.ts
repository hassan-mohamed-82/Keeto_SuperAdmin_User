import { z } from "zod";

const fileOrString = z.any();

export const createRestaurantSchema = z.object({
    name: z.string().min(1, "Name is required").max(255),
    nameAr: z.string().max(255).optional(),
    nameFr: z.string().max(255).optional(),
    address: z.string().min(1, "Address is required"),
    addressAr: z.string().optional(),
    addressFr: z.string().optional(),
    
    cuisineId: z.string().uuid("Invalid Cuisine ID").optional(), 
    zoneId: z.string().uuid("Invalid Zone ID"),
    
    // 🚀 التعديل هنا لضمان عدم ضرب إيرور Validation بسبب الـ Base64
    logo: fileOrString,
    cover: fileOrString.optional(),

    minDeliveryTime: z.string().max(50).optional(),
    maxDeliveryTime: z.string().max(50).optional(),
    deliveryTimeUnit: z.string().max(50).optional(),
    
    ownerFirstName: z.string().min(1, "Owner first name is required").max(255),
    ownerLastName: z.string().min(1, "Owner last name is required").max(255),
    ownerPhone: z.string().min(1, "Owner phone is required").max(50),
    
    tags: z.array(z.string()).optional(),

    taxNumber: z.string().max(255).optional(),
    taxExpireDate: z.coerce.date().optional(),  
    taxCertificate: fileOrString.optional(),
    
    
    addhome: z.boolean().optional(),
    status: z.enum(["active", "inactive"]).optional(),
});

export const updateRestaurantSchema = createRestaurantSchema.partial();