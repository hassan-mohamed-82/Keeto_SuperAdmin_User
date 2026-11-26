-- =====================================================================
-- Cleanup: zero-value order_payment rows in restaurant_wallet_transactions
-- =====================================================================
-- Targets rows where NOTHING moved:
--   type = 'order_payment', amount = 0, service_fee = 0, commission = 0,
--   visa_commission = 0, balance_before = balance_after
-- Skips rows whose order was later reversed (a cancellation "Reversal" row
-- exists), so no reversal row is left without its original.
--
-- Run the steps one at a time. Step 2 makes a backup; step 5 restores it.
-- =====================================================================

-- 1) PREVIEW: how many rows, per restaurant and method
SELECT t.restaurant_id, t.method, COUNT(*) AS rows_to_delete
FROM restaurant_wallet_transactions t
WHERE t.type = 'order_payment'
  AND t.amount = 0
  AND COALESCE(t.service_fee, 0) = 0
  AND COALESCE(t.commission, 0) = 0
  AND COALESCE(t.visa_commission, 0) = 0
  AND t.balance_before = t.balance_after
  AND NOT EXISTS (
      SELECT 1 FROM restaurant_wallet_transactions r
      WHERE r.reference = t.reference
        AND r.restaurant_id = t.restaurant_id
        AND r.type = 'adjustment'
        AND r.note LIKE 'Reversal for cancelled delivered order%'
  )
GROUP BY t.restaurant_id, t.method;

-- 2) BACKUP the rows (keep this table until you are sure)
CREATE TABLE restaurant_wallet_transactions_zero_backup_20261126 AS
SELECT t.*
FROM restaurant_wallet_transactions t
WHERE t.type = 'order_payment'
  AND t.amount = 0
  AND COALESCE(t.service_fee, 0) = 0
  AND COALESCE(t.commission, 0) = 0
  AND COALESCE(t.visa_commission, 0) = 0
  AND t.balance_before = t.balance_after
  AND NOT EXISTS (
      SELECT 1 FROM restaurant_wallet_transactions r
      WHERE r.reference = t.reference
        AND r.restaurant_id = t.restaurant_id
        AND r.type = 'adjustment'
        AND r.note LIKE 'Reversal for cancelled delivered order%'
  );

SELECT COUNT(*) AS backed_up FROM restaurant_wallet_transactions_zero_backup_20261126;

-- 3) DELETE exactly the backed-up rows
START TRANSACTION;

DELETE t FROM restaurant_wallet_transactions t
JOIN restaurant_wallet_transactions_zero_backup_20261126 b ON b.id = t.id;

-- Check the affected-row count equals "backed_up" above, then:
COMMIT;
-- (or ROLLBACK; if the count is wrong)

-- 4) VERIFY: should return 0
SELECT COUNT(*) AS remaining
FROM restaurant_wallet_transactions t
JOIN restaurant_wallet_transactions_zero_backup_20261126 b ON b.id = t.id;

-- 5) UNDO (only if needed): put the rows back
-- INSERT INTO restaurant_wallet_transactions
-- SELECT * FROM restaurant_wallet_transactions_zero_backup_20261126;

-- 6) When you are sure, drop the backup
-- DROP TABLE restaurant_wallet_transactions_zero_backup_20261126;
