# Cloudflare Worker source audit snapshot

This branch captures the three modules returned by Cloudflare's Worker content endpoint for `dhyanshedu-api` on 2026-11-22. The active deployment metadata at capture time identified Worker version 26 as serving 100% of traffic.

These files are an audit snapshot only. They are not wired into the portal's existing deployment pipeline and must not be deployed automatically.

## Patch in this branch
- Corrected the double-escaped YYYY-MM-DD leave-date pattern in `study.js`, using strict calendar-date validation.

## Remaining coverage work
- Substitute coverage is not consistently included in teacher workspace, materials, assignments, exam/evaluation and attachment authorization.
- Batch-level coverage must take precedence over class/subject coverage when both are active.
- End-to-end authenticated API tests still need a safe isolated preview environment.

No production Worker deployment or authentication change is performed by this branch.
