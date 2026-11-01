-- ============================================================================
-- Migration: Add Default 'manager' & 'cashier' Roles To Existing Restaurants
-- Description:
--   Inserts 'manager' (All Permissions) and 'cashier' (Orders Permissions)
--   for any restaurant in `restaurants` that does not already have them.
-- ============================================================================

-- 1. Insert 'manager' role for restaurants that don't have one
INSERT INTO `role_restaurant` (`id`, `restaurant_id`, `name`, `permissions`, `status`, `created_at`, `updated_at`)
SELECT 
    UUID() AS `id`,
    r.`id` AS `restaurant_id`,
    'manager' AS `name`,
    CAST('[{"module":"Admins","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Roles","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Countries","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Cities","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Zones","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"ZoneDeliveryFees","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Restaurants","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"RestaurantWallets","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"RestaurantWalletTransactions","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Food","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Categories","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Subcategories","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"AdonesCategories","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"policy","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Adones","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"RestaurantSettings","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Users","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"UserWallet","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"BusninessPlan","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"basiccampaign","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Ratings","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"cuisines","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Coupons","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Orders","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"reports","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"popup","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"RestaurantBranches","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"RestaurantZoneDeliveryFees","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"BranchMenuItems","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"zone","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Reasons","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Discounts","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"delivery_man","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"restaurantPaymentCredentials","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"shippingCompany","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"PlatformPaymentSettings","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"RestaurantOperations","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"PaymentMethod","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Sales","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Notifications","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"PlatformPaymentGateways","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]},{"module":"Videos","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]}]' AS JSON) AS `permissions`,
    'active' AS `status`,
    NOW() AS `created_at`,
    NOW() AS `updated_at`
FROM `restaurants` r
WHERE NOT EXISTS (
    SELECT 1 FROM `role_restaurant` rr
    WHERE rr.`restaurant_id` = r.`id` AND LOWER(rr.`name`) = 'manager'
);

-- 2. Insert 'cashier' role for restaurants that don't have one
INSERT INTO `role_restaurant` (`id`, `restaurant_id`, `name`, `permissions`, `status`, `created_at`, `updated_at`)
SELECT 
    UUID() AS `id`,
    r.`id` AS `restaurant_id`,
    'cashier' AS `name`,
    CAST('[{"module":"Orders","actions":[{"action":"View"},{"action":"Add"},{"action":"Edit"},{"action":"Delete"},{"action":"Status"}]}]' AS JSON) AS `permissions`,
    'active' AS `status`,
    NOW() AS `created_at`,
    NOW() AS `updated_at`
FROM `restaurants` r
WHERE NOT EXISTS (
    SELECT 1 FROM `role_restaurant` rr
    WHERE rr.`restaurant_id` = r.`id` AND LOWER(rr.`name`) = 'cashier'
);

