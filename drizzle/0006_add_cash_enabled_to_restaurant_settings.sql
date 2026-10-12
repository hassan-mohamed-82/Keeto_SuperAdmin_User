-- Migration: Add cash_enabled to restaurant_settings
ALTER TABLE `restaurant_settings`
  ADD COLUMN `cash_enabled` boolean NOT NULL DEFAULT true AFTER `is_busy`;
