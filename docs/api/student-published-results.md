# Student Published Results

## Student experience
The Student Exam Centre now provides a **View result** action when a result has been published. The result page shows:
- Exam name, submitted and published timestamps.
- Marks obtained, maximum marks and percentage.
- Pass-mark comparison when pass marks are configured.
- Question-wise maximum and awarded marks.
- Student's submitted text answer or selected options.
- Correct MCQ/multiple-select options after publication.
- Teacher feedback saved against a question.

A result is not exposed through this endpoint unless `results.published_at` is set and the authenticated student owns the attempt.

## API
`GET /api/student/results/{attempt_id}`

Requires a valid Supabase bearer token and an approved active student account. The query is scoped to the authenticated student and the attempt must have a published result. Historical access is retained for the student while the batch enrolment record exists, even if that enrolment is no longer active.

Response includes `result` and ordered `questions`. Each question includes the question text/type, maximum marks, submitted answer, selected option IDs, correctness, awarded marks, teacher feedback, and options with correct-answer indicators. These answer-key fields are only returned after publication.

## Important deployment dependency
Per-question teacher feedback requires migration `0002_student_answer_teacher_feedback.sql`. It is committed but has not been applied to D1. Do not deploy the Worker evaluation routes until the migration has been reviewed, the target D1 database backed up, and the migration safely applied.

## Not yet included
- Downloadable/printable report card.
- Topic-wise performance analytics and recommendations.
- Student result history independent of the exam list.
- Admin result approval/override and grade revision audit trail.
- Runtime integration tests against Cloudflare D1.

## Verification status
Source changes are committed to GitHub. No Cloudflare Worker deployment, D1 migration, or live student-account test has been performed.
