-- DhyanshEdu website enquiry capture and admin follow-up history.
-- Additive migration. Back up D1 and validate before production execution.

CREATE TABLE IF NOT EXISTS enquiries (
  id TEXT PRIMARY KEY,
  student_name TEXT NOT NULL,
  parent_name TEXT,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  student_class TEXT NOT NULL,
  board TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','contacted','demo_scheduled','enrolled','closed')),
  assigned_to TEXT REFERENCES users(id),
  follow_up_at TEXT,
  admin_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enquiry_history (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL REFERENCES enquiries(id),
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The live Phase 1 database already has enquiry_history with actor_id/notes.
-- Add API-facing aliases without dropping or rewriting the legacy columns.
ALTER TABLE enquiry_history ADD COLUMN actor_user_id TEXT REFERENCES users(id);
ALTER TABLE enquiry_history ADD COLUMN field_name TEXT;
UPDATE enquiry_history SET actor_user_id=actor_id WHERE actor_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_enquiries_status_created
  ON enquiries(status,created_at);
CREATE INDEX IF NOT EXISTS idx_enquiries_assigned_followup
  ON enquiries(assigned_to,follow_up_at);
CREATE INDEX IF NOT EXISTS idx_enquiry_history_enquiry_created
  ON enquiry_history(enquiry_id,created_at);
