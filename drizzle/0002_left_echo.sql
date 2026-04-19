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
--> statement-breakpoint
CREATE TABLE `rolesadmin` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(100) NOT NULL,
	`permissions` json DEFAULT ('[]'),
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `rolesadmin_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
DROP TABLE `admins`;--> statement-breakpoint
DROP TABLE `roles`;--> statement-breakpoint
ALTER TABLE `restrauntadmins` ADD CONSTRAINT `restrauntadmins_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restrauntadmins` ADD CONSTRAINT `restrauntadmins_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restrauntadmins` ADD CONSTRAINT `restrauntadmins_role_id_rolesadmin_id_fk` FOREIGN KEY (`role_id`) REFERENCES `rolesadmin`(`id`) ON DELETE no action ON UPDATE no action;