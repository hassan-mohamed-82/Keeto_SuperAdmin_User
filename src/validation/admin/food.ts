import { z } from "zod";

export const createFoodSchema = z.object({
    // الحقول الأساسية (Required)
    name: z.string().min(1, "Name is required").max(255),
    description: z.string().min(1, "Description is required"),
    image: z.string().min(1, "Image is required").max(500),
    startTime: z.string().min(1, "Start time is required").max(255),
    endTime: z.string().min(1, "End time is required").max(255),
    
    // الأرقام والأسعار (Required)
    price: z.coerce.string({
        required_error: "Price is required",
        invalid_type_error: "Price must be a valid number",
    }).min(1, "Price cannot be empty"),

    // العلاقات (Required)
    restaurantid: z.string().uuid("Invalid Restaurant ID"),
    categoryid: z.string().uuid("Invalid Category ID"),
    subcategoryid: z.string().uuid("Invalid Subcategory ID"),

    // الحقول الاختيارية والـ Defaults
    nameAr: z.string().max(255).optional(),
    nameFr: z.string().max(255).optional(),
    descriptionAr: z.string().optional(),
    descriptionFr: z.string().optional(),
    
    foodtype: z.enum(["veg", "non-veg"]).optional(),
    Nutrition: z.string().optional(),
    allergen_ingredients: z.string().optional(),
    is_Halal: z.boolean().optional(),
    
    addonsId: z.string().uuid("Invalid Addons ID").optional(),
    search_tags: z.string().max(255).optional(),

    discount_type: z.enum(["percentage", "amount"]).optional(),
    discount_value: z.coerce.string().optional(),
    Maximum_Purchase: z.coerce.number().int().min(1).optional(),
    
    stock_type: z.enum(["limited", "unlimited", "daily"]).optional(),
    status: z.enum(["active", "inactive"]).optional(),
});

export const updateFoodSchema = createFoodSchema.partial();