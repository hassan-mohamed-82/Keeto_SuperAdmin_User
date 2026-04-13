ALTER TABLE `order_items` RENAME COLUMN `price` TO `base_price`;--> statement-breakpoint
ALTER TABLE `orders` RENAME COLUMN `payment_method` TO `payment_method_id`;--> statement-breakpoint
ALTER TABLE `orders` MODIFY COLUMN `order_number` varchar(20) NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` MODIFY COLUMN `payment_method_id` char(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `order_items` ADD `variations_price` decimal(10,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `order_items` ADD `total_price` decimal(10,2) NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `idempotency_key` varchar(100);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_idempotency_key_unique` UNIQUE(`idempotency_key`);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_payment_method_id_payment_methods_id_fk` FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON DELETE no action ON UPDATE no action;