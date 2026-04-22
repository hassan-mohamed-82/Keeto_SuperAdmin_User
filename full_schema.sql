CREATE TABLE `admins` (
	`id` char(255) NOT NULL DEFAULT (uuid()),
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`type` enum('super_admin','admin') NOT NULL DEFAULT 'admin',
	`phone_number` varchar(255) NOT NULL,
	`password` varchar(255) NOT NULL,
	`role_id` char(36),
	`permissions` json DEFAULT ('[]'),
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `admins_id` PRIMARY KEY(`id`)
);

CREATE TABLE `roles` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(100) NOT NULL,
	`permissions` json DEFAULT ('[]'),
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `roles_id` PRIMARY KEY(`id`)
);

CREATE TABLE `restrauntadmins` (
	`id` char(36) NOT NULL DEFAULT (uuid()),
	`restaurant_id` char(36) NOT NULL,
	`branch_id` char(36),
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password` varchar(255) NOT NULL,
	`phone_number` varchar(255) NOT NULL,
	`type` enum('subadmin','branch_manager') NOT NULL DEFAULT 'branch_manager',
	`role_id` char(36),
	`permissions` json DEFAULT ('[]'),
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `restrauntadmins_id` PRIMARY KEY(`id`),
	CONSTRAINT `restrauntadmins_email_unique` UNIQUE(`email`)
);

CREATE TABLE `rolesadmin` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(100) NOT NULL,
	`permissions` json DEFAULT ('[]'),
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `rolesadmin_id` PRIMARY KEY(`id`)
);

CREATE TABLE `countries` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`name_ar` varchar(255) NOT NULL DEFAULT '',
	`name_fr` varchar(255) NOT NULL DEFAULT '',
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `countries_id` PRIMARY KEY(`id`)
);

CREATE TABLE `cities` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`name_ar` varchar(255) NOT NULL DEFAULT '',
	`name_fr` varchar(255) NOT NULL DEFAULT '',
	`status` enum('active','inactive') DEFAULT 'active',
	`countryId` char(36),
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cities_id` PRIMARY KEY(`id`)
);

CREATE TABLE `zones` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`name_ar` varchar(255) NOT NULL DEFAULT '',
	`name_fr` varchar(255) NOT NULL DEFAULT '',
	`displayName` varchar(255) NOT NULL,
	`displayName_ar` varchar(255) NOT NULL DEFAULT '',
	`displayName_fr` varchar(255) NOT NULL DEFAULT '',
	`lat` varchar(255) NOT NULL,
	`lng` varchar(255) NOT NULL,
	`status` enum('active','inactive') DEFAULT 'active',
	`cityId` char(36),
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `zones_id` PRIMARY KEY(`id`)
);

CREATE TABLE `cuisines` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`name_ar` varchar(255) NOT NULL DEFAULT '',
	`name_fr` varchar(255) NOT NULL DEFAULT '',
	`image` varchar(255) NOT NULL,
	`meta_image` varchar(255),
	`description` text,
	`description_ar` text NOT NULL DEFAULT (''),
	`description_fr` text NOT NULL DEFAULT (''),
	`meta_description` text,
	`meta_description_ar` text NOT NULL DEFAULT (''),
	`meta_description_fr` text NOT NULL DEFAULT (''),
	`status` enum('active','inactive') DEFAULT 'active',
	`total_restaurants` varchar(255) DEFAULT '0',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cuisines_id` PRIMARY KEY(`id`)
);

CREATE TABLE `categories` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`name_ar` varchar(255) NOT NULL DEFAULT '',
	`name_fr` varchar(255) NOT NULL DEFAULT '',
	`image` varchar(255) NOT NULL,
	`meta_image` varchar(255),
	`title` text,
	`title_ar` text NOT NULL DEFAULT (''),
	`title_fr` text NOT NULL DEFAULT (''),
	`meta_title` text,
	`meta_title_ar` text NOT NULL DEFAULT (''),
	`meta_title_fr` text NOT NULL DEFAULT (''),
	`priority` enum('low','medium','high') DEFAULT 'low',
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`)
);

