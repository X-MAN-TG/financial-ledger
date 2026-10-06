-- 0005_ledger_day_usdt_purchased.sql
-- Add usdt_purchased to ledger_days to track USDT purchased for the day.
ALTER TABLE ledger_days ADD COLUMN usdt_purchased REAL NULL DEFAULT 0;
