CREATE TABLE IF NOT EXISTS `auth_handoff_codes` (
  `id` char(36) NOT NULL DEFAULT (UUID()),
  `code_hash` varchar(64) NOT NULL,
  `user_id` char(36) NOT NULL,
  `return_host` varchar(255) NOT NULL,
  `expires_at` timestamp NOT NULL,
  `used_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `auth_handoff_codes_code_hash_unique` (`code_hash`),
  KEY `auth_handoff_codes_user_id_idx` (`user_id`),
  CONSTRAINT `auth_handoff_codes_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

