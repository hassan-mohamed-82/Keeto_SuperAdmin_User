-- Migration V3: Add 'subdomain' source and dns_status tracking
-- Run this AFTER MIGRATE_RESTAURANT_DOMAINS_V2.sql

ALTER TABLE `restaurant_domains`
  MODIFY COLUMN `source` ENUM('external','managed','subdomain') NOT NULL DEFAULT 'external',
  ADD COLUMN `dns_status` ENUM('not_needed','pending','created','manual_required') NOT NULL DEFAULT 'not_needed' AFTER `provision_attempts`;
