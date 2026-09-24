-- =====================================================
-- Migration: Unified Payment Gateway Columns
-- Replaces gateway-specific columns with gateway-agnostic ones
-- =====================================================

-- Step 1: Add new unified payment columns
ALTER TABLE `orders`
  ADD COLUMN `payment_gateway` ENUM('kashier', 'paymob') NULL AFTER `payment_status`,
  ADD COLUMN `payment_order_id` VARCHAR(150) NULL AFTER `payment_gateway`,
  ADD COLUMN `payment_transaction_id` VARCHAR(150) NULL AFTER `payment_order_id`;

-- Step 2: Migrate existing Paymob data to new columns
UPDATE `orders`
SET
  `payment_gateway` = 'paymob',
  `payment_order_id` = `paymob_order_id`,
  `payment_transaction_id` = `paymob_transaction_id`
WHERE `paymob_order_id` IS NOT NULL OR `paymob_transaction_id` IS NOT NULL;

-- Step 3: Drop old gateway-specific columns
-- ⚠️  Only run after verifying data was migrated correctly
ALTER TABLE `orders`
  DROP COLUMN `paymob_order_id`,
  DROP COLUMN `paymob_transaction_id`;

-- Step 4: Add indexes for performance
CREATE INDEX `idx_orders_payment_gateway` ON `orders` (`payment_gateway`);
CREATE INDEX `idx_orders_payment_order_id` ON `orders` (`payment_order_id`);
CREATE INDEX `idx_orders_payment_status` ON `orders` (`payment_status`);
