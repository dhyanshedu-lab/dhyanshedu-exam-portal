import { handleStudyRequest, teacherCoveragePredicate } from "./study.js";
import { handleFeeRequest } from "./fees.js";
// DhyanshEdu Cloudflare Worker — consolidated working source
// Transcribed from the Worker source supplied for the DhyanshEdu review.
// Based on the Worker source supplied for this project; deployed version has not been independently diffed.
// Reviewed syntax after removing pasted-document escaping; do not deploy without
// environment binding review, API tests, and approval.

const ALLOWED_ORIGINS = ["https://dhyanshedu-lab.github.io","https://dhyanshedu-exam-portal.dhyanshedu.workers.dev","https://dhyanshedu-exam-portal.pages.dev","https://dhyanshedu.com","https://www.dhyanshedu.com"];



function corsHeaders(request) {

 const origin = request.headers.get("Origin") || "";

 const h = {

   "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",

   "Access-Control-Allow-Headers": "Content-Type, Authorization",

   "Vary": "Origin"

 };

 if (ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;

 return h;

}

function reply(data, status, request) {

 return new Response(JSON.stringify(data), {

   status: status || 200,

   headers: { ...corsHeaders(request), "Content-Type": "application/json" }

 });

}

async function body(request) {

 const raw = await request.text();

 if (raw.length > 20000) throw new Error("Request too large");

 try { return JSON.parse(raw || "{}"); } catch { throw new Error("Invalid JSON"); }

}

async function authUser(request, env) {

 const authorization = request.headers.get("Authorization") || "";

 if (!authorization.startsWith("Bearer ")) return null;

 const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {

   headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: authorization }

 });

 return r.ok ? r.json() : null;

}

async function adminUser(id, env) {

 return env.DB.prepare(

   "SELECT id,full_name,email,role,status FROM users WHERE id=? AND role='admin' AND status='approved' AND deleted_at IS NULL"

 ).bind(id).first();

}

const text = (v, max=160) => String(v ?? "").trim().slice(0,max);

async function invite(email, name, role, env) {
  const r = await fetch(env.SUPABASE_URL + "/auth/v1/admin/generate_link", {
    method: "POST",
    headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: "Bearer " + env.SUPABASE_SECRET_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "invite", email, data: { full_name: name, role } })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.msg || d.message || d.error_description || "Invitation link could not be generated.");
  const id = d.user?.id || d.id;
  const actionUrl = d.action_link || d.properties?.action_link;
  if (!id || !actionUrl) { if (id) await rollbackInvite(id, env); throw new Error("Supabase did not return a valid invitation link."); }
  return { id, actionUrl };
}

async function rollbackInvite(id, env) {
  try {
    await fetch(env.SUPABASE_URL + "/auth/v1/admin/users/" + id, { method: "DELETE", headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: "Bearer " + env.SUPABASE_SECRET_KEY } });
  } catch (e) { console.error("Supabase invitation rollback failed:", e); }
}

async function sendInviteEmail(email, name, role, actionUrl, authUserId, eventKey, env) {
  if (!env.RESEND_API_KEY) throw new Error("Resend email service is not configured.");
  const teacher = role === "teacher";
  const templateId = teacher ? "53c4f25c-47b3-4138-81ea-55b88da87f98" : "3706e568-c7b0-4080-9358-fc0c24f4d6df";
  const variables = teacher ? { TEACHER_NAME: name, ACTION_URL: actionUrl, REGISTERED_EMAIL: email } : { STUDENT_NAME: name, ACTION_URL: actionUrl, REGISTERED_EMAIL: email };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json", "Idempotency-Key": "dhyanshedu-invite-" + authUserId + "-" + eventKey },
    body: JSON.stringify({ from: "DhyanshEdu <noreply@dhyanshedu.com>", to: [email], template: { id: templateId, variables } })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || d.error || "Invitation email could not be sent.");
  return d;
}

async function recoveryInvite(email, name, role, env) {
  const r = await fetch(env.SUPABASE_URL + "/auth/v1/admin/generate_link", {
    method: "POST",
    headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: "Bearer " + env.SUPABASE_SECRET_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "recovery", email, data: { full_name: name, role } })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.msg || d.message || d.error_description || "A fresh account activation link could not be generated.");
  const id = d.user?.id || d.id;
  const actionUrl = d.action_link || d.properties?.action_link;
  if (!id || !actionUrl) throw new Error("Supabase did not return a valid reactivation link.");
  return { id, actionUrl };
}

async function inviteRole(b, role, env, actorId) {
  const name = text(b.full_name,120);
  const email = text(b.email,254).toLowerCase();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid full name and email.");
  if (!env.RESEND_API_KEY) throw new Error("Resend email service is not configured.");
  const old = await env.DB.prepare("SELECT id,full_name,email,role,status,deleted_at,deleted_by FROM users WHERE lower(email)=? LIMIT 1").bind(email).first();
  if (old) {
    if (!old.deleted_at) throw new Error("This email is already registered.");
    if (old.role !== role) throw new Error("This email belongs to a previously removed " + old.role + " account. Restore it using the original role.");
    // Supabase no longer has this archived user's Auth identity. Generate a new invite identity,
    // then remap every known D1 user reference in one deferred-FK transaction.
    const created = await invite(email,name,role,env);
    const oldId = old.id, newId = created.id, auditId = crypto.randomUUID();
    const refs = [
      ["assignment_submissions","student_id"],["assignments","teacher_id"],["audit_logs","actor_id"],
      ["batch_students","student_id"],["batch_teachers","teacher_id"],["batches","created_by"],
      ["enquiries","assigned_to"],["enquiry_history","actor_id"],["exam_attachments","uploaded_by"],
      ["exam_attempts","student_id"],["exams","created_by"],["fee_adjustments","created_by"],
      ["file_assets","owner_id"],["live_class_attendance","student_id"],["live_class_attendance","marked_by"],
      ["live_classes","teacher_id"],["notifications","user_id"],["questions","teacher_id"],
      ["results","student_id"],["results","evaluated_by"],["student_badges","student_id"],
      ["student_class_entitlements","student_id"],["student_class_entitlements","created_by"],
      ["student_fee_accounts","student_id"],["student_profiles","user_id"],["study_materials","teacher_id"],
      ["teacher_assignments","teacher_id"],["teacher_coverage_assignments","primary_teacher_id"],
      ["teacher_coverage_assignments","substitute_teacher_id"],["teacher_coverage_assignments","created_by"],
      ["teacher_leaves","teacher_id"],["teacher_leaves","reviewed_by"],
      ["student_fee_accounts","created_by"],["fee_transactions","recorded_by"],
      ["audit_logs","actor_user_id"],["users","deleted_by"]
    ];
    const statements = [env.DB.prepare("PRAGMA defer_foreign_keys=ON")];
    for (const [table,column] of refs) {
      statements.push(env.DB.prepare("UPDATE " + table + " SET " + column + "=? WHERE " + column + "=?").bind(newId,oldId));
    }
    const details = JSON.stringify({full_name:name,email,previous_auth_user_id:oldId,new_auth_user_id:newId});
    statements.push(env.DB.prepare("UPDATE users SET id=?,full_name=?,status='pending',deleted_at=NULL,deleted_by=NULL WHERE id=? AND role=? AND deleted_at IS NOT NULL").bind(newId,name,oldId,role));
    statements.push(env.DB.prepare("INSERT INTO audit_logs(id,actor_id,actor_user_id,action,entity_type,entity_id,details,details_json) VALUES(?,?,?,?,?,?,?,?)").bind(auditId,actorId,actorId,role+"_restored","user",newId,details,details));
    try {
      const result = await env.DB.batch(statements);
      const userUpdate = result[refs.length+1];
      if (!userUpdate?.meta?.changes) throw new Error("Archived teacher record was not updated; the database transaction must be reviewed.");
    } catch (e) {
      await rollbackInvite(newId,env);
      throw new Error("D1 restoration did not complete. No historical records were intentionally changed. " + e.message);
    }
    try {
      await sendInviteEmail(email,name,role,created.actionUrl,newId,crypto.randomUUID(),env);
    } catch (e) {
      try {
        const rollback = [env.DB.prepare("PRAGMA defer_foreign_keys=ON")];
        for (const [table,column] of refs) {
          rollback.push(env.DB.prepare("UPDATE " + table + " SET " + column + "=? WHERE " + column + "=?").bind(oldId,newId));
        }
        rollback.push(env.DB.prepare("UPDATE users SET id=?,full_name=?,status=?,deleted_at=?,deleted_by=? WHERE id=? AND role=?").bind(oldId,old.full_name,old.status,old.deleted_at,old.deleted_by,newId,role));
        rollback.push(env.DB.prepare("DELETE FROM audit_logs WHERE id=?").bind(auditId));
        await env.DB.batch(rollback);
        await rollbackInvite(newId,env);
      } catch (rollbackError) {
        console.error("Teacher restoration rollback failed; Auth identity retained for manual recovery:",rollbackError);
        throw new Error("The teacher record was remapped, but the invitation email failed and automatic rollback also failed. The new login has been retained to protect the linked records; manual recovery is required.");
      }
      throw e;
    }
    return { id:newId, full_name:name, email, status:"pending", restored:true };
  }
  const created = await invite(email,name,role,env);
  try {
    await env.DB.prepare("INSERT INTO users(id,full_name,email,role,status) VALUES(?,?,?,?,'pending')").bind(created.id,name,email,role).run();
    await sendInviteEmail(email,name,role,created.actionUrl,created.id,crypto.randomUUID(),env);
  } catch (e) {
    try { await env.DB.prepare("DELETE FROM users WHERE id=? AND role=?").bind(created.id,role).run(); } catch (cleanupError) { console.error("D1 invitation rollback failed:", cleanupError); }
    await rollbackInvite(created.id,env);
    throw e;
  }
  return { id:created.id, full_name:name, email, status:"pending", restored:false };
}

