"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCategorySchema = exports.createCategorySchema = void 0;
// src/modules/category/category.validation.ts
const zod_1 = require("zod");
// Regex للتحقق من Base64 image
const base64ImageRegex = /^data:image\/(jpeg|jpg|png|gif|webp|svg\+xml);base64,/;
exports.createCategorySchema = zod_1.z.object({
    name: zod_1.z
        .string({ required_error: 'Name is required' })
        .min(2, 'Name must be at least 2 characters')
        .max(255, 'Name must not exceed 255 characters')
        .trim(),
    description: zod_1.z
        .string({ required_error: 'Description is required' })
        .min(10, 'Description must be at least 10 characters')
        .max(255, 'Description must not exceed 255 characters')
        .trim(),
    image: zod_1.z
        .string({ required_error: 'Image is required' })
        .regex(base64ImageRegex, 'Invalid image format. Must be base64 encoded image'),
});
exports.updateCategorySchema = zod_1.z.object({
    name: zod_1.z
        .string()
        .min(2, 'Name must be at least 2 characters')
        .max(255, 'Name must not exceed 255 characters')
        .trim()
        .optional(),
    description: zod_1.z
        .string()
        .min(10, 'Description must be at least 10 characters')
        .max(255, 'Description must not exceed 255 characters')
        .trim()
        .optional(),
    image: zod_1.z
        .string()
        .regex(base64ImageRegex, 'Invalid image format. Must be base64 encoded image')
        .optional(),
});
