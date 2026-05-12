"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateBranchMenuItemSchema = exports.createBranchMenuItemSchema = exports.updateBranchSchema = exports.createBranchSchema = void 0;
const zod_1 = require("zod");
// ==========================================
// 1. Branches Validation
// ==========================================
exports.createBranchSchema = zod_1.z.object({
    // العلاقات (Required)
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID"),
    zoneId: zod_1.z.string().uuid("Invalid Zone ID"),
    // الحقول الأساسية (Required)
    name: zod_1.z.string().min(1, "Branch name is required").max(255, "Name cannot exceed 255 characters"),
    address: zod_1.z.string().min(1, "Address is required"),
    // الحقول الاختيارية (ليها Default في الداتا بيز أو مش NotNull)
    nameAr: zod_1.z.string().max(255).optional(),
    nameFr: zod_1.z.string().max(255).optional(),
    addressAr: zod_1.z.string().optional(),
    addressFr: zod_1.z.string().optional(),
    phoneNumber: zod_1.z.string().max(50, "Phone number cannot exceed 50 characters").optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
// فاليديشن التحديث (Update) - كل الحقول اختيارية
exports.updateBranchSchema = exports.createBranchSchema.partial();
// ==========================================
// 2. Branch Menu Items Validation
// ==========================================
exports.createBranchMenuItemSchema = zod_1.z.object({
    // العلاقات (Required)
    branchId: zod_1.z.string().uuid("Invalid Branch ID"),
    foodId: zod_1.z.string().uuid("Invalid Food ID"),
    // السعر (Required)
    // استخدمنا coerce.string عشان Drizzle بيتعامل مع Decimal كـ String للحفاظ على الدقة
    // وممكن الفرونت يبعته رقم، فكده إحنا بنغطى الحالتين
    price: zod_1.z.coerce.string({
        required_error: "Price is required",
        invalid_type_error: "Price must be a valid number",
    }).min(1, "Price cannot be empty"),
    // الحقول الاختيارية (ليها Default)
    stockType: zod_1.z.enum(["limited", "unlimited"]).optional(),
    // الكمية المتاحة (يجب أن تكون رقم صحيح ولا يقل عن الصفر)
    stockQty: zod_1.z.coerce.number().int().min(0, "Stock quantity cannot be negative").optional(),
    status: zod_1.z.enum(["active", "out_of_stock", "inactive"]).optional(),
});
// فاليديشن التحديث (Update) - كل الحقول اختيارية
exports.updateBranchMenuItemSchema = exports.createBranchMenuItemSchema.partial();
