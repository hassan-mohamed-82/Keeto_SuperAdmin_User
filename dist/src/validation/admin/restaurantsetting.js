"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateRestaurantScheduleSchema = exports.createRestaurantScheduleSchema = exports.updateRestaurantSettingsSchema = exports.createRestaurantSettingsSchema = void 0;
const zod_1 = require("zod");
// Regex لفحص الوقت بصيغة HH:MM
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
// ==========================================
// 1. Restaurant Settings Validation
// ==========================================
exports.createRestaurantSettingsSchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID"),
    // كل الإعدادات الـ Boolean 
    foodManagement: zod_1.z.boolean().optional(),
    scheduledDelivery: zod_1.z.boolean().optional(),
    reviewsSection: zod_1.z.boolean().optional(),
    posSection: zod_1.z.boolean().optional(),
    selfDelivery: zod_1.z.boolean().optional(),
    homeDelivery: zod_1.z.boolean().optional(),
    takeaway: zod_1.z.boolean().optional(),
    orderSubscription: zod_1.z.boolean().optional(),
    instantOrder: zod_1.z.boolean().optional(),
    halalTagStatus: zod_1.z.boolean().optional(),
    dineIn: zod_1.z.boolean().optional(),
    canEditOrder: zod_1.z.boolean().optional(),
    isAlwaysOpen: zod_1.z.boolean().optional(),
    isSameTimeEveryDay: zod_1.z.boolean().optional(),
    vegType: zod_1.z.enum(["VEG", "NON_VEG", "BOTH"]).optional(),
    minOrderAmount: zod_1.z.coerce.string().optional(),
    minDeliveryTime: zod_1.z.coerce.number().int().min(0).optional(),
    maxDeliveryTime: zod_1.z.coerce.number().int().min(0).optional(),
});
exports.updateRestaurantSettingsSchema = exports.createRestaurantSettingsSchema.partial();
// ==========================================
// 2. Restaurant Schedules Validation
// ==========================================
exports.createRestaurantScheduleSchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID"),
    dayOfWeek: zod_1.z.coerce.number().int().min(0).max(6, "Day of week must be between 0 (Sunday) and 6 (Saturday)"),
    isOffDay: zod_1.z.boolean().optional(),
    openingTime: zod_1.z.string().regex(timeRegex, "Opening time must be in HH:MM format").optional(),
    closingTime: zod_1.z.string().regex(timeRegex, "Closing time must be in HH:MM format").optional(),
});
exports.updateRestaurantScheduleSchema = exports.createRestaurantScheduleSchema.partial();
