CREATE TABLE `addons` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`price` varchar(255) NOT NULL,
	`status` enum('active','inactive') DEFAULT 'active',
	`stock_type` enum('unlimited','limited','daily') DEFAULT 'unlimited',
	`adonescategory_id` char(36) NOT NULL,
	`restaurant_id` char(36) NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `addons_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `addons` ADD CONSTRAINT `addons_adonescategory_id_adonescategory_id_fk` FOREIGN KEY (`adonescategory_id`) REFERENCES `adonescategory`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `addons` ADD CONSTRAINT `addons_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restaurants` DROP COLUMN `lat`;--> statement-breakpoint
ALTER TABLE `restaurants` DROP COLUMN `lng`;