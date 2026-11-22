# Cloudflare Worker source audit and QA candidate

This branch captures the three modules returned by Cloudflare's Worker content endpoint for `dhyanshedu-api` on 2026-11-22. At capture time, Worker version 26 was serving 100% of traffic.

## Changes in this isolated branch
- Replaced the double-escaped leave date pattern with strict ISO calendar-date validation. Impossible dates such as 2026-02-29 and 2026-11-31 are rejected.
- Added a shared substitute-coverage SQL predicate and applied it to teacher workspace batch, assignment, material, live-class, exam, evaluation, grading, publishing and attachment access.
- Applied explicit precedence: active batch-level coverage overrides class/subject coverage for that batch.
- Preserved the primary teacher's original batch assignment validation during leave approval.

## Validation completed
- 11 leave-date assertions passed locally.
- D1 QA query confirmed batch coverage wins over overlapping class/subject coverage; the class-level substitute is denied when a batch override exists and regains access when that override is inactive.
- Cloudflare accepted the patched modules as Worker version 27, confirming source compilation and binding inheritance.

## Not deployed
Version 27 is uploaded as a non-deployed candidate only. The active production deployment remains version 26 at 100%. No production login configuration or existing records were changed by this source patch.

## Remaining validation
- Authenticated end-to-end tests through a protected preview URL are still outstanding. Preview URLs are disabled for the API Worker, and this branch has not enabled a public preview.
- Review the remaining teacher question-bank ownership model and leave-approval completeness before promoting the candidate.
