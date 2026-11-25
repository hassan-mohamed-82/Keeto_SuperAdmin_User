-- ============================================================
-- Migration: Tax flow + new order sources
--
-- taxes:
--   source = 'keeto'      → created by the super admin → always 'exclude'
--                           restaurant_ids = []        → ALL restaurants
--                           restaurant_ids = ["a","b"] → only those restaurants
--                           restaurant_id  = NULL
--   source = 'restaurant' → created by the restaurant admin, owned by restaurant_id
--                           tax_type 'include' (default) or 'exclude'
--   include → price already contains the tax → amount is only returned (display)
--   exclude → tax is calculated and added to the order total
--   Only status = 'active' taxes are returned / calculated.
--
-- order sources (each one is separate):
--   online_order_web, online_order_app, food_aggregator, food_aggregator_web,
--   my_keeto (plan: mykeeto), mykeeto_web, pos
--
-- Safe for existing data:
--   • Enum values are only APPENDED at the end (old values keep their position)
--     → MySQL 8 applies it instantly, no table rebuild, existing rows unchanged.
--   • New order columns are added at the end with a default
--     → instant on MySQL 8, old orders get tax 0.
--   Take a backup before running anyway.
-- ============================================================

-- 0. PRE-CHECK (run first, every query must return 0 rows) ----------
--    Any row here has a value that is NOT in the enum lists below → fix it before step 3/4.
SELECT `order_source`, COUNT(*) FROM `orders`
WHERE `order_source` NOT IN ('online_order_web', 'online_order_app', 'food_aggregator', 'my_keeto', 'pos')
GROUP BY `order_source`;

SELECT `platform_type`, COUNT(*) FROM `restaurant_business_plans`
WHERE `platform_type` NOT IN ('online_order_app', 'online_order_web', 'food_aggregator', 'mykeeto', 'pos')
GROUP BY `platform_type`;

-- must return 0 (the taxes table is dropped below)
SELECT COUNT(*) FROM `taxes`;

-- 1. Taxes table (empty → drop and recreate) ----------------------
DROP TABLE IF EXISTS `taxes`;

CREATE TABLE `taxes` (
  `id`             CHAR(36)      NOT NULL DEFAULT (UUID()),
  `restaurant_id`  CHAR(36)      NULL,
  `restaurant_ids` JSON          NOT NULL DEFAULT (JSON_ARRAY()),
  `name`           VARCHAR(255)  NOT NULL,
  `name_ar`        VARCHAR(255)  NULL,
  `name_fr`        VARCHAR(255)  NULL,
  `amount`         DECIMAL(10,2) NOT NULL,
  `amount_type`    ENUM('percentage', 'value')   NOT NULL DEFAULT 'percentage',
  `source`         ENUM('keeto', 'restaurant')   NOT NULL DEFAULT 'restaurant',
  `tax_type`       ENUM('include', 'exclude')    NOT NULL DEFAULT 'include',
  `module_type`    ENUM('pos', 'online', 'all')  NOT NULL DEFAULT 'all',
  `type`           ENUM('web', 'app', 'all')     NOT NULL DEFAULT 'all',
  `food_ids`       JSON          NOT NULL DEFAULT (JSON_ARRAY()),
  `branch_ids`     JSON          NOT NULL DEFAULT (JSON_ARRAY()),
  `status`         ENUM('active', 'inactive')    NOT NULL DEFAULT 'active',
  `created_at`     TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP     NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_taxes_restaurant_status` (`restaurant_id`, `status`),
  KEY `idx_taxes_source_status` (`source`, `status`),
  CONSTRAINT `taxes_restaurant_id_restaurants_id_fk`
    FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants` (`id`) ON DELETE CASCADE
);

-- 2. Orders: tax columns (added at the end → instant, old orders = 0) ---
ALTER TABLE `orders`
  ADD COLUMN `tax_amount`          DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `included_tax_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `tax_details`         JSON NULL;

-- 3. Orders: new order sources (old values first, new ones appended) ---
ALTER TABLE `orders`
  MODIFY COLUMN `order_source`
    ENUM('online_order_web', 'online_order_app', 'food_aggregator', 'my_keeto', 'pos',
         'food_aggregator_web', 'mykeeto_web') NOT NULL;

-- 4. Business plans: new platform types (old values first, new ones appended) ---
ALTER TABLE `restaurant_business_plans`
  MODIFY COLUMN `platform_type`
    ENUM('online_order_app', 'online_order_web', 'food_aggregator', 'mykeeto', 'pos',
         'food_aggregator_web', 'mykeeto_web') NOT NULL;
