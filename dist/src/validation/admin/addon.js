"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAddonSchema = exports.createAddonSchema = void 0;
const zod_1 = require("zod");
// ==========================================
// Addons Validation
// ==========================================
exports.createAddonSchema = zod_1.z.object({
    // الحقول الأساسية (Required)
    name: zod_1.z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),
    price: zod_1.z.string().min(1, "Price is required").max(255),
    adonescategoryid: zod_1.z.string().uuid("Invalid Category ID"),
    restaurantid: zod_1.z.string().uuid("Invalid Restaurant ID"),
    // الحقول الاختيارية (عشان ليها default values في الداتا بيز)
    nameAr: zod_1.z.string().max(255).optional(),
    nameFr: zod_1.z.string().max(255).optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
    stock_type: zod_1.z.enum(["unlimited", "limited", "daily"]).optional(),
});
// فاليديشن التحديث (Update) - كل الحقول هتكون اختيارية
exports.updateAddonSchema = exports.createAddonSchema.partial();
