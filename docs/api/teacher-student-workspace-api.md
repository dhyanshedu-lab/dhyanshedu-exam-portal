# Teacher and student workspace API — implementation note

## Change committed
The Cloudflare Worker now has authenticated, read-only role-specific endpoints for approved teacher and student accounts. These routes are inserted after authentication and before the Admin-only API gate.

## Endpoints
- `GET /api/workspace` — role and counts for assigned batches, published assignments, learning materials and upcoming/live classes.
- `GET /api/my/batches` — teacher-assigned batches or student's active enrolled batches.
- `GET /api/my/assignments` — teacher's authored/assigned work or published work visible to the signed-in student, including that student's submission status and feedback.
- `GET /api/my/materials` — teacher's own uploads or student-visible materials.
- `GET /api/my/live-classes` — teacher's scheduled/live classes or classes assigned to the signed-in student's enrolled batches/class.

## Access control
- Requires a valid Supabase bearer token.
- Requires an approved, active D1 user record.
- Every query is scoped to the authenticated user's ID through D1 joins/filters.
- Teacher/student routes are read-only.
- Admin routes remain behind the existing Admin role check.
- No R2 object keys are returned by these list endpoints.

## Boundaries and follow-up
- This adds API capability only; the current frontend still needs teacher/student workspace screens and must call these endpoints.
- It uses existing legacy `batch_teachers`, `batch_students`, `assignments`, `study_materials` and `live_classes` tables. It does not yet use the proposed effective-dated primary/substitute assignment tables from migration 0001.
- Teacher class-level assignments without a matching batch are not automatically expanded to all class students for every resource. That mapping needs a deliberate rule.
- The student-visible material rule currently honors `visibility='all_students'` globally, or active batch enrollment for batch-scoped materials.
- These endpoints have not been executed against live D1 or deployed to Cloudflare. SQL/runtime tests and frontend integration remain required.

## Safe verification checklist
1. Test unauthenticated requests return 401.
2. Test pending/inactive users return 403.
3. Test a teacher sees only their assigned/authored records.
4. Test a student sees only their enrolled/published records.
5. Test one teacher/student cannot retrieve another user's records by changing request parameters (the routes accept no user ID parameter).
6. Test query behavior against the exact D1 schema in a disposable database.
7. Deploy only after review and explicit approval.
