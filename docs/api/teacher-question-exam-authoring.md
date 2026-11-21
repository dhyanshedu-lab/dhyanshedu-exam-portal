# Teacher question bank and exam builder

## Scope
This increment adds the first teacher authoring workflow using the existing D1 tables from the Phase 1 schema:
- `questions`
- `question_options`
- `exams`
- `exam_questions`
- `batch_teachers`
- `teacher_assignments`

No migration or D1 schema change is required for these endpoints.

## Teacher API
All routes require a valid Supabase bearer token and an approved, active D1 user with role `teacher`.

### Question bank
- `GET /api/teacher/questions` — returns only active questions created by the signed-in teacher.
- `POST /api/teacher/questions` — creates a question and its options in a D1 batch.

Supported types: `mcq`, `multiple_select`, `numerical`, `short_answer`, `long_answer`.
MCQ requires 2–8 options and exactly one correct answer. Multiple-select requires 2–8 options and at least one correct answer. Other types do not accept options.
Question creation is limited to a subject/class for which the teacher has a current row in `teacher_assignments` or a teacher assignment through `batch_teachers`.

### Exams
- `GET /api/teacher/exams` — returns exams created by the signed-in teacher.
- `POST /api/teacher/exams` — creates an exam for an active batch assigned to the teacher and attaches selected questions from that teacher's question bank.
- `POST /api/teacher/exams/{id}/publish` — publishes the teacher's own exam; future start dates retain `scheduled` status, otherwise status becomes `published`.

The exam batch is authoritative for class and subject. Selected questions must match the batch class and subject, or have those fields unset. Total marks are calculated from the selected questions' default marks. Negative marking is currently zero for all attached questions.

## Frontend
The Teacher workspace now includes:
- Question creation form with options and correct-answer labels for MCQ/multiple-select.
- Teacher's question list.
- Exam builder with assigned-batch selection, duration, optional pass marks and schedule, and multi-question selection.
- Teacher's exam list and Publish action.

Student accounts do not see teacher authoring controls.

## Explicit limitations / next implementation
- This increment does not yet create student exam-taking endpoints or a student exam attempt UI. Publishing an exam does not yet make it attemptable from the student portal.
- It does not yet support negative marks per exam question, random question selection, attempt limits, auto-submit, autosave, or descriptive-answer evaluation.
- Teachers cannot yet edit/archive questions or edit/delete exams after creation.
- There is no image/diagram attachment UI for questions; R2 question media is a later increment.
- No live D1 integration test or Cloudflare deployment has been performed. The source has been committed to GitHub only.

## Pre-deployment test cases
1. Approved teacher with an assigned batch can create a question for that batch's subject/class.
2. Teacher cannot create a question for an unassigned subject/class.
3. MCQ rejects fewer than two options or anything other than exactly one correct option.
4. Multiple-select rejects missing correct options.
5. Teacher cannot build an exam for a batch not assigned to them.
6. Exam creation rejects questions owned by another teacher or questions for a different class/subject.
7. Publish action only changes an exam owned by the signed-in teacher.
8. Student and Admin roles cannot call teacher authoring routes.
9. Admin dashboard and existing Admin endpoints continue to work.
