-- ============================================================
-- Migration: Update visaSwitchConditionType enum (without 'date')
--            and add visaSwitchDayOfWeek & visaSwitchDayOfMonth
-- ============================================================

-- 1. تعديل نوع الـ ENUM لحذف 'date' والاحتفاظ بـ ('none', 'amount', 'day_of_week', 'day_of_month')
ALTER TABLE `restaurant_settings`
  MODIFY COLUMN `visa_switch_condition_type`
    ENUM('none', 'amount', 'day_of_week', 'day_of_month')
    NOT NULL DEFAULT 'none';

-- 2. إضافة الأعمدة الجديدة (visa_switch_day_of_week و visa_switch_day_of_month)
ALTER TABLE `restaurant_settings`
  ADD COLUMN `visa_switch_day_of_week`  VARCHAR(10) NULL AFTER `visa_switch_amount_threshold`,
  ADD COLUMN `visa_switch_day_of_month` INT         NULL AFTER `visa_switch_day_of_week`;

-- 3. في حال كان عمود visa_switch_date قد تم إنشاؤه سابقاً وتريد حذفه:
-- ALTER TABLE `restaurant_settings` DROP COLUMN IF EXISTS `visa_switch_date`;
