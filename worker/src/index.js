// SOURCE SNAPSHOT
// Transcribed from the Worker source supplied for the DhyanshEdu review.
// This is not independently confirmed as the currently deployed Worker.
// Reviewed syntax after removing pasted-document escaping; do not deploy without
// environment binding review, API tests, and approval.

const ALLOWED_ORIGINS = [

 "https\://dhyanshedu-lab.github.io",

 "https\://dhyanshedu-exam-portal.dhyanshedu.workers.dev"

];



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

 const r = await fetch(`${env.SUPABASE_URL}/auth/v1/invite`, {

   method: "POST",

   headers: {

     apikey: env.SUPABASE_SECRET_KEY,

     Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,

     "Content-Type": "application/json"

   },

   body: JSON.stringify({ email, data: { full_name: name, role } })

 });

 const d = await r.json().catch(() => ({}));

 if (!r.ok) throw new Error(d.msg || d.message || "Invitation failed; check Supabase email settings.");

 const id = d.id || d.user?.id;

 if (!id) throw new Error("Invitation response did not include user ID.");

 return id;

}

async function rollbackInvite(id, env) {

 await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${id}`, {

   method: "DELETE",

   headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` }

 });

}

async function inviteRole(b, role, env) {

 const name = text(b.full_name,120);

 const email = text(b.email,254).toLowerCase();

 if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid full name and email.");

 const old = await env.DB.prepare("SELECT id FROM users WHERE lower(email)=?").bind(email).first();

 if (old) throw new Error("This email is already registered.");

 const id = await invite(email,name,role,env);

 try {

   await env.DB.prepare("INSERT INTO users(id,full_name,email,role,status) VALUES(?,?,?,?,'pending')")

     .bind(id,name,email,role).run();

 } catch (e) {

   await rollbackInvite(id,env);

   throw e;

 }

 return { id, full_name:name, email, status:"pending" };

}



