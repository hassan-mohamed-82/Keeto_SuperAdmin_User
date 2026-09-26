-- =====================================================
-- Migration: Create Payment Transactions Table & Modify daily_order_number
-- =====================================================

-- 1. التأكد من أن حقل daily_order_number في جدول orders يقبل NULL وإضافة حقل payment_failure_reason
ALTER TABLE `orders` 
  MODIFY COLUMN `daily_order_number` INT NULL DEFAULT NULL,
  ADD COLUMN `payment_failure_reason` TEXT NULL AFTER `payment_status`;

-- 2. إنشاء جدول payment_transactions لحفظ تفاصيل العمليات وأسباب الفشل
CREATE TABLE IF NOT EXISTS `payment_transactions` (
  `id` CHAR(36) NOT NULL DEFAULT (UUID()),
  `order_id` CHAR(36) NULL,
  `order_number` VARCHAR(50) NULL,
  `user_id` CHAR(36) NULL,
  `restaurant_id` CHAR(36) NULL,
  `gateway` ENUM('kashier', 'paymob') NOT NULL,
  `transaction_id` VARCHAR(150) NULL,
  `gateway_order_id` VARCHAR(150) NULL,
  `amount` DECIMAL(10, 2) NOT NULL,
  `currency` VARCHAR(10) DEFAULT 'EGP',
  `status` ENUM('pending', 'success', 'failed') NOT NULL DEFAULT 'pending',
  `failure_reason` TEXT NULL,
  `raw_response` JSON NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_pt_order_id` (`order_id`),
  INDEX `idx_pt_restaurant_id` (`restaurant_id`),
  INDEX `idx_pt_gateway` (`gateway`),
  INDEX `idx_pt_status` (`status`),
  INDEX `idx_pt_transaction_id` (`transaction_id`),
  CONSTRAINT `fk_pt_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pt_restaurant` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pt_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
