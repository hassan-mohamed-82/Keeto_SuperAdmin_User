"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeRestaurantSchema = exports.assignRestaurantsSchema = exports.updateShippingCompanySchema = exports.createShippingCompanySchema = void 0;
const zod_1 = require("zod");
const restaurantIdsValidator = zod_1.z.preprocess((val) => {
    if (typeof val === "string") {
        try {
            return JSON.parse(val);
        }
        catch {
            return val;
        }
    }
    return val;
}, zod_1.z.array(zod_1.z.string().uuid("Invalid Restaurant ID")).optional());
exports.createShippingCompanySchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Name is required").max(255),
    nameAr: zod_1.z.string().max(255).optional(),
    email: zod_1.z.string().email("Invalid email format").max(255),
    password: zod_1.z.string().min(6, "Password must be at least 6 characters").max(255),
    phone: zod_1.z.string().min(1, "Phone number is required").max(50),
    address: zod_1.z.string().optional(),
    logo: zod_1.z.string().max(500).optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional().default("active"),
    restaurantIds: restaurantIdsValidator,
});
exports.updateShippingCompanySchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(255).optional(),
    nameAr: zod_1.z.string().max(255).optional(),
    email: zod_1.z.string().email("Invalid email format").max(255).optional(),
    password: zod_1.z.string().min(6, "Password must be at least 6 characters").max(255).optional(),
    phone: zod_1.z.string().min(1).max(50).optional(),
    address: zod_1.z.string().optional(),
    logo: zod_1.z.string().max(500).optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
    restaurantIds: restaurantIdsValidator,
});
exports.assignRestaurantsSchema = zod_1.z.object({
    restaurantIds: zod_1.z.array(zod_1.z.string().uuid("Invalid Restaurant ID")).min(1, "At least one restaurant is required"),
});
exports.removeRestaurantSchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID"),
});
