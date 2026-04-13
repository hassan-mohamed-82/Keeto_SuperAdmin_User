RENAME TABLE `account_transactions` TO `restaurant_wallet_transactions`;--> statement-breakpoint
ALTER TABLE `restaurant_wallet_transactions` DROP FOREIGN KEY `account_transactions_restaurant_id_restaurants_id_fk`;
--> statement-breakpoint
ALTER TABLE `restaurant_wallet_transactions` DROP PRIMARY KEY;--> statement-breakpoint
ALTER TABLE `restaurant_wallet_transactions` MODIFY COLUMN `restaurant_id` char(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `restaurant_wallet_transactions` MODIFY COLUMN `type` enum('order_payment','cash_collection','withdraw_request','withdraw_approved','adjustment') NOT NULL;--> statement-breakpoint
ALTER TABLE `restaurant_wallet_transactions` MODIFY COLUMN `method` varchar(50) DEFAULT 'cash';--> statement-breakpoint
ALTER TABLE `restaurant_wallet_transactions` ADD PRIMARY KEY(`id`);--> statement-breakpoint
ALTER TABLE `restaurant_wallet_transactions` ADD `balance_after` decimal(10,2) NOT NULL;--> statement-breakpoint
ALTER TABLE `restaurant_wallet_transactions` ADD `note` text;--> statement-breakpoint
ALTER TABLE `restaurant_wallet_transactions` ADD CONSTRAINT `restaurant_wallet_transactions_restaurant_id_restaurants_id_fk` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE no action ON UPDATE no action;