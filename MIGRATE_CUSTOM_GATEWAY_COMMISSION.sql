-- ============================================================
-- Migration: Add percentage_value, fixed_value, and tax to
--            restaurant_payment_credentials, visa_commission to orders,
--            and visa commission columns to wallet tables
-- ============================================================

-- 1. إضافة حقول عمولة الفيزا لبوابات الدفع المخصصة للمطاعم
ALTER TABLE `restaurant_payment_credentials`
  ADD COLUMN `percentage_value` DECIMAL(10, 2) NOT NULL DEFAULT '0.00' AFTER `credentials`,
  ADD COLUMN `fixed_value`      DECIMAL(10, 2) NOT NULL DEFAULT '0.00' AFTER `percentage_value`,
  ADD COLUMN `tax`              DECIMAL(10, 2) NOT NULL DEFAULT '0.00' AFTER `fixed_value`;

-- 2. إضافة حقل visa_commission لجدول الأوردرات
ALTER TABLE `orders`
  ADD COLUMN `visa_commission` DECIMAL(10, 2) NOT NULL DEFAULT '0.00' AFTER `app_commission`;

-- 3. إضافة إجمالي عمولة الفيزا لجدول محفظة المطعم
ALTER TABLE `restaurant_wallets`
  ADD COLUMN `total_visa_commission` DECIMAL(10, 2) NOT NULL DEFAULT '0.00' AFTER `total_commission`;

-- 4. إضافة عمولة الفيزا لجدول حركات محفظة المطعم
ALTER TABLE `restaurant_wallet_transactions`
  ADD COLUMN `visa_commission` DECIMAL(10, 2) NOT NULL DEFAULT '0.00' AFTER `commission`;
