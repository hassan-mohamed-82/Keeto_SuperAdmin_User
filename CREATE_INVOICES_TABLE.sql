-- Migration: Create restaurant_invoices table
-- تاريخ الإنشاء: 2024
-- الوصف: جدول لإدارة فواتير المطاعم

CREATE TABLE IF NOT EXISTS `restaurant_invoices` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `invoice_number` VARCHAR(50) NOT NULL UNIQUE,
    `restaurant_id` CHAR(36) NOT NULL,
    
    -- الفترة الزمنية
    `period_start` TIMESTAMP NOT NULL,
    `period_end` TIMESTAMP NOT NULL,
    
    -- المبالغ المالية
    `total_orders` VARCHAR(20) DEFAULT '0',
    `total_revenue` DECIMAL(10,2) DEFAULT 0.00,
    `total_commission` DECIMAL(10,2) DEFAULT 0.00,
    `total_service_fee` DECIMAL(10,2) DEFAULT 0.00,
    `total_delivery_fee` DECIMAL(10,2) DEFAULT 0.00,
    
    -- المستحقات
    `cash_collected` DECIMAL(10,2) DEFAULT 0.00,
    `platform_owes_to_restaurant` DECIMAL(10,2) DEFAULT 0.00,
    `restaurant_owes_to_platform` DECIMAL(10,2) DEFAULT 0.00,
    `net_balance` DECIMAL(10,2) DEFAULT 0.00,
    
    -- الحالة
    `status` ENUM('draft', 'pending', 'paid', 'overdue', 'cancelled') NOT NULL DEFAULT 'pending',
    `due_date` TIMESTAMP NULL,
    `paid_date` TIMESTAMP NULL,
    
    -- معلومات إضافية
    `notes` TEXT NULL,
    `payment_method` VARCHAR(50) NULL,
    `payment_reference` VARCHAR(255) NULL,
    
    -- timestamps
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    PRIMARY KEY (`id`),
    FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE,
    INDEX `idx_restaurant_id` (`restaurant_id`),
    INDEX `idx_status` (`status`),
    INDEX `idx_period` (`period_start`, `period_end`),
    INDEX `idx_invoice_number` (`invoice_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
