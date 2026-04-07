// src/modules/category/category.validation.ts
import { z } from 'zod';

// Regex للتحقق من Base64 image
const base64ImageRegex = /^data:image\/(jpeg|jpg|png|gif|webp|svg\+xml);base64,/;

export const createCategorySchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .min(2, 'Name must be at least 2 characters')
    .max(255, 'Name must not exceed 255 characters')
    .trim(),
  description: z
    .string({ required_error: 'Description is required' })
    .min(10, 'Description must be at least 10 characters')
    .max(255, 'Description must not exceed 255 characters')
    .trim(),
  image: z
    .string({ required_error: 'Image is required' })
    .regex(base64ImageRegex, 'Invalid image format. Must be base64 encoded image'),
});

export const updateCategorySchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(255, 'Name must not exceed 255 characters')
    .trim()
    .optional(),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(255, 'Description must not exceed 255 characters')
    .trim()
    .optional(),
  image: z
    .string()
    .regex(base64ImageRegex, 'Invalid image format. Must be base64 encoded image')
    .optional(),
});

// Types
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;