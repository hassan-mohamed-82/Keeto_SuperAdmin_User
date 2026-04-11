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
--> statement-breakpoint
CREATE TABLE `restaurant_business_plans` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`restaurant_id` char(36) NOT NULL,
	`platform_type` enum('online_order','Keeto_App') NOT NULL,
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
--> statement-breakpoint
CREATE TABLE `restaurant_wallets` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`restaurant_id` char(36) NOT NULL,
	`balance` decimal(10,2) DEFAULT '0.00',
	`collected_cash` decimal(10,2) DEFAULT '0.00',
	`pending_withdraw` decimal(10,2) DEFAULT '0.00',
	`total_withdrawn` decimal(10,2) DEFAULT '0.00',
	`total_earning` decimal(10,2) DEFAULT '0.00',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `restaurant_wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `restaurant_wallets_restaurant_id_unique` UNIQUE(`restaurant_id`)
);
--> statement-breakpoint
ALTER TABLE `restaurant_business_plans` ADD CONSTRAINT `restaurant_business_plans_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restaurant_wallets` ADD CONSTRAINT `restaurant_wallets_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;