CREATE TABLE `subcategories` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`name_ar` varchar(255) NOT NULL DEFAULT '',
	`name_fr` varchar(255) NOT NULL DEFAULT '',
	`category_id` char(36) NOT NULL,
	`priority` enum('low','medium','high') DEFAULT 'low',
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subcategories_id` PRIMARY KEY(`id`)
);

CREATE TABLE `adonescategory` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`name_ar` varchar(255) NOT NULL DEFAULT '',
	`name_fr` varchar(255) NOT NULL DEFAULT '',
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `adonescategory_id` PRIMARY KEY(`id`)
);

CREATE TABLE `restaurants` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`name_ar` varchar(255) NOT NULL DEFAULT '',
	`name_fr` varchar(255) NOT NULL DEFAULT '',
	`address` text NOT NULL,
	`address_ar` text NOT NULL DEFAULT (''),
	`address_fr` text NOT NULL DEFAULT (''),
	`cuisine_id` char(36),
	`zone_id` char(36) NOT NULL,
	`logo` varchar(255) NOT NULL,
	`cover` varchar(255),
	`min_delivery_time` varchar(50),
	`max_delivery_time` varchar(50),
	`delivery_time_unit` varchar(50) DEFAULT 'Minutes',
	`owner_first_name` varchar(255) NOT NULL,
	`owner_last_name` varchar(255) NOT NULL,
	`owner_phone` varchar(50) NOT NULL,
	`tags` json DEFAULT ('[]'),
	`tax_number` varchar(255),
	`tax_expire_date` date,
	`tax_certificate` varchar(255),
	`email` varchar(255) NOT NULL,
	`password` varchar(255) NOT NULL,
	`type` enum('restaurantadmin','superadmin') DEFAULT 'restaurantadmin',
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `restaurants_id` PRIMARY KEY(`id`),
	CONSTRAINT `restaurants_email_unique` UNIQUE(`email`)
);

CREATE TABLE `addons` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`name_ar` varchar(255) NOT NULL DEFAULT '',
	`name_fr` varchar(255) NOT NULL DEFAULT '',
	`price` varchar(255) NOT NULL,
	`status` enum('active','inactive') DEFAULT 'active',
	`stock_type` enum('unlimited','limited','daily') DEFAULT 'unlimited',
	`adonescategory_id` char(36) NOT NULL,
	`restaurant_id` char(36) NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `addons_id` PRIMARY KEY(`id`)
);

CREATE TABLE `food_variations` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`food_id` char(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`name_ar` varchar(255) NOT NULL DEFAULT '',
	`name_fr` varchar(255) NOT NULL DEFAULT '',
	`is_required` boolean DEFAULT false,
	`selection_type` enum('single','multiple') DEFAULT 'single',
	`min` int,
	`max` int,
	CONSTRAINT `food_variations_id` PRIMARY KEY(`id`)
);

CREATE TABLE `variation_options` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`variation_id` char(36) NOT NULL,
	`option_name` varchar(255) NOT NULL,
	`option_name_ar` varchar(255) NOT NULL DEFAULT '',
	`option_name_fr` varchar(255) NOT NULL DEFAULT '',
	`additional_price` varchar(255) NOT NULL DEFAULT '0',
	CONSTRAINT `variation_options_id` PRIMARY KEY(`id`)
);

CREATE TABLE `food` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`name_ar` varchar(255) NOT NULL DEFAULT '',
	`name_fr` varchar(255) NOT NULL DEFAULT '',
	`description` text NOT NULL,
	`description_ar` text NOT NULL DEFAULT (''),
	`description_fr` text NOT NULL DEFAULT (''),
	`image` varchar(255) NOT NULL,
	`restaurantid` char(36) NOT NULL,
	`categoryid` char(36) NOT NULL,
	`subcategoryid` char(36) NOT NULL,
	`foodtype` enum('veg','non-veg') DEFAULT 'veg',
	`nutrition` text,
	`allergen_ingredients` text,
	`is_Halal` boolean DEFAULT false,
	`addons_id` char(36),
	`start_time` varchar(255) NOT NULL,
	`end_time` varchar(255) NOT NULL,
	`search_tags` varchar(255),
	`price` decimal(10,2) NOT NULL,
	`discount_type` enum('percentage','amount') DEFAULT 'percentage',
	`discount_value` decimal(10,2),
	`Maximum_Purchase` int,
	`stock_type` enum('limited','unlimited','daily') DEFAULT 'unlimited',
	`variations` json,
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `food_id` PRIMARY KEY(`id`)
);

CREATE TABLE `basiccampaign` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`title` varchar(255) NOT NULL,
	`description` text,
	`image` varchar(255),
	`status` enum('active','inactive') DEFAULT 'active',
	`start_date` timestamp NOT NULL,
	`end_date` timestamp NOT NULL,
	`daily_start_time` time NOT NULL,
	`daily_end_time` time NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `basiccampaign_id` PRIMARY KEY(`id`)
);

CREATE TABLE `restaurant_business_plans` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`restaurant_id` char(36) NOT NULL,
	`platform_type` enum('online_order','food_aggregator') NOT NULL,
	`is_monthly_active` boolean DEFAULT false,
	`monthly_amount` decimal(10,2) DEFAULT '0.00',
	`is_quarterly_active` boolean DEFAULT false,
	`quarterly_amount` decimal(10,2) DEFAULT '0.00',
	`is_annually_active` boolean DEFAULT false,
	`annually_amount` decimal(10,2) DEFAULT '0.00',
	`commission_rate` decimal(5,2) DEFAULT '0.00',
	`service_fee` decimal(10,2) DEFAULT '0.00',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `restaurant_business_plans_id` PRIMARY KEY(`id`)
);

CREATE TABLE `payment_methods` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(100) NOT NULL,
	`name_ar` varchar(100) NOT NULL DEFAULT '',
	`name_fr` varchar(100) NOT NULL DEFAULT '',
	`image` varchar(255) NOT NULL,
	`description` varchar(255) NOT NULL,
	`description_ar` varchar(255) NOT NULL DEFAULT '',
	`description_fr` varchar(255) NOT NULL DEFAULT '',
	`type` enum('wallet','visa','cash') NOT NULL,
	`is_active` boolean DEFAULT true,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `payment_methods_id` PRIMARY KEY(`id`)
);

CREATE TABLE `restaurant_wallet_transactions` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`restaurant_id` char(36) NOT NULL,
	`type` enum('order_payment','cash_collection','withdraw_request','withdraw_approved','adjustment') NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`balance_before` decimal(10,2) NOT NULL,
	`balance_after` decimal(10,2) NOT NULL,
	`method` varchar(50) DEFAULT 'cash',
	`reference` varchar(255),
	`note` text,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `restaurant_wallet_transactions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `restaurant_wallets` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`restaurant_id` char(36) NOT NULL,
	`balance` decimal(10,2) DEFAULT '0.00',
	`collected_cash` decimal(10,2) DEFAULT '0.00',
	`pending_withdraw` decimal(10,2) DEFAULT '0.00',
	`total_withdrawn` decimal(10,2) DEFAULT '0.00',
	`total_earning` decimal(10,2) DEFAULT '0.00',
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `restaurant_wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `restaurant_wallets_restaurant_id_unique` UNIQUE(`restaurant_id`)
);

CREATE TABLE `branch_menu_items` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`branch_id` char(36) NOT NULL,
	`food_id` char(36) NOT NULL,
	`price` decimal(10,2) NOT NULL,
	`stock_type` enum('limited','unlimited') DEFAULT 'unlimited',
	`stock_qty` int DEFAULT 0,
	`status` enum('active','out_of_stock','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `branch_menu_items_id` PRIMARY KEY(`id`)
);

CREATE TABLE `branches` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`restaurant_id` char(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`name_ar` varchar(255) NOT NULL DEFAULT '',
	`name_fr` varchar(255) NOT NULL DEFAULT '',
	`address` text NOT NULL,
	`address_ar` text NOT NULL DEFAULT (''),
	`address_fr` text NOT NULL DEFAULT (''),
	`phone_number` varchar(50),
	`zone_id` char(36) NOT NULL,
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `branches_id` PRIMARY KEY(`id`)
);

CREATE TABLE `restaurant_schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurant_id` char(36) NOT NULL,
	`day_of_week` int NOT NULL,
	`is_off_day` boolean DEFAULT false,
	`opening_time` varchar(5),
	`closing_time` varchar(5),
	CONSTRAINT `restaurant_schedules_id` PRIMARY KEY(`id`)
);

CREATE TABLE `restaurant_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurant_id` char(36) NOT NULL,
	`food_management` boolean DEFAULT true,
	`scheduled_delivery` boolean DEFAULT false,
	`reviews_section` boolean DEFAULT true,
	`pos_section` boolean DEFAULT false,
	`self_delivery` boolean DEFAULT false,
	`home_delivery` boolean DEFAULT true,
	`takeaway` boolean DEFAULT false,
	`order_subscription` boolean DEFAULT false,
	`instant_order` boolean DEFAULT false,
	`halal_tag_status` boolean DEFAULT false,
	`dine_in` boolean DEFAULT false,
	`veg_type` enum('VEG','NON_VEG','BOTH') DEFAULT 'BOTH',
	`can_edit_order` boolean DEFAULT false,
	`min_order_amount` decimal(10,2) DEFAULT '0.00',
	`min_delivery_time` int DEFAULT 15,
	`max_delivery_time` int DEFAULT 25,
	`is_always_open` boolean DEFAULT false,
	`is_same_time_every_day` boolean DEFAULT false,
	CONSTRAINT `restaurant_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `restaurant_settings_restaurant_id_unique` UNIQUE(`restaurant_id`)
);

