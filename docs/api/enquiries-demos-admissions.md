# Enquiries, demo bookings and admissions

This module is source-only until the Worker is deployed and the existing D1 schema is confirmed. It uses the tables already defined in `migrations/0001_dhyanshedu_consolidated.sql`: `enquiries`, `enquiry_activities`, `demo_bookings`, `student_admissions`, and `student_admission_history`.

## Public enquiry intake

- `POST /api/public/enquiries` — no login required.
- Required: `student_name`, `phone`, and `privacy_accepted: true`.
- Optional: `parent_name`, `email`, `class_label`, `curriculum_id`, `exam_pathway_id`, `subject_id`, `learning_mode` (`group` or `one_to_one`), `message`, `privacy_notice_version`, `marketing_consent`.
- Marketing consent is separate and defaults to false.
- A honeypot field named `website` is accepted for basic bot filtering.
- CORS allows the existing public website origins. Add any future custom origin explicitly.

Example body:

```json
{
  "student_name": "Student name",
  "parent_name": "Parent name",
  "phone": "+91 9000000000",
  "email": "parent@example.com",
  "class_label": "Class 10",
  "learning_mode": "group",
  "message": "Interested in a free demo",
  "privacy_accepted": true,
  "privacy_notice_version": "website-v1",
  "marketing_consent": false
}
```

## Admin enquiry workflow

All routes below require a signed-in, approved Admin account.

- `GET /api/admin/enquiries?status=new&q=...` — list up to 300 matching enquiries.
- `GET /api/admin/enquiries/:id` — enquiry and activity history.
- `PATCH /api/admin/enquiries/:id` — update `status`, `assigned_to`, and/or `next_follow_up_at`.
- `POST /api/admin/enquiries/:id/activities` — add call, email, WhatsApp, note or follow-up activity.

Statuses: `new`, `contacted`, `interested`, `follow_up_required`, `converted`, `not_interested`, `closed`.

Follow-up owner must be an active approved Admin or Teacher. Every status/owner/follow-up change is recorded in `enquiry_activities`.

## Demo workflow

- `GET /api/admin/demos` — list demo bookings.
- `POST /api/admin/demos` — create a demo request, optionally linked to an enquiry.
- `PATCH /api/admin/demos/:id` — set status, approved teacher, confirmed start/end, meeting URL and notes.

Statuses: `requested`, `pending_confirmation`, `confirmed`, `rescheduled`, `completed`, `cancelled`, `no_show`.

The API does not check teacher calendar conflicts or send notifications yet. Admin must check availability before confirming a time.

## Admission workflow

- `GET /api/admin/admissions` — list recent admissions.
- `POST /api/admin/admissions` — create an admission for an existing approved student account.

Admission creation stores admission number/date, curriculum/pathway, class, subject, learning mode and agreed fee amount. It creates an initial admission-history entry. If linked to an enquiry, that enquiry is marked converted.

This endpoint does not create the student Auth account. Use the existing Admin student invitation process first.

## Current limits / next work

- Admin Enquiries & Demos UI is included in this branch.
- Public website enquiry form is wired in the separate `dhyanshedu-site` feature branch; the Worker endpoint is not deployed yet.
- Demo scheduling does not check availability, trigger teacher/student notifications, or collect demo feedback yet.
- Admin admission list/create UI is included in this branch. It requires an existing approved student account; it does not create the Auth account or edit/withdraw an admission yet.
- No Cloudflare Worker deployment, D1 migration, or production data changes have been made.
- Before deployment, test the public insert and every admin route against a reviewed copy of the D1 schema, then configure rate limiting / abuse protection for public intake.
