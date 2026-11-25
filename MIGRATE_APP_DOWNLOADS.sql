-- Store identifiers for each restaurant's apps (used to pull download stats)
ALTER TABLE `restaurants`
    ADD COLUMN `android_package_name` VARCHAR(255) NULL AFTER `app_bundle_id`,
    ADD COLUMN `apple_app_id` VARCHAR(20) NULL AFTER `android_package_name`,
    ADD UNIQUE INDEX `restaurants_android_package_name_unique` (`android_package_name`),
    ADD UNIQUE INDEX `restaurants_apple_app_id_unique` (`apple_app_id`);

-- Daily (or monthly, for old iOS history) download counts per restaurant app
CREATE TABLE IF NOT EXISTS `restaurant_app_downloads` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `restaurant_id` CHAR(36) NOT NULL,
    `platform` ENUM('android', 'ios') NOT NULL,
    `date` DATE NOT NULL,
    `granularity` ENUM('day', 'month') NOT NULL DEFAULT 'day',
    `downloads` INT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_app_downloads_restaurant_platform_date` (`restaurant_id`, `platform`, `date`),
    KEY `idx_app_downloads_date` (`date`),
    CONSTRAINT `restaurant_app_downloads_restaurant_id_fk`
        FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants` (`id`) ON DELETE CASCADE
);

