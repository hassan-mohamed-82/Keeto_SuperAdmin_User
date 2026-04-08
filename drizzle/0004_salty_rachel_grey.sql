CREATE TABLE `categories` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`image` varchar(255) NOT NULL,
	`meta_image` varchar(255),
	`title` text,
	`meta_title` text,
	`priority` enum('low','medium','high') DEFAULT 'low',
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subcategories` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(255) NOT NULL,
	`category_id` char(36),
	`priority` enum('low','medium','high') DEFAULT 'low',
	`status` enum('active','inactive') DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subcategories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `subcategories` ADD CONSTRAINT `subcategories_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;