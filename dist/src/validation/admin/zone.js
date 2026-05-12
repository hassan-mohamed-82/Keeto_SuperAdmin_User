"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateZoneSchema = exports.createZoneSchema = void 0;
const zod_1 = require("zod");
exports.createZoneSchema = zod_1.z.object({
    // الحقول الأساسية (Required)
    name: zod_1.z.string().min(1, "Name is required").max(255),
    displayName: zod_1.z.string().min(1, "Display name is required").max(255),
    // الإحداثيات الجغرافية متسجلة كـ varchar
    lat: zod_1.z.string().min(1, "Latitude is required").max(255),
    lng: zod_1.z.string().min(1, "Longitude is required").max(255),
    // العلاقات (في الـ Schema مفيش notNull فبتبقى Optional)
    cityId: zod_1.z.string().uuid("Invalid City ID").optional(),
    // الحقول الاختيارية والـ Defaults
    nameAr: zod_1.z.string().max(255).optional(),
    nameFr: zod_1.z.string().max(255).optional(),
    displayNameAr: zod_1.z.string().max(255).optional(),
    displayNameFr: zod_1.z.string().max(255).optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
exports.updateZoneSchema = exports.createZoneSchema.partial();
