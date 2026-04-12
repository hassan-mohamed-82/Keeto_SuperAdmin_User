CREATE TABLE `account_transactions` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`restaurant_id` char(36),
	`type` varchar(100) NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`balance_before` decimal(10,2) NOT NULL,
	`method` varchar(50) DEFAULT 'Cash',
	`reference` varchar(255),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `account_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `zone_delivery_fees` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`from_zone_id` char(36) NOT NULL,
	`to_zone_id` char(36) NOT NULL,
	`fee` decimal(10,2) NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `zone_delivery_fees_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `restaurant_zone_delivery_fees` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`restaurant_id` char(36) NOT NULL,
	`zone_id` char(36) NOT NULL,
	`delivery_fee` decimal(10,2) NOT NULL,
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `restaurant_zone_delivery_fees_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`order_id` char(36) NOT NULL,
	`food_id` char(36) NOT NULL,
	`quantity` int NOT NULL,
	`price` decimal(10,2) NOT NULL,
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`order_number` varchar(15) NOT NULL,
	`user_id` char(36) NOT NULL,
	`restaurant_id` char(36) NOT NULL,
	`order_source` enum('online_order','food_aggregator') NOT NULL,
	`payment_method` enum('cash','visa') DEFAULT 'cash',
	`order_type` enum('delivery','takeaway','dine_in') DEFAULT 'delivery',
	`subtotal` decimal(10,2) NOT NULL,
	`delivery_fee` decimal(10,2) DEFAULT '0.00',
	`service_fee` decimal(10,2) DEFAULT '0.00',
	`app_commission` decimal(10,2) DEFAULT '0.00',
	`total_amount` decimal(10,2) NOT NULL,
	`status` enum('pending','accepted','preparing','out_for_delivery','delivered','cancelled') DEFAULT 'pending',
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_order_number_unique` UNIQUE(`order_number`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`country_id` char(36) NOT NULL,
	`city_id` char(36) NOT NULL,
	`zone_id` char(36) NOT NULL,
	`address` text,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `account_transactions` ADD CONSTRAINT `account_transactions_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `zone_delivery_fees` ADD CONSTRAINT `zone_delivery_fees_from_zone_id_zones_id_fk` FOREIGN KEY (`from_zone_id`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `zone_delivery_fees` ADD CONSTRAINT `zone_delivery_fees_to_zone_id_zones_id_fk` FOREIGN KEY (`to_zone_id`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restaurant_zone_delivery_fees` ADD CONSTRAINT `restaurant_zone_delivery_fees_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restaurant_zone_delivery_fees` ADD CONSTRAINT `restaurant_zone_delivery_fees_zone_id_zones_id_fk` FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_food_id_food_id_fk` FOREIGN KEY (`food_id`) REFERENCES `food`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_country_id_countries_id_fk` FOREIGN KEY (`country_id`) REFERENCES `countries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_city_id_cities_id_fk` FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_zone_id_zones_id_fk` FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restaurant_wallets` DROP COLUMN `created_at`;