CREATE TABLE `zone_delivery_fees` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`from_zone_id` char(36) NOT NULL,
	`to_zone_id` char(36) NOT NULL,
	`fee` decimal(10,2) NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `zone_delivery_fees_id` PRIMARY KEY(`id`)
);

CREATE TABLE `restaurant_zone_delivery_fees` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`restaurant_id` char(36) NOT NULL,
	`zone_id` char(36) NOT NULL,
	`delivery_fee` decimal(10,2) NOT NULL,
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `restaurant_zone_delivery_fees_id` PRIMARY KEY(`id`)
);

CREATE TABLE `order_items` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`order_id` char(36) NOT NULL,
	`food_id` char(36) NOT NULL,
	`quantity` int NOT NULL,
	`base_price` decimal(10,2) NOT NULL,
	`variations_price` decimal(10,2) DEFAULT '0.00',
	`total_price` decimal(10,2) NOT NULL,
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);

CREATE TABLE `orders` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`order_number` varchar(20) NOT NULL,
	`idempotency_key` varchar(100),
	`user_id` char(36) NOT NULL,
	`restaurant_id` char(36) NOT NULL,
	`branch_id` char(36) NOT NULL,
	`order_source` enum('online_order','food_aggregator') NOT NULL,
	`payment_method_id` char(36) NOT NULL,
	`order_type` enum('delivery','takeaway','dine_in') DEFAULT 'delivery',
	`subtotal` decimal(10,2) NOT NULL,
	`delivery_fee` decimal(10,2) DEFAULT '0.00',
	`service_fee` decimal(10,2) DEFAULT '0.00',
	`app_commission` decimal(10,2) DEFAULT '0.00',
	`total_amount` decimal(10,2) NOT NULL,
	`status` enum('pending','accepted','preparing','out_for_delivery','delivered','cancelled','rejected','refund') DEFAULT 'pending',
	`cancel_reason` text,
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_order_number_unique` UNIQUE(`order_number`),
	CONSTRAINT `orders_idempotency_key_unique` UNIQUE(`idempotency_key`)
);

CREATE TABLE `users` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`photo` varchar(255),
	`email` varchar(255) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`fcm_token` text,
	`password` varchar(255) NOT NULL,
	`is_verified` boolean DEFAULT false,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);

 

CREATE TABLE `user_wallet_transactions` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`user_id` char(36) NOT NULL,
	`payment_method_id` char(36),
	`type` enum('credit','debit') NOT NULL,
	`transaction_type` enum('order_payment','add_fund','cashback','converted_loyalty','manual_deposit') NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`balance_before` decimal(10,2) NOT NULL,
	`reference` varchar(255),
	`receipt_image` varchar(255),
	`status` enum('pending','approved','rejected') DEFAULT 'approved',
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `user_wallet_transactions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `user_wallets` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`user_id` char(36) NOT NULL,
	`balance` decimal(10,2) DEFAULT '0.00',
	`loyalty_points` int DEFAULT 0,
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_wallets_user_id_unique` UNIQUE(`user_id`)
);

CREATE TABLE `email_verifications` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`user_id` char(36) NOT NULL,
	`code` varchar(255) NOT NULL,
	`purpose` enum('verify_email','reset_password') DEFAULT 'verify_email',
	`created_at` timestamp DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	CONSTRAINT `email_verifications_id` PRIMARY KEY(`id`)
);

CREATE TABLE `favorites` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`user_id` char(36) NOT NULL,
	`restaurant_id` char(36),
	`food_id` char(36),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `favorites_id` PRIMARY KEY(`id`)
);

CREATE TABLE `cart_items` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`user_id` char(36) NOT NULL,
	`restaurant_id` char(36) NOT NULL,
	`food_id` char(36) NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`unit_price` varchar(50) NOT NULL,
	`total_price` varchar(50) NOT NULL,
	`variations` json,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cart_items_id` PRIMARY KEY(`id`)
);

