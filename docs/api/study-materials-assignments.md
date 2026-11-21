# Study Materials and Assignments

## Storage architecture
- Supabase Auth is used only for authentication.
- D1 stores material, assignment, attachment and submission metadata.
- File bytes are stored in Cloudflare R2.
- The Worker expects an R2 bucket binding named `STUDY_FILES_BUCKET`.
- No R2 bucket binding was detected in the repository configuration during this code update. The binding must be created in Cloudflare before uploads/downloads can work.

## Cloudflare R2 setup required before deployment
1. Create or select a private R2 bucket for DhyanshEdu study files.
2. Open the deployed API Worker in Cloudflare Dashboard.
3. Open Settings → Bindings → Add binding → R2 bucket.
4. Set the variable name to `STUDY_FILES_BUCKET` and select the bucket.
5. Save and deploy the Worker only after reviewing the complete Worker changes and confirming the D1 migration is applied.
6. Keep the bucket private. Files are served through authenticated Worker endpoints, not public bucket URLs.

## Teacher workflow
- Upload a PDF, worksheet image, text file, DOCX, PPTX or XLSX to an active batch assigned to the teacher.
- Create and publish an assignment for an assigned active batch.
- Optionally attach a worksheet or question paper to the assignment.
- Review student submissions, download submitted files, award marks and leave feedback.

## Student workflow
- View study materials for active enrolled batches and download them through an authenticated endpoint.
- View published assignments and attached instructions/files.
- Submit typed answers and/or one completed file (PDF, image, TXT or DOCX, up to 12 MB).
- View submission status, awarded marks and teacher feedback in the workspace.

## API routes
- `POST /api/teacher/materials` — upload and assign a study material (multipart form).
- `GET /api/materials/{id}/download` — authenticated material download.
- `POST /api/teacher/assignments` — publish an assignment to an assigned batch.
- `POST /api/teacher/assignments/{id}/attachments` — upload assignment attachment.
- `GET /api/assignments/{id}/attachments/{attachment_id}/download` — authorized attachment download.
- `GET /api/student/assignments` — student's published assignments, own submission status and attachments.
- `POST /api/student/assignments/{id}/submit` — submit text and/or a file.
- `GET /api/teacher/assignments/{id}/submissions` — teacher review queue.
- `GET /api/submissions/{submission_id}/attachments/{attachment_id}/download` — teacher download of student work.
- `POST /api/teacher/submissions/{id}/grade` — save marks and feedback.

## Limits and safeguards
- Uploads are limited to 12 MB per file.
- MIME types are allow-listed; files are not made publicly accessible.
- Teacher upload and grading routes require an approved teacher account and an assignment to the selected batch.
- Student reads and submissions require active enrolment in the assignment batch.
- Student submission rows are unique per assignment/student. An evaluated submission cannot be overwritten through the student submit endpoint.
- Past-due submissions are retained with `late` status so the teacher can decide how to handle them.
- Soft-deleted materials are excluded from listing and download.

## Database prerequisites
The D1 schema must include `study_materials`, `assignments`, `assignment_attachments`, `assignment_submissions` and `submission_attachments` as defined in the reviewed Phase 1 schema. This code update does not execute SQL or alter the live database.

## Not included yet
- Multiple attachments per student submission in one submission request.
- Assignment resubmission after evaluation or teacher-requested revision workflow.
- Admin assignment moderation and bulk assignment reporting.
- Automated reminders, push notifications, plagiarism checks or antivirus scanning.
- R2 lifecycle policies and retention/backup automation.

## Release status
Code only. No Worker deployment, R2 binding configuration or D1 migration execution was performed in this change.
