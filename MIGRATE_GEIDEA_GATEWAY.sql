-- ========================================================================
-- Migration: Add GEIDEA Payment Gateway Support & Manual Insert Template
-- ========================================================================

-- 1. تحديث عمود provider في جدول restaurant_payment_credentials لدعم GEIDEA
ALTER TABLE `restaurant_payment_credentials` 
    MODIFY COLUMN `provider` ENUM('PAYMOB', 'KASHIER', 'GEIDEA') NOT NULL;

-- 2. تحديث عمود gateway في جدول payment_transactions لدعم geidea
ALTER TABLE `payment_transactions` 
    MODIFY COLUMN `gateway` ENUM('kashier', 'paymob', 'geidea') NOT NULL;

-- 3. تحديث عمود payment_gateway في جدول orders لدعم geidea
ALTER TABLE `orders` 
    MODIFY COLUMN `payment_gateway` ENUM('kashier', 'paymob', 'geidea') NULL;

-- ========================================================================
-- استعلام الإضافة اليدوي في الداتابيز (Manual Insert Query into DB)
-- استبدل 'YOUR_RESTAURANT_UUID' بالمعرف الخاص بالمطعم في الداتابيز
-- ========================================================================

INSERT INTO `restaurant_payment_credentials` (
    `id`,
    `restaurant_id`,
    `provider`,
    `title`,
    `environment`,
    `credentials`,
    `logo_url`,
    `is_active`,
    `created_at`,
    `updated_at`
) VALUES (
    UUID(),
    'YOUR_RESTAURANT_UUID', -- ضع هنا ID المطعم
    'GEIDEA',
    'Visa-Master',
    'LIVE',
    JSON_OBJECT(
        'name', 'Visa-Master',
        'publicKey', '00cae251-e389-4d6d-90ce-f7fb789f84',
        'apiPassword', 'f45e0d99-336f-4aa3-abf9-d821368bc5',
        'environment', 'Egypt',
        'logoUrl', 'https://wahedmashwybcknd.food2g'
    ),
    'https://wahedmashwybcknd.food2g',
    1,
    NOW(),
    NOW()
);
