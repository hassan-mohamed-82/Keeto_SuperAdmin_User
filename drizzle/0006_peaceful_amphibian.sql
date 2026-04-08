CREATE TABLE `adonescategory` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `adonescategory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `restaurants` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`address` text NOT NULL,
	`cuisine_id` char(36),
	`zone_id` char(36) NOT NULL,
	`lat` varchar(255),
	`lng` varchar(255),
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
	`status` enum('active','inactive','pending') DEFAULT 'pending',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `restaurants_id` PRIMARY KEY(`id`),
	CONSTRAINT `restaurants_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `restaurants` ADD CONSTRAINT `restaurants_cuisine_id_cuisines_id_fk` FOREIGN KEY (`cuisine_id`) REFERENCES `cuisines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restaurants` ADD CONSTRAINT `restaurants_zone_id_zones_id_fk` FOREIGN KEY (`zone_id`) REFERENCES `zones`(`id`) ON DELETE no action ON UPDATE no action;