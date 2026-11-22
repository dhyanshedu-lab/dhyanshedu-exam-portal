# DhyanshEdu Worker source audit and deployment record

This branch captures the Cloudflare Worker modules for `dhyanshedu-api` and records the production release.

## Source reconciliation
- Compared the QA branch modules against the active Cloudflare Worker source before release.
- `fees.js` matched the active source exactly.
- Reconciled the intended fixes in `index.js` and `study.js`: the `/api/me` D1 binding mismatch and India Standard Time date-boundary handling.
- Preserved the existing D1, R2 and Supabase bindings through strict inheritance; no credentials or binding values were changed.

## Changes included in Worker version 28
- Strict ISO calendar-date validation rejects malformed and impossible dates.
- Shared substitute-coverage access with batch-level precedence over class/subject coverage.
- Substitute teachers can view the primary teacher's question bank only while an active matching coverage assignment applies; exam creation revalidates question ownership against the selected batch and coverage scope.
- Leave approval now requires complete coverage of every active batch assignment and every class/subject assignment. Duplicate and malformed scopes are rejected.
- Teacher workspace, study materials, assignments, exams, evaluation, grading, publishing, attachments and live-class access honor substitute coverage.
- India-local date comparisons use the explicit UTC+05:30 offset.

## Validation completed
- Worker version upload and Cloudflare compilation succeeded.
- All six existing bindings were verified on the candidate version.
- Read-only D1 checks accepted the revised question-bank queries and assignment-scope lookups; no database rows were changed.
- Seven focused coverage-completeness assertions passed in an isolated runtime harness.
- Regression tests for coverage completeness were added to the Worker QA test suite. Authenticated end-to-end testing has not been performed.

## Production deployment
- Worker version 28 was deployed to `dhyanshedu-api` at 100% traffic on 2026-11-22 07:21:51 UTC.
- Previous production version 26 remains available for rollback.
- No D1 migration, production login configuration change, or production data write was performed as part of this deployment.

## Deferred
- Admin, teacher and student authenticated end-to-end tests are deferred until the user is ready.
- Do not treat syntax, SQL parsing or the isolated helper assertions as a substitute for those end-to-end tests.
