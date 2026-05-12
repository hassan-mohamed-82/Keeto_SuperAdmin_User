import { z } from "zod";

// ==========================================
// Addons Validation
// ==========================================

export const createAddonSchema = z.object({
    // الحقول الأساسية (Required)
    name: z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),
    price: z.string().min(1, "Price is required").max(255),
    adonescategoryid: z.string().uuid("Invalid Category ID"),
    restaurantid: z.string().uuid("Invalid Restaurant ID"),

    // الحقول الاختيارية (عشان ليها default values في الداتا بيز)
    nameAr: z.string().max(255).optional(),
    nameFr: z.string().max(255).optional(),
    status: z.enum(["active", "inactive"]).optional(),
    stock_type: z.enum(["unlimited", "limited", "daily"]).optional(),
});

// فاليديشن التحديث (Update) - كل الحقول هتكون اختيارية
export const updateAddonSchema = createAddonSchema.partial();