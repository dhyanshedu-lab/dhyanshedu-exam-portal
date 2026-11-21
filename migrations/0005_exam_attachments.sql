-- Additive metadata table for question papers stored in Cloudflare R2.
-- Review and back up D1 before applying this migration.
CREATE TABLE IF NOT EXISTS exam_attachments (
 id TEXT PRIMARY KEY,
 exam_id TEXT NOT NULL REFERENCES exams(id),
 uploaded_by TEXT NOT NULL REFERENCES users(id),
 r2_object_key TEXT NOT NULL,
 file_name TEXT NOT NULL,
 mime_type TEXT NOT NULL,
 file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 12582912),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_exam_attachments_exam ON exam_attachments(exam_id,created_at);