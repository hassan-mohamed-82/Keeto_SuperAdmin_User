-- Migration: Create restaurant_domains table
-- Removes hardcoded collation so it inherits the exact database/restaurants collation,
-- preventing MySQL errno 150 (collation mismatch between foreign key columns).

CREATE TABLE IF NOT EXISTS `restaurant_domains` (
  `id`                  INT           NOT NULL AUTO_INCREMENT,
  `restaurant_id`       CHAR(36)      NOT NULL,
  `domain`              VARCHAR(255)  NOT NULL,          -- always stored lowercase
  `is_apex`             TINYINT(1)    NOT NULL DEFAULT 0,
  `source`              ENUM('external','managed') NOT NULL DEFAULT 'external',
  `verification_token`  VARCHAR(64)   NULL,              -- 32-byte hex, external only
  `verified`            TINYINT(1)    NOT NULL DEFAULT 0,
  `ssl_status`          ENUM('pending','active','failed') NOT NULL DEFAULT 'pending',
  `last_error`          VARCHAR(500)  NULL,
  `last_checked_at`     TIMESTAMP     NULL,
  `created_at`          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_domain` (`domain`),
  KEY `idx_restaurant_id` (`restaurant_id`)
) ENGINE=InnoDB;

-- Add foreign key constraint separately to ensure clear errors and matching types
ALTER TABLE `restaurant_domains`
  ADD CONSTRAINT `fk_rd_restaurant`
  FOREIGN KEY (`restaurant_id`)
  REFERENCES `restaurants` (`id`)
  ON DELETE CASCADE;
