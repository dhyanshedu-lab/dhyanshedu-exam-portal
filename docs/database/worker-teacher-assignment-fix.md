# Worker correction plan — teacher assignment ID

## Verified mismatch
The existing D1 schema defines `teacher_assignments.id` as an integer auto-generated primary key. The supplied Worker source currently does this:

```js
const id=crypto.randomUUID();
try {
  await env.DB.prepare("INSERT INTO teacher_assignments(id,teacher_id,class_id,subject_id) VALUES(?,?,?,?)")
    .bind(id,t.id,b.class_id,b.subject_id).run();
} catch {
  return reply({error:"This teacher may already be assigned to this class and subject"},409,request);
}
return reply({success:true,id},201,request);
```

That is incompatible with the existing integer primary key. The Worker should let SQLite generate the ID.

## Corrected handler fragment

Replace only the POST handler body for `/api/teacher-assignments` with:

```js
if (path === "/api/teacher-assignments" && method === "POST") {
  const b = await body(request);

  const t = await env.DB.prepare(
    "SELECT id FROM users WHERE id=? AND role='teacher' AND status='approved' AND deleted_at IS NULL"
  ).bind(b.teacher_id || "").first();

  if (!t || !b.class_id || !b.subject_id) {
    return reply({error:"Select an approved teacher, class and subject"},400,request);
  }

  try {
    const result = await env.DB.prepare(
      "INSERT INTO teacher_assignments(teacher_id,class_id,subject_id) VALUES(?,?,?)"
    ).bind(t.id, Number(b.class_id), Number(b.subject_id)).run();

    return reply({success:true,id:result.meta?.last_row_id},201,request);
  } catch (e) {
    // A uniqueness conflict means this assignment already exists.
    return reply({error:"This teacher may already be assigned to this class and subject"},409,request);
  }
}
```

The `Number()` conversions match the integer class/subject IDs in the existing schema. SQLite remains responsible for generating the integer assignment ID.

## Important: do not deploy this fragment alone
- The complete Worker source is not currently present in the GitHub repository root; the repository currently contains the portal frontend files. The Worker source reviewed so far was supplied separately.
- This document is a proposed code correction, not a committed Worker deployment.
- Before changing the deployed Worker, place the complete current Worker source under version control (for example, `worker/src/index.js`) and review the exact current deployed version. Do not replace the Worker with a partial file.
- Test this handler against a disposable copy of the D1 schema, including: valid assignment, duplicate assignment, unknown teacher, inactive teacher, invalid class/subject IDs.
- This correction addresses the integer-ID mismatch only. It does not yet implement the new effective-dated primary/substitute assignment model.

## Related design decision still required
The legacy `teacher_assignments` and `batch_teachers` tables must remain intact. The new period-based assignment tables should become the source for effective-dated assignments only after a deliberate backfill/mapping plan is approved. In particular, the existing two `batch_teachers` rows need to be reviewed and mapped without losing assignment history.
