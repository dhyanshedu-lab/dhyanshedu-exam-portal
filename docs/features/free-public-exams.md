# Free public examinations

Status: development implementation; production launch pending separate review.

## Goal
Add a public Free Online Exams experience to the existing DhyanshEdu website and use the existing exam question bank without creating student portal accounts.

## Student journey
1. Student browses exams explicitly published by Admin.
2. Before starting, student provides student name, mobile number and class; parent/guardian name and email are optional.
3. Student accepts the privacy notice. Optional marketing consent is separate and unchecked by default.
4. Student completes a timed, objective multiple-choice exam. Answers remain in browser memory only.
5. On Submit (or timer expiry), the browser sends the selected options once to the Worker for scoring.
6. Worker validates and scores the submission, stores only the final score/percentage and submission timestamp, and immediately returns the score, correct answers and explanations.
7. The Worker does not insert, update, log or otherwise persist the selected options or answer text. There is no autosave, resume, answer-sheet retrieval, manual grading or delayed result release.

Refreshing or leaving the page before submission ends the in-browser attempt; the student must start a new allowed attempt. The attempt token exists only in page memory and its hash is stored for server-side authorization.

## Admin workflow
- Admin publishes/unpublishes eligible exams with a public slug, attempt limit and optional availability window.
- Only exams containing MCQ/multiple-select questions with at least one correct option per question can be published, because the public experience must show immediate results.
- Admin sees student contact details, class, exam, attempt status and final score in the Free Public Exams page.
- Student contact details and score are retained for enquiry follow-up. The Admin view does not expose submitted answers because they are not stored.
- Existing enquiry records and normal website enquiries remain separate and unchanged.

## Data model
- `public_exam_publications`: public allow-list, slug, status, date window and attempt limit.
- `public_assessment_registrations`: student/guardian contact details, class and privacy/marketing consent.
- `public_assessment_attempts`: attempt metadata, hashed in-session token, timestamps and final score only.
- `public_assessment_rate_limits`: hashed-IP request counters.
- There is deliberately no `public_assessment_answers` table.

## API contract
Public origin-checked routes:
- `GET /api/public/exams`: safe public catalogue fields.
- `POST /api/public/exams/:slug/register`: validate contact details and consent, create enquiry registration and attempt metadata, return one-time in-memory token.
- `GET /api/public/attempts/:id`: validate token and return questions/options without correct-answer flags.
- `POST /api/public/attempts/:id/submit`: accept the answer payload once, validate every question/option, score server-side, persist only final score and return result/answer key immediately.
- `GET /api/public/attempts/:id/result`: allow a result retry after a completed submission using the in-memory attempt token; it returns the stored score and answer key, never the student's selected options.

Admin-only routes:
- `GET /api/admin/public-exams`: publication controls and exam catalogue.
- `PATCH /api/admin/public-exams/:examId`: publish, update or unpublish.
- `GET /api/admin/public-attempts`: enquiry/contact details and final score only.

## Privacy and security
- Store a SHA-256 hash of the random attempt token; never persist the raw token.
- No selected options, written answers, per-question responses or answer-sheet rows are persisted.
- Answers are transmitted once over HTTPS for scoring; request bodies must not be logged.
- Server validates the token, deadline, question IDs, option ownership, attempt limit and publication status.
- Public routes require an allow-listed Origin and use per-IP hashed rate limits. Add Cloudflare Turnstile before public launch.
- Require privacy-notice acceptance; marketing consent is optional.
- Confirm published privacy-policy wording, access controls and retention/deletion rules for enquiry details and final scores before launch.

## Validation and deployment sequence
1. Validate the DDL on disposable SQLite and review against the actual D1 baseline.
2. Run API/browser end-to-end tests in a separate development Worker/D1 environment.
3. Confirm no answer values are present in D1 after submission and Admin reporting shows only contact details and final score.
4. Add Turnstile and verify privacy/retention language.
5. Deploy Worker and public website together only after successful development validation and separate production approval.

## Production safety
The current work remains in draft development branches. No production Worker, Pages deployment or D1 migration has been performed. Back up and review the live D1 database before any approved schema change.
