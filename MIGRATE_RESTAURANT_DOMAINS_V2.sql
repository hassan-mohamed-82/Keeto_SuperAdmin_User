-- Migration V2: Add provisioning tracking columns to restaurant_domains
-- Run this AFTER MIGRATE_RESTAURANT_DOMAINS.sql

ALTER TABLE `restaurant_domains`
  ADD COLUMN `provision_status` ENUM('idle','running','done','failed') NOT NULL DEFAULT 'idle' AFTER `last_checked_at`,
  ADD COLUMN `provision_step` VARCHAR(30) NULL AFTER `provision_status`,
  ADD COLUMN `plesk_site_created` TINYINT(1) NOT NULL DEFAULT 0 AFTER `provision_step`,
  ADD COLUMN `provision_started_at` TIMESTAMP NULL AFTER `plesk_site_created`,
  ADD COLUMN `provision_attempts` INT NOT NULL DEFAULT 0 AFTER `provision_started_at`;
