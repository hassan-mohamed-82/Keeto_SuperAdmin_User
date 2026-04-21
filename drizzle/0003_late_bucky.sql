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
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(100) NOT NULL,
	`permissions` json DEFAULT ('[]'),
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `admins` ADD CONSTRAINT `admins_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE no action ON UPDATE no action;