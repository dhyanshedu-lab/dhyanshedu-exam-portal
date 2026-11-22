-- Teacher leave / temporary coverage and student class-progress foundation.
-- Additive migration only. Review and back up D1 before applying; do not run against production until validated.

CREATE TABLE IF NOT EXISTS teacher_leaves (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES users(id),
  leave_type TEXT NOT NULL DEFAULT 'personal' CHECK (leave_type IN ('sick','personal','emergency','other')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_teacher_leaves_teacher_dates
  ON teacher_leaves(teacher_id,start_date,end_date,status);
CREATE INDEX IF NOT EXISTS idx_teacher_leaves_status_dates
  ON teacher_leaves(status,start_date,end_date);

-- One row per affected teaching scope. Batch-specific coverage takes precedence
-- over class+subject coverage; the latter is the fallback for non-batch classes.
CREATE TABLE IF NOT EXISTS teacher_coverage_assignments (
  id TEXT PRIMARY KEY,
  leave_id TEXT NOT NULL REFERENCES teacher_leaves(id),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('batch','class_subject')),
  batch_id TEXT REFERENCES batches(id),
  class_id INTEGER REFERENCES classes(id),
  subject_id INTEGER REFERENCES subjects(id),
  primary_teacher_id TEXT NOT NULL REFERENCES users(id),
  substitute_teacher_id TEXT NOT NULL REFERENCES users(id),
  effective_from TEXT NOT NULL,
  effective_to TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','completed')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (effective_to >= effective_from),
  CHECK (
    (scope_type='batch' AND batch_id IS NOT NULL AND class_id IS NULL AND subject_id IS NULL)
    OR
    (scope_type='class_subject' AND batch_id IS NULL AND class_id IS NOT NULL AND subject_id IS NOT NULL)
  ),
  CHECK (primary_teacher_id <> substitute_teacher_id)
);
CREATE INDEX IF NOT EXISTS idx_teacher_coverage_batch_dates
  ON teacher_coverage_assignments(batch_id,effective_from,effective_to,status);
CREATE INDEX IF NOT EXISTS idx_teacher_coverage_class_subject_dates
  ON teacher_coverage_assignments(class_id,subject_id,effective_from,effective_to,status);
CREATE INDEX IF NOT EXISTS idx_teacher_coverage_leave
  ON teacher_coverage_assignments(leave_id,status);

CREATE TABLE IF NOT EXISTS student_class_entitlements (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  total_classes INTEGER NOT NULL CHECK (total_classes > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id,batch_id,subject_id)
);
CREATE INDEX IF NOT EXISTS idx_student_entitlements_student
  ON student_class_entitlements(student_id,status);
CREATE INDEX IF NOT EXISTS idx_student_entitlements_batch
  ON student_class_entitlements(batch_id,subject_id,status);

CREATE TABLE IF NOT EXISTS student_badge_definitions (
  badge_code TEXT PRIMARY KEY,
  badge_name TEXT NOT NULL,
  description TEXT NOT NULL,
  threshold_percent INTEGER NOT NULL UNIQUE CHECK (threshold_percent IN (25,50,75,100)),
  badge_emoji TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
INSERT OR IGNORE INTO student_badge_definitions
  (badge_code,badge_name,description,threshold_percent,badge_emoji,sort_order)
VALUES
  ('getting_started','Getting Started','Completed 25% of the allocated classes',25,'🌱',1),
  ('bronze_achiever','Bronze Achiever','Completed 50% of the allocated classes',50,'🥉',2),
  ('silver_achiever','Silver Achiever','Completed 75% of the allocated classes',75,'🥈',3),
  ('gold_achiever','Gold Achiever','Completed 100% of the allocated classes',100,'🥇',4);

CREATE TABLE IF NOT EXISTS student_badges (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  badge_code TEXT NOT NULL REFERENCES student_badge_definitions(badge_code),
  earned_percent INTEGER NOT NULL,
  earned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id,batch_id,subject_id,badge_code)
);
CREATE INDEX IF NOT EXISTS idx_student_badges_student
  ON student_badges(student_id,earned_at DESC);

-- Completion is counted only when the lesson is marked completed and the
-- student's attendance is Present or Late. Absent/Excused are excluded.
CREATE VIEW IF NOT EXISTS student_class_progress AS
SELECT
  e.student_id,
  e.batch_id,
  e.subject_id,
  e.total_classes,
  COUNT(DISTINCT CASE
    WHEN lc.status='completed' AND lca.attendance_status IN ('present','late')
    THEN lc.id END) AS completed_classes,
  MIN(100, CAST(
    COUNT(DISTINCT CASE
      WHEN lc.status='completed' AND lca.attendance_status IN ('present','late')
      THEN lc.id END) * 100.0 / e.total_classes AS INTEGER
  )) AS completion_percent
FROM student_class_entitlements e
LEFT JOIN live_classes lc
  ON lc.batch_id=e.batch_id
 AND (lc.subject_id=e.subject_id OR lc.subject_id IS NULL)
 AND lc.status='completed'
LEFT JOIN live_class_attendance lca
  ON lca.live_class_id=lc.id
 AND lca.student_id=e.student_id
WHERE e.status='active'
GROUP BY e.student_id,e.batch_id,e.subject_id,e.total_classes;
