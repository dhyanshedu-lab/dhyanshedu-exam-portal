# Teacher and student dashboard integration

## Change committed
The portal frontend now detects the authenticated profile role and renders a separate teacher or student workspace instead of showing the Admin overview.

## Teacher and student dashboard
The role-specific page displays:
- Counts for batches, assignments, study materials and upcoming classes.
- A table of the user's batches.
- Assignments and student submission status/marks/feedback where available.
- Study material titles and file metadata.
- Scheduled/live class details and a safe external meeting link.

The top-bar label is role-specific. Admin navigation and the existing Admin dashboard remain available only to Admin accounts.

## API calls used
- `GET /api/workspace`
- `GET /api/my/batches`
- `GET /api/my/assignments`
- `GET /api/my/materials`
- `GET /api/my/live-classes`

The frontend obtains the Supabase access token through the existing `api()` helper. It does not accept a user ID from the browser for these requests.

## Limitations
- This is the first read-only workspace view. It does not yet provide teacher exam creation, question upload, assignment creation/evaluation, attendance marking, student answer submission, or result viewing.
- Materials currently show metadata only; secure R2 file-view/download routes are not yet implemented.
- The current Worker workspace queries use legacy batch assignments and enrollment. The effective-dated primary/substitute teacher assignment model is not wired in yet.
- Existing Admin page behavior has not been intentionally changed.
- Source changes have been committed to GitHub, but no browser end-to-end tests, live D1 query tests, or Cloudflare deployment have been performed.

## Verification required before deployment
1. Sign in with a test teacher account approved in D1; confirm only that teacher's batches and resources appear.
2. Sign in with a test student account approved in D1; confirm only that student's enrolled/published resources appear.
3. Confirm a pending/inactive account remains blocked.
4. Confirm Admin still sees the original Admin navigation and overview.
5. Verify the meeting URL points to the expected external meeting provider.
