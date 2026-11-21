-- DhyanshEdu migration 0002: per-question teacher evaluation feedback.
-- Additive only. Review and back up D1 before applying. This file is not applied automatically.
ALTER TABLE student_answers ADD COLUMN teacher_feedback TEXT;
