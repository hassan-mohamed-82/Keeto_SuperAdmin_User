-- Migration: Add food_ids column to coupons table
-- Date: 2026-10-29
-- Description: إضافة عمود food_ids كـ JSON Array لجدول coupons لدعم تقييد الكوبون بأصناف محددة

ALTER TABLE `coupons` 
ADD COLUMN `food_ids` JSON DEFAULT NULL AFTER `is_global`;
