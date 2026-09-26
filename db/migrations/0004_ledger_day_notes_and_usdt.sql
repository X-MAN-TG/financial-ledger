-- 0004_ledger_day_notes_and_usdt.sql
-- Add common day note, image attachments (JSON array of NoteAttachment), and day USDT rate to ledger_days.
ALTER TABLE ledger_days ADD COLUMN note TEXT NULL;
ALTER TABLE ledger_days ADD COLUMN attachments TEXT NULL;
ALTER TABLE ledger_days ADD COLUMN usdt_rate REAL NULL DEFAULT 0;
