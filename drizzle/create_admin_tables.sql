-- ==========================================================
-- Migration: Create shifts, service_fees, taxes, offers tables
-- Shared Database for Keeto_Restaurant_User & Keeto_SuperAdmin_User
-- ==========================================================

-- 1. Shifts Table
CREATE TABLE IF NOT EXISTS `shifts` (
    `id` char(36) NOT NULL DEFAULT (UUID()),
    `restaurant_id` char(36) NULL,
    `name` varchar(255) NOT NULL,
    `from` time NOT NULL,
    `to` time NOT NULL,
    `is_tomorrow` boolean NOT NULL DEFAULT false,
    `status` enum('active', 'inactive') NOT NULL DEFAULT 'active',
    `created_at` timestamp DEFAULT (now()),
    `updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `shifts_id` PRIMARY KEY(`id`),
    CONSTRAINT `shifts_restaurant_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE
);

-- 2. Service Fees Table
CREATE TABLE IF NOT EXISTS `service_fees` (
    `id` char(36) NOT NULL DEFAULT (UUID()),
    `restaurant_id` char(36) NULL,
    `name` varchar(255) NULL,
    `amount` decimal(10, 2) NOT NULL,
    `amount_type` enum('percentage', 'value') NOT NULL DEFAULT 'percentage',
    `modules` json NOT NULL,
    `type` enum('web', 'app', 'all') NOT NULL DEFAULT 'all',
    `branch_ids` json NOT NULL,
    `status` enum('active', 'inactive') NOT NULL DEFAULT 'active',
    `created_at` timestamp DEFAULT (now()),
    `updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `service_fees_id` PRIMARY KEY(`id`),
    CONSTRAINT `service_fees_restaurant_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE
);

-- 3. Taxes Table
CREATE TABLE IF NOT EXISTS `taxes` (
    `id` char(36) NOT NULL DEFAULT (UUID()),
    `restaurant_id` char(36) NULL,
    `name` varchar(255) NULL,
    `amount` decimal(10, 2) NOT NULL,
    `amount_type` enum('percentage', 'value') NOT NULL DEFAULT 'percentage',
    `modules` json NOT NULL,
    `type` enum('web', 'app', 'all') NOT NULL DEFAULT 'all',
    `food_ids` json NOT NULL,
    `branch_ids` json NOT NULL,
    `status` enum('active', 'inactive') NOT NULL DEFAULT 'active',
    `created_at` timestamp DEFAULT (now()),
    `updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `taxes_id` PRIMARY KEY(`id`),
    CONSTRAINT `taxes_restaurant_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE
);

-- 4. Offers Table
CREATE TABLE IF NOT EXISTS `offers` (
    `id` char(36) NOT NULL DEFAULT (UUID()),
    `restaurant_id` char(36) NULL,
    `name` varchar(255) NOT NULL,
    `image` varchar(500) NULL,
    `start_date` timestamp NOT NULL,
    `end_date` timestamp NOT NULL,
    `price` decimal(10, 2) NOT NULL,
    `food_ids` json NOT NULL,
    `status` enum('active', 'inactive') NOT NULL DEFAULT 'active',
    `created_at` timestamp DEFAULT (now()),
    `updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `offers_id` PRIMARY KEY(`id`),
    CONSTRAINT `offers_restaurant_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE
);

-- 5. Tax Types Table
CREATE TABLE IF NOT EXISTS `tax_types` (
    `id` char(36) NOT NULL DEFAULT (UUID()),
    `restrauntid` char(36) NOT NULL,
    `type` enum('include', 'exclude') NOT NULL DEFAULT 'exclude',
    `created_at` timestamp DEFAULT (now()),
    `updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `tax_types_id` PRIMARY KEY(`id`),
    CONSTRAINT `tax_types_restrauntid_fk` FOREIGN KEY (`restrauntid`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE
);

-- ==========================================================
-- Migration for existing databases: Add amount_type column
-- ==========================================================
-- ALTER TABLE `service_fees` ADD COLUMN `amount_type` ENUM('percentage', 'value') NOT NULL DEFAULT 'percentage' AFTER `amount`;
-- ALTER TABLE `taxes` ADD COLUMN `amount_type` ENUM('percentage', 'value') NOT NULL DEFAULT 'percentage' AFTER `amount`;


