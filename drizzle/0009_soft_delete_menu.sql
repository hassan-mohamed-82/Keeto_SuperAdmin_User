-- Soft delete for categories, subcategories and food.
-- `deleted_at` already exists on `food` (0005_add_food_deleted_at in Keeto_Restaurant_User).

ALTER TABLE `categories`
  ADD COLUMN `is_deleted` boolean NOT NULL DEFAULT false,
  ADD COLUMN `deleted_at` timestamp NULL DEFAULT NULL;

ALTER TABLE `subcategories`
  ADD COLUMN `is_deleted` boolean NOT NULL DEFAULT false,
  ADD COLUMN `deleted_at` timestamp NULL DEFAULT NULL;

ALTER TABLE `food`
  ADD COLUMN `is_deleted` boolean NOT NULL DEFAULT false;

-- Foods already archived by the restaurant panel's hybrid delete.
UPDATE `food` SET `is_deleted` = true WHERE `deleted_at` IS NOT NULL;

CREATE INDEX `idx_categories_is_deleted` ON `categories` (`is_deleted`);
CREATE INDEX `idx_subcategories_is_deleted` ON `subcategories` (`is_deleted`);
CREATE INDEX `idx_food_is_deleted` ON `food` (`is_deleted`);
