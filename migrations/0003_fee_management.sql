-- DhyanshEdu Fee Management Phase 2 (additive migration)
-- Review and back up D1 before applying. Do not execute automatically.
-- This migration extends the Phase 1 fee tables without deleting existing records.

PRAGMA foreign_keys = ON;

ALTER TABLE fee_plans ADD COLUMN pricing_scope TEXT NOT NULL DEFAULT 'general'
  CHECK (pricing_scope IN ('general','curriculum','class','subject','batch'));
ALTER TABLE fee_plans ADD COLUMN batch_type TEXT
  CHECK (batch_type IS NULL OR batch_type IN ('group','one_to_one'));
ALTER TABLE fee_plans ADD COLUMN curriculum_id TEXT;
ALTER TABLE fee_plans ADD COLUMN class_id TEXT REFERENCES classes(id);
ALTER TABLE fee_plans ADD COLUMN subject_id TEXT REFERENCES subjects(id);
ALTER TABLE fee_plans ADD COLUMN batch_id TEXT REFERENCES batches(id);
ALTER TABLE fee_plans ADD COLUMN effective_from TEXT;
ALTER TABLE fee_plans ADD COLUMN effective_to TEXT;
ALTER TABLE fee_plans ADD COLUMN public_status TEXT NOT NULL DEFAULT 'draft'
  CHECK (public_status IN ('draft','published','archived'));
ALTER TABLE fee_plans ADD COLUMN inclusions TEXT;
ALTER TABLE fee_plans ADD COLUMN terms TEXT;
ALTER TABLE fee_plans ADD COLUMN discount_type TEXT
  CHECK (discount_type IS NULL OR discount_type IN ('fixed','percentage'));
ALTER TABLE fee_plans ADD COLUMN discount_value REAL;

ALTER TABLE student_fee_accounts ADD COLUMN original_amount_paise INTEGER
  CHECK (original_amount_paise IS NULL OR original_amount_paise >= 0);
ALTER TABLE student_fee_accounts ADD COLUMN discount_paise INTEGER NOT NULL DEFAULT 0
  CHECK (discount_paise >= 0);
ALTER TABLE student_fee_accounts ADD COLUMN scholarship_paise INTEGER NOT NULL DEFAULT 0
  CHECK (scholarship_paise >= 0);
ALTER TABLE student_fee_accounts ADD COLUMN agreed_on TEXT;
ALTER TABLE student_fee_accounts ADD COLUMN notes TEXT;

CREATE TABLE IF NOT EXISTS fee_installments (
  id TEXT PRIMARY KEY,
  fee_account_id TEXT NOT NULL REFERENCES student_fee_accounts(id),
  installment_number INTEGER NOT NULL CHECK (installment_number > 0),
  description TEXT,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fee_account_id, installment_number)
);

CREATE TABLE IF NOT EXISTS fee_adjustments (
  id TEXT PRIMARY KEY,
  fee_account_id TEXT NOT NULL REFERENCES student_fee_accounts(id),
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('credit','debit','refund','waiver')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  reason TEXT NOT NULL,
  reference TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fee_plans_public ON fee_plans(public_status,is_active,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_fee_plans_scope ON fee_plans(pricing_scope,curriculum_id,class_id,subject_id,batch_id);
CREATE INDEX IF NOT EXISTS idx_fee_installments_due ON fee_installments(fee_account_id,due_date,status);
CREATE INDEX IF NOT EXISTS idx_fee_adjustments_account ON fee_adjustments(fee_account_id,created_at);

-- Existing fee_plans remain draft until Admin explicitly publishes them.
-- Existing student_fee_accounts retain their original amount_due_paise as the agreed total.
