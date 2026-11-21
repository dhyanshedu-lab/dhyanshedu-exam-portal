# DhyanshEdu Exam Portal

This repository contains the separate exam portal frontend. It does not replace the existing public `dhyanshedu.com` website.

## Current frontend functionality

- Supabase email/password sign-in.
- Teacher invitation callback and password setup.
- Pending teacher approval screen.
- Admin dashboard and teacher invitation/status interface.
- Forgot-password email request.
- Password recovery callback and new-password form.
- Responsive login and dashboard styling.

## Current application architecture

- Supabase Auth: authentication, invitation links and password recovery.
- Cloudflare Worker: authenticated API and authorization checks.
- Cloudflare D1: structured application records and user roles/status.
- Cloudflare R2: uploaded files and attachments.

The browser code must contain only the Supabase project URL and publishable key. Never put a Supabase secret/service-role key in this repository.

## Password recovery configuration

In Supabase Dashboard:

1. Open **Authentication → URL Configuration**.
2. Keep the existing portal Site URL and invitation redirect entries.
3. Ensure the deployed portal URL is included in **Redirect URLs**. The current generated portal origin is:

   `https://dhyanshedu-exam-portal.dhyanshedu.workers.dev/**`

4. Save changes.

The forgot-password form calls `resetPasswordForEmail()` and redirects to the current portal page. Supabase sends the recovery email. The recovery link must return to the portal with a valid recovery session before the new-password form is shown.

If the portal is later moved to `https://exam.dhyanshedu.com`, add that exact origin/path pattern to Supabase Redirect URLs and update the Site URL when the custom-domain migration is ready. Do not change DNS as part of this password-recovery update.

## Deployment files

For this update, replace these three files in the exam portal GitHub repository:

- `index.html`
- `app.js`
- `styles.css`

Do not replace files in the separate public website repository.

## Test checklist after deployment

1. Admin can still sign in.
2. Existing teacher can still sign in.
3. Teacher invitation and password setup still work.
4. Admin can still approve a teacher.
5. Forgot password accepts a registered email and displays a neutral confirmation.
6. The reset email opens the portal.
7. A valid recovery link shows the new-password screen.
8. Password update succeeds and the user can sign in with the new password.
9. An expired/invalid recovery link does not expose a password form.
10. A pending or inactive account remains subject to the existing Worker/D1 approval checks.

## Important remaining production work

This ZIP does not contain the Cloudflare Worker source or database migration scripts, so it cannot establish that the backend has passed a full security review. Before real student use, review:

- Worker authentication and server-side role checks for every endpoint.
- D1 schema, constraints, indexes and migration/backup process.
- Student account creation and bulk-import validation.
- Enquiry submission, spam prevention and admin follow-up workflow.
- Exam scheduling, secure attempt creation/submission, timers, scoring and audit logs.
- R2 upload limits, file type validation and private download authorization.
- Rate limiting, monitoring, error handling and recovery procedures.

Do not put real student data or conduct real exams until the backend security and exam workflows have been reviewed and tested.
