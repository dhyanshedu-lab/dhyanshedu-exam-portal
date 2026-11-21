# Teacher Evaluation Centre

## What this increment adds
The teacher workspace now includes an Evaluation Centre to review submitted exam attempts, award marks for numerical and written answers, leave per-question feedback, and publish results.

## Teacher API
All routes require a valid Supabase bearer token and an approved active D1 teacher account.

- `GET /api/teacher/evaluations`: lists submitted/evaluated attempts for exams created by the teacher or assigned to the teacher through `batch_teachers`.
- `GET /api/teacher/evaluations/{attempt_id}`: returns attempt details, student responses, per-question marks, feedback and (for the authorised teacher only) correct-option indicators.
- `POST /api/teacher/evaluations/{attempt_id}/grade`: accepts a grade for every numerical, short-answer and long-answer question. Marks must be between zero and the question's maximum. It stores feedback and recalculates the total score and percentage, then marks the attempt evaluated.
- `POST /api/teacher/evaluations/{attempt_id}/publish`: publishes an evaluated result by setting `results.published_at`.

## Database change required
The existing Phase 1 schema does not include per-question teacher feedback in `student_answers`. Migration `0002_student_answer_teacher_feedback.sql` adds the nullable `teacher_feedback` column.

**Important:** this migration is committed to GitHub but has NOT been applied to Cloudflare D1. The evaluation detail and grading endpoints reference that column and therefore must not be deployed until migration 0002 is reviewed, backed up and applied to the correct D1 database. No live D1 change has been made.

## Evaluation behaviour
- MCQ and multiple-select responses are scored at student submission time.
- Numerical, short-answer and long-answer responses require teacher review.
- The teacher must grade every manual-review question before completing evaluation.
- The system adds manual marks to the existing objective score and calculates the percentage against the exam's configured total marks.
- The result remains hidden from the student until a teacher publishes it (unless the exam's existing immediate-result setting already published an entirely auto-scored result).
- Teachers can only see and grade attempts for exams they created or batches currently assigned to them.
- Per-question feedback is stored for the student to see with their published result; a student-facing detailed result/feedback page is still a separate UI task.

## Known limitations
- No bulk evaluation, rubric templates, annotation tools or audit log of grade revisions yet.
- Regrading an already evaluated attempt is allowed for the authorised teacher; the current schema does not preserve each previous grade version.
- No automated runtime tests against Cloudflare D1 have been performed.
- The frontend and Worker source are committed to GitHub only; nothing is deployed.

## Pre-deployment checks
1. Review migration 0002 and confirm the target database is the intended D1 database.
2. Back up D1 before applying migration 0002.
3. Verify an assigned teacher can see only their batch's submissions.
4. Verify an unrelated teacher cannot read or grade an attempt.
5. Verify MCQ/multiple-select marks remain unchanged when manual answers are graded.
6. Verify all manual questions must be graded and marks cannot exceed the maximum.
7. Verify feedback and marks are visible to the student only after result publication.
8. Verify Admin dashboard behaviour remains unchanged.
