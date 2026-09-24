-- ========================================================================
-- Migration: Add KASHIER to restaurant_payment_credentials provider enum
-- ========================================================================

-- Update provider enum column to support both PAYMOB and KASHIER
ALTER TABLE `restaurant_payment_credentials` 
    MODIFY COLUMN `provider` ENUM('PAYMOB', 'KASHIER') NOT NULL;
