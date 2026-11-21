-- Add teacher feedback to manually graded exam answers.
-- Additive change: existing answer, mark and attempt records remain intact.
ALTER TABLE student_answers ADD COLUMN teacher_feedback TEXT;
