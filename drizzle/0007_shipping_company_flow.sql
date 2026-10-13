-- Migration: Shipping Company Flow Enhancements (Phase 1)
-- Clean any orphan values in restaurant_settings.shipping_company_id before adding FK
UPDATE `restaurant_settings`
SET `shipping_company_id` = NULL
WHERE `shipping_company_id` IS NOT NULL
  AND `shipping_company_id` NOT IN (SELECT `id` FROM `shipping_companies`);

-- Add foreign key constraint to restaurant_settings.shipping_company_id
ALTER TABLE `restaurant_settings`
  ADD CONSTRAINT `fk_restaurant_settings_shipping_company`
  FOREIGN KEY (`shipping_company_id`) REFERENCES `shipping_companies`(`id`)
  ON DELETE SET NULL;

-- Delivery Men: add all_zones column with default true, and composite index
ALTER TABLE `delivery_men`
  ADD COLUMN `all_zones` boolean NOT NULL DEFAULT true AFTER `work_type`;

ALTER TABLE `delivery_men`
  ADD INDEX `idx_delivery_men_dispatch` (`shipping_company_id`, `is_online`, `is_active`, `is_deleted`);

-- Orders: update shipping_fail_reason enum to include no_coordinates, add timestamps, and index
ALTER TABLE `orders`
  MODIFY COLUMN `shipping_fail_reason` enum('no_company','company_inactive','out_of_zone','no_courier','max_attempts','no_coordinates');

ALTER TABLE `orders`
  ADD COLUMN `shipping_assigned_at` timestamp NULL DEFAULT NULL AFTER `payment_issue_type`,
  ADD COLUMN `picked_up_at` timestamp NULL DEFAULT NULL AFTER `shipping_assigned_at`,
  ADD COLUMN `delivered_at` timestamp NULL DEFAULT NULL AFTER `picked_up_at`;

ALTER TABLE `orders`
  ADD INDEX `idx_orders_shipping_status` (`shipping_company_id`, `shipping_status`);

-- Shipping Company Users: add token_version int default 0
ALTER TABLE `shipping_company_users`
  ADD COLUMN `token_version` int NOT NULL DEFAULT 0 AFTER `role`;

-- Delivery Man Shifts: add unique constraint on courier, restaurant, day, from, to
ALTER TABLE `delivery_man_shifts`
  ADD CONSTRAINT `uq_delivery_man_shifts_slot`
  UNIQUE (`delivery_man_id`, `restaurant_id`, `day_of_week`, `from`, `to`);
