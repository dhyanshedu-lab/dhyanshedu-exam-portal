// DhyanshEdu Cloudflare Worker — consolidated working source
// Transcribed from the Worker source supplied for the DhyanshEdu review.
// Based on the Worker source supplied for this project; deployed version has not been independently diffed.
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



     const account = await env.DB.prepare(
       "SELECT id,role FROM users WHERE id=? AND status='approved' AND deleted_at IS NULL"
     ).bind(user.id).first();
     if (!account) return reply({error:"Account is pending approval or inactive"},403,request);

     // Read-only teacher/student workspace APIs. All records are scoped to the signed-in user.
     if (account.role === "teacher" || account.role === "student") {
       const isTeacher = account.role === "teacher";

       if (path === "/api/workspace" && method === "GET") {
         const [batches, assignments, materials, liveClasses] = await Promise.all([
           isTeacher
             ? env.DB.prepare("SELECT COUNT(*) total FROM batch_teachers bt JOIN batches b ON b.id=bt.batch_id WHERE bt.teacher_id=? AND b.status='active'").bind(user.id).first()
             : env.DB.prepare("SELECT COUNT(*) total FROM batch_students bs JOIN batches b ON b.id=bs.batch_id WHERE bs.student_id=? AND bs.status='active' AND b.status='active'").bind(user.id).first(),
           isTeacher
             ? env.DB.prepare("SELECT COUNT(*) total FROM assignments a WHERE a.status='published' AND (a.teacher_id=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=a.batch_id AND bt.teacher_id=?))").bind(user.id,user.id).first()
             : env.DB.prepare("SELECT COUNT(*) total FROM assignments a WHERE a.status='published' AND (EXISTS (SELECT 1 FROM batch_students bs WHERE bs.batch_id=a.batch_id AND bs.student_id=? AND bs.status='active') OR EXISTS (SELECT 1 FROM batch_students bs JOIN batches b ON b.id=bs.batch_id WHERE bs.student_id=? AND bs.status='active' AND b.class_id=a.class_id))").bind(user.id,user.id).first(),
           isTeacher
             ? env.DB.prepare("SELECT COUNT(*) total FROM study_materials sm WHERE sm.deleted_at IS NULL AND sm.teacher_id=?").bind(user.id).first()
             : env.DB.prepare("SELECT COUNT(*) total FROM study_materials sm WHERE sm.deleted_at IS NULL AND (sm.visibility='all_students' OR EXISTS (SELECT 1 FROM batch_students bs WHERE bs.student_id=? AND bs.status='active' AND bs.batch_id=sm.batch_id))").bind(user.id).first(),
           isTeacher
             ? env.DB.prepare("SELECT COUNT(*) total FROM live_classes lc WHERE lc.teacher_id=? AND lc.status IN ('scheduled','live')").bind(user.id).first()
             : env.DB.prepare("SELECT COUNT(*) total FROM live_classes lc WHERE lc.status IN ('scheduled','live') AND (EXISTS (SELECT 1 FROM batch_students bs WHERE bs.student_id=? AND bs.status='active' AND bs.batch_id=lc.batch_id) OR (lc.batch_id IS NULL AND EXISTS (SELECT 1 FROM batch_students bs JOIN batches b ON b.id=bs.batch_id WHERE bs.student_id=? AND bs.status='active' AND b.class_id=lc.class_id)))").bind(user.id,user.id).first()
         ]);
         return reply({success:true,role:account.role,stats:{
           batches:batches?.total||0,assignments:assignments?.total||0,
           materials:materials?.total||0,upcoming_classes:liveClasses?.total||0
         }},200,request);
       }

       if (path === "/api/my/batches" && method === "GET") {
         const result = isTeacher
           ? await env.DB.prepare("SELECT b.id,b.batch_name,b.batch_type,b.status,b.class_id,b.subject_id,c.class_name,s.subject_name FROM batch_teachers bt JOIN batches b ON b.id=bt.batch_id LEFT JOIN classes c ON c.id=b.class_id LEFT JOIN subjects s ON s.id=b.subject_id WHERE bt.teacher_id=? ORDER BY b.batch_name").bind(user.id).all()
           : await env.DB.prepare("SELECT b.id,b.batch_name,b.batch_type,b.status,b.class_id,b.subject_id,c.class_name,s.subject_name,bs.enrolled_at FROM batch_students bs JOIN batches b ON b.id=bs.batch_id LEFT JOIN classes c ON c.id=b.class_id LEFT JOIN subjects s ON s.id=b.subject_id WHERE bs.student_id=? AND bs.status='active' ORDER BY b.batch_name").bind(user.id).all();
         return reply({success:true,batches:result.results||[]},200,request);
       }

       if (path === "/api/my/assignments" && method === "GET") {
         const result = isTeacher
           ? await env.DB.prepare("SELECT DISTINCT a.id,a.title,a.instructions,a.due_at,a.max_marks,a.status,a.created_at,c.class_name,s.subject_name,b.batch_name FROM assignments a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN subjects s ON s.id=a.subject_id LEFT JOIN batches b ON b.id=a.batch_id WHERE a.status IN ('draft','published','closed') AND (a.teacher_id=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=a.batch_id AND bt.teacher_id=?)) ORDER BY a.due_at").bind(user.id,user.id).all()
           : await env.DB.prepare("SELECT DISTINCT a.id,a.title,a.instructions,a.due_at,a.max_marks,a.status,a.created_at,c.class_name,s.subject_name,b.batch_name,sub.status submission_status,sub.submitted_at,sub.marks_awarded,sub.teacher_feedback FROM assignments a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN subjects s ON s.id=a.subject_id LEFT JOIN batches b ON b.id=a.batch_id LEFT JOIN assignment_submissions sub ON sub.assignment_id=a.id AND sub.student_id=? WHERE a.status='published' AND (EXISTS (SELECT 1 FROM batch_students bs WHERE bs.batch_id=a.batch_id AND bs.student_id=? AND bs.status='active') OR EXISTS (SELECT 1 FROM batch_students bs JOIN batches eb ON eb.id=bs.batch_id WHERE bs.student_id=? AND bs.status='active' AND eb.class_id=a.class_id)) ORDER BY a.due_at").bind(user.id,user.id,user.id).all();
         return reply({success:true,assignments:result.results||[]},200,request);
       }

       if (path === "/api/my/materials" && method === "GET") {
         const result = isTeacher
           ? await env.DB.prepare("SELECT id,title,description,class_id,subject_id,batch_id,file_name,mime_type,file_size_bytes,created_at FROM study_materials WHERE teacher_id=? AND deleted_at IS NULL ORDER BY created_at DESC").bind(user.id).all()
           : await env.DB.prepare("SELECT DISTINCT sm.id,sm.title,sm.description,sm.class_id,sm.subject_id,sm.batch_id,sm.file_name,sm.mime_type,sm.file_size_bytes,sm.created_at FROM study_materials sm WHERE sm.deleted_at IS NULL AND (sm.visibility='all_students' OR EXISTS (SELECT 1 FROM batch_students bs WHERE bs.student_id=? AND bs.status='active' AND bs.batch_id=sm.batch_id)) ORDER BY sm.created_at DESC").bind(user.id).all();
         return reply({success:true,materials:result.results||[]},200,request);
       }

       if (path === "/api/my/live-classes" && method === "GET") {
         const result = isTeacher
           ? await env.DB.prepare("SELECT id,title,description,batch_id,class_id,subject_id,meeting_provider,meeting_url,starts_at,ends_at,status FROM live_classes WHERE teacher_id=? ORDER BY starts_at").bind(user.id).all()
           : await env.DB.prepare("SELECT DISTINCT lc.id,lc.title,lc.description,lc.batch_id,lc.class_id,lc.subject_id,lc.meeting_provider,lc.meeting_url,lc.starts_at,lc.ends_at,lc.status FROM live_classes lc WHERE lc.status<>'cancelled' AND (EXISTS (SELECT 1 FROM batch_students bs WHERE bs.student_id=? AND bs.status='active' AND bs.batch_id=lc.batch_id) OR (lc.batch_id IS NULL AND EXISTS (SELECT 1 FROM batch_students bs JOIN batches b ON b.id=bs.batch_id WHERE bs.student_id=? AND bs.status='active' AND b.class_id=lc.class_id))) ORDER BY lc.starts_at").bind(user.id,user.id).all();
         return reply({success:true,live_classes:result.results||[]},200,request);
       }
     }

     // Student exam centre. Correct answers are never returned by read endpoints.
     if (account.role === "student") {
       if (path === "/api/student/exams" && method === "GET") {
         const rows=await env.DB.prepare(
           "SELECT e.id,e.title,e.description,e.duration_minutes,e.total_marks,e.pass_marks,e.starts_at,e.ends_at,e.status,e.show_results_immediately,b.batch_name,ea.id attempt_id,ea.status attempt_status,ea.started_at,ea.submitted_at,r.marks_obtained,r.percentage,r.published_at FROM exams e JOIN batches b ON b.id=e.batch_id JOIN batch_students bs ON bs.batch_id=b.id AND bs.student_id=? AND bs.status='active' LEFT JOIN exam_attempts ea ON ea.exam_id=e.id AND ea.student_id=? LEFT JOIN results r ON r.attempt_id=ea.id WHERE e.status IN ('scheduled','published','closed') AND b.status='active' ORDER BY COALESCE(e.starts_at,e.created_at) DESC"
         ).bind(user.id,user.id).all();
         const now=Date.now();
         const exams=(rows.results||[]).map(e=>({
           ...e,
           availability: e.attempt_id ? e.attempt_status : (
             e.status==="closed" || (e.ends_at && new Date(e.ends_at).getTime()<now) ? "closed" :
             (e.starts_at && new Date(e.starts_at).getTime()>now ? "upcoming" : "available")
           ),
           result_visible: !!e.published_at
         }));
         return reply({success:true,exams},200,request);
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
           "SELECT q.id,q.question_type,q.question_text,q.topic,q.difficulty,q.default_marks,q.subject_id,q.class_id,q.created_at,(SELECT COUNT(*) FROM question_options qo WHERE qo.question_id=q.id) option_count FROM questions q WHERE q.teacher_id=? AND q.status='active' ORDER BY q.created_at DESC"
         ).bind(user.id).all();
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
           "SELECT DISTINCT e.id,e.title,e.description,e.batch_id,e.duration_minutes,e.total_marks,e.pass_marks,e.starts_at,e.ends_at,e.status,e.created_at,b.batch_name,(SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id=e.id) question_count FROM exams e LEFT JOIN batches b ON b.id=e.batch_id WHERE e.created_by=? ORDER BY e.created_at DESC"
         ).bind(user.id).all();
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
           "SELECT b.id,b.class_id,b.subject_id FROM batches b JOIN batch_teachers bt ON bt.batch_id=b.id WHERE b.id=? AND bt.teacher_id=? AND b.status='active'"
         ).bind(batchId,user.id).first();
         if(!batch) return reply({error:"Select an active batch assigned to you."},403,request);
         const marksRows=await env.DB.prepare(
           `SELECT id,default_marks FROM questions WHERE teacher_id=? AND status='active' AND id IN (${questionIds.map(()=>"?").join(",")}) AND (class_id IS NULL OR class_id=?) AND (subject_id IS NULL OR subject_id=?)`
         ).bind(user.id,...questionIds,batch.class_id,batch.subject_id).all();
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
         const exam=await env.DB.prepare("SELECT id,status,starts_at,ends_at,(SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id=exams.id) question_count FROM exams WHERE id=? AND created_by=?").bind(publishMatch[1],user.id).first();
         if(!exam) return reply({error:"Exam not found."},404,request);
         if(!exam.question_count) return reply({error:"Add at least one question before publishing."},400,request);
         if(exam.status==="archived"||exam.status==="closed") return reply({error:"This exam cannot be published."},409,request);
         if(exam.ends_at && new Date(exam.ends_at)<=new Date()) return reply({error:"The exam end time is in the past."},400,request);
         const nextStatus=exam.starts_at && new Date(exam.starts_at)>new Date() ? "scheduled" : "published";
         await env.DB.prepare("UPDATE exams SET status=?,updated_at=datetime('now') WHERE id=? AND created_by=?").bind(nextStatus,exam.id,user.id).run();
         return reply({success:true,status:nextStatus},200,request);
       }
     }

     // Teacher evaluation centre: only the exam owner or an assigned batch teacher can review attempts.
     if (account.role === "teacher") {
       if (path === "/api/teacher/evaluations" && method === "GET") {
         const rows=await env.DB.prepare(
           "SELECT ea.id attempt_id,ea.status attempt_status,ea.started_at,ea.submitted_at,ea.score,e.id exam_id,e.title exam_title,e.total_marks,e.batch_id,b.batch_name,u.full_name student_name,u.email student_email,r.marks_obtained,r.published_at,(SELECT COUNT(*) FROM student_answers sa JOIN exam_questions eq ON eq.id=sa.exam_question_id JOIN questions q ON q.id=eq.question_id WHERE sa.attempt_id=ea.id AND q.question_type IN ('numerical','short_answer','long_answer')) manual_count FROM exam_attempts ea JOIN exams e ON e.id=ea.exam_id JOIN batches b ON b.id=e.batch_id JOIN users u ON u.id=ea.student_id LEFT JOIN results r ON r.attempt_id=ea.id WHERE ea.status IN ('submitted','evaluated') AND (e.created_by=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=e.batch_id AND bt.teacher_id=?)) ORDER BY ea.submitted_at DESC"
         ).bind(user.id,user.id).all();
         return reply({success:true,evaluations:rows.results||[]},200,request);
       }

       const evaluationMatch=path.match(/^\/api\/teacher\/evaluations\/([0-9a-f-]+)$/i);
       if(evaluationMatch && method==="GET"){
         const attempt=await env.DB.prepare(
           "SELECT ea.id attempt_id,ea.status attempt_status,ea.started_at,ea.submitted_at,ea.score,e.id exam_id,e.title exam_title,e.total_marks,e.pass_marks,e.batch_id,b.batch_name,u.full_name student_name,u.email student_email,r.marks_obtained,r.published_at FROM exam_attempts ea JOIN exams e ON e.id=ea.exam_id JOIN batches b ON b.id=e.batch_id JOIN users u ON u.id=ea.student_id LEFT JOIN results r ON r.attempt_id=ea.id WHERE ea.id=? AND (e.created_by=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=e.batch_id AND bt.teacher_id=?))"
         ).bind(evaluationMatch[1],user.id,user.id).first();
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
           "SELECT ea.id,ea.status,ea.exam_id,ea.student_id,e.total_marks,e.pass_marks FROM exam_attempts ea JOIN exams e ON e.id=ea.exam_id WHERE ea.id=? AND (e.created_by=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=e.batch_id AND bt.teacher_id=?))"
         ).bind(attemptId,user.id,user.id).first();
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
           "SELECT ea.id,ea.status,r.published_at FROM exam_attempts ea JOIN exams e ON e.id=ea.exam_id JOIN results r ON r.attempt_id=ea.id WHERE ea.id=? AND (e.created_by=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=e.batch_id AND bt.teacher_id=?))"
         ).bind(publishEvaluationMatch[1],user.id,user.id).first();
         if(!attempt) return reply({error:"Result not found or you are not assigned to this exam."},404,request);
         if(attempt.status!=="evaluated") return reply({error:"Complete evaluation before publishing this result."},409,request);
         await env.DB.prepare("UPDATE results SET published_at=datetime('now') WHERE attempt_id=? AND published_at IS NULL").bind(attempt.id).run();
         return reply({success:true,published:true},200,request);
       }
     }

     const admin = await adminUser(user.id,env);

     if (!admin) return reply({error:"Admin access required"},403,request);



     if (path === "/api/dashboard/stats" && method === "GET") {

       const [t,s,e,a,c,sub,b] = await Promise.all([

         env.DB.prepare("SELECT COUNT(*) total FROM users WHERE role='teacher' AND deleted_at IS NULL").first(),

         env.DB.prepare("SELECT COUNT(*) total FROM users WHERE role='student' AND deleted_at IS NULL").first(),

         env.DB.prepare("SELECT COUNT(*) total FROM exams").first(),

         env.DB.prepare("SELECT COUNT(*) total FROM exam_attempts").first(),

         env.DB.prepare("SELECT COUNT(*) total FROM classes WHERE status='active'").first(),

         env.DB.prepare("SELECT COUNT(*) total FROM subjects WHERE status='active'").first(),

         env.DB.prepare("SELECT COUNT(*) total FROM batches WHERE status='active'").first()

       ]);

       return reply({success:true,stats:{teachers:t?.total||0,students:s?.total||0,exams:e?.total||0,attempts:a?.total||0,classes:c?.total||0,subjects:sub?.total||0,batches:b?.total||0}},200,request);

     }



// Teacher accounts*

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



// Students (student accounts only; no parent accounts)*

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

};