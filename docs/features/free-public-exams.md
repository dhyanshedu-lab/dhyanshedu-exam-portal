# Free public examinations

Status: approved product scope; implementation in progress.

## Goal

Add a public **Free Online Exams** experience to the existing `dhyanshedu.com` website. It must use the existing DhyanshEdu exam question bank and exam engine where safe, while keeping public attempts separate from enrolled-student attempts.

This is an addition to the existing public website and portal. It is not a replacement site or a separate application.

## Student journey

1. Student opens the Free Online Exams page on the public website.
2. Student browses only exams explicitly published for public access.
3. Before starting, student provides name, mobile number and class; email and parent name are optional. A clear privacy notice must be accepted. Marketing consent is separate and unchecked by default.
4. Student receives a one-time attempt token and begins a timed exam.
5. Questions, options and media are delivered without correct-answer flags or explanations.
6. Answers are saved server-side. The server enforces the deadline and attempt limit.
7. Objective-only exams can show an instant score and explanations. Exams containing numerical/descriptive questions that need manual marking remain pending until a teacher/admin evaluates them.
8. Student can view only the result belonging to their valid attempt token.

No public route may expose unpublished exams, private batch exams, answer keys, other students' attempts, or admin/teacher data.

## Admin and teacher workflow

- Teacher continues to create questions and exams using the existing question bank and authoring workflow.
- Admin explicitly publishes an eligible exam to the public catalogue, assigns a stable public slug, chooses the attempt limit and result mode, and can unpublish/archive it.
- Public publication is independent from the exam's batch enrolment visibility. Publishing publicly must not enroll a guest into a batch or expose the exam through unrelated student workspaces.
- Admin can review public registrations and attempts and evaluate descriptive answers in the first release. Teacher-scoped public-attempt evaluation is a follow-on enhancement; the first release does not expose guest personal details in teacher workspaces.
- Unpublishing prevents new registrations/attempts. Existing in-progress attempts may finish until their server-side deadline unless an admin explicitly closes them.

## Data model

- `public_exam_publications`: explicit allow-list of public exams, slug, publication state, date window, attempt limit and result mode.
- `public_assessment_registrations`: minimal guest identity, class, privacy-notice version and consent timestamp; marketing consent remains separate.
- `public_assessment_attempts`: independent guest attempt, attempt number, hashed access token, server-side expiry, score and status. It does not require a Supabase user or an `exam_attempts.student_id` row.
- `public_assessment_answers`: answer rows keyed to the public attempt and existing exam-question IDs, with optional evaluator feedback.

This separation is deliberate: the existing `exam_attempts` table requires a registered D1 student user, so anonymous public attempts must not be forced into that table or represented as fake student accounts.

## API contract

Public, origin-checked routes (no Supabase login):
- `GET /api/public/exams` — safe catalogue fields only.
- `GET /api/public/exams/:slug` — public instructions and exam metadata only.
- `POST /api/public/exams/:slug/register` — validate consent and guest details, enforce publication window/attempt limit, create registration and attempt, return a one-time raw token (store only its SHA-256 hash).
- `GET /api/public/attempts/:id` — return questions/options and saved answers only after validating the attempt token.
- `POST /api/public/attempts/:id/answers` — validate token, ownership, question membership and server-side deadline before saving.
- `POST /api/public/attempts/:id/submit` — server-side scoring and immutable submission.
- `GET /api/public/attempts/:id/result` — reveal answers, correct options and explanations only when the configured result policy allows it.

Admin-only routes must manage publication and review using the existing approved Admin authorization gate. Never trust a client-supplied role, score, deadline or attempt number.

## Security and privacy requirements

- Store only a hash of the random attempt token; never store or log the raw token.
- Use cryptographically random tokens, strict attempt ownership checks, expiry checks and server-side time enforcement.
- Do not return `is_correct`, correct option IDs, marks-awarded values or explanations before results are eligible for release.
- Validate every selected option against the exact exam question.
- Enforce attempt limits in D1 transactions/batches, not only in browser code.
- Keep guest attempts separate from registered student accounts and batch enrolments.
- Require explicit privacy-notice acceptance; marketing consent is optional and separate.
- Add Cloudflare Turnstile and/or an effective rate-limit control before public launch to reduce automated abuse.
- Confirm the privacy notice against the published privacy policy, define guest-record retention/deletion rules, and document who can access guest contact details.
- Use parameterized SQL, bounded request sizes and strict CORS origin allow-listing.
- Audit publish/unpublish, evaluation and result release actions.

## Implementation sequence

1. Review and validate the schema changes against the captured D1 baseline and a disposable SQLite fixture. Do not apply to production D1.
2. Implement and test the public Worker API, including token validation, attempt limits, deadlines, scoring and result gating.
3. Build the responsive public Free Online Exams page and timed exam/result screens in the existing public-site repository.
4. Add Admin publication controls and public-attempt monitoring to the existing portal.
5. Run end-to-end tests for guest registration, expired tokens, repeat attempts, unpublished exams, answer-key leakage, timer expiry, manual marking and result visibility.
6. Deploy to a development environment first. Production deployment and any D1 migration require separate review and explicit approval.

## Current known constraints

- The existing portal Worker source in GitHub and the currently deployed Cloudflare Worker must be reconciled before changing/deploying API code.
- The consolidated migration has not been approved for production execution. The new schema is a draft until tested against the actual D1 schema.
- Do not place real student/guest personal data in test fixtures or commit secrets.
