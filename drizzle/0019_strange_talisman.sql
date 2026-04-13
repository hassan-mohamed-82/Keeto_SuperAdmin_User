CREATE TABLE `payment_methods` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`name` varchar(100) NOT NULL,
	`image` varchar(255) NOT NULL,
	`description` varchar(255) NOT NULL,
	`type` enum('manual','automatic') NOT NULL,
	`is_active` boolean DEFAULT true,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `payment_methods_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `user_wallet_transactions` RENAME COLUMN `payment_method` TO `payment_method_id`;--> statement-breakpoint
ALTER TABLE `user_wallet_transactions` MODIFY COLUMN `payment_method_id` char(36);--> statement-breakpoint
ALTER TABLE `user_wallet_transactions` MODIFY COLUMN `transaction_type` enum('order_payment','add_fund','cashback','converted_loyalty','manual_deposit') NOT NULL;--> statement-breakpoint
ALTER TABLE `user_wallet_transactions` ADD `receipt_image` varchar(255);--> statement-breakpoint
ALTER TABLE `user_wallet_transactions` ADD `status` enum('pending','approved','rejected') DEFAULT 'approved';--> statement-breakpoint
ALTER TABLE `user_wallet_transactions` ADD CONSTRAINT `user_wallet_transactions_payment_method_id_payment_methods_id_fk` FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON DELETE no action ON UPDATE no action;