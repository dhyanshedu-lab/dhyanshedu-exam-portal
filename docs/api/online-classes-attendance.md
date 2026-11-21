# Online Classes and Attendance

## Scope
This release uses the existing `live_classes` and `live_class_attendance` D1 tables. It does not add a migration or store meeting recordings. Meeting URLs point to an external provider such as Google Meet or Jitsi.

## Admin
- Schedule a class for an active batch and an approved teacher.
- The teacher must already be assigned to the batch through `batch_teachers`.
- The schedule stores title, description, batch, teacher, class/subject metadata, provider, meeting URL, start/end time and status.
- Review enrolled-student attendance for each class.
- The Admin list displays enrolled, marked and present/late counts.

## Teacher
- View classes assigned to the signed-in teacher.
- Change class status to scheduled, live, completed or cancelled.
- Open the roster for an assigned class and mark each active batch student as present, late, absent or excused.
- Attendance records identify the teacher who marked it in `marked_by`.
- Re-saving a student's attendance updates the existing row rather than creating a duplicate.

## Student
- View classes for batches in which the student has an active enrolment.
- Open the meeting URL from their own workspace.
- Students cannot read other batch rosters or mark attendance.

## API
- `GET /api/admin/live-classes` — Admin class list and scheduling dropdown data.
- `POST /api/admin/live-classes` — Admin schedules a class.
- `GET /api/admin/live-classes/{id}/attendance` — Admin attendance review.
- `GET /api/my/live-classes` — role-scoped teacher/student schedule.
- `GET /api/teacher/live-classes/{id}/attendance` — assigned teacher roster.
- `POST /api/teacher/live-classes/{id}/attendance` — assigned teacher marks attendance.
- `PATCH /api/teacher/live-classes/{id}/status` — assigned teacher updates class status.

## Validation and access controls
- All APIs require a valid Supabase-authenticated user and an approved, non-deleted D1 profile.
- Admin scheduling and review routes are behind the existing Admin authorization gate.
- Teacher actions require the class's `teacher_id` to match the signed-in teacher.
- Student schedule queries are scoped to active batch enrolments.
- Meeting URLs must use HTTP or HTTPS; start time must precede end time.
- Attendance status is limited to `present`, `late`, `absent`, or `excused`.

## Deliberate limitations / next design review
- Substitute-teacher coverage with effective dates, reason, notifications and reversion is not implemented here. The current `live_classes.teacher_id` field is a single teacher assignment and does not model temporary cover.
- Automatic join/leave tracking, meeting-provider webhooks, timetable conflict detection, recurring schedules, cancellation notifications and class rescheduling history are not included.
- Teacher scheduling is Admin-controlled in this release.
- The code has not been deployed and the live D1 database has not been changed. Validate the Worker against a backed-up test database before production release.
