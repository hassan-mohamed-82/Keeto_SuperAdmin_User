CREATE TABLE `user_wallet_transactions` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`user_id` char(36) NOT NULL,
	`type` enum('credit','debit') NOT NULL,
	`payment_method` varchar(50),
	`transaction_type` enum('order_payment','add_fund','cashback','added_via_payment','converted_loyalty','order_transaction') NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`balance_before` decimal(10,2) NOT NULL,
	`reference` varchar(255),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `user_wallet_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_wallets` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`user_id` char(36) NOT NULL,
	`balance` decimal(10,2) DEFAULT '0.00',
	`loyalty_points` int DEFAULT 0,
	`updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_wallets_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `email_verifications` (
	`id` char(36) NOT NULL DEFAULT (UUID()),
	`user_id` char(36) NOT NULL,
	`code` varchar(6) NOT NULL,
	`purpose` enum('verify_email','reset_password') DEFAULT 'verify_email',
	`created_at` timestamp DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	CONSTRAINT `email_verifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `password` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `is_verified` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `user_wallet_transactions` ADD CONSTRAINT `user_wallet_transactions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_wallets` ADD CONSTRAINT `user_wallets_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `email_verifications` ADD CONSTRAINT `email_verifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;