export default {

 async fetch(request, env) {

   try {

     const url = new URL(request.url), path = url.pathname, method = request.method;

     if (method === "OPTIONS") return new Response(null,{status:204,headers:corsHeaders(request)});

     if (path === "/api/health" && method === "GET") return reply({success:true,service:"DhyanshEdu API"},200,request);

     if (!path.startsWith("/api/")) return reply({error:"Not found"},404,request);



     const user = await authUser(request,env);

     if (!user?.id) return reply({error:"Authentication required"},401,request);



     if (path === "/api/me" && method === "GET") {

       const profile = await env.DB.prepare(

         "SELECT id,full_name,email,role,status FROM users WHERE id=? AND status='approved' AND deleted_at IS NULL"

       ).bind(user.id).first();

       if (!profile) return reply({error:"Account is pending approval or inactive"},403,request);

       return reply({success:true,profile},200,request);

     }



     const admin = await adminUser(user.id,env);

     if (!admin) return reply({error:"Admin access required"},403,request);



     if (path === "/api/dashboard/stats" && method === "GET") {

       const [t,s,e,a,c,sub,b] = await Promise.all([

         env.DB.prepare("SELECT COUNT(\*) total FROM users WHERE role='teacher' AND deleted_at IS NULL").first(),

         env.DB.prepare("SELECT COUNT(\*) total FROM users WHERE role='student' AND deleted_at IS NULL").first(),

         env.DB.prepare("SELECT COUNT(\*) total FROM exams").first(),

         env.DB.prepare("SELECT COUNT(\*) total FROM exam_attempts").first(),

         env.DB.prepare("SELECT COUNT(\*) total FROM classes WHERE status='active'").first(),

         env.DB.prepare("SELECT COUNT(\*) total FROM subjects WHERE status='active'").first(),

         env.DB.prepare("SELECT COUNT(\*) total FROM batches WHERE status='active'").first()

       ]);

       return reply({success:true,stats:{teachers:t?.total||0,students:s?.total||0,exams:e?.total||0,attempts:a?.total||0,classes:c?.total||0,subjects:sub?.total||0,batches:b?.total||0}},200,request);

     }



*// Teacher accounts*

     if (path === "/api/teachers" && method === "GET") {

       const r = await env.DB.prepare("SELECT id,full_name,email,status,created_at FROM users WHERE role='teacher' AND deleted_at IS NULL ORDER BY created_at DESC").all();

       return reply({success:true,teachers:r.results||[]},200,request);

     }

     if (path === "/api/teachers" && method === "POST") {

       const b = await body(request);

       try { const teacher=await inviteRole(b,"teacher",env); return reply({success:true,teacher,message:"Invitation sent. Access is pending Admin approval."},201,request); }

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



*// Students (student accounts only; no parent accounts)*

     if (path === "/api/students" && method === "GET") {

       const r=await env.DB.prepare("SELECT id,full_name,email,status,created_at FROM users WHERE role='student' AND deleted_at IS NULL ORDER BY created_at DESC").all();

       return reply({success:true,students:r.results||[]},200,request);

     }

     if (path === "/api/students" && method === "POST") {

       const b=await body(request);

       try { const student=await inviteRole(b,"student",env); return reply({success:true,student,message:"Student invitation sent. Access is pending approval."},201,request); }

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



*// Curriculum, competitive-exam pathways and academic-year master data*

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



*// Classes*

     if (path === "/api/classes" && method === "GET") {

       const r=await env.DB.prepare("SELECT c.id,c.class_name,c.section,c.academic_year,c.status,c.created_at,c.curriculum_id,cu.name curriculum_name FROM classes c LEFT JOIN curricula cu ON cu.id=c.curriculum_id ORDER BY cu.name,c.class_name,c.section").all();

       return reply({success:true,classes:r.results||[]},200,request);

     }

     if (path === "/api/classes" && method === "POST") {

       const b=await body(request), name=text(b.class_name,80), curriculumId=text(b.curriculum_id,64), yearId=text(b.academic_year_id,64);

       if (!name || !curriculumId || !yearId) return reply({error:"Enter a class name, curriculum and academic year"},400,request);

       const curriculum=await env.DB.prepare("SELECT id FROM curricula WHERE id=? AND status='active'").bind(curriculumId).first();

       const year=await env.DB.prepare("SELECT id,name FROM academic_years WHERE id=? AND is_active=1").bind(yearId).first();

       if (!curriculum) return reply({error:"Select an active curriculum"},400,request);

       if (!year) return reply({error:"Select the active academic year"},400,request);

       const result=await env.DB.prepare("INSERT INTO classes(class_name,section,academic_year,status,curriculum_id) VALUES(?,?,?,'active',?)").bind(name,text(b.section,30)||null,year.name,curriculumId).run();

       return reply({success:true,id:result.meta?.last_row_id},201,request);

     }

     m=path.match(/^\/api\/classes\/(\d+)\/status$/i);

     if (m && method === "PATCH") {

       const b=await body(request);

       if (!["active","inactive"].includes(b.status)) return reply({error:"Invalid status"},400,request);

       const r=await env.DB.prepare("UPDATE classes SET status=? WHERE id=?").bind(b.status,m[1]).run();

       if (!r.meta?.changes) return reply({error:"Class not found"},404,request);

       return reply({success:true},200,request);

     }



*// Subjects*

     if (path === "/api/subjects" && method === "GET") {

       const r=await env.DB.prepare("SELECT id,subject_name,status,created_at FROM subjects ORDER BY subject_name").all();

       return reply({success:true,subjects:r.results||[]},200,request);

     }

     if (path === "/api/subjects" && method === "POST") {

       const b=await body(request), name=text(b.subject_name,80);

       if (!name) return reply({error:"Subject name is required"},400,request);

*// subjects.id is INTEGER PRIMARY KEY; let D1 generate it.*

       const result=await env.DB.prepare("INSERT INTO subjects(subject_name,status) VALUES(?,'active')").bind(name).run();

       return reply({success:true,id:result.meta?.last_row_id},201,request);

     }

*// Subject IDs are INTEGER in the existing D1 schema.*

     m=path.match(/^\/api\/subjects\/(\d+)\/status$/i);

     if (m && method === "PATCH") {

       const b=await body(request);

       if (!["active","inactive"].includes(b.status)) return reply({error:"Invalid status"},400,request);

       const r=await env.DB.prepare("UPDATE subjects SET status=? WHERE id=?").bind(b.status,m[1]).run();

       if (!r.meta?.changes) return reply({error:"Subject not found"},404,request);

       return reply({success:true},200,request);

     }



*// Batches*

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



*// Teacher-to-class-and-subject assignment*

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

       const id=crypto.randomUUID();

       try { await env.DB.prepare("INSERT INTO teacher_assignments(id,teacher_id,class_id,subject_id) VALUES(?,?,?,?)").bind(id,t.id,b.class_id,b.subject_id).run(); }

       catch { return reply({error:"This teacher may already be assigned to this class and subject"},409,request); }

       return reply({success:true,id},201,request);

     }

     m=path.match(/^\/api\/teacher-assignments\/([0-9a-f-]+)$/i);

     if (m && method === "DELETE") {

       const r=await env.DB.prepare("DELETE FROM teacher_assignments WHERE id=?").bind(m[1]).run();

       if (!r.meta?.changes) return reply({error:"Assignment not found"},404,request);

       return reply({success:true},200,request);

     }



*// Teacher assignment to batch*

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

*// Student enrollment in batch*

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

};