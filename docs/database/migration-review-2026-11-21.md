# DhyanshEdu D1 migration compatibility review — 2026-11-21

## Scope reviewed
- Existing D1 schema snapshot: `docs/database/d1-schema-baseline-2026-11-21.md`.
- Proposed additive migration: `migrations/0001_dhyanshedu_consolidated.sql`.
- Existing Worker source supplied for review (737 lines).

This is a source-level compatibility review. It is not a Cloudflare D1 execution test, Worker runtime test, or production approval.

## Findings

### 1. Existing database structure must be preserved
The current D1 schema uses integer primary keys for `classes.id`, `subjects.id`, and `teacher_assignments.id`. The migration correctly uses integer references for class and subject foreign keys in its new tables, and it does not alter the existing tables.

### 2. Existing Worker has an assignment ID mismatch
The existing `teacher_assignments.id` column is `INTEGER PRIMARY KEY AUTOINCREMENT`, but the Worker POST handler generates `crypto.randomUUID()` and inserts it into that ID column. This conflicts with the existing SQLite integer rowid primary-key design and must be corrected in the Worker before relying on that endpoint. The migration does not fix this existing API issue.

### 3. New tables are not yet wired into the Worker
The migration creates new period-based class/batch teacher assignment tables, timetable/session tables, enquiry/demo/admission tables, answer-sheet evaluation tables, fee extensions and notification/privacy tables. The currently reviewed Worker routes do not yet implement the full API workflows for these new tables. Applying the SQL alone will create schema structures; it will not deliver those features in the portal.

### 4. Existing teacher assignment routes still use legacy tables
The current Worker uses `teacher_assignments` and `batch_teachers` for assignment operations. The new period-based tables are separate. A later Worker update must define and implement the transition/precedence between legacy assignments and effective-dated primary/substitute assignments. Do not remove legacy assignment tables or data during this migration.

### 5. Existing fee/exam records remain in place
The migration adds related fee and evaluation structures but does not replace existing `fee_plans`, `student_fee_accounts`, `fee_transactions`, `fee_receipts`, `exams`, `questions`, `exam_attempts`, or related records. Worker and frontend changes are still needed to use the new fields and workflows.

## Decision
**Do not execute this migration on production D1 yet.** Keep it committed as a reviewed draft while the Worker/API compatibility plan and execution workflow are completed. Before production execution, run the exact file against a fresh disposable D1 database or an equivalent local SQLite copy of the captured schema, inspect all errors, then review the resulting schema and foreign-key check. Keep the backup.

## Safe next steps
1. Fix and test the existing `teacher_assignments.id` insertion mismatch in Worker code.
2. Define how legacy teacher/batch assignments map to effective-dated assignment periods.
3. Confirm the SQL against the current live D1 schema (re-capture schema immediately before execution).
4. Configure a manually triggered GitHub Actions workflow with least-privilege Cloudflare credentials stored only as GitHub Secrets.
5. Apply only after a final explicit approval; then verify expected tables, migration marker, existing row counts, and `PRAGMA foreign_key_check`.

## Security
Never commit Cloudflare API tokens, Supabase secrets, live student records, or database backups to this repository. Store deployment credentials only in GitHub Actions Secrets. Keep backups in a private, access-controlled location.
