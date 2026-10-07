CREATE TABLE IF NOT EXISTS `restaurant_operations` (
    `id` CHAR(36) NOT NULL DEFAULT (UUID()),
    `restaurant_id` CHAR(36) NOT NULL,
    `operation_type` ENUM('callcenter', 'branch') NOT NULL DEFAULT 'callcenter',
    `status` ENUM(
        'demo',
        'sales',
        'data',
        'customer support',
        'visit',
        'start order',
        'qr',
        'points',
        'social media'
    ) DEFAULT NULL,
    `app` ENUM('on', 'off') DEFAULT NULL,
    `notes` JSON NOT NULL DEFAULT (JSON_ARRAY()),
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `restaurant_operations_restaurant_id_unique` (`restaurant_id`),
    CONSTRAINT `restaurant_operations_restaurant_id_fk`
        FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
