# Admin Examination Monitoring Dashboard

## Admin-only endpoint
`GET /api/admin/exam-monitoring`

The route is placed after the Worker Admin authorization check. Teachers and students cannot call it successfully.

## Summary metrics
- Total exams.
- Published exams.
- Scheduled exams.
- Total student attempts.
- Attempts currently in progress.
- Attempts submitted and awaiting teacher evaluation.
- Evaluated attempts.
- Results published to students.
- Average percentage across published results.

## Exam-level monitoring
The response includes up to 250 most recently created exams, with:
- Exam title and status.
- Teacher who created the exam.
- Batch, class and subject.
- Active batch enrolment count.
- Total attempts.
- In-progress, pending-evaluation and evaluated attempt counts.
- Published result count.
- Average percentage across published results.

The frontend adds an Admin-only **Exam monitoring** navigation item, summary cards, exam table, status filter, text search and manual refresh.

## Metric definitions and caveats
- Enrolled students counts current active `batch_students` records, not historical enrolments.
- Attempts count rows in `exam_attempts`; an attempt is considered in progress/submitted/evaluated according to its current status.
- Pending evaluation counts attempts with status `submitted`. This is the workflow status used by the current online exam evaluation process.
- Published results counts `results` rows where `published_at` is not null.
- Average score is the arithmetic average of published result percentages; it is not weighted by student count across exams.
- Exam-level listing is limited to the 250 most recently created records. Summary totals are not limited to those 250.
- The dashboard is read-only. It does not change exam status, grades or publication state.

## Verification and deployment
The Worker, frontend and HTML changes are committed to GitHub. No Cloudflare Worker deployment or live D1 test has been performed. Before deployment, verify the endpoint with an Admin account and confirm that a teacher/student bearer token receives an authorization denial.
