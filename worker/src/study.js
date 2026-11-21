const txt=(v,n=160)=>String(v??"").trim().slice(0,n);
const json=(data,status,request)=>{const origin=request.headers.get("Origin")||"";const headers={"Content-Type":"application/json","Cache-Control":"no-store","Vary":"Origin"};if(["https://dhyanshedu-lab.github.io","https://dhyanshedu-exam-portal.dhyanshedu.workers.dev"].includes(origin))headers["Access-Control-Allow-Origin"]=origin;return new Response(JSON.stringify(data),{status,headers});};
const fail=(message,status=400,request)=>json({error:message},status,request);
const bucketKey=()=> "study-files/"+crypto.randomUUID();
const fileTypes=["application/pdf","image/jpeg","image/png","image/webp","text/plain","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.presentationml.presentation","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
async function upload(request,env){
  if(!env.DB1)throw new Error("R2 is not configured. Add the DB1 binding.");
  const form=await request.formData(),file=form.get("file");
  if(!(file instanceof File)||!file.size)throw new Error("Choose a file.");
  if(file.size>12*1024*1024)throw new Error("File size must be 12 MB or less.");
  if(!fileTypes.includes(file.type))throw new Error("Allowed formats: PDF, JPG, PNG, WebP, TXT, DOCX, PPTX and XLSX.");
  const key=bucketKey();await env.DB1.put(key,file.stream(),{httpMetadata:{contentType:file.type}});
  return {form,key,name:txt(file.name,240),mime:file.type,size:file.size};
}
async function download(env,request,row){
  if(!row)return fail("File not found or access denied.",404,request);
  if(!env.DB1)return fail("R2 file storage is not configured.",503,request);
  const obj=await env.DB1.get(row.r2_object_key);if(!obj)return fail("File is no longer available.",404,request);
  const origin=request.headers.get("Origin")||"",headers={"Content-Type":row.mime_type||"application/octet-stream","Content-Disposition":"attachment; filename*=UTF-8''"+encodeURIComponent(row.file_name),"Cache-Control":"private, no-store","Vary":"Origin"};
  if(["https://dhyanshedu-lab.github.io","https://dhyanshedu-exam-portal.dhyanshedu.workers.dev"].includes(origin))headers["Access-Control-Allow-Origin"]=origin;
  return new Response(obj.body,{headers});
}
export async function handleStudyRequest(request,env,user,account,path,method){
  const teacher=account.role==="teacher",student=account.role==="student";
  const materialDownload=path.match(/^\/api\/materials\/([0-9a-f-]+)\/download$/i);
  if(materialDownload&&method==="GET"){
    const row=teacher
      ? await env.DB.prepare("SELECT r2_object_key,file_name,mime_type FROM study_materials WHERE id=? AND deleted_at IS NULL AND (teacher_id=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=study_materials.batch_id AND bt.teacher_id=?))").bind(materialDownload[1],user.id,user.id).first()
      : student?await env.DB.prepare("SELECT r2_object_key,file_name,mime_type FROM study_materials WHERE id=? AND deleted_at IS NULL AND (visibility='all_students' OR EXISTS (SELECT 1 FROM batch_students bs WHERE bs.batch_id=study_materials.batch_id AND bs.student_id=? AND bs.status='active'))").bind(materialDownload[1],user.id).first():null;
    return download(env,request,row);
  }
  const submissionAttach=path.match(/^\/api\/submissions\/([0-9a-f-]+)\/attachments\/([0-9a-f-]+)\/download$/i);
  if(submissionAttach&&method==="GET"&&teacher){
    const row=await env.DB.prepare("SELECT sa.r2_object_key,sa.file_name,sa.mime_type FROM submission_attachments sa JOIN assignment_submissions sub ON sub.id=sa.submission_id JOIN assignments a ON a.id=sub.assignment_id WHERE sub.id=? AND sa.id=? AND (a.teacher_id=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=a.batch_id AND bt.teacher_id=?))").bind(submissionAttach[1],submissionAttach[2],user.id,user.id).first();
    return download(env,request,row);
  }
  const attach=path.match(/^\/api\/assignments\/([0-9a-f-]+)\/attachments\/([0-9a-f-]+)\/download$/i);
  if(attach&&method==="GET"){
    const row=teacher
      ? await env.DB.prepare("SELECT aa.r2_object_key,aa.file_name,aa.mime_type FROM assignment_attachments aa JOIN assignments a ON a.id=aa.assignment_id WHERE aa.id=? AND a.id=? AND (a.teacher_id=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=a.batch_id AND bt.teacher_id=?))").bind(attach[2],attach[1],user.id,user.id).first()
      : student?await env.DB.prepare("SELECT aa.r2_object_key,aa.file_name,aa.mime_type FROM assignment_attachments aa JOIN assignments a ON a.id=aa.assignment_id JOIN batch_students bs ON bs.batch_id=a.batch_id AND bs.student_id=? AND bs.status='active' WHERE aa.id=? AND a.id=? AND a.status='published'").bind(user.id,attach[2],attach[1]).first():null;
    return download(env,request,row);
  }
  if(path==="/api/teacher/materials"&&method==="POST"&&teacher){
    let up;try{up=await upload(request,env);const title=txt(up.form.get("title"),180),description=txt(up.form.get("description"),2000)||null,bid=txt(up.form.get("batch_id"),80);
      const b=await env.DB.prepare("SELECT b.id,b.class_id,b.subject_id FROM batches b JOIN batch_teachers bt ON bt.batch_id=b.id WHERE b.id=? AND bt.teacher_id=? AND b.status='active'").bind(bid,user.id).first();
      if(!title||!b)throw new Error("Enter a title and choose an active batch assigned to you.");
      const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO study_materials(id,title,description,class_id,subject_id,batch_id,teacher_id,r2_object_key,file_name,mime_type,file_size_bytes,visibility) VALUES(?,?,?,?,?,?,?,?,?,?,?,'assigned')").bind(id,title,description,b.class_id,b.subject_id,b.id,user.id,up.key,up.name,up.mime,up.size).run();
      return json({success:true,id,title,file_name:up.name},201,request);
    }catch(e){if(up?.key)await env.DB1?.delete(up.key);return fail(e.message,400,request);}
  }
  if(path==="/api/teacher/assignments"&&method==="POST"&&teacher){
    const b=await request.json().catch(()=>({})),title=txt(b.title,180),instructions=txt(b.instructions,6000)||null,bid=txt(b.batch_id,80),due=txt(b.due_at,40)||null,marks=b.max_marks===""||b.max_marks==null?null:Number(b.max_marks);
    if(!title||!bid||(marks!==null&&(!Number.isFinite(marks)||marks<0))||(due&&!Number.isFinite(Date.parse(due))))return fail("Enter a title, batch, valid due date and maximum marks.",400,request);
    const batch=await env.DB.prepare("SELECT b.id,b.class_id,b.subject_id FROM batches b JOIN batch_teachers bt ON bt.batch_id=b.id WHERE b.id=? AND bt.teacher_id=? AND b.status='active'").bind(bid,user.id).first();
    if(!batch)return fail("Choose an active batch assigned to you.",403,request);
    const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO assignments(id,title,instructions,class_id,subject_id,batch_id,teacher_id,due_at,max_marks,status) VALUES(?,?,?,?,?,?,?,?,?,'published')").bind(id,title,instructions,batch.class_id,batch.subject_id,batch.id,user.id,due?new Date(Date.parse(due)).toISOString():null,marks).run();
    return json({success:true,id,status:"published"},201,request);
  }
  const assignmentAttach=path.match(/^\/api\/teacher\/assignments\/([0-9a-f-]+)\/attachments$/i);
  if(assignmentAttach&&method==="POST"&&teacher){
    let up;try{const a=await env.DB.prepare("SELECT id FROM assignments WHERE id=? AND teacher_id=?").bind(assignmentAttach[1],user.id).first();if(!a)return fail("Assignment not found.",404,request);up=await upload(request,env);const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO assignment_attachments(id,assignment_id,r2_object_key,file_name,mime_type,file_size_bytes) VALUES(?,?,?,?,?,?)").bind(id,a.id,up.key,up.name,up.mime,up.size).run();return json({success:true,id,file_name:up.name},201,request);}catch(e){if(up?.key)await env.DB1?.delete(up.key);return fail(e.message,400,request);}
  }
  if(path==="/api/student/assignments"&&method==="GET"&&student){
    const rows=await env.DB.prepare("SELECT a.id,a.title,a.instructions,a.due_at,a.max_marks,b.batch_name,sub.id submission_id,sub.status submission_status,sub.submitted_at,sub.marks_awarded,sub.teacher_feedback FROM assignments a JOIN batches b ON b.id=a.batch_id JOIN batch_students bs ON bs.batch_id=b.id AND bs.student_id=? AND bs.status='active' LEFT JOIN assignment_submissions sub ON sub.assignment_id=a.id AND sub.student_id=? WHERE a.status='published' AND b.status='active' ORDER BY a.due_at").bind(user.id,user.id).all();
    const files=await env.DB.prepare("SELECT aa.id,aa.assignment_id,aa.file_name FROM assignment_attachments aa JOIN assignments a ON a.id=aa.assignment_id JOIN batch_students bs ON bs.batch_id=a.batch_id AND bs.student_id=? AND bs.status='active' WHERE a.status='published'").bind(user.id).all();
    return json({success:true,assignments:rows.results||[],attachments:files.results||[]},200,request);
  }
  const submit=path.match(/^\/api\/student\/assignments\/([0-9a-f-]+)\/submit$/i);
  if(submit&&method==="POST"&&student){
    let up;try{if(!env.DB1)return fail("R2 file storage is not configured.",503,request);const form=await request.formData(),answer=txt(form.get("answer_text"),8000),file=form.get("file");
      const a=await env.DB.prepare("SELECT a.id,a.due_at FROM assignments a JOIN batch_students bs ON bs.batch_id=a.batch_id AND bs.student_id=? AND bs.status='active' WHERE a.id=? AND a.status='published'").bind(user.id,submit[1]).first();
      if(!a)return fail("Assignment not found or not assigned to your active batch.",404,request);
      if(!answer&&(!(file instanceof File)||!file.size))return fail("Enter an answer or attach your completed work.",400,request);
      if(file instanceof File&&file.size){if(file.size>12*1024*1024||!["application/pdf","image/jpeg","image/png","image/webp","text/plain","application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(file.type))return fail("Attach a PDF, image, TXT or DOCX file up to 12 MB.",400,request);up={key:"study-files/submissions/"+crypto.randomUUID(),name:txt(file.name,240),mime:file.type,size:file.size};await env.DB1.put(up.key,file.stream(),{httpMetadata:{contentType:file.type}});}
      const old=await env.DB.prepare("SELECT id,status FROM assignment_submissions WHERE assignment_id=? AND student_id=?").bind(a.id,user.id).first();if(old?.status==="evaluated")throw new Error("This submission is already evaluated. Contact your teacher about resubmission.");
      const id=old?.id||crypto.randomUUID(),status=a.due_at&&Date.now()>Date.parse(a.due_at)?"late":"submitted";
      await env.DB.prepare("INSERT INTO assignment_submissions(id,assignment_id,student_id,answer_text,submitted_at,status) VALUES(?,?,?,?,datetime('now'),?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET answer_text=excluded.answer_text,submitted_at=excluded.submitted_at,status=excluded.status").bind(id,a.id,user.id,answer||null,status).run();
      if(up)await env.DB.prepare("INSERT INTO submission_attachments(id,submission_id,r2_object_key,file_name,mime_type,file_size_bytes) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),id,up.key,up.name,up.mime,up.size).run();
      return json({success:true,submission_id:id,status},200,request);
    }catch(e){if(up?.key)await env.DB1?.delete(up.key);return fail(e.message,400,request);}
  }
  const teacherSubs=path.match(/^\/api\/teacher\/assignments\/([0-9a-f-]+)\/submissions$/i);
  if(teacherSubs&&method==="GET"&&teacher){
    const a=await env.DB.prepare("SELECT id,title,max_marks FROM assignments WHERE id=? AND (teacher_id=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=assignments.batch_id AND bt.teacher_id=?))").bind(teacherSubs[1],user.id,user.id).first();if(!a)return fail("Assignment not found or access denied.",404,request);
    const subs=await env.DB.prepare("SELECT sub.id submission_id,u.full_name student_name,u.email,sub.answer_text,sub.submitted_at,sub.marks_awarded,sub.teacher_feedback,sub.status FROM assignment_submissions sub JOIN users u ON u.id=sub.student_id WHERE sub.assignment_id=? ORDER BY sub.submitted_at DESC").bind(a.id).all();
    const files=await env.DB.prepare("SELECT sa.id,sa.submission_id,sa.file_name FROM submission_attachments sa JOIN assignment_submissions sub ON sub.id=sa.submission_id WHERE sub.assignment_id=?").bind(a.id).all();return json({success:true,assignment:a,submissions:subs.results||[],attachments:files.results||[]},200,request);
  }
  const grade=path.match(/^\/api\/teacher\/submissions\/([0-9a-f-]+)\/grade$/i);
  if(grade&&method==="POST"&&teacher){
    const b=await request.json().catch(()=>({})),marks=Number(b.marks_awarded),sub=await env.DB.prepare("SELECT sub.id,a.max_marks FROM assignment_submissions sub JOIN assignments a ON a.id=sub.assignment_id WHERE sub.id=? AND (a.teacher_id=? OR EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id=a.batch_id AND bt.teacher_id=?))").bind(grade[1],user.id,user.id).first();
    if(!sub)return fail("Submission not found or access denied.",404,request);if(!Number.isFinite(marks)||marks<0||(sub.max_marks!==null&&marks>Number(sub.max_marks)))return fail("Marks must be between zero and the maximum marks.",400,request);
    await env.DB.prepare("UPDATE assignment_submissions SET marks_awarded=?,teacher_feedback=?,status='evaluated' WHERE id=?").bind(marks,txt(b.teacher_feedback,3000)||null,sub.id).run();return json({success:true,status:"evaluated"},200,request);
  }

  // Live-class endpoints are dispatched here inside the authenticated Worker.
  if(path==="/api/admin/live-classes"&&method==="GET"&&account.role==="admin"){
    const rows=await env.DB.prepare("SELECT lc.id,lc.title,lc.description,lc.batch_id,lc.teacher_id,lc.meeting_provider,lc.meeting_url,lc.starts_at,lc.ends_at,lc.status,b.batch_name,u.full_name teacher_name,(SELECT COUNT(*) FROM batch_students bs WHERE bs.batch_id=lc.batch_id AND bs.status='active') enrolled_students,(SELECT COUNT(*) FROM live_class_attendance la WHERE la.live_class_id=lc.id) marked_students,(SELECT COUNT(*) FROM live_class_attendance la WHERE la.live_class_id=lc.id AND la.attendance_status IN ('present','late')) present_students FROM live_classes lc LEFT JOIN batches b ON b.id=lc.batch_id JOIN users u ON u.id=lc.teacher_id ORDER BY lc.starts_at DESC LIMIT 300").all();
    const [batches,teachers]=await Promise.all([env.DB.prepare("SELECT id,batch_name,batch_type FROM batches WHERE status='active' ORDER BY batch_name").all(),env.DB.prepare("SELECT id,full_name FROM users WHERE role='teacher' AND status='approved' AND deleted_at IS NULL ORDER BY full_name").all()]);
    return json({success:true,live_classes:rows.results||[],batches:batches.results||[],teachers:teachers.results||[]},200,request);
  }
  if(path==="/api/admin/live-classes"&&method==="POST"&&account.role==="admin"){
    const b=await request.json().catch(()=>({})),title=txt(b.title,180),bid=txt(b.batch_id,80),tid=txt(b.teacher_id,80),provider=txt(b.meeting_provider,30)||"google_meet",meeting=txt(b.meeting_url,1000),start=Date.parse(txt(b.starts_at,40)),end=Date.parse(txt(b.ends_at,40));
    if(!title||!bid||!tid||!["google_meet","jitsi","other"].includes(provider)||!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return fail("Enter valid class details and schedule.",400,request);
    try{const u=new URL(meeting);if(!["https:","http:"].includes(u.protocol))throw Error();}catch{return fail("Enter a valid meeting URL.",400,request);}
    const [batch,teacher,assigned]=await Promise.all([env.DB.prepare("SELECT id,class_id,subject_id FROM batches WHERE id=? AND status='active'").bind(bid).first(),env.DB.prepare("SELECT id FROM users WHERE id=? AND role='teacher' AND status='approved' AND deleted_at IS NULL").bind(tid).first(),env.DB.prepare("SELECT 1 ok FROM batch_teachers WHERE batch_id=? AND teacher_id=?").bind(bid,tid).first()]);
    if(!batch||!teacher||!assigned)return fail("Choose an active batch and a teacher assigned to it.",400,request);
    const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO live_classes(id,title,description,batch_id,teacher_id,class_id,subject_id,meeting_provider,meeting_url,starts_at,ends_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'scheduled')").bind(id,title,txt(b.description,2000)||null,bid,tid,batch.class_id,batch.subject_id,provider,meeting,new Date(start).toISOString(),new Date(end).toISOString()).run();return json({success:true,id},201,request);
  }
  const liveAdminAttendance=path.match(/^\/api\/admin\/live-classes\/([0-9a-f-]+)\/attendance$/i);
  if(liveAdminAttendance&&method==="GET"&&account.role==="admin"){
    const cls=await env.DB.prepare("SELECT lc.id,lc.title,lc.batch_id,b.batch_name,u.full_name teacher_name FROM live_classes lc JOIN batches b ON b.id=lc.batch_id JOIN users u ON u.id=lc.teacher_id WHERE lc.id=?").bind(liveAdminAttendance[1]).first();if(!cls)return fail("Class not found.",404,request);
    const rows=await env.DB.prepare("SELECT u.id student_id,u.full_name student_name,u.email,la.attendance_status,m.full_name marked_by_name FROM batch_students bs JOIN users u ON u.id=bs.student_id LEFT JOIN live_class_attendance la ON la.live_class_id=? AND la.student_id=u.id LEFT JOIN users m ON m.id=la.marked_by WHERE bs.batch_id=? AND bs.status='active' ORDER BY u.full_name").bind(cls.id,cls.batch_id).all();return json({success:true,class:cls,students:rows.results||[]},200,request);
  }
  if(teacher){
    const am=path.match(/^\/api\/teacher\/live-classes\/([0-9a-f-]+)\/attendance$/i),sm=path.match(/^\/api\/teacher\/live-classes\/([0-9a-f-]+)\/status$/i);
    if(am&&method==="GET"){const cls=await env.DB.prepare("SELECT id,batch_id,title FROM live_classes WHERE id=? AND teacher_id=?").bind(am[1],user.id).first();if(!cls)return fail("Class not found.",404,request);const rows=await env.DB.prepare("SELECT u.id student_id,u.full_name student_name,u.email,la.attendance_status FROM batch_students bs JOIN users u ON u.id=bs.student_id LEFT JOIN live_class_attendance la ON la.live_class_id=? AND la.student_id=u.id WHERE bs.batch_id=? AND bs.status='active' AND u.status='approved' AND u.deleted_at IS NULL ORDER BY u.full_name").bind(cls.id,cls.batch_id).all();return json({success:true,class:cls,students:rows.results||[]},200,request);}
    if(am&&method==="POST"){const cls=await env.DB.prepare("SELECT id,batch_id FROM live_classes WHERE id=? AND teacher_id=?").bind(am[1],user.id).first();if(!cls)return fail("Class not found.",404,request);const b=await request.json().catch(()=>({})),list=Array.isArray(b.attendance)?b.attendance:[],allowed=["present","late","absent","excused"];if(!list.length||list.length>250)return fail("Select attendance for students.",400,request);for(const item of list){const sid=txt(item.student_id,80),status=txt(item.attendance_status,20);if(!allowed.includes(status))return fail("Invalid attendance status.",400,request);const enrolled=await env.DB.prepare("SELECT 1 ok FROM batch_students WHERE batch_id=? AND student_id=? AND status='active'").bind(cls.batch_id,sid).first();if(!enrolled)return fail("Student is not actively enrolled.",403,request);await env.DB.prepare("INSERT INTO live_class_attendance(id,live_class_id,student_id,attendance_status,marked_by) VALUES(?,?,?,?,?) ON CONFLICT(live_class_id,student_id) DO UPDATE SET attendance_status=excluded.attendance_status,marked_by=excluded.marked_by").bind(crypto.randomUUID(),cls.id,sid,status,user.id).run();}return json({success:true,saved:list.length},200,request);}
    if(sm&&method==="PATCH"){const b=await request.json().catch(()=>({})),status=txt(b.status,20);if(!["scheduled","live","completed","cancelled"].includes(status))return fail("Invalid class status.",400,request);const result=await env.DB.prepare("UPDATE live_classes SET status=?,updated_at=datetime('now') WHERE id=? AND teacher_id=?").bind(status,sm[1],user.id).run();if(!result.meta?.changes)return fail("Class not found.",404,request);return json({success:true},200,request);}
  }
  return null;
}
