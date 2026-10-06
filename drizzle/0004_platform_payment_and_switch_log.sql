CREATE TABLE IF NOT EXISTS `platform_payment_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `percentage_value` decimal(10,4) NOT NULL DEFAULT '0.0000',
  `fixed_value` decimal(10,2) NOT NULL DEFAULT '0.00',
  `tax` decimal(10,2) NOT NULL DEFAULT '0.00',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` char(36) NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `platform_payment_settings` (`id`, `percentage_value`, `fixed_value`, `tax`, `updated_at`, `updated_by`)
SELECT 1, '0.0000', '0.00', '0.00', CURRENT_TIMESTAMP, NULL
WHERE NOT EXISTS (SELECT 1 FROM `platform_payment_settings` WHERE `id` = 1);

CREATE TABLE IF NOT EXISTS `gateway_switch_log` (
  `id` char(36) NOT NULL,
  `restaurant_id` char(36) NOT NULL,
  `from_type` enum('SYSTEM','CUSTOM') NOT NULL,
  `to_type` enum('SYSTEM','CUSTOM') NOT NULL,
  `trigger` enum('amount','day_of_week','day_of_month','manual') NOT NULL,
  `balance_at_switch` decimal(10,2) NOT NULL,
  `admin_id` char(36) NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `gateway_switch_log_restaurant_idx` (`restaurant_id`),
  CONSTRAINT `gateway_switch_log_restaurant_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
