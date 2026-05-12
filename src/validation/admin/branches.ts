import { z } from "zod";

// ==========================================
// 1. Branches Validation
// ==========================================

export const createBranchSchema = z.object({
    // العلاقات (Required)
    restaurantId: z.string().uuid("Invalid Restaurant ID"),
    zoneId: z.string().uuid("Invalid Zone ID"),

    // الحقول الأساسية (Required)
    name: z.string().min(1, "Branch name is required").max(255, "Name cannot exceed 255 characters"),
    address: z.string().min(1, "Address is required"),

    // الحقول الاختيارية (ليها Default في الداتا بيز أو مش NotNull)
    nameAr: z.string().max(255).optional(),
    nameFr: z.string().max(255).optional(),
    addressAr: z.string().optional(),
    addressFr: z.string().optional(),
    phoneNumber: z.string().max(50, "Phone number cannot exceed 50 characters").optional(),
    status: z.enum(["active", "inactive"]).optional(),
});

// فاليديشن التحديث (Update) - كل الحقول اختيارية
export const updateBranchSchema = createBranchSchema.partial();


// ==========================================
// 2. Branch Menu Items Validation
// ==========================================

export const createBranchMenuItemSchema = z.object({
    // العلاقات (Required)
    branchId: z.string().uuid("Invalid Branch ID"),
    foodId: z.string().uuid("Invalid Food ID"),

    // السعر (Required)
    // استخدمنا coerce.string عشان Drizzle بيتعامل مع Decimal كـ String للحفاظ على الدقة
    // وممكن الفرونت يبعته رقم، فكده إحنا بنغطى الحالتين
    price: z.coerce.string({
        required_error: "Price is required",
        invalid_type_error: "Price must be a valid number",
    }).min(1, "Price cannot be empty"),

    // الحقول الاختيارية (ليها Default)
    stockType: z.enum(["limited", "unlimited"]).optional(),
    
    // الكمية المتاحة (يجب أن تكون رقم صحيح ولا يقل عن الصفر)
    stockQty: z.coerce.number().int().min(0, "Stock quantity cannot be negative").optional(),
    
    status: z.enum(["active", "out_of_stock", "inactive"]).optional(),
});

// فاليديشن التحديث (Update) - كل الحقول اختيارية
export const updateBranchMenuItemSchema = createBranchMenuItemSchema.partial();