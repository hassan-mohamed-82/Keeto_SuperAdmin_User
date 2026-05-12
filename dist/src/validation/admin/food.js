"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateFoodSchema = exports.createFoodSchema = void 0;
const zod_1 = require("zod");
exports.createFoodSchema = zod_1.z.object({
    // الحقول الأساسية (Required)
    name: zod_1.z.string().min(1, "Name is required").max(255),
    description: zod_1.z.string().min(1, "Description is required"),
    image: zod_1.z.string().min(1, "Image is required").max(500),
    startTime: zod_1.z.string().min(1, "Start time is required").max(255),
    endTime: zod_1.z.string().min(1, "End time is required").max(255),
    // الأرقام والأسعار (Required)
    price: zod_1.z.coerce.string({
        required_error: "Price is required",
        invalid_type_error: "Price must be a valid number",
    }).min(1, "Price cannot be empty"),
    // العلاقات (Required)
    restaurantid: zod_1.z.string().uuid("Invalid Restaurant ID"),
    categoryid: zod_1.z.string().uuid("Invalid Category ID"),
    subcategoryid: zod_1.z.string().uuid("Invalid Subcategory ID"),
    // الحقول الاختيارية والـ Defaults
    nameAr: zod_1.z.string().max(255).optional(),
    nameFr: zod_1.z.string().max(255).optional(),
    descriptionAr: zod_1.z.string().optional(),
    descriptionFr: zod_1.z.string().optional(),
    foodtype: zod_1.z.enum(["veg", "non-veg"]).optional(),
    Nutrition: zod_1.z.string().optional(),
    allergen_ingredients: zod_1.z.string().optional(),
    is_Halal: zod_1.z.boolean().optional(),
    addonsId: zod_1.z.string().uuid("Invalid Addons ID").optional(),
    search_tags: zod_1.z.string().max(255).optional(),
    discount_type: zod_1.z.enum(["percentage", "amount"]).optional(),
    discount_value: zod_1.z.coerce.string().optional(),
    Maximum_Purchase: zod_1.z.coerce.number().int().min(1).optional(),
    stock_type: zod_1.z.enum(["limited", "unlimited", "daily"]).optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
exports.updateFoodSchema = exports.createFoodSchema.partial();
