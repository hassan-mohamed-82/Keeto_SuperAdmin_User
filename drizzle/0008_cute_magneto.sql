CREATE TABLE `food_variations` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`food_id` char(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`is_required` boolean DEFAULT false,
	`selection_type` enum('single','multiple') DEFAULT 'single',
	`min` int,
	`max` int,
	CONSTRAINT `food_variations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `variation_options` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`variation_id` char(36) NOT NULL,
	`option_name` varchar(255) NOT NULL,
	`additional_price` varchar(255) NOT NULL DEFAULT '0',
	CONSTRAINT `variation_options_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `food` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`image` varchar(255) NOT NULL,
	`restaurantid` char(36) NOT NULL,
	`categoryid` char(36) NOT NULL,
	`subcategoryid` char(36) NOT NULL,
	`foodtype` enum('veg','non-veg') DEFAULT 'veg',
	`nutrition` text,
	`allegren_ingredients` text,
	`is_Halal` boolean DEFAULT false,
	`addons_id` char(36),
	`start_time` varchar(255) NOT NULL,
	`end_time` varchar(255) NOT NULL,
	`search_tages` varchar(255),
	`price` varchar(255) NOT NULL,
	`discount_type` enum('percentage','amount') DEFAULT 'percentage',
	`discount_value` varchar(255),
	`Maximum_Purchase` varchar(255),
	`stock_type` enum('limited','unlimited','daily') DEFAULT 'unlimited',
	`variations` json,
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `food_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `food_variations` ADD CONSTRAINT `food_variations_food_id_food_id_fk` FOREIGN KEY (`food_id`) REFERENCES `food`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variation_options` ADD CONSTRAINT `variation_options_variation_id_food_variations_id_fk` FOREIGN KEY (`variation_id`) REFERENCES `food_variations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `food` ADD CONSTRAINT `food_restaurantid_restaurants_id_fk` FOREIGN KEY (`restaurantid`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `food` ADD CONSTRAINT `food_categoryid_categories_id_fk` FOREIGN KEY (`categoryid`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `food` ADD CONSTRAINT `food_subcategoryid_subcategories_id_fk` FOREIGN KEY (`subcategoryid`) REFERENCES `subcategories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `food` ADD CONSTRAINT `food_addons_id_addons_id_fk` FOREIGN KEY (`addons_id`) REFERENCES `addons`(`id`) ON DELETE no action ON UPDATE no action;