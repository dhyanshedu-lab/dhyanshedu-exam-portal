# Student Exam Centre API

These endpoints use the existing D1 tables `exams`, `exam_questions`, `questions`, `question_options`, `exam_attempts`, `student_answers`, `results`, `batches`, and `batch_students`. No migration is required for this increment.

All endpoints require a valid Supabase bearer token and an approved, active D1 student account.

## Endpoints
- `GET /api/student/exams`: lists exams assigned through the student's active batch enrolments. It returns exam schedule, attempt status, and only results whose `published_at` is set.
- `POST /api/student/exams/{exam_id}/start`: checks active batch enrolment, published/scheduled state and exam window; creates or resumes the single permitted attempt. Returns question text and options but never correct-answer flags.
- `GET /api/student/attempts/{attempt_id}`: returns the authenticated student's attempt and saved answers, without answer keys.
- `POST /api/student/attempts/{attempt_id}/answers`: saves one answer; verifies that the question and selected options belong to the attempt's exam and that the attempt is still open.
- `POST /api/student/attempts/{attempt_id}/submit`: submits the attempt and scores MCQ/multiple-select server-side. Numerical and written responses remain pending teacher evaluation because the current question schema has no dedicated numerical answer-key field.

## Frontend
The Student workspace now includes an Exam Centre showing available/upcoming/submitted exams, attempt status and published scores. Starting an exam renders all questions, allows saving responses, shows a countdown and submits when time expires or the student chooses Submit exam.

## Important behaviour and limitations
- One attempt per student per exam is enforced by the existing `UNIQUE(exam_id, student_id)` constraint.
- The timer is bounded by both the configured duration and exam end time.
- MCQ and multiple-select correctness is evaluated on the server; answer keys are not returned to the browser.
- Numerical, short-answer and long-answer questions require teacher evaluation. There is not yet a teacher evaluation/publish-results screen, so those results remain unpublished until that workflow is implemented.
- The existing `show_results_immediately` setting controls immediate publication for fully auto-scored exams.
- No retakes, autosave-on-every-keystroke, offline mode, negative-mark configuration UI, proctoring, or manual-evaluation workflow is included yet.
- No live D1 integration test or Cloudflare deployment has been performed.

## Pre-deployment test cases
1. A student can see only exams linked to batches where their enrolment is active.
2. A student outside the batch cannot start an exam or read another student's attempt.
3. A future exam cannot be started early; an expired/closed exam cannot be started.
4. Correct-answer flags and explanation/key fields are never returned by student question APIs.
5. Invalid question IDs or option IDs are rejected when saving answers.
6. An attempt cannot be changed after submission.
7. MCQ and multiple-select are scored correctly, including negative marks if present.
8. Numerical and written answers are marked pending teacher evaluation and are not published.
9. Timer expiry triggers submission and a second attempt is rejected.
10. Teacher and Admin routes remain protected by their own role checks.
