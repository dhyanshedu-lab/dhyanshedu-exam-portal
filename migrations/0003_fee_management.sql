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

ALTER TABLE fee_plans ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_fee_plans_public ON fee_plans(public_status,is_active,effective_from,effective_to);
CREATE INDEX IF NOT EXISTS idx_fee_plans_scope ON fee_plans(pricing_scope,curriculum_id,class_id,subject_id,batch_id);
CREATE INDEX IF NOT EXISTS idx_fee_installments_due ON fee_installments(fee_account_id,due_date,status);
CREATE INDEX IF NOT EXISTS idx_fee_adjustments_account ON fee_adjustments(fee_account_id,created_at);

-- Existing fee_plans remain draft until Admin explicitly publishes them.
-- Existing student_fee_accounts retain their original amount_due_paise as the agreed total.


-- Compatibility columns required by the fee API module and existing Phase 1 schema.
-- Keep the original columns intact; copy existing values into the API-facing aliases.
ALTER TABLE fee_plans ADD COLUMN name TEXT;
ALTER TABLE fee_plans ADD COLUMN billing_frequency TEXT;
UPDATE fee_plans SET name=plan_name, billing_frequency=billing_period;

ALTER TABLE student_fee_accounts ADD COLUMN description TEXT;
ALTER TABLE student_fee_accounts ADD COLUMN amount_due_paise INTEGER;
ALTER TABLE student_fee_accounts ADD COLUMN created_by TEXT;
UPDATE student_fee_accounts
SET description=COALESCE((SELECT plan_name FROM fee_plans WHERE fee_plans.id=student_fee_accounts.fee_plan_id),'Tuition fee'),
    amount_due_paise=total_amount_paise;

ALTER TABLE fee_transactions ADD COLUMN student_id TEXT;
ALTER TABLE fee_transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE fee_transactions ADD COLUMN recorded_by TEXT;
ALTER TABLE fee_transactions ADD COLUMN notes TEXT;
ALTER TABLE fee_transactions ADD COLUMN received_at TEXT;
UPDATE fee_transactions
SET student_id=(SELECT student_id FROM student_fee_accounts WHERE student_fee_accounts.id=fee_transactions.fee_account_id),
    status=CASE WHEN payment_status IN ('paid','success','completed','recorded') THEN 'recorded' ELSE payment_status END,
    received_at=created_at;

ALTER TABLE fee_receipts ADD COLUMN transaction_id TEXT;
ALTER TABLE fee_receipts ADD COLUMN issued_at TEXT;
UPDATE fee_receipts SET transaction_id=fee_transaction_id, issued_at=created_at;

ALTER TABLE audit_logs ADD COLUMN actor_user_id TEXT;
ALTER TABLE audit_logs ADD COLUMN details_json TEXT;
UPDATE audit_logs SET actor_user_id=actor_id, details_json=details;

CREATE INDEX IF NOT EXISTS idx_fee_transactions_account_status
  ON fee_transactions(fee_account_id,status);
CREATE INDEX IF NOT EXISTS idx_fee_receipts_transaction
  ON fee_receipts(transaction_id);
