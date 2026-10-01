-- Bring restrauntadmins in line with src/models/schema/admin/restrauntadmin.ts.
ALTER TABLE `restrauntadmins`
	ADD COLUMN `fcm_token` text,
	ADD COLUMN `device_type` enum('web','android','ios') DEFAULT 'android',
	ADD COLUMN `firebase_project` varchar(50) DEFAULT 'primary',
	MODIFY COLUMN `type` enum('owner','subadmin','branch_manager','staff','cashier') NOT NULL DEFAULT 'branch_manager',
	ADD COLUMN `updated_at` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP;