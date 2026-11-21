# Fee management API

This phase is admin-controlled manual fee management. Payment gateway processing is intentionally not included.

## Data model

- `fee_plans`: reusable fee catalogue. A plan is public only when `public_status='published'` and `is_active=1`; effective dates are respected.
- `student_fee_accounts`: student-specific fee agreement. `amount_due_paise` is the fixed agreed total and is not recalculated when a public plan changes.
- `fee_installments`: optional schedule for an agreed account.
- `fee_transactions`: recorded cash/bank/manual receipts. Only `recorded` transactions count as collections.
- `fee_receipts`: receipt number for each recorded payment.
- `fee_adjustments`: audited credits, debits, refunds and waivers. They do not rewrite payment history.

All amounts are integer paise. The UI displays INR by dividing by 100.

## Admin endpoints

- `GET /api/admin/fees/bootstrap` — active students, batches and fee plans for selectors.
- `GET /api/admin/fee-plans` — all fee plans.
- `POST /api/admin/fee-plans` — create a draft fee plan.
- `PATCH /api/admin/fee-plans/:id/status` — set `draft`, `published`, or `archived`.
- `GET /api/admin/fee-accounts` — accounts with paid, adjusted and outstanding totals.
- `POST /api/admin/fee-accounts` — create a student fee agreement and optional instalments.
- `POST /api/admin/fee-accounts/:id/payments` — record cash, bank transfer, UPI (manual) or other manual payment and issue receipt metadata.
- `POST /api/admin/fee-accounts/:id/adjustments` — record a credit, debit, refund or waiver with reason and optional reference.

## Student endpoint

- `GET /api/student/fees` — only the signed-in student's own accounts, instalments, transactions and receipt numbers.

## Security and operating notes

- Every endpoint requires a valid Supabase-authenticated portal account.
- Admin endpoints require an approved Admin profile in D1.
- Student fee history is filtered by the authenticated user ID; no student ID is accepted from the browser.
- The public website integration should later consume only published fee plans through a separate public read-only endpoint. It must never expose student accounts or payment records.
- No migration is executed by this code change. Review the SQL, take a fresh D1 backup, then apply it manually in a controlled release.
- No gateway API, gateway secret, automatic charge, or webhook is present in this phase.
