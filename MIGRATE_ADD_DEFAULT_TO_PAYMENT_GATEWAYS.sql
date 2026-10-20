-- ========================================================================
-- Migration: Add is_default column to platform_payment_gateways and restaurant_payment_credentials
-- ========================================================================

-- 1. Add is_default to platform_payment_gateways
ALTER TABLE `platform_payment_gateways` 
    ADD COLUMN `is_default` BOOLEAN DEFAULT FALSE AFTER `is_active`;

-- 2. Add is_default to restaurant_payment_credentials
ALTER TABLE `restaurant_payment_credentials` 
    ADD COLUMN `is_default` BOOLEAN DEFAULT FALSE AFTER `is_active`;

-- 3. Set existing active platform gateway as default (if exists and no default set)
UPDATE `platform_payment_gateways` 
SET `is_default` = TRUE 
WHERE `is_active` = TRUE 
LIMIT 1;

-- 4. Set existing active restaurant credentials as default (if exists)
UPDATE `restaurant_payment_credentials` 
SET `is_default` = TRUE 
WHERE `is_active` = TRUE;
