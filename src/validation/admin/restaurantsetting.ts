import { z } from "zod";

// Regex لفحص الوقت بصيغة HH:MM
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ==========================================
// 1. Restaurant Settings Validation
// ==========================================
export const createRestaurantSettingsSchema = z.object({
    restaurantId: z.string().uuid("Invalid Restaurant ID"),
    
    // كل الإعدادات الـ Boolean 
    foodManagement: z.boolean().optional(),
    scheduledDelivery: z.boolean().optional(),
    reviewsSection: z.boolean().optional(),
    posSection: z.boolean().optional(),
    selfDelivery: z.boolean().optional(),
    homeDelivery: z.boolean().optional(),
    takeaway: z.boolean().optional(),
    orderSubscription: z.boolean().optional(),
    instantOrder: z.boolean().optional(),
    halalTagStatus: z.boolean().optional(),
    dineIn: z.boolean().optional(),
    canEditOrder: z.boolean().optional(),
    isAlwaysOpen: z.boolean().optional(),
    isSameTimeEveryDay: z.boolean().optional(),

    vegType: z.enum(["VEG", "NON_VEG", "BOTH"]).optional(),
    minOrderAmount: z.coerce.string().optional(),
    
    minDeliveryTime: z.coerce.number().int().min(0).optional(),
    maxDeliveryTime: z.coerce.number().int().min(0).optional(),
});

export const updateRestaurantSettingsSchema = createRestaurantSettingsSchema.partial();

// ==========================================
// 2. Restaurant Schedules Validation
// ==========================================
export const createRestaurantScheduleSchema = z.object({
    restaurantId: z.string().uuid("Invalid Restaurant ID"),
    dayOfWeek: z.coerce.number().int().min(0).max(6, "Day of week must be between 0 (Sunday) and 6 (Saturday)"),
    isOffDay: z.boolean().optional(),
    
    openingTime: z.string().regex(timeRegex, "Opening time must be in HH:MM format").optional(),
    closingTime: z.string().regex(timeRegex, "Closing time must be in HH:MM format").optional(),
});

export const updateRestaurantScheduleSchema = createRestaurantScheduleSchema.partial();