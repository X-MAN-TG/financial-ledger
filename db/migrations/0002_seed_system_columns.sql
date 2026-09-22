-- 0002_seed_system_columns.sql
-- Seeds the 9 standard columns as is_system = 1 rows (03 section 9 note,
-- 03 section 14.3: seeded by migration, never hard-coded in app logic).
-- These map to real `transactions` table columns, not to the EAV table.
-- Positions 0..8 are reserved for system columns; owner-added custom
-- columns start at position 100 (11-owner-panel.txt section 7.4 keeps the
-- system block fixed and ordered first).

INSERT OR IGNORE INTO column_definitions
  (id, key, label, type, position, is_required, is_active, is_system, select_options, created_at, updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000001','sr_number',       'Sr Number',          'NUMBER',   0, 1, 1, 1, NULL, 1757894400000, 1757894400000),
  ('00000000-0000-4000-8000-000000000002','customer_name',   'Customer Name',      'TEXT',     1, 0, 1, 1, NULL, 1757894400000, 1757894400000),
  ('00000000-0000-4000-8000-000000000003','inr_amount',      'Amount in INR',      'CURRENCY', 2, 0, 1, 1, NULL, 1757894400000, 1757894400000),
  ('00000000-0000-4000-8000-000000000004','inr_received',    'INR Received',       'CHECKBOX', 3, 0, 1, 1, NULL, 1757894400000, 1757894400000),
  ('00000000-0000-4000-8000-000000000005','usdt_amount',     'USDT',               'NUMBER',   4, 0, 1, 1, NULL, 1757894400000, 1757894400000),
  ('00000000-0000-4000-8000-000000000006','final_rub_amount','Final Amount in RUB','CURRENCY', 5, 0, 1, 1, NULL, 1757894400000, 1757894400000),
  ('00000000-0000-4000-8000-000000000007','extras_amount',   'Extras',             'CURRENCY', 6, 0, 1, 1, NULL, 1757894400000, 1757894400000),
  ('00000000-0000-4000-8000-000000000008','order_done',      'Order Done',         'CHECKBOX', 7, 0, 1, 1, NULL, 1757894400000, 1757894400000),
  ('00000000-0000-4000-8000-000000000009','note',            'Note',               'LONG_TEXT',8, 0, 1, 1, NULL, 1757894400000, 1757894400000);