export default {

 async fetch(request, env) {

   try {

     const url = new URL(request.url), path = url.pathname, method = request.method;

     if (method === "OPTIONS") return new Response(null,{status:204,headers:corsHeaders(request)});

     if (path === "/api/health" && method === "GET") return reply({success:true,service:"DhyanshEdu API"},200,request);

     if (!path.startsWith("/api/")) return reply({error:"Not found"},404,request);




     // Public pricing catalogue: only active fee plans explicitly published by Admin.
     if (path === "/api/public/fee-plans" && method === "GET") {
       const origin = request.headers.get("Origin") || "";
       if (!ALLOWED_ORIGINS.includes(origin)) return reply({error:"Origin not allowed"},403,request);
       const q = await env.DB.prepare(
         "SELECT id,name,plan_name,description,amount_paise,billing_frequency,batch_type,inclusions,terms,effective_from,effective_to FROM fee_plans WHERE is_active=1 AND public_status='published' AND (effective_from IS NULL OR effective_from<=date('now')) AND (effective_to IS NULL OR effective_to>=date('now')) ORDER BY name"
       ).all();
       return reply({success:true,fee_plans:q.results||[]},200,request);
     }

     // Preserve the existing public website enquiry submission route.
     if (path === "/api/public/enquiries" && method === "POST") {
       const origin = request.headers.get("Origin") || "";
       if (!ALLOWED_ORIGINS.includes(origin)) return reply({error:"Origin not allowed"},403,request);
       const b = await body(request);
       const student = text(b.student_name,120), parent = text(b.parent_name,120);
       const phone = text(b.phone,30), email = text(b.email,254).toLowerCase();
       const studentClass = text(b.student_class,30), board = text(b.board,80);
       let courseInterest = text(b.course_interest,240);
       const feePlanId = text(b.fee_plan_id,80), learningFormat = text(b.learning_format,20);
       if (feePlanId) {
         const plan = await env.DB.prepare(
           "SELECT id,name,amount_paise,batch_type FROM fee_plans WHERE id=? AND is_active=1 AND public_status='published' AND (effective_from IS NULL OR effective_from<=date('now')) AND (effective_to IS NULL OR effective_to>=date('now'))"
         ).bind(feePlanId).first();
         if (!plan) return reply({error:"This fee option is no longer available. Please refresh the page and select again."},409,request);
         if (!["one_to_one","group"].includes(learningFormat) || plan.batch_type !== learningFormat) return reply({error:"Please select a valid learning format."},400,request);
         courseInterest = `${plan.name} | ${learningFormat === "one_to_one" ? "One-to-one" : "Small group"} | ₹${(Number(plan.amount_paise)/100).toLocaleString("en-IN")}/60 min`;
       }
       if (!student || !phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !studentClass) {
         return reply({error:"Please provide student name, phone, valid email and class."},400,request);
       }
       const digits = phone.replace(/\D/g,"").length;
       if (digits < 7 || digits > 15) return reply({error:"Enter a valid phone number."},400,request);
       const id = crypto.randomUUID();
       await env.DB.prepare("INSERT INTO enquiries(id,student_name,parent_name,phone,email,student_class,board,course_interest) VALUES(?,?,?,?,?,?,?,?)")
         .bind(id,student,parent||null,phone,email,studentClass,board||null,courseInterest||null).run();
       return reply({success:true,id,message:"Your enquiry has been received. Our team will contact you."},201,request);
     }

     const user = await authUser(request,env);

     if (!user?.id) return reply({error:"Authentication required"},401,request);



     if (path === "/api/me" && method === "GET") {

       const profile = await env.DB.prepare(

         "SELECT id,full_name,email,role,status FROM users WHERE id=? AND status='approved' AND deleted_at IS NULL"

       ).bind(user.id).first();

       if (!profile) return reply({error:"Account is pending approval or inactive"},403,request);

       return reply({success:true,profile},200,request);

     }



     const account = await env.DB.prepare(
       "SELECT id,role FROM users WHERE id=? AND status='approved' AND deleted_at IS NULL"
     ).bind(user.id).first();
     if (!account) return reply({error:"Account is pending approval or inactive"},403,request);



     if (path === "/api/admin/system-health" && method === "GET") {
       if (account.role !== "admin") return reply({error:"Administrator access required"},403,request);
       const count = async (sql) => {
         try { const row=await env.DB.prepare(sql).first(); return Number(row?.total||0); }
         catch { return null; }
       };
       const checks = await Promise.allSettled([
         env.DB.prepare("SELECT 1 AS ok").first(),
         env.STUDY_FILES_BUCKET ? env.STUDY_FILES_BUCKET.list({limit:1}) : Promise.reject(new Error("R2 binding missing")),
         fetch(env.SUPABASE_URL+"/auth/v1/settings",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY}})
       ]);
       const d1Ok=checks[0].status==="fulfilled";
       const r2Ok=checks[1].status==="fulfilled";
       const supaOk=checks[2].status==="fulfilled" && checks[2].value.ok;
       const [users,exams,attempts,studyFiles,examFiles]=await Promise.all([
         count("SELECT COUNT(*) AS total FROM users"),
         count("SELECT COUNT(*) AS total FROM exams"),
         count("SELECT COUNT(*) AS total FROM exam_attempts"),
         count("SELECT COUNT(*) AS total FROM study_materials WHERE deleted_at IS NULL"),
         count("SELECT COUNT(*) AS total FROM exam_attachments")
       ]);
       return reply({
         success:true,checked_at:new Date().toISOString(),
         services:{
           worker:{status:"Online",detail:"Authenticated API request succeeded"},
           d1:{status:d1Ok?"Online":"Unavailable",detail:d1Ok?"D1 query succeeded":"D1 query failed"},
           r2:{status:r2Ok?"Online":"Unavailable",detail:r2Ok?"R2 bucket listing permission succeeded":"R2 bucket check failed"},
           supabase:{status:supaOk?"Online":"Unavailable",detail:supaOk?"Supabase Auth settings endpoint responded":"Supabase Auth check failed"}
         },
         activity:{users:users??"—",exams:exams??"—",attempts:attempts??"—",files:studyFiles===null||examFiles===null?"—":studyFiles+examFiles}
       },200,request);
     }

     // Existing Admin enquiry inbox, assignment, follow-up and history APIs.
     if (path === "/api/enquiries" && method === "GET" && account.role === "admin") {
       const status = url.searchParams.get("status") || "";
       if (!["","new","contacted","demo_scheduled","enrolled","closed"].includes(status)) return reply({error:"Invalid status"},400,request);
       const sql = "SELECT e.*,u.full_name assigned_name FROM enquiries e LEFT JOIN users u ON u.id=e.assigned_to " +
         (status ? "WHERE e.status=? " : "") + "ORDER BY e.created_at DESC LIMIT 500";
       const q = status ? await env.DB.prepare(sql).bind(status).all() : await env.DB.prepare(sql).all();
       return reply({success:true,enquiries:q.results||[]},200,request);
     }

     let enquiryMatch = path.match(/^\/api\/enquiries\/([0-9a-f-]+)$/i);
     if (enquiryMatch && method === "PATCH" && account.role === "admin") {
       const id = enquiryMatch[1], b = await body(request);
       const old = await env.DB.prepare("SELECT id,status,assigned_to,follow_up_at,admin_notes FROM enquiries WHERE id=?").bind(id).first();
       if (!old) return reply({error:"Enquiry not found"},404,request);
       const status = b.status === undefined ? old.status : text(b.status,30);
       if (!["new","contacted","demo_scheduled","enrolled","closed"].includes(status)) return reply({error:"Invalid status"},400,request);
       const assigned = b.assigned_to === undefined ? old.assigned_to : (text(b.assigned_to,64)||null);
       if (assigned && !await env.DB.prepare("SELECT id FROM users WHERE id=? AND role IN ('admin','teacher') AND status='approved' AND deleted_at IS NULL").bind(assigned).first()) {
         return reply({error:"Invalid follow-up owner"},400,request);
       }
       const follow = b.follow_up_at === undefined ? old.follow_up_at : (text(b.follow_up_at,40)||null);
       if (follow && !/^\d{4}-\d{2}-\d{2}$/.test(follow)) return reply({error:"Invalid follow-up date"},400,request);
       const notes = b.admin_notes === undefined ? old.admin_notes : text(b.admin_notes,2000);
       const changes = [["status",old.status,status],["assigned_to",old.assigned_to,assigned],["follow_up_at",old.follow_up_at,follow],["admin_notes",old.admin_notes,notes]];
       const statements = [env.DB.prepare("UPDATE enquiries SET status=?,assigned_to=?,follow_up_at=?,admin_notes=?,updated_at=datetime('now') WHERE id=?").bind(status,assigned,follow,notes,id)];
       for (const [field,before,after] of changes) {
         if ((before ?? null) !== (after ?? null)) statements.push(env.DB.prepare("INSERT INTO enquiry_history(id,enquiry_id,actor_id,action,old_value,new_value) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),id,user.id,field,before==null?null:String(before),after==null?null:String(after)));
       }
       await env.DB.batch(statements);
       return reply({success:true},200,request);
     }
     enquiryMatch = path.match(/^\/api\/enquiries\/([0-9a-f-]+)\/history$/i);
     if (enquiryMatch && method === "GET" && account.role === "admin") {
       const q = await env.DB.prepare("SELECT h.*,u.full_name actor_name FROM enquiry_history h LEFT JOIN users u ON u.id=h.actor_id WHERE h.enquiry_id=? ORDER BY h.created_at DESC").bind(enquiryMatch[1]).all();
       return reply({success:true,history:q.results||[]},200,request);
     }

     const feeResponse = await handleFeeRequest(request,env,user,account,path,method);
     if (feeResponse) return feeResponse;

     const studyResponse = await handleStudyRequest(request,env,user,account,path,method);
     if (studyResponse) return studyResponse;

     // Read-only teacher/student workspace APIs. All records are scoped to the signed-in user.
     if (account.role === "teacher" || account.role === "student") {
       const isTeacher = account.role === "teacher";

       if (path === "/api/workspace" && method === "GET") {
         const [batches, assignments, materials, liveClasses] = await Promise.all([
           isTeacher
             ? env.DB.prepare(`SELECT COUNT(*) total FROM batches b WHERE b.status='active' AND (EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=b.id AND bt.teacher_id=?) OR ${teacherCoveragePredicate("b")})`).bind(user.id,user.id).first()
             : env.DB.prepare("SELECT COUNT(*) total FROM batch_students bs JOIN batches b ON b.id=bs.batch_id WHERE bs.student_id=? AND bs.status='active' AND b.status='active'").bind(user.id).first(),
           isTeacher
             ? env.DB.prepare(`SELECT COUNT(*) total FROM assignments a JOIN batches b ON b.id=a.batch_id WHERE a.status='published' AND (a.teacher_id=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=a.batch_id AND bt.teacher_id=?) OR ${teacherCoveragePredicate("b")})`).bind(user.id,user.id,user.id).first()
             : env.DB.prepare("SELECT COUNT(*) total FROM assignments a WHERE a.status='published' AND (EXISTS (SELECT 1 FROM batch_students bs WHERE bs.batch_id=a.batch_id AND bs.student_id=? AND bs.status='active') OR EXISTS (SELECT 1 FROM batch_students bs JOIN batches b ON b.id=bs.batch_id WHERE bs.student_id=? AND bs.status='active' AND b.class_id=a.class_id))").bind(user.id,user.id).first(),
           isTeacher
             ? env.DB.prepare(`SELECT COUNT(*) total FROM study_materials sm JOIN batches b ON b.id=sm.batch_id WHERE sm.deleted_at IS NULL AND (sm.teacher_id=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=sm.batch_id AND bt.teacher_id=?) OR ${teacherCoveragePredicate("b")})`).bind(user.id,user.id,user.id).first()
             : env.DB.prepare("SELECT COUNT(*) total FROM study_materials sm WHERE sm.deleted_at IS NULL AND (sm.visibility='all_students' OR EXISTS (SELECT 1 FROM batch_students bs WHERE bs.student_id=? AND bs.status='active' AND bs.batch_id=sm.batch_id))").bind(user.id).first(),
           isTeacher
             ? env.DB.prepare("SELECT COUNT(*) total FROM live_classes lc WHERE lc.status IN ('scheduled','live') AND (lc.teacher_id=? OR EXISTS (SELECT 1 FROM teacher_coverage_assignments tc WHERE tc.status='active' AND tc.substitute_teacher_id=? AND date(lc.starts_at,'+5 hours','+30 minutes') BETWEEN tc.effective_from AND tc.effective_to AND ((tc.scope_type='batch' AND tc.batch_id=lc.batch_id) OR (tc.scope_type='class_subject' AND tc.class_id=lc.class_id AND tc.subject_id=lc.subject_id AND NOT EXISTS (SELECT 1 FROM teacher_coverage_assignments tb WHERE tb.status='active' AND tb.scope_type='batch' AND tb.batch_id=lc.batch_id AND date(lc.starts_at,'+5 hours','+30 minutes') BETWEEN tb.effective_from AND tb.effective_to)))))").bind(user.id,user.id).first()
             : env.DB.prepare("SELECT COUNT(*) total FROM live_classes lc WHERE lc.status IN ('scheduled','live') AND (EXISTS (SELECT 1 FROM batch_students bs WHERE bs.student_id=? AND bs.status='active' AND bs.batch_id=lc.batch_id) OR (lc.batch_id IS NULL AND EXISTS (SELECT 1 FROM batch_students bs JOIN batches b ON b.id=bs.batch_id WHERE bs.student_id=? AND bs.status='active' AND b.class_id=lc.class_id)))").bind(user.id,user.id).first()
         ]);
         return reply({success:true,role:account.role,stats:{
           batches:batches?.total||0,assignments:assignments?.total||0,
           materials:materials?.total||0,upcoming_classes:liveClasses?.total||0
         }},200,request);
       }

       if (path === "/api/my/batches" && method === "GET") {
         const result = isTeacher
           ? await env.DB.prepare(`SELECT b.id,b.batch_name,b.batch_type,b.status,b.class_id,b.subject_id,c.class_name,s.subject_name FROM batches b LEFT JOIN classes c ON c.id=b.class_id LEFT JOIN subjects s ON s.id=b.subject_id WHERE EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=b.id AND bt.teacher_id=?) OR ${teacherCoveragePredicate("b")} ORDER BY b.batch_name`).bind(user.id,user.id).all()
           : await env.DB.prepare("SELECT b.id,b.batch_name,b.batch_type,b.status,b.class_id,b.subject_id,c.class_name,s.subject_name,bs.enrolled_at FROM batch_students bs JOIN batches b ON b.id=bs.batch_id LEFT JOIN classes c ON c.id=b.class_id LEFT JOIN subjects s ON s.id=b.subject_id WHERE bs.student_id=? AND bs.status='active' ORDER BY b.batch_name").bind(user.id).all();
         return reply({success:true,batches:result.results||[]},200,request);
       }

       if (path === "/api/my/assignments" && method === "GET") {
         const result = isTeacher
           ? await env.DB.prepare(`SELECT DISTINCT a.id,a.title,a.instructions,a.due_at,a.max_marks,a.status,a.created_at,c.class_name,s.subject_name,b.batch_name FROM assignments a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN subjects s ON s.id=a.subject_id LEFT JOIN batches b ON b.id=a.batch_id WHERE a.status IN ('draft','published','closed') AND (a.teacher_id=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=a.batch_id AND bt.teacher_id=?) OR ${teacherCoveragePredicate("b")}) ORDER BY a.due_at`).bind(user.id,user.id,user.id).all()
           : await env.DB.prepare("SELECT DISTINCT a.id,a.title,a.instructions,a.due_at,a.max_marks,a.status,a.created_at,c.class_name,s.subject_name,b.batch_name,sub.status submission_status,sub.submitted_at,sub.marks_awarded,sub.teacher_feedback FROM assignments a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN subjects s ON s.id=a.subject_id LEFT JOIN batches b ON b.id=a.batch_id LEFT JOIN assignment_submissions sub ON sub.assignment_id=a.id AND sub.student_id=? WHERE a.status='published' AND (EXISTS (SELECT 1 FROM batch_students bs WHERE bs.batch_id=a.batch_id AND bs.student_id=? AND bs.status='active') OR EXISTS (SELECT 1 FROM batch_students bs JOIN batches eb ON eb.id=bs.batch_id WHERE bs.student_id=? AND bs.status='active' AND eb.class_id=a.class_id)) ORDER BY a.due_at").bind(user.id,user.id,user.id).all();
         return reply({success:true,assignments:result.results||[]},200,request);
       }

       if (path === "/api/my/materials" && method === "GET") {
         const result = isTeacher
           ? await env.DB.prepare(`SELECT sm.id,sm.title,sm.description,sm.class_id,sm.subject_id,sm.batch_id,sm.file_name,sm.mime_type,sm.file_size_bytes,sm.created_at FROM study_materials sm LEFT JOIN batches b ON b.id=sm.batch_id WHERE sm.deleted_at IS NULL AND (sm.teacher_id=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=sm.batch_id AND bt.teacher_id=?) OR ${teacherCoveragePredicate("b")}) ORDER BY sm.created_at DESC`).bind(user.id,user.id,user.id).all()
           : await env.DB.prepare("SELECT DISTINCT sm.id,sm.title,sm.description,sm.class_id,sm.subject_id,sm.batch_id,sm.file_name,sm.mime_type,sm.file_size_bytes,sm.created_at FROM study_materials sm WHERE sm.deleted_at IS NULL AND (sm.visibility='all_students' OR EXISTS (SELECT 1 FROM batch_students bs WHERE bs.student_id=? AND bs.status='active' AND bs.batch_id=sm.batch_id)) ORDER BY sm.created_at DESC").bind(user.id).all();
         return reply({success:true,materials:result.results||[]},200,request);
       }

       if (path === "/api/my/live-classes" && method === "GET") {
         const result = isTeacher
           ? await env.DB.prepare("SELECT DISTINCT lc.id,lc.title,lc.description,lc.batch_id,lc.class_id,lc.subject_id,lc.meeting_provider,lc.meeting_url,lc.starts_at,lc.ends_at,lc.status,b.batch_name FROM live_classes lc LEFT JOIN batches b ON b.id=lc.batch_id WHERE lc.teacher_id=? OR EXISTS (SELECT 1 FROM teacher_coverage_assignments tc WHERE tc.status='active' AND tc.substitute_teacher_id=? AND date(lc.starts_at,'+5 hours','+30 minutes') BETWEEN tc.effective_from AND tc.effective_to AND ((tc.scope_type='batch' AND tc.batch_id=lc.batch_id) OR (tc.scope_type='class_subject' AND tc.class_id=lc.class_id AND tc.subject_id=lc.subject_id AND NOT EXISTS (SELECT 1 FROM teacher_coverage_assignments tb WHERE tb.status='active' AND tb.scope_type='batch' AND tb.batch_id=lc.batch_id AND date(lc.starts_at,'+5 hours','+30 minutes') BETWEEN tb.effective_from AND tb.effective_to)))) ORDER BY lc.starts_at").bind(user.id,user.id).all()
           : await env.DB.prepare("SELECT DISTINCT lc.id,lc.title,lc.description,lc.batch_id,lc.class_id,lc.subject_id,lc.meeting_provider,lc.meeting_url,lc.starts_at,lc.ends_at,lc.status,b.batch_name,t.full_name teacher_name FROM live_classes lc LEFT JOIN batches b ON b.id=lc.batch_id LEFT JOIN users t ON t.id=lc.teacher_id WHERE lc.status<>'cancelled' AND (EXISTS (SELECT 1 FROM batch_students bs WHERE bs.student_id=? AND bs.status='active' AND bs.batch_id=lc.batch_id) OR (lc.batch_id IS NULL AND EXISTS (SELECT 1 FROM batch_students bs JOIN batches b ON b.id=bs.batch_id WHERE bs.student_id=? AND bs.status='active' AND b.class_id=lc.class_id))) ORDER BY lc.starts_at").bind(user.id,user.id).all();
         return reply({success:true,live_classes:result.results||[]},200,request);
       }
     }

     // Published student results. Correct answers and teacher feedback are exposed only after publication.
     if(account.role==="student"){
       const resultMatch=path.match(/^\/api\/student\/results\/([0-9a-f-]+)$/i);
       if(resultMatch && method==="GET"){
         const result=await env.DB.prepare(
           "SELECT r.id result_id,r.attempt_id,r.exam_id,r.total_marks,r.marks_obtained,r.percentage,r.published_at,e.title exam_title,e.pass_marks,ea.submitted_at FROM results r JOIN exams e ON e.id=r.exam_id JOIN exam_attempts ea ON ea.id=r.attempt_id JOIN batches b ON b.id=e.batch_id JOIN batch_students bs ON bs.batch_id=b.id AND bs.student_id=r.student_id WHERE r.attempt_id=? AND r.student_id=? AND r.published_at IS NOT NULL"
         ).bind(resultMatch[1],user.id).first();
         if(!result) return reply({error:"Published result not found."},404,request);
         const rows=await env.DB.prepare(
           "SELECT eq.id exam_question_id,q.id question_id,eq.marks,q.question_type,q.question_text,q.topic,sa.answer_text,sa.selected_option_ids,sa.is_correct,sa.marks_awarded,sa.teacher_feedback FROM exam_questions eq JOIN questions q ON q.id=eq.question_id LEFT JOIN student_answers sa ON sa.exam_question_id=eq.id AND sa.attempt_id=? WHERE eq.exam_id=? ORDER BY eq.sort_order"
         ).bind(result.attempt_id,result.exam_id).all();
         const options=await env.DB.prepare(
           "SELECT qo.question_id,qo.id option_id,qo.option_label,qo.option_text,qo.is_correct FROM exam_questions eq JOIN question_options qo ON qo.question_id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.sort_order,qo.sort_order"
         ).bind(result.exam_id).all();
         const questions=(rows.results||[]).map(q=>({
           ...q,selected_option_ids:JSON.parse(q.selected_option_ids||"[]"),
           options:(options.results||[]).filter(o=>o.question_id===q.question_id).map(o=>({id:o.option_id,label:o.option_label,text:o.option_text,is_correct:!!o.is_correct}))
         }));
         return reply({success:true,result,questions},200,request);
       }
     }

     // Student exam centre. Correct answers are never returned by read endpoints.
     if (account.role === "student") {
       if (path === "/api/student/exams" && method === "GET") {
         const rows=await env.DB.prepare(
           "SELECT e.id,e.title,e.description,e.duration_minutes,e.total_marks,e.pass_marks,e.starts_at,e.ends_at,e.status,e.show_results_immediately,b.batch_name,ea.id attempt_id,ea.status attempt_status,ea.started_at,ea.submitted_at,r.marks_obtained,r.percentage,r.published_at FROM exams e JOIN batches b ON b.id=e.batch_id JOIN batch_students bs ON bs.batch_id=b.id AND bs.student_id=? AND bs.status='active' LEFT JOIN exam_attempts ea ON ea.exam_id=e.id AND ea.student_id=? LEFT JOIN results r ON r.attempt_id=ea.id WHERE e.status IN ('scheduled','published','closed') AND b.status='active' ORDER BY COALESCE(e.starts_at,e.created_at) DESC"
         ).bind(user.id,user.id).all();
         const attachmentRows=await env.DB.prepare("SELECT ea.id,ea.exam_id,ea.file_name FROM exam_attachments ea JOIN exams e ON e.id=ea.exam_id JOIN batch_students bs ON bs.batch_id=e.batch_id AND bs.student_id=? AND bs.status='active' WHERE e.status IN ('scheduled','published','closed')").bind(user.id).all();
         const now=Date.now();
         const exams=(rows.results||[]).map(e=>({
           ...e,
           availability: e.attempt_id ? e.attempt_status : (
             e.status==="closed" || (e.ends_at && new Date(e.ends_at).getTime()<now) ? "closed" :
             (e.starts_at && new Date(e.starts_at).getTime()>now ? "upcoming" : "available")
           ),
           result_visible: !!e.published_at
         }));
         return reply({success:true,exams,attachments:attachmentRows.results||[]},200,request)
       }

       const startMatch=path.match(/^\/api\/student\/exams\/([0-9a-f-]+)\/start$/i);
       if(startMatch && method==="POST"){
         const exam=await env.DB.prepare(
           "SELECT e.id,e.status,e.starts_at,e.ends_at,e.duration_minutes,b.id batch_id FROM exams e JOIN batches b ON b.id=e.batch_id JOIN batch_students bs ON bs.batch_id=b.id AND bs.student_id=? AND bs.status='active' WHERE e.id=? AND b.status='active'"
         ).bind(user.id,startMatch[1]).first();
         if(!exam) return reply({error:"Exam not found or you are not enrolled in its batch."},404,request);
         const now=Date.now();
         if(!["published","scheduled"].includes(exam.status) || (exam.starts_at && new Date(exam.starts_at).getTime()>now) || (exam.ends_at && new Date(exam.ends_at).getTime()<now)) return reply({error:"This exam is not open for attempts right now."},409,request);
         let attempt=await env.DB.prepare("SELECT id,status,started_at,submitted_at FROM exam_attempts WHERE exam_id=? AND student_id=?").bind(exam.id,user.id).first();
         if(attempt && attempt.status!=="in_progress") return reply({error:"You have already submitted this exam. Only one attempt is allowed."},409,request);
         if(!attempt){
           const id=crypto.randomUUID();
           await env.DB.prepare("INSERT INTO exam_attempts(id,exam_id,student_id,status) VALUES(?,?,?,'in_progress')").bind(id,exam.id,user.id).run();
           attempt={id,status:"in_progress",started_at:new Date().toISOString(),submitted_at:null};
         }
         const questions=await env.DB.prepare(
           "SELECT eq.id exam_question_id,eq.marks,eq.negative_marks,eq.sort_order,q.question_type,q.question_text,q.topic FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.sort_order"
         ).bind(exam.id).all();
         const options=await env.DB.prepare(
           "SELECT qo.id,qo.question_id,qo.option_label,qo.option_text,eq.id exam_question_id FROM exam_questions eq JOIN question_options qo ON qo.question_id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.sort_order,qo.sort_order"
         ).bind(exam.id).all();
         const answers=await env.DB.prepare("SELECT exam_question_id,answer_text,selected_option_ids FROM student_answers WHERE attempt_id=?").bind(attempt.id).all();
         const answerMap=new Map((answers.results||[]).map(x=>[x.exam_question_id,x]));
         return reply({success:true,attempt:{...attempt,title:exam.title,ends_at:exam.ends_at,duration_minutes:exam.duration_minutes,questions:(questions.results||[]).map(q=>({
           ...q,options:(options.results||[]).filter(o=>o.exam_question_id===q.exam_question_id).map(o=>({id:o.id,label:o.option_label,text:o.option_text})),
           answer:answerMap.get(q.exam_question_id)?.answer_text||"",
           selected_option_ids:JSON.parse(answerMap.get(q.exam_question_id)?.selected_option_ids||"[]")
         }))}},200,request);
       }

       const attemptMatch=path.match(/^\/api\/student\/attempts\/([0-9a-f-]+)$/i);
       if(attemptMatch && method==="GET"){
         const attempt=await env.DB.prepare("SELECT ea.id,ea.status,ea.started_at,ea.submitted_at,e.id exam_id,e.title,e.duration_minutes,e.ends_at FROM exam_attempts ea JOIN exams e ON e.id=ea.exam_id WHERE ea.id=? AND ea.student_id=?").bind(attemptMatch[1],user.id).first();
         if(!attempt) return reply({error:"Attempt not found."},404,request);
         const questions=await env.DB.prepare("SELECT eq.id exam_question_id,eq.marks,eq.sort_order,q.question_type,q.question_text,q.topic FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.sort_order").bind(attempt.exam_id).all();
         const options=await env.DB.prepare("SELECT qo.id,qo.option_label,qo.option_text,eq.id exam_question_id FROM exam_questions eq JOIN question_options qo ON qo.question_id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.sort_order,qo.sort_order").bind(attempt.exam_id).all();
         const answers=await env.DB.prepare("SELECT exam_question_id,answer_text,selected_option_ids FROM student_answers WHERE attempt_id=?").bind(attempt.id).all();
         const answerMap=new Map((answers.results||[]).map(x=>[x.exam_question_id,x]));
         return reply({success:true,attempt:{...attempt,questions:(questions.results||[]).map(q=>({ ...q,options:(options.results||[]).filter(o=>o.exam_question_id===q.exam_question_id).map(o=>({id:o.id,label:o.option_label,text:o.option_text})),answer:answerMap.get(q.exam_question_id)?.answer_text||"",selected_option_ids:JSON.parse(answerMap.get(q.exam_question_id)?.selected_option_ids||"[]")}))}},200,request);
       }

       const answerMatch=path.match(/^\/api\/student\/attempts\/([0-9a-f-]+)\/answers$/i);
       if(answerMatch && method==="POST"){
         const b=await body(request), attemptId=answerMatch[1];
         const attempt=await env.DB.prepare("SELECT ea.id,ea.status,ea.started_at,e.duration_minutes,e.ends_at FROM exam_attempts ea JOIN exams e ON e.id=ea.exam_id JOIN batches bt ON bt.id=e.batch_id JOIN batch_students bs ON bs.batch_id=bt.id AND bs.student_id=? AND bs.status='active' WHERE ea.id=? AND ea.student_id=?").bind(user.id,attemptId,user.id).first();
         if(!attempt) return reply({error:"Attempt not found."},404,request);
         if(attempt.status!=="in_progress") return reply({error:"This attempt is already submitted."},409,request);
         const deadline=Math.min(new Date(attempt.started_at).getTime()+Number(attempt.duration_minutes)*60000,attempt.ends_at?new Date(attempt.ends_at).getTime():Infinity);
         if(Date.now()>deadline) return reply({error:"The exam time has ended. Submit your attempt now."},409,request);
         const examQuestionId=text(b.exam_question_id,64), answerText=text(b.answer_text,8000);
         const selected=Array.isArray(b.selected_option_ids)?[...new Set(b.selected_option_ids.map(x=>text(x,64)))]:[];
         const eq=await env.DB.prepare("SELECT eq.id FROM exam_questions eq JOIN exam_attempts ea ON ea.exam_id=eq.exam_id WHERE eq.id=? AND ea.id=?").bind(examQuestionId,attemptId).first();
         if(!eq) return reply({error:"Question does not belong to this exam."},400,request);
         if(selected.length){
           const placeholders=selected.map(()=>"?").join(",");
           const valid=await env.DB.prepare("SELECT COUNT(*) total FROM question_options qo JOIN exam_questions eq ON eq.question_id=qo.question_id WHERE eq.id=? AND qo.id IN ("+placeholders+")").bind(examQuestionId,...selected).first();
           if(Number(valid?.total)!==selected.length) return reply({error:"One or more selected options are invalid."},400,request);
         }
         await env.DB.prepare("INSERT INTO student_answers(id,attempt_id,exam_question_id,answer_text,selected_option_ids,answered_at) VALUES(?,?,?,?,?,datetime('now')) ON CONFLICT(attempt_id,exam_question_id) DO UPDATE SET answer_text=excluded.answer_text,selected_option_ids=excluded.selected_option_ids,answered_at=excluded.answered_at").bind(crypto.randomUUID(),attemptId,examQuestionId,answerText||null,JSON.stringify(selected)).run();
         return reply({success:true,saved:true},200,request);
       }

       const submitMatch=path.match(/^\/api\/student\/attempts\/([0-9a-f-]+)\/submit$/i);
       if(submitMatch && method==="POST"){
         const attemptId=submitMatch[1];
         const attempt=await env.DB.prepare("SELECT ea.id,ea.exam_id,ea.status,ea.started_at,e.duration_minutes,e.ends_at,e.total_marks,e.show_results_immediately FROM exam_attempts ea JOIN exams e ON e.id=ea.exam_id JOIN batches b ON b.id=e.batch_id JOIN batch_students bs ON bs.batch_id=b.id AND bs.student_id=? AND bs.status='active' WHERE ea.id=? AND ea.student_id=?").bind(user.id,attemptId,user.id).first();
         if(!attempt) return reply({error:"Attempt not found."},404,request);
         if(attempt.status!=="in_progress") return reply({error:"This attempt has already been submitted."},409,request);
         const qs=await env.DB.prepare("SELECT eq.id,eq.marks,eq.negative_marks,q.question_type,q.question_text FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=?").bind(attempt.exam_id).all();
         const answers=await env.DB.prepare("SELECT exam_question_id,answer_text,selected_option_ids FROM student_answers WHERE attempt_id=?").bind(attemptId).all();
         const answerMap=new Map((answers.results||[]).map(x=>[x.exam_question_id,x]));
         let score=0,manual=0;
         for(const q of qs.results||[]){
           const ans=answerMap.get(q.id);
           if(["short_answer","long_answer","numerical"].includes(q.question_type)){manual++;continue;}
           let correct=false;
           if(q.question_type==="mcq"||q.question_type==="multiple_select"){
             const chosen=new Set(JSON.parse(ans?.selected_option_ids||"[]"));
             const rightRows=await env.DB.prepare("SELECT id FROM question_options WHERE question_id=(SELECT question_id FROM exam_questions WHERE id=?) AND is_correct=1").bind(q.id).all();
             const right=new Set((rightRows.results||[]).map(x=>x.id));
             correct=chosen.size===right.size && [...chosen].every(id=>right.has(id));
           }
           const awarded=correct?Number(q.marks): (ans && (q.question_type==="mcq"||q.question_type==="multiple_select") ? -Number(q.negative_marks||0) : 0);
           score+=awarded;
           await env.DB.prepare("UPDATE student_answers SET is_correct=?,marks_awarded=? WHERE attempt_id=? AND exam_question_id=?").bind(correct?1:0,awarded,attemptId,q.id).run();
         }
         score=Math.max(0,score);
         const total=Number(attempt.total_marks||0), percentage=total>0?Math.round(score/total*10000)/100:0;
         const nextStatus=manual>0?"submitted":"evaluated";
         const publishedAt=manual===0 && Number(attempt.show_results_immediately)===1 ? new Date().toISOString() : null;
         await env.DB.batch([
           env.DB.prepare("UPDATE exam_attempts SET status=?,submitted_at=datetime('now'),score=? WHERE id=? AND student_id=?").bind(nextStatus,score,attemptId,user.id),
           env.DB.prepare("INSERT INTO results(id,attempt_id,student_id,exam_id,total_marks,marks_obtained,percentage,published_at) VALUES(?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),attemptId,user.id,attempt.exam_id,total,score,percentage,publishedAt)
         ]);
         return reply({success:true,status:nextStatus,marks_obtained:score,total_marks:total,manual_review_required:manual>0,result_published:!!publishedAt},200,request);
       }
     }

     // Teacher question bank and batch exam authoring. These routes run before the Admin-only gate.
     if (account.role === "teacher") {
       if (path === "/api/teacher/questions" && method === "GET") {
         const rows = await env.DB.prepare(
           `SELECT DISTINCT q.id,q.question_type,q.question_text,q.topic,q.difficulty,q.default_marks,q.subject_id,q.class_id,q.teacher_id owner_teacher_id,q.created_at,(SELECT COUNT(*) FROM question_options qo WHERE qo.question_id=q.id) option_count
            FROM questions q
            WHERE q.status='active' AND (
              q.teacher_id=? OR EXISTS (
                SELECT 1 FROM teacher_coverage_assignments tc
                LEFT JOIN batches cb ON cb.id=tc.batch_id
                WHERE tc.status='active' AND tc.substitute_teacher_id=? AND tc.primary_teacher_id=q.teacher_id
                  AND date('now','+5 hours','+30 minutes') BETWEEN tc.effective_from AND tc.effective_to
                  AND (
                    (tc.scope_type='batch' AND (q.class_id IS NULL OR q.class_id=cb.class_id) AND (q.subject_id IS NULL OR q.subject_id=cb.subject_id))
                    OR (tc.scope_type='class_subject' AND (q.class_id IS NULL OR q.class_id=tc.class_id) AND q.subject_id=tc.subject_id)
                  )
              )
            ) ORDER BY q.created_at DESC`
         ).bind(user.id,user.id).all();
         return reply({success:true,questions:rows.results||[]},200,request);
       }

       if (path === "/api/teacher/questions" && method === "POST") {
         const b = await body(request);
         const type = text(b.question_type,30);
         const questionText = text(b.question_text,8000);
         const topic = text(b.topic,160) || null;
         const difficulty = text(b.difficulty,20) || "medium";
         const marks = Number(b.default_marks ?? 1);
         const subjectId = text(b.subject_id,32);
         const classId = text(b.class_id,32) || null;
         const allowedTypes = ["mcq","multiple_select","numerical","short_answer","long_answer"];
         if (!allowedTypes.includes(type) || !questionText || !Number.isFinite(marks) || marks<=0 || !subjectId || !["easy","medium","hard"].includes(difficulty)) {
           return reply({error:"Enter valid question text, type, subject, difficulty and positive marks."},400,request);
         }
         const assignment = await env.DB.prepare(
           "SELECT 1 ok FROM teacher_assignments WHERE teacher_id=? AND subject_id=? AND (? IS NULL OR class_id=?) UNION SELECT 1 FROM batch_teachers bt JOIN batches b ON b.id=bt.batch_id WHERE bt.teacher_id=? AND b.subject_id=? AND (? IS NULL OR b.class_id=?) LIMIT 1"
         ).bind(user.id,subjectId,classId,classId,user.id,subjectId,classId,classId).first();
         if (!assignment) return reply({error:"You can create questions only for a subject/class assigned to you."},403,request);

         const options = Array.isArray(b.options) ? b.options : [];
         if ((type==="mcq" || type==="multiple_select") &&
             (options.length < 2 || options.length > 8 ||
              options.some(o=>!text(o.option_text,1000)) ||
              options.filter(o=>o.is_correct===true).length < 1 ||
              (type==="mcq" && options.filter(o=>o.is_correct===true).length !== 1))) {
           return reply({error:type==="mcq" ? "MCQ questions need 2–8 options and exactly one correct answer." : "Multiple-select questions need 2–8 options and at least one correct answer."},400,request);
         }
         if (type!=="mcq" && type!=="multiple_select" && options.length) return reply({error:"Options are supported only for MCQ and multiple-select questions."},400,request);

         const id=crypto.randomUUID();
         const statements=[
           env.DB.prepare("INSERT INTO questions(id,subject_id,class_id,teacher_id,topic,difficulty,question_type,question_text,explanation,default_marks,status) VALUES(?,?,?,?,?,?,?,?,?,?, 'active')")
             .bind(id,subjectId,classId,user.id,topic,difficulty,type,questionText,text(b.explanation,4000)||null,marks)
         ];
         options.forEach((o,i)=>statements.push(
           env.DB.prepare("INSERT INTO question_options(id,question_id,option_label,option_text,is_correct,sort_order) VALUES(?,?,?,?,?,?)")
             .bind(crypto.randomUUID(),id,String.fromCharCode(65+i),text(o.option_text,1000),o.is_correct===true?1:0,i)
         ));
         await env.DB.batch(statements);
         return reply({success:true,question_id:id},201,request);
       }

       if (path === "/api/teacher/exams" && method === "GET") {
         const rows=await env.DB.prepare(
           `SELECT DISTINCT e.id,e.title,e.description,e.batch_id,e.duration_minutes,e.total_marks,e.pass_marks,e.starts_at,e.ends_at,e.status,e.created_at,b.batch_name,(SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id=e.id) question_count FROM exams e LEFT JOIN batches b ON b.id=e.batch_id WHERE e.created_by=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=e.batch_id AND bt.teacher_id=?) OR ${teacherCoveragePredicate("b")} ORDER BY e.created_at DESC`
         ).bind(user.id,user.id,user.id).all();
         return reply({success:true,exams:rows.results||[]},200,request);
       }

       if (path === "/api/teacher/exams" && method === "POST") {
         const b=await body(request);
         const title=text(b.title,180), batchId=text(b.batch_id,64);
         const duration=Number(b.duration_minutes);
         const passMarks=b.pass_marks===""||b.pass_marks==null?null:Number(b.pass_marks);
         const startsAt=text(b.starts_at,40)||null, endsAt=text(b.ends_at,40)||null;
         const questionIds=Array.isArray(b.question_ids)?[...new Set(b.question_ids.map(x=>text(x,64)).filter(Boolean))]:[];
         if (!title || !batchId || !Number.isInteger(duration) || duration<1 || duration>600 || !questionIds.length || questionIds.length>100 ||
             (passMarks!==null && (!Number.isFinite(passMarks)||passMarks<0)) ||
             (startsAt && endsAt && new Date(endsAt)<=new Date(startsAt))) {
           return reply({error:"Enter a title, assigned batch, valid duration, at least one question and a valid schedule."},400,request);
         }
         const batch=await env.DB.prepare(
           `SELECT b.id,b.class_id,b.subject_id FROM batches b WHERE b.id=? AND b.status='active' AND (EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=b.id AND bt.teacher_id=?) OR ${teacherCoveragePredicate("b")})`
         ).bind(batchId,user.id,user.id).first();
         if(!batch) return reply({error:"Select an active batch assigned to you."},403,request);
         const marksRows=await env.DB.prepare(
           `SELECT q.id,q.default_marks FROM questions q
            WHERE q.status='active' AND q.id IN (${questionIds.map(()=>"?").join(",")})
              AND (q.class_id IS NULL OR q.class_id=?) AND (q.subject_id IS NULL OR q.subject_id=?)
              AND (
                q.teacher_id=? OR EXISTS (
                  SELECT 1 FROM teacher_coverage_assignments tc
                  WHERE tc.status='active' AND tc.substitute_teacher_id=? AND tc.primary_teacher_id=q.teacher_id
                    AND date('now','+5 hours','+30 minutes') BETWEEN tc.effective_from AND tc.effective_to
                    AND (
                      (tc.scope_type='batch' AND tc.batch_id=?)
                      OR (tc.scope_type='class_subject' AND tc.class_id=? AND tc.subject_id=?
                        AND NOT EXISTS (
                          SELECT 1 FROM teacher_coverage_assignments tb
                          WHERE tb.status='active' AND tb.scope_type='batch' AND tb.batch_id=?
                            AND date('now','+5 hours','+30 minutes') BETWEEN tb.effective_from AND tb.effective_to
                        )
                      )
                    )
                )
              )`
         ).bind(...questionIds,batch.class_id,batch.subject_id,user.id,user.id,batchId,batch.class_id,batch.subject_id,batchId).all();
         if((marksRows.results||[]).length!==questionIds.length) return reply({error:"One or more selected questions are unavailable or do not match this batch."},400,request);
         const totalMarks=marksRows.results.reduce((sum,q)=>sum+Number(q.default_marks||0),0);
         if(passMarks!==null && passMarks>totalMarks) return reply({error:"Pass marks cannot exceed total marks."},400,request);
         const id=crypto.randomUUID();
         const status=startsAt && new Date(startsAt)>new Date() ? "scheduled" : "draft";
         const statements=[
           env.DB.prepare("INSERT INTO exams(id,title,description,class_id,subject_id,batch_id,created_by,duration_minutes,total_marks,pass_marks,starts_at,ends_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
             .bind(id,title,text(b.description,4000)||null,batch.class_id,batch.subject_id,batchId,user.id,duration,totalMarks,passMarks,startsAt,endsAt,status),
           ...questionIds.map((qid,i)=>{
             const q=marksRows.results.find(x=>x.id===qid);
             return env.DB.prepare("INSERT INTO exam_questions(id,exam_id,question_id,marks,negative_marks,sort_order) VALUES(?,?,?, ?,0,?)")
               .bind(crypto.randomUUID(),id,qid,Number(q.default_marks||1),i);
           })
         ];
         await env.DB.batch(statements);
         return reply({success:true,exam_id:id,status,total_marks:totalMarks},201,request);
       }

       const publishMatch=path.match(/^\/api\/teacher\/exams\/([0-9a-f-]+)\/publish$/i);
       if(publishMatch && method==="POST"){
         const exam=await env.DB.prepare(`SELECT exams.id,exams.status,exams.starts_at,exams.ends_at,(SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id=exams.id) question_count FROM exams JOIN batches b ON b.id=exams.batch_id WHERE exams.id=? AND (exams.created_by=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=exams.batch_id AND bt.teacher_id=?) OR ${teacherCoveragePredicate("b")})`).bind(publishMatch[1],user.id,user.id,user.id).first();
         if(!exam) return reply({error:"Exam not found."},404,request);
         if(!exam.question_count) return reply({error:"Add at least one question before publishing."},400,request);
         if(exam.status==="archived"||exam.status==="closed") return reply({error:"This exam cannot be published."},409,request);
         if(exam.ends_at && new Date(exam.ends_at)<=new Date()) return reply({error:"The exam end time is in the past."},400,request);
         const nextStatus=exam.starts_at && new Date(exam.starts_at)>new Date() ? "scheduled" : "published";
         await env.DB.prepare("UPDATE exams SET status=?,updated_at=datetime('now') WHERE id=? AND (created_by=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=exams.batch_id AND bt.teacher_id=?) OR EXISTS (SELECT 1 FROM teacher_coverage_assignments tc WHERE tc.status='active' AND tc.substitute_teacher_id=? AND date('now','+5 hours','+30 minutes') BETWEEN tc.effective_from AND tc.effective_to AND ((tc.scope_type='batch' AND tc.batch_id=exams.batch_id) OR (tc.scope_type='class_subject' AND tc.class_id=exams.class_id AND tc.subject_id=exams.subject_id AND NOT EXISTS (SELECT 1 FROM teacher_coverage_assignments tb WHERE tb.status='active' AND tb.scope_type='batch' AND tb.batch_id=exams.batch_id AND date('now','+5 hours','+30 minutes') BETWEEN tb.effective_from AND tb.effective_to))))").bind(nextStatus,exam.id,user.id,user.id,user.id).run();
         return reply({success:true,status:nextStatus},200,request);
       }
     }

     // Teacher evaluation centre: only the exam owner or an assigned batch teacher can review attempts.
     if (account.role === "teacher") {
       if (path === "/api/teacher/evaluations" && method === "GET") {
         const rows=await env.DB.prepare(
           `SELECT ea.id attempt_id,ea.status attempt_status,ea.started_at,ea.submitted_at,ea.score,e.id exam_id,e.title exam_title,e.total_marks,e.batch_id,b.batch_name,u.full_name student_name,u.email student_email,r.marks_obtained,r.published_at,(SELECT COUNT(*) FROM student_answers sa JOIN exam_questions eq ON eq.id=sa.exam_question_id JOIN questions q ON q.id=eq.question_id WHERE sa.attempt_id=ea.id AND q.question_type IN ('numerical','short_answer','long_answer')) manual_count FROM exam_attempts ea JOIN exams e ON e.id=ea.exam_id JOIN batches b ON b.id=e.batch_id JOIN users u ON u.id=ea.student_id LEFT JOIN results r ON r.attempt_id=ea.id WHERE ea.status IN ('submitted','evaluated') AND (e.created_by=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=e.batch_id AND bt.teacher_id=?) OR ${teacherCoveragePredicate("b")}) ORDER BY ea.submitted_at DESC`
         ).bind(user.id,user.id,user.id).all();
         return reply({success:true,evaluations:rows.results||[]},200,request);
       }

       const evaluationMatch=path.match(/^\/api\/teacher\/evaluations\/([0-9a-f-]+)$/i);
       if(evaluationMatch && method==="GET"){
         const attempt=await env.DB.prepare(
           `SELECT ea.id attempt_id,ea.status attempt_status,ea.started_at,ea.submitted_at,ea.score,e.id exam_id,e.title exam_title,e.total_marks,e.pass_marks,e.batch_id,b.batch_name,u.full_name student_name,u.email student_email,r.marks_obtained,r.published_at FROM exam_attempts ea JOIN exams e ON e.id=ea.exam_id JOIN batches b ON b.id=e.batch_id JOIN users u ON u.id=ea.student_id LEFT JOIN results r ON r.attempt_id=ea.id WHERE ea.id=? AND (e.created_by=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=e.batch_id AND bt.teacher_id=?) OR ${teacherCoveragePredicate("b")})`
         ).bind(evaluationMatch[1],user.id,user.id,user.id).first();
         if(!attempt) return reply({error:"Evaluation not found or you are not assigned to this exam."},404,request);
         const rows=await env.DB.prepare(
           "SELECT eq.id exam_question_id,q.id question_id,eq.marks,eq.negative_marks,eq.sort_order,q.question_type,q.question_text,q.explanation,sa.answer_text,sa.selected_option_ids,sa.is_correct,sa.marks_awarded,sa.teacher_feedback FROM exam_questions eq JOIN questions q ON q.id=eq.question_id LEFT JOIN student_answers sa ON sa.exam_question_id=eq.id AND sa.attempt_id=? WHERE eq.exam_id=? ORDER BY eq.sort_order"
         ).bind(attempt.attempt_id,attempt.exam_id).all();
         const options=await env.DB.prepare(
           "SELECT qo.question_id,qo.option_label,qo.option_text,qo.is_correct FROM exam_questions eq JOIN question_options qo ON qo.question_id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.sort_order,qo.sort_order"
         ).bind(attempt.exam_id).all();
         const questions=(rows.results||[]).map(q=>({
           ...q,options:(options.results||[]).filter(o=>o.question_id===q.question_id).map(o=>({label:o.option_label,text:o.option_text,is_correct:!!o.is_correct}))
         }));
         return reply({success:true,attempt,questions},200,request);
       }

       const evaluateMatch=path.match(/^\/api\/teacher\/evaluations\/([0-9a-f-]+)\/grade$/i);
       if(evaluateMatch && method==="POST"){
         const b=await body(request), attemptId=evaluateMatch[1];
         const attempt=await env.DB.prepare(
           `SELECT ea.id,ea.status,ea.exam_id,ea.student_id,e.total_marks,e.pass_marks FROM exam_attempts ea JOIN exams e ON e.id=ea.exam_id JOIN batches b ON b.id=e.batch_id WHERE ea.id=? AND (e.created_by=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=e.batch_id AND bt.teacher_id=?) OR ${teacherCoveragePredicate("b")})`
         ).bind(attemptId,user.id,user.id,user.id).first();
         if(!attempt) return reply({error:"Evaluation not found or you are not assigned to this exam."},404,request);
         if(!["submitted","evaluated"].includes(attempt.status)) return reply({error:"Only submitted attempts can be evaluated."},409,request);
         const grades=Array.isArray(b.grades)?b.grades:[];
         if(grades.length>200) return reply({error:"Too many question grades were supplied."},400,request);
         const validRows=await env.DB.prepare(
           "SELECT eq.id,q.question_type,eq.marks FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=?"
         ).bind(attempt.exam_id).all();
         const valid=new Map((validRows.results||[]).map(q=>[q.id,q]));
         const seen=new Set();
         let manualTotal=0;
         const statements=[];
         for(const grade of grades){
           const qid=text(grade.exam_question_id,64), q=valid.get(qid);
           const marks=Number(grade.marks_awarded);
           if(!q || seen.has(qid) || !["numerical","short_answer","long_answer"].includes(q.question_type) ||
              !Number.isFinite(marks) || marks<0 || marks>Number(q.marks)) {
             return reply({error:"Each manual grade must reference a unique written/numerical question and be between zero and its maximum marks."},400,request);
           }
           seen.add(qid);manualTotal+=marks;
           statements.push(env.DB.prepare("INSERT INTO student_answers(id,attempt_id,exam_question_id,marks_awarded,is_correct,teacher_feedback,answered_at) VALUES(?,?,?, ?,NULL,?,datetime('now')) ON CONFLICT(attempt_id,exam_question_id) DO UPDATE SET marks_awarded=excluded.marks_awarded,is_correct=NULL,teacher_feedback=excluded.teacher_feedback").bind(crypto.randomUUID(),attemptId,qid,marks,text(grade.teacher_feedback,2000)||null));
         }
         const remaining=validRows.results.filter(q=>["numerical","short_answer","long_answer"].includes(q.question_type));
         if(seen.size!==remaining.length) return reply({error:"Grade every numerical and written question before completing evaluation."},400,request);
         const objective=await env.DB.prepare("SELECT COALESCE(SUM(marks_awarded),0) total FROM student_answers WHERE attempt_id=? AND exam_question_id IN (SELECT eq.id FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=? AND q.question_type IN ('mcq','multiple_select'))").bind(attemptId,attempt.exam_id).first();
         const score=Math.max(0,Number(objective?.total||0)+manualTotal);
         const total=Number(attempt.total_marks||0), percentage=total>0?Math.round(score/total*10000)/100:0;
         statements.push(env.DB.prepare("UPDATE exam_attempts SET status='evaluated',score=? WHERE id=?").bind(score,attemptId));
         statements.push(env.DB.prepare("UPDATE results SET marks_obtained=?,percentage=?,evaluated_by=? WHERE attempt_id=?").bind(score,percentage,user.id,attemptId));
         await env.DB.batch(statements);
         return reply({success:true,status:"evaluated",marks_obtained:score,total_marks:total,percentage,pass:attempt.pass_marks==null?null:score>=Number(attempt.pass_marks)},200,request);
       }

       const publishEvaluationMatch=path.match(/^\/api\/teacher\/evaluations\/([0-9a-f-]+)\/publish$/i);
       if(publishEvaluationMatch && method==="POST"){
         const attempt=await env.DB.prepare(
           `SELECT ea.id,ea.status,r.published_at FROM exam_attempts ea JOIN exams e ON e.id=ea.exam_id JOIN batches b ON b.id=e.batch_id JOIN results r ON r.attempt_id=ea.id WHERE ea.id=? AND (e.created_by=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=e.batch_id AND bt.teacher_id=?) OR ${teacherCoveragePredicate("b")})`
         ).bind(publishEvaluationMatch[1],user.id,user.id,user.id).first();
         if(!attempt) return reply({error:"Result not found or you are not assigned to this exam."},404,request);
         if(attempt.status!=="evaluated") return reply({error:"Complete evaluation before publishing this result."},409,request);
         await env.DB.prepare("UPDATE results SET published_at=datetime('now') WHERE attempt_id=? AND published_at IS NULL").bind(attempt.id).run();
         return reply({success:true,published:true},200,request);
       }
     }

     const admin = await adminUser(user.id,env);

     if (!admin) return reply({error:"Admin access required"},403,request);



     // Admin-only examination monitoring and performance overview.
     if(path==="/api/admin/exam-monitoring" && method==="GET"){
       const [summary,exams]=await Promise.all([
         env.DB.prepare(
           "SELECT COUNT(*) total_exams, SUM(CASE WHEN e.status='published' THEN 1 ELSE 0 END) published_exams, SUM(CASE WHEN e.status='scheduled' THEN 1 ELSE 0 END) scheduled_exams, (SELECT COUNT(*) FROM exam_attempts) total_attempts, (SELECT COUNT(*) FROM exam_attempts WHERE status='in_progress') in_progress_attempts, (SELECT COUNT(*) FROM exam_attempts WHERE status='submitted') pending_evaluation, (SELECT COUNT(*) FROM exam_attempts WHERE status='evaluated') evaluated_attempts, (SELECT COUNT(*) FROM results WHERE published_at IS NOT NULL) published_results, (SELECT ROUND(AVG(percentage),2) FROM results WHERE published_at IS NOT NULL) average_published_percentage FROM exams e"
         ).first(),
         env.DB.prepare(
           "SELECT e.id,e.title,e.status,e.starts_at,e.ends_at,e.duration_minutes,e.total_marks,e.pass_marks,e.created_at,u.full_name teacher_name,b.batch_name,c.class_name,s.subject_name,(SELECT COUNT(*) FROM batch_students bs WHERE bs.batch_id=e.batch_id AND bs.status='active') enrolled_students,(SELECT COUNT(*) FROM exam_attempts ea WHERE ea.exam_id=e.id) attempts,(SELECT COUNT(*) FROM exam_attempts ea WHERE ea.exam_id=e.id AND ea.status='in_progress') in_progress,(SELECT COUNT(*) FROM exam_attempts ea WHERE ea.exam_id=e.id AND ea.status='submitted') pending_evaluation,(SELECT COUNT(*) FROM exam_attempts ea WHERE ea.exam_id=e.id AND ea.status='evaluated') evaluated,(SELECT COUNT(*) FROM results r WHERE r.exam_id=e.id AND r.published_at IS NOT NULL) published_results,(SELECT ROUND(AVG(r.percentage),2) FROM results r WHERE r.exam_id=e.id AND r.published_at IS NOT NULL) average_percentage FROM exams e LEFT JOIN users u ON u.id=e.created_by LEFT JOIN batches b ON b.id=e.batch_id LEFT JOIN classes c ON c.id=e.class_id LEFT JOIN subjects s ON s.id=e.subject_id ORDER BY e.created_at DESC LIMIT 250"
         ).all()
       ]);
       return reply({success:true,summary:summary||{},exams:exams.results||[]},200,request);
     }

     if (path === "/api/dashboard/stats" && method === "GET") {

       const [t,s,e,a,c,sub,b,enquiryStats] = await Promise.all([

         env.DB.prepare("SELECT COUNT(*) total FROM users WHERE role='teacher' AND deleted_at IS NULL").first(),

         env.DB.prepare("SELECT COUNT(*) total FROM users WHERE role='student' AND deleted_at IS NULL").first(),

         env.DB.prepare("SELECT COUNT(*) total FROM exams").first(),

         env.DB.prepare("SELECT COUNT(*) total FROM exam_attempts").first(),

         env.DB.prepare("SELECT COUNT(*) total FROM classes WHERE status='active'").first(),

         env.DB.prepare("SELECT COUNT(*) total FROM subjects WHERE status='active'").first(),

         env.DB.prepare("SELECT COUNT(*) total FROM batches WHERE status='active'").first(),

         env.DB.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='new' THEN 1 ELSE 0 END) new, SUM(CASE WHEN status='contacted' THEN 1 ELSE 0 END) contacted, SUM(CASE WHEN status='demo_scheduled' THEN 1 ELSE 0 END) demo_scheduled, SUM(CASE WHEN status='enrolled' THEN 1 ELSE 0 END) enrolled, SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) closed, SUM(CASE WHEN follow_up_at IS NOT NULL AND follow_up_at <= datetime('now') AND status NOT IN ('enrolled','closed') THEN 1 ELSE 0 END) follow_up_due FROM enquiries").first()

       ]);

       return reply({success:true,stats:{teachers:t?.total||0,students:s?.total||0,exams:e?.total||0,attempts:a?.total||0,classes:c?.total||0,subjects:sub?.total||0,batches:b?.total||0,enquiries:{total:enquiryStats?.total||0,new:enquiryStats?.new||0,contacted:enquiryStats?.contacted||0,demo_scheduled:enquiryStats?.demo_scheduled||0,enrolled:enquiryStats?.enrolled||0,closed:enquiryStats?.closed||0,follow_up_due:enquiryStats?.follow_up_due||0}}},200,request);

     }



// Teacher accounts*

     if (path === "/api/teachers" && method === "GET") {

       const r = await env.DB.prepare("SELECT id,full_name,email,status,created_at FROM users WHERE role='teacher' AND deleted_at IS NULL ORDER BY created_at DESC").all();

       return reply({success:true,teachers:r.results||[]},200,request);

     }

     if (path === "/api/teachers" && method === "POST") {

       const b = await body(request);

       try { const teacher=await inviteRole(b,"teacher",env,admin.id); return reply({success:true,teacher,message:teacher.restored?"Teacher restored. A fresh activation email was sent; approval is pending.":"Invitation sent. Access is pending Admin approval."},teacher.restored?200:201,request); }

       catch(e){ return reply({error:e.message},400,request); }

     }

     let m = path.match(/^\/api\/teachers\/([0-9a-f-]+)\/status$/i);

     if (m && method === "PATCH") {

       const b=await body(request);

       if (!["pending","approved","inactive"].includes(b.status)) return reply({error:"Invalid status"},400,request);

       const r=await env.DB.prepare("UPDATE users SET status=? WHERE id=? AND role='teacher' AND deleted_at IS NULL").bind(b.status,m[1]).run();

       if (!r.meta?.changes) return reply({error:"Active teacher not found"},404,request);

       return reply({success:true,status:b.status},200,request);

     }

     m=path.match(/^\/api\/teachers\/([0-9a-f-]+)$/i);

     if (m && method === "DELETE") {

       const id=m[1], teacher=await env.DB.prepare("SELECT id,full_name,email FROM users WHERE id=? AND role='teacher' AND deleted_at IS NULL").bind(id).first();

       if (!teacher) return reply({error:"Active teacher not found"},404,request);

       const auditId=crypto.randomUUID();

       const details=JSON.stringify({full_name:teacher.full_name,email:teacher.email});

       const result=await env.DB.batch([

         env.DB.prepare("UPDATE users SET status='inactive',deleted_at=datetime('now'),deleted_by=? WHERE id=? AND role='teacher' AND deleted_at IS NULL").bind(admin.id,id),

         env.DB.prepare("INSERT INTO audit_logs(id,actor_id,action,entity_type,entity_id,details) VALUES(?,?,'teacher_removed','user',?,?)").bind(auditId,admin.id,id,details)

       ]);

       if (!result[0]?.meta?.changes) return reply({error:"Teacher could not be removed"},409,request);

       return reply({success:true,message:"Teacher removed. Historical records are preserved."},200,request);

     }



// Students (student accounts only; no parent accounts)*

     if (path === "/api/students" && method === "GET") {

       const r=await env.DB.prepare("SELECT id,full_name,email,status,created_at FROM users WHERE role='student' AND deleted_at IS NULL ORDER BY created_at DESC").all();

       return reply({success:true,students:r.results||[]},200,request);

     }

     if (path === "/api/students" && method === "POST") {

       const b=await body(request);

       try { const student=await inviteRole(b,"student",env,admin.id); return reply({success:true,student,message:student.restored?"Student restored. A fresh activation email was sent; approval is pending.":"Student invitation sent. Access is pending approval."},student.restored?200:201,request); }

       catch(e){ return reply({error:e.message},400,request); }

     }

     m=path.match(/^\/api\/students\/([0-9a-f-]+)\/status$/i);

     if (m && method === "PATCH") {

       const b=await body(request);

       if (!["pending","approved","inactive"].includes(b.status)) return reply({error:"Invalid status"},400,request);

       const r=await env.DB.prepare("UPDATE users SET status=? WHERE id=? AND role='student' AND deleted_at IS NULL").bind(b.status,m[1]).run();

       if (!r.meta?.changes) return reply({error:"Student not found"},404,request);

       return reply({success:true,status:b.status},200,request);

     }



// Curriculum, competitive-exam pathways and academic-year master data*

     if (path === "/api/master-data" && method === "GET") {

       const [curricula, pathways, years] = await Promise.all([

         env.DB.prepare("SELECT id,name,status FROM curricula WHERE status='active' ORDER BY sort_order,name").all(),

         env.DB.prepare("SELECT id,name,status FROM exam_pathways WHERE status='active' ORDER BY sort_order,name").all(),

         env.DB.prepare("SELECT id,name,start_date,end_date,is_active FROM academic_years ORDER BY name DESC").all()

       ]);

       return reply({success:true,curricula:curricula.results||[],pathways:pathways.results||[],academic_years:years.results||[]},200,request);

     }

     if (path === "/api/curricula" && method === "POST") {

       const b=await body(request), name=text(b.name,100);

       if (!name) return reply({error:"Curriculum name is required"},400,request);

       const id=crypto.randomUUID();

       try { await env.DB.prepare("INSERT INTO curricula(id,name,status,sort_order) VALUES(?,?,'active',100)").bind(id,name).run(); }

       catch { return reply({error:"This curriculum already exists"},409,request); }

       return reply({success:true,id},201,request);

     }

     if (path === "/api/exam-pathways" && method === "POST") {

       const b=await body(request), name=text(b.name,100);

       if (!name) return reply({error:"Exam pathway name is required"},400,request);

       const id=crypto.randomUUID();

       try { await env.DB.prepare("INSERT INTO exam_pathways(id,name,status,sort_order) VALUES(?,?,'active',100)").bind(id,name).run(); }

       catch { return reply({error:"This exam pathway already exists"},409,request); }

       return reply({success:true,id},201,request);

     }

     m=path.match(/^\/api\/(curricula|exam-pathways)\/([0-9a-f-]+)\/status$/i);

     if (m && method === "PATCH") {

       const b=await body(request);

       if (!["active","inactive"].includes(b.status)) return reply({error:"Invalid status"},400,request);

       const table=m[1]==="curricula"?"curricula":"exam_pathways";

       const r=await env.DB.prepare(`UPDATE ${table} SET status=? WHERE id=?`).bind(b.status,m[2]).run();

       if (!r.meta?.changes) return reply({error:"Master-data item not found"},404,request);

       return reply({success:true},200,request);

     }

     if (path === "/api/academic-years" && method === "POST") {

       const b=await body(request), name=text(b.name,30);

       if (!name) return reply({error:"Academic year is required"},400,request);

       const id=crypto.randomUUID();

       try {

         if (b.is_active) await env.DB.prepare("UPDATE academic_years SET is_active=0").run();

         await env.DB.prepare("INSERT INTO academic_years(id,name,start_date,end_date,is_active) VALUES(?,?,?,?,?)").bind(id,name,b.start_date||null,b.end_date||null,b.is_active?1:0).run();

       } catch { return reply({error:"This academic year already exists or could not be saved"},409,request); }

       return reply({success:true,id},201,request);

     }

     if (path === "/api/academic-years/active" && method === "PATCH") {

       const b=await body(request), id=text(b.id,64);

       const year=await env.DB.prepare("SELECT id FROM academic_years WHERE id=?").bind(id).first();

       if (!year) return reply({error:"Academic year not found"},404,request);

       await env.DB.batch([

         env.DB.prepare("UPDATE academic_years SET is_active=0"),

         env.DB.prepare("UPDATE academic_years SET is_active=1 WHERE id=?").bind(id)

       ]);

       return reply({success:true},200,request);

     }



// Classes*

     if (path === "/api/classes" && method === "GET") {

       const r=await env.DB.prepare("SELECT c.id,c.class_name,c.section,c.academic_year,c.status,c.created_at,c.curriculum_id,cu.name curriculum_name FROM classes c LEFT JOIN curricula cu ON cu.id=c.curriculum_id ORDER BY cu.name,c.class_name,c.section").all();

       return reply({success:true,classes:r.results||[]},200,request);

     }

     if (path === "/api/classes" && method === "POST") {

       const b=await body(request), name=text(b.class_name,80), curriculumId=text(b.curriculum_id,64), yearId=text(b.academic_year_id,64);

       if (!name || !curriculumId || !yearId) return reply({error:"Enter a class name, curriculum and academic year"},400,request);

       const curriculum=await env.DB.prepare("SELECT id FROM curricula WHERE id=?").bind(curriculumId).first();

       const year=await env.DB.prepare("SELECT id,name FROM academic_years WHERE id=? AND is_active=1").bind(yearId).first();

       if (!curriculum) return reply({error:"Select an active curriculum"},400,request);

       if (!year) return reply({error:"Select the active academic year"},400,request);

       const result=await env.DB.prepare("INSERT INTO classes(class_name,section,academic_year,status,curriculum_id) VALUES(?,?,?,'active',?)").bind(name,text(b.section,30)||null,year.name,curriculumId).run();

       return reply({success:true,id:result.meta?.last_row_id},201,request);

     }

     m=path.match(/^\/api\/classes\/(\d+)$/i);
     if (m && method === "PATCH") {
       const b=await body(request), name=text(b.class_name,80), section=text(b.section,30)||null, curriculumId=text(b.curriculum_id,64), yearName=text(b.academic_year,80);
       if (!name || !curriculumId || !yearName) return reply({error:"Enter a class name, curriculum and academic year"},400,request);
       const [curriculum,year]=await Promise.all([
         env.DB.prepare("SELECT id FROM curricula WHERE id=? AND status='active'").bind(curriculumId).first(),
         env.DB.prepare("SELECT id,name FROM academic_years WHERE name=?").bind(yearName).first()
       ]);
       if (!curriculum) return reply({error:"Select an active curriculum"},400,request);
       if (!year) return reply({error:"Select a valid academic year"},400,request);
       const r=await env.DB.prepare("UPDATE classes SET class_name=?,section=?,academic_year=?,curriculum_id=? WHERE id=?").bind(name,section,year.name,curriculumId,m[1]).run();
       if (!r.meta?.changes) return reply({error:"Class not found"},404,request);
       return reply({success:true},200,request);
     }

     m=path.match(/^\/api\/classes\/(\d+)\/status$/i);

     if (m && method === "PATCH") {

       const b=await body(request);

       if (!["active","inactive"].includes(b.status)) return reply({error:"Invalid status"},400,request);

       const r=await env.DB.prepare("UPDATE classes SET status=? WHERE id=?").bind(b.status,m[1]).run();

       if (!r.meta?.changes) return reply({error:"Class not found"},404,request);

       return reply({success:true},200,request);

     }



// Subjects*

     if (path === "/api/subjects" && method === "GET") {

       const r=await env.DB.prepare("SELECT id,subject_name,status,created_at FROM subjects ORDER BY subject_name").all();

       return reply({success:true,subjects:r.results||[]},200,request);

     }

     if (path === "/api/subjects" && method === "POST") {

       const b=await body(request), name=text(b.subject_name,80);

       if (!name) return reply({error:"Subject name is required"},400,request);

// subjects.id is INTEGER PRIMARY KEY; let D1 generate it.*

       const result=await env.DB.prepare("INSERT INTO subjects(subject_name,status) VALUES(?,'active')").bind(name).run();

       return reply({success:true,id:result.meta?.last_row_id},201,request);

     }

// Subject IDs are INTEGER in the existing D1 schema.*

     m=path.match(/^\/api\/subjects\/(\d+)$/i);
     if (m && method === "PATCH") {
       const b=await body(request), name=text(b.subject_name,80);
       if (!name) return reply({error:"Subject name is required"},400,request);
       const r=await env.DB.prepare("UPDATE subjects SET subject_name=? WHERE id=?").bind(name,m[1]).run();
       if (!r.meta?.changes) return reply({error:"Subject not found"},404,request);
       return reply({success:true},200,request);
     }

     m=path.match(/^\/api\/subjects\/(\d+)\/status$/i);

     if (m && method === "PATCH") {

       const b=await body(request);

       if (!["active","inactive"].includes(b.status)) return reply({error:"Invalid status"},400,request);

       const r=await env.DB.prepare("UPDATE subjects SET status=? WHERE id=?").bind(b.status,m[1]).run();

       if (!r.meta?.changes) return reply({error:"Subject not found"},404,request);

       return reply({success:true},200,request);

     }



// Batches*

     if (path === "/api/batches" && method === "GET") {

       const r=await env.DB.prepare(

         "SELECT b.id,b.batch_name,b.class_id,b.subject_id,b.academic_year_id,b.batch_type,b.capacity,b.status,b.start_date,b.end_date,c.class_name,s.subject_name,ay.name academic_year,cu.name curriculum_name FROM batches b LEFT JOIN classes c ON c.id=b.class_id LEFT JOIN subjects s ON s.id=b.subject_id LEFT JOIN academic_years ay ON ay.id=b.academic_year_id LEFT JOIN curricula cu ON cu.id=c.curriculum_id ORDER BY b.created_at DESC"

       ).all();

       return reply({success:true,batches:r.results||[]},200,request);

     }

     if (path === "/api/batches" && method === "POST") {

       const b=await body(request), name=text(b.batch_name,120), type=b.batch_type;

       const classId=text(b.class_id,64), subjectId=text(b.subject_id,64), yearId=text(b.academic_year_id,64);

       if (!name || !["group","one_to_one"].includes(type) || !classId || !subjectId || !yearId)

         return reply({error:"Batch name, type, class, subject and academic year are all required"},400,request);

       const [cls,sub,year]=await Promise.all([

         env.DB.prepare("SELECT id,academic_year,curriculum_id FROM classes WHERE id=? AND status='active'").bind(classId).first(),

         env.DB.prepare("SELECT id FROM subjects WHERE id=? AND status='active'").bind(subjectId).first(),

         env.DB.prepare("SELECT id,name FROM academic_years WHERE id=? AND is_active=1").bind(yearId).first()

       ]);

       if (!cls) return reply({error:"Select an active class"},400,request);

       if (!sub) return reply({error:"Select an active subject"},400,request);

       if (!year) return reply({error:"Select the active academic year"},400,request);

       if (String(cls.academic_year)!==String(year.name)) return reply({error:"The selected class does not belong to the selected academic year"},400,request);

       if (type==="group" && !(Number(b.capacity)>0)) return reply({error:"Enter the maximum student capacity for a group batch"},400,request);

       const capacity=type==="one_to_one"?1:Number(b.capacity);

       if (b.start_date && b.end_date && b.end_date < b.start_date) return reply({error:"End date cannot be earlier than start date"},400,request);

       const id=crypto.randomUUID();

       await env.DB.prepare(

         "INSERT INTO batches(id,batch_name,class_id,subject_id,academic_year_id,batch_type,capacity,status,start_date,end_date,created_by) VALUES(?,?,?,?,?,?,?,'active',?,?,?)"

       ).bind(id,name,classId,subjectId,yearId,type,capacity,b.start_date||null,b.end_date||null,admin.id).run();

       return reply({success:true,id},201,request);

     }

     m=path.match(/^\/api\/batches\/([0-9a-f-]+)$/i);

     if (m && method === "DELETE") {

       const id=m[1], batch=await env.DB.prepare("SELECT id,batch_name FROM batches WHERE id=? AND status='active'").bind(id).first();

       if (!batch) return reply({error:"Active batch not found"},404,request);

       await env.DB.batch([

         env.DB.prepare("UPDATE batches SET status='inactive',updated_at=datetime('now') WHERE id=? AND status='active'").bind(id),

         env.DB.prepare("INSERT INTO audit_logs(id,actor_id,action,entity_type,entity_id,details) VALUES(?,?,'batch_removed','batch',?,?)").bind(crypto.randomUUID(),admin.id,id,JSON.stringify({batch_name:batch.batch_name}))

       ]);

       return reply({success:true,message:"Batch removed from active use. Historical records are preserved."},200,request);

     }

     m=path.match(/^\/api\/batches\/([0-9a-f-]+)\/status$/i);

     if (m && method === "PATCH") {

       const b=await body(request);

       if (!["active","inactive","completed"].includes(b.status)) return reply({error:"Invalid batch status"},400,request);

       const r=await env.DB.prepare("UPDATE batches SET status=? WHERE id=?").bind(b.status,m[1]).run();

       if (!r.meta?.changes) return reply({error:"Batch not found"},404,request);

       return reply({success:true},200,request);

     }



// Teacher-to-class-and-subject assignment*

     if (path === "/api/teacher-assignments" && method === "GET") {

       const r=await env.DB.prepare(

         "SELECT ta.id,ta.teacher_id,ta.class_id,ta.subject_id,u.full_name teacher_name,c.class_name,s.subject_name FROM teacher_assignments ta JOIN users u ON u.id=ta.teacher_id LEFT JOIN classes c ON c.id=ta.class_id LEFT JOIN subjects s ON s.id=ta.subject_id WHERE u.status='approved' AND u.deleted_at IS NULL ORDER BY c.class_name,s.subject_name"

       ).all();

       return reply({success:true,assignments:r.results||[]},200,request);

     }

     if (path === "/api/teacher-assignments" && method === "POST") {

       const b=await body(request);

       const t=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='teacher' AND status='approved' AND deleted_at IS NULL").bind(b.teacher_id||"").first();

       if (!t || !b.class_id || !b.subject_id) return reply({error:"Select an approved teacher, class and subject"},400,request);

       try {
         const result = await env.DB.prepare(
           "INSERT INTO teacher_assignments(teacher_id,class_id,subject_id) VALUES(?,?,?)"
         ).bind(t.id,Number(b.class_id),Number(b.subject_id)).run();
         return reply({success:true,id:result.meta?.last_row_id},201,request);
       } catch {
         return reply({error:"This teacher may already be assigned to this class and subject"},409,request);
       }

     }

     m=path.match(/^\/api\/teacher-assignments\/([0-9a-f-]+)$/i);

     if (m && method === "DELETE") {

       const r=await env.DB.prepare("DELETE FROM teacher_assignments WHERE id=?").bind(m[1]).run();

       if (!r.meta?.changes) return reply({error:"Assignment not found"},404,request);

       return reply({success:true},200,request);

     }



// Teacher assignment to batch*

     m=path.match(/^\/api\/batches\/([0-9a-f-]+)\/teachers$/i);

     if (m && method === "POST") {

       const b=await body(request);

       const t=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='teacher' AND status='approved' AND deleted_at IS NULL").bind(b.teacher_id||"").first();

       if (!t) return reply({error:"Select an approved active teacher"},400,request);

       const id=crypto.randomUUID();

       try { await env.DB.prepare("INSERT INTO batch_teachers(id,batch_id,teacher_id) VALUES(?,?,?)").bind(id,m[1],t.id).run(); }

       catch { return reply({error:"Teacher is already assigned to this batch"},409,request); }

       return reply({success:true,id},201,request);

     }

// Student enrollment in batch*

     m=path.match(/^\/api\/batches\/([0-9a-f-]+)\/students$/i);

     if (m && method === "POST") {

       const b=await body(request);

       const s=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='student' AND status='approved' AND deleted_at IS NULL").bind(b.student_id||"").first();

       if (!s) return reply({error:"Select an approved active student"},400,request);

       const id=crypto.randomUUID();

       try { await env.DB.prepare("INSERT INTO batch_students(id,batch_id,student_id) VALUES(?,?,?)").bind(id,m[1],s.id).run(); }

       catch { return reply({error:"Student is already enrolled in this batch"},409,request); }

       return reply({success:true,id},201,request);

     }



     return reply({error:"Not found"},404,request);

   } catch (e) {

     console.error(e);

     const status=e.message==="Invalid JSON"?400:e.message==="Request too large"?413:500;

     return reply({error:status===500?"Internal server error":e.message},status,request);

   }

 }

}