ALTER TABLE `admins` ADD CONSTRAINT `admins_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `restrauntadmins` ADD CONSTRAINT `restrauntadmins_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `restrauntadmins` ADD CONSTRAINT `restrauntadmins_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `restrauntadmins` ADD CONSTRAINT `restrauntadmins_role_id_rolesadmin_id_fk` FOREIGN KEY (`role_id`) REFERENCES `rolesadmin`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `cities` ADD CONSTRAINT `cities_countryId_countries_id_fk` FOREIGN KEY (`countryId`) REFERENCES `countries`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `zones` ADD CONSTRAINT `zones_cityId_cities_id_fk` FOREIGN KEY (`cityId`) REFERENCES `cities`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `subcategories` ADD CONSTRAINT `subcategories_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `restaurants` ADD CONSTRAINT `restaurants_cuisine_id_cuisines_id_fk` FOREIGN KEY (`cuisine_id`) REFERENCES `cuisines`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `restaurants` ADD CONSTRAINT `restaurants_zone_id_zones_id_fk` FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `addons` ADD CONSTRAINT `addons_adonescategory_id_adonescategory_id_fk` FOREIGN KEY (`adonescategory_id`) REFERENCES `adonescategory`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `addons` ADD CONSTRAINT `addons_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `food_variations` ADD CONSTRAINT `food_variations_food_id_food_id_fk` FOREIGN KEY (`food_id`) REFERENCES `food`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `variation_options` ADD CONSTRAINT `variation_options_variation_id_food_variations_id_fk` FOREIGN KEY (`variation_id`) REFERENCES `food_variations`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `food` ADD CONSTRAINT `food_restaurantid_restaurants_id_fk` FOREIGN KEY (`restaurantid`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `food` ADD CONSTRAINT `food_categoryid_categories_id_fk` FOREIGN KEY (`categoryid`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `food` ADD CONSTRAINT `food_subcategoryid_subcategories_id_fk` FOREIGN KEY (`subcategoryid`) REFERENCES `subcategories`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `food` ADD CONSTRAINT `food_addons_id_addons_id_fk` FOREIGN KEY (`addons_id`) REFERENCES `addons`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `restaurant_business_plans` ADD CONSTRAINT `restaurant_business_plans_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `restaurant_wallet_transactions` ADD CONSTRAINT `restaurant_wallet_transactions_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `restaurant_wallets` ADD CONSTRAINT `restaurant_wallets_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `branch_menu_items` ADD CONSTRAINT `branch_menu_items_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `branch_menu_items` ADD CONSTRAINT `branch_menu_items_food_id_food_id_fk` FOREIGN KEY (`food_id`) REFERENCES `food`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `branches` ADD CONSTRAINT `branches_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `branches` ADD CONSTRAINT `branches_zone_id_zones_id_fk` FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `zone_delivery_fees` ADD CONSTRAINT `zone_delivery_fees_from_zone_id_zones_id_fk` FOREIGN KEY (`from_zone_id`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `zone_delivery_fees` ADD CONSTRAINT `zone_delivery_fees_to_zone_id_zones_id_fk` FOREIGN KEY (`to_zone_id`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `restaurant_zone_delivery_fees` ADD CONSTRAINT `restaurant_zone_delivery_fees_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `restaurant_zone_delivery_fees` ADD CONSTRAINT `restaurant_zone_delivery_fees_zone_id_zones_id_fk` FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_food_id_food_id_fk` FOREIGN KEY (`food_id`) REFERENCES `food`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `orders` ADD CONSTRAINT `orders_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `orders` ADD CONSTRAINT `orders_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `orders` ADD CONSTRAINT `orders_payment_method_id_payment_methods_id_fk` FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `addresses` ADD CONSTRAINT `addresses_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `addresses` ADD CONSTRAINT `addresses_zone_id_zones_id_fk` FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `user_wallet_transactions` ADD CONSTRAINT `user_wallet_transactions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `user_wallet_transactions` ADD CONSTRAINT `user_wallet_transactions_payment_method_id_payment_methods_id_fk` FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `user_wallets` ADD CONSTRAINT `user_wallets_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `email_verifications` ADD CONSTRAINT `email_verifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `favorites` ADD CONSTRAINT `favorites_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `favorites` ADD CONSTRAINT `favorites_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `favorites` ADD CONSTRAINT `favorites_food_id_food_id_fk` FOREIGN KEY (`food_id`) REFERENCES `food`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_food_id_food_id_fk` FOREIGN KEY (`food_id`) REFERENCES `food`(`id`) ON DELETE no action ON UPDATE no action;
