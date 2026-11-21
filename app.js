import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://vxifxiuitprdafvgpojh.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_WbeQeyK02QCDwayhi2NMjw_T-gOIpxG";
const API_URL = "https://dhyanshedu-api.dhyanshedu.workers.dev";

const $ = s => document.querySelector(s);

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

let profile = null;
let invitationFlowStarted = false;

$("#year").textContent = new Date().getFullYear();
$("#invite-year").textContent = new Date().getFullYear();
$("#pending-year").textContent = new Date().getFullYear();

function isInvitationCallback() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);

  return hash.get("type") === "invite" ||
         query.get("type") === "invite";
}

async function api(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Please sign in again.");
  }

  const r = await fetch(API_URL + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(opts.headers || {})
    }
  });

  const d = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw new Error(d.error || `Request failed (${r.status})`);
  }

  return d;
}

function hideAllViews() {
  ["login-view", "invite-view", "pending-view", "dashboard-view"]
    .forEach(id => {
      $("#" + id).classList.add("hidden");
    });
}

function showLogin(message = "") {
  hideAllViews();
  $("#login-view").classList.remove("hidden");
  $("#login-message").textContent = message;
}

function showInvitationForm(message = "") {
  hideAllViews();
  $("#invite-view").classList.remove("hidden");
  $("#invite-message").textContent = message;
}

function showPendingApproval() {
  hideAllViews();
  $("#pending-view").classList.remove("hidden");
}

function page(name) {
  const pages = ["overview", "teachers", "classes", "subjects", "batches", "assignments", "students"];
  for (const pageName of pages) {
    const section = $(`#${pageName}-page`);
    if (section) section.classList.toggle("hidden", pageName !== name);
  }
  document.querySelectorAll(".nav-item[data-page]").forEach(x =>
    x.classList.toggle("active", x.dataset.page === name)
  );
  if (name !== "overview") loadAdminPage(name);
}

function roleWorkspaceSection() {
  let section = $("#role-workspace-page");
  if (section) section.remove();

  section = document.createElement("section");
  section.id = "role-workspace-page";
  section.innerHTML = `
    <div class="section-heading page-title">
      <div><h2 id="role-workspace-heading">My workspace</h2>
      <p class="muted" id="role-workspace-subtitle">Your assigned learning activity.</p></div>
    </div>
    <div class="stats-grid">
      <article class="stat-card"><p>My batches</p><strong id="my-batch-count">—</strong></article>
      <article class="stat-card"><p>Assignments</p><strong id="my-assignment-count">—</strong></article>
      <article class="stat-card"><p>Study materials</p><strong id="my-material-count">—</strong></article>
      <article class="stat-card"><p>Upcoming classes</p><strong id="my-live-count">—</strong></article>
    </div>
    <div class="table-card"><div class="table-heading"><h3>My batches</h3></div>
      <div class="table-scroll"><table><thead><tr><th>Batch</th><th>Class</th><th>Subject</th><th>Type</th><th>Status</th></tr></thead><tbody id="my-batches-list"><tr><td colspan="5">Loading…</td></tr></tbody></table></div>
    </div>
    <div class="table-card"><div class="table-heading"><h3>Assignments</h3></div>
      <div class="table-scroll"><table><thead><tr><th>Assignment</th><th>Batch / Class</th><th>Due</th><th>Status</th><th>Marks / Feedback</th></tr></thead><tbody id="my-assignments-list"><tr><td colspan="5">Loading…</td></tr></tbody></table></div>
    </div>
    <div class="table-card"><div class="table-heading"><h3>Study materials</h3></div>
      <div class="table-scroll"><table><thead><tr><th>Title</th><th>File</th><th>Description</th><th>Added</th></tr></thead><tbody id="my-materials-list"><tr><td colspan="4">Loading…</td></tr></tbody></table></div>
    </div>
    <div class="table-card"><div class="table-heading"><h3>Classes and meeting links</h3></div>
      <div class="table-scroll"><table><thead><tr><th>Class</th><th>Batch</th><th>Schedule</th><th>Status</th><th>Meeting</th></tr></thead><tbody id="my-live-list"><tr><td colspan="5">Loading…</td></tr></tbody></table></div>
    </div>`;
  $("#dashboard-view .content").append(section);
  if (profile?.role === "teacher") {
    const authoring = document.createElement("div");
    authoring.id = "teacher-authoring";
    authoring.innerHTML = `
      <div class="section-heading lower"><div><h2>Question bank</h2><p class="muted">Create questions for the batches assigned to you.</p></div></div>
      <div class="form-card">
        <form id="teacher-question-form" class="form-grid">
          <div><label for="question-batch">Assigned batch</label><select id="question-batch" required><option value="">Select batch</option></select></div>
          <div><label for="question-type">Question type</label><select id="question-type"><option value="mcq">Multiple choice (one answer)</option><option value="multiple_select">Multiple select</option><option value="numerical">Numerical</option><option value="short_answer">Short answer</option><option value="long_answer">Long answer</option></select></div>
          <div><label for="question-topic">Topic</label><input id="question-topic" maxlength="160" placeholder="e.g. Quadratic equations"></div>
          <div><label for="question-difficulty">Difficulty</label><select id="question-difficulty"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option></select></div>
          <div><label for="question-marks">Default marks</label><input id="question-marks" type="number" min="0.25" step="0.25" value="1" required></div>
          <div class="full"><label for="question-text">Question</label><textarea id="question-text" rows="3" required maxlength="8000" placeholder="Enter the question"></textarea></div>
          <div class="full" id="question-options-wrap"><label for="question-options">Answer options (one per line)</label><textarea id="question-options" rows="4" placeholder="Option A&#10;Option B&#10;Option C&#10;Option D"></textarea><label for="question-correct">Correct option labels (e.g. A or A,C)</label><input id="question-correct" placeholder="A"></div>
          <div class="full"><label for="question-explanation">Explanation (optional)</label><textarea id="question-explanation" rows="2" maxlength="4000"></textarea></div>
          <div><button class="btn btn-primary" type="submit" id="save-question-button">Save question</button></div>
        </form><p id="question-form-message" class="message"></p>
      </div>
      <div class="table-card"><div class="table-heading"><h3>My questions</h3></div><div class="table-scroll"><table><thead><tr><th>Question</th><th>Type</th><th>Topic</th><th>Difficulty</th><th>Marks</th></tr></thead><tbody id="teacher-question-list"><tr><td colspan="5">Loading…</td></tr></tbody></table></div></div>

      <div class="section-heading lower"><div><h2>Exam builder</h2><p class="muted">Create a draft or scheduled exam for one of your assigned batches.</p></div></div>
      <div class="form-card">
        <form id="teacher-exam-form" class="form-grid">
          <div><label for="exam-title">Exam title</label><input id="exam-title" maxlength="180" required placeholder="e.g. Algebra Unit Test"></div>
          <div><label for="exam-batch">Assigned batch</label><select id="exam-batch" required><option value="">Select batch</option></select></div>
          <div><label for="exam-duration">Duration (minutes)</label><input id="exam-duration" type="number" min="1" max="600" value="60" required></div>
          <div><label for="exam-pass-marks">Pass marks (optional)</label><input id="exam-pass-marks" type="number" min="0" step="0.25"></div>
          <div><label for="exam-start">Start date/time (optional)</label><input id="exam-start" type="datetime-local"></div>
          <div><label for="exam-end">End date/time (optional)</label><input id="exam-end" type="datetime-local"></div>
          <div class="full"><label for="exam-description">Instructions (optional)</label><textarea id="exam-description" rows="2" maxlength="4000"></textarea></div>
          <div class="full"><label for="exam-questions">Select questions (Ctrl/Cmd-click for multiple)</label><select id="exam-questions" multiple size="7" required></select><small class="muted">Questions must belong to your question bank and match the selected batch's subject/class.</small></div>
          <div><button class="btn btn-primary" type="submit" id="save-exam-button">Create exam</button></div>
        </form><p id="exam-form-message" class="message"></p>
      </div>
      <div class="table-card"><div class="table-heading"><h3>My exams</h3></div><div class="table-scroll"><table><thead><tr><th>Exam</th><th>Batch</th><th>Questions</th><th>Total marks</th><th>Schedule</th><th>Status</th><th>Action</th></tr></thead><tbody id="teacher-exam-list"><tr><td colspan="7">Loading…</td></tr></tbody></table></div></div>`;
    section.append(authoring);
  } else if (profile?.role === "student") {
    const exams = document.createElement("div");
    exams.id = "student-exam-centre";
    exams.innerHTML = `
      <div class="section-heading lower"><div><h2>Exam Centre</h2><p class="muted">View available exams, continue an attempt and check published results.</p></div></div>
      <div id="student-exam-list" class="table-card"><div class="table-heading"><h3>My exams</h3></div><div class="table-scroll"><table><thead><tr><th>Exam</th><th>Batch</th><th>Schedule</th><th>Duration</th><th>Status</th><th>Result</th><th>Action</th></tr></thead><tbody id="student-exams-body"><tr><td colspan="7">Loading…</td></tr></tbody></table></div></div>
      <div id="student-attempt-panel" class="hidden"></div>`;
    section.append(exams);
  }
  return section;
}

function addWorkspaceRow(body, values, emptyMessage, colspan) {
  body.replaceChildren();
  if (!values.length) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = colspan;
    cell.textContent = emptyMessage;
    return;
  }
  values.forEach(valuesForRow => {
    const row = body.insertRow();
    valuesForRow.forEach(value => {
      const cell = row.insertCell();
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value == null || value === "" ? "—" : String(value);
    });
  });
}

function safeMeetingLink(raw) {
  if (!raw) return "—";
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol)) return "—";
    const link = document.createElement("a");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Join class";
    return link;
  } catch {
    return "—";
  }
}

let activeStudentAttempt = null;
let studentExamTimer = null;

function stopStudentExamTimer() {
  if(studentExamTimer) clearInterval(studentExamTimer);
  studentExamTimer=null;
}

function formatRemaining(ms) {
  const seconds=Math.max(0,Math.floor(ms/1000));
  return `${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
}

async function loadStudentExams() {
  const body=$("#student-exams-body");
  if(!body)return;
  body.innerHTML='<tr><td colspan="7">Loading…</td></tr>';
  try{
    const result=await api("/api/student/exams");
    body.replaceChildren();
    const exams=result.exams||[];
    if(!exams.length){const row=body.insertRow();const cell=row.insertCell();cell.colSpan=7;cell.textContent="No exams have been assigned to your batches yet.";return;}
    exams.forEach(exam=>{
      const row=body.insertRow();
      [exam.title,exam.batch_name,exam.starts_at?new Date(exam.starts_at).toLocaleString():"Available when published",exam.duration_minutes+" min",exam.availability,
       exam.result_visible?`${exam.marks_obtained} / ${exam.total_marks} (${exam.percentage}%)`:(exam.attempt_status==="submitted"?"Awaiting evaluation":"—")
      ].forEach(value=>{const cell=row.insertCell();cell.textContent=value??"—";});
      const action=row.insertCell();
      if(exam.availability==="available"||exam.availability==="in_progress"){
        const button=document.createElement("button");button.type="button";button.className="btn btn-primary btn-small";
        button.textContent=exam.availability==="in_progress"?"Continue":"Start exam";
        button.addEventListener("click",()=>startStudentExam(exam.id));
        action.append(button);
      }else action.textContent=exam.availability==="upcoming"?"Not open yet":exam.availability==="evaluated"?"Submitted":"—";
    });
  }catch(error){body.replaceChildren();const row=body.insertRow();const cell=row.insertCell();cell.colSpan=7;cell.textContent=error.message;}
}

async function startStudentExam(examId) {
  try{
    const started=await api(`/api/student/exams/${encodeURIComponent(examId)}/start`,{method:"POST"});
    activeStudentAttempt=started.attempt;
    renderStudentAttempt(activeStudentAttempt);
  }catch(error){alert(error.message);}
}

function renderStudentAttempt(attempt) {
  stopStudentExamTimer();
  const panel=$("#student-attempt-panel");
  panel.classList.remove("hidden");
  panel.replaceChildren();
  const heading=document.createElement("div");heading.className="section-heading lower";
  const title=document.createElement("h2");title.textContent=attempt.title||"Exam in progress";
  const timer=document.createElement("strong");timer.id="student-exam-countdown";timer.className="exam-countdown";
  heading.append(title,timer);panel.append(heading);
  const info=document.createElement("p");info.className="muted";info.textContent="Your answers are saved when you select Save answer. Submit when you have finished.";panel.append(info);
  (attempt.questions||[]).forEach((q,index)=>{
    const card=document.createElement("article");card.className="table-card student-question";
    card.dataset.questionId=q.exam_question_id;
    const inner=document.createElement("div");inner.className="student-question-inner";
    const h=document.createElement("h3");h.textContent=`Question ${index+1} · ${q.marks} marks`;
    const prompt=document.createElement("p");prompt.textContent=q.question_text;
    inner.append(h,prompt);
    if(["mcq","multiple_select"].includes(q.question_type)){
      (q.options||[]).forEach(option=>{
        const label=document.createElement("label");label.className="student-option";
        const input=document.createElement("input");input.type=q.question_type==="mcq"?"radio":"checkbox";
        input.name="answer-"+q.exam_question_id;input.value=option.id;
        input.checked=(q.selected_option_ids||[]).includes(option.id);
        label.append(input,document.createTextNode(` ${option.label}. ${option.text}`));inner.append(label);
      });
    }else{
      const answer=document.createElement("textarea");answer.className="student-answer-text";answer.rows=3;answer.maxLength=8000;answer.placeholder=q.question_type==="numerical"?"Enter your numerical answer":"Write your answer";answer.value=q.answer||"";
      inner.append(answer);
      if(["short_answer","long_answer","numerical"].includes(q.question_type)){
        const note=document.createElement("small");note.className="muted";note.textContent="This answer will be reviewed by your teacher.";inner.append(note);
      }
    }
    const status=document.createElement("p");status.className="student-save-status muted";status.textContent=q.answer||(q.selected_option_ids||[]).length?"Saved answer available":"Not saved yet";
    const save=document.createElement("button");save.type="button";save.className="btn btn-primary btn-small student-save-answer";save.textContent="Save answer";
    inner.append(save,status);card.append(inner);panel.append(card);
  });
  const submit=document.createElement("button");submit.type="button";submit.id="student-submit-exam";submit.className="btn btn-primary";submit.textContent="Submit exam";
  panel.append(submit);
  const startedAt=new Date(attempt.started_at).getTime();
  const durationEnd=Math.min(startedAt+Number(attempt.duration_minutes)*60000,attempt.ends_at?new Date(attempt.ends_at).getTime():Infinity);
  const tick=()=>{
    const remaining=durationEnd-Date.now();
    timer.textContent="Time left: "+formatRemaining(remaining);
    if(remaining<=0){stopStudentExamTimer();submitStudentExam(true);}
  };
  tick();studentExamTimer=setInterval(tick,1000);
  panel.scrollIntoView({behavior:"smooth",block:"start"});
}

async function saveStudentAnswer(card) {
  const questionId=card.dataset.questionId;
  const inputs=Array.from(card.querySelectorAll('input[type="radio"]:checked,input[type="checkbox"]:checked'));
  const textAnswer=card.querySelector(".student-answer-text")?.value||"";
  const button=card.querySelector(".student-save-answer"),status=card.querySelector(".student-save-status");
  button.disabled=true;status.textContent="Saving…";
  try{
    await api(`/api/student/attempts/${encodeURIComponent(activeStudentAttempt.id)}/answers`,{
      method:"POST",body:JSON.stringify({exam_question_id:questionId,answer_text:textAnswer,selected_option_ids:inputs.map(x=>x.value)})
    });
    status.textContent="Answer saved.";return true;
  }catch(error){status.textContent=error.message;return false;}
  finally{button.disabled=false;}
}

async function submitStudentExam(auto=false) {
  if(!activeStudentAttempt)return;
  const panel=$("#student-attempt-panel");
  if(!auto && !confirm("Submit your exam now? You cannot change answers after submission."))return;
  stopStudentExamTimer();
  const buttons=Array.from(panel.querySelectorAll(".student-save-answer"));
  for(const button of buttons){
    const card=button.closest(".student-question");
    const saved=await saveStudentAnswer(card);
    if(!saved){const submit=$("#student-submit-exam");if(submit)submit.disabled=false;return;}
  }
  const submit=$("#student-submit-exam");if(submit)submit.disabled=true;
  try{
    const result=await api(`/api/student/attempts/${encodeURIComponent(activeStudentAttempt.id)}/submit`,{method:"POST"});
    panel.replaceChildren();
    const message=document.createElement("div");message.className="table-card table-heading";
    const heading=document.createElement("h2");heading.textContent="Exam submitted";
    const details=document.createElement("p");details.textContent=result.manual_review_required
      ?"Your objective answers were scored. Numerical and written answers are waiting for teacher evaluation."
      :result.result_published?`Your score: ${result.marks_obtained} / ${result.total_marks}`:"Your answers were submitted. Results will be shown when published.";
    message.append(heading,details);panel.append(message);
    activeStudentAttempt=null;
    await loadStudentExams();
  }catch(error){alert(error.message);if(submit)submit.disabled=false;}
}

let teacherWorkspaceBatches = [];
let teacherWorkspaceQuestions = [];

function populateTeacherBatchSelects() {
  ["question-batch","exam-batch"].forEach(id => {
    const select=$("#"+id); if(!select) return;
    select.replaceChildren();
    const first=document.createElement("option"); first.value=""; first.textContent="Select batch"; select.append(first);
    teacherWorkspaceBatches.forEach(batch=>{
      const option=document.createElement("option"); option.value=batch.id;
      option.textContent=`${batch.batch_name} — ${batch.subject_name||"Subject"}`;
      select.append(option);
    });
  });
}

function refreshExamQuestionOptions() {
  const batch=teacherWorkspaceBatches.find(x=>x.id===$("#exam-batch").value);
  const select=$("#exam-questions"); if(!select) return;
  select.replaceChildren();
  const questions=teacherWorkspaceQuestions.filter(q=>
    batch && (q.subject_id==null || String(q.subject_id)===String(batch.subject_id)) &&
    (q.class_id==null || String(q.class_id)===String(batch.class_id))
  );
  questions.forEach(q=>{
    const option=document.createElement("option"); option.value=q.id;
    option.textContent=`${q.question_text.slice(0,115)} · ${q.question_type} · ${q.default_marks} marks`;
    select.append(option);
  });
}

async function loadTeacherAuthoring() {
  const [questions,exams]=await Promise.all([
    api("/api/teacher/questions"),api("/api/teacher/exams")
  ]);
  teacherWorkspaceQuestions=questions.questions||[];
  const questionBody=$("#teacher-question-list");
  addWorkspaceRow(questionBody,teacherWorkspaceQuestions.map(q=>[
    q.question_text,q.question_type,q.topic,q.difficulty,q.default_marks
  ]),"No questions yet. Create your first question above.",5);
  refreshExamQuestionOptions();

  const examBody=$("#teacher-exam-list");
  examBody.replaceChildren();
  const items=exams.exams||[];
  if(!items.length){
    const row=examBody.insertRow();const cell=row.insertCell();cell.colSpan=7;cell.textContent="No exams created yet.";return;
  }
  items.forEach(exam=>{
    const row=examBody.insertRow();
    [exam.title,exam.batch_name,exam.question_count,exam.total_marks,
     exam.starts_at?new Date(exam.starts_at).toLocaleString():"Not scheduled",exam.status].forEach(v=>{const cell=row.insertCell();cell.textContent=v??"—";});
    const action=row.insertCell();
    if(["draft","scheduled"].includes(exam.status)){
      const button=document.createElement("button");button.className="btn btn-primary btn-small";button.textContent="Publish";
      button.addEventListener("click",async()=>{
        if(!confirm("Publish this exam so eligible students can access it according to its schedule?"))return;
        button.disabled=true;
        try{await api(`/api/teacher/exams/${encodeURIComponent(exam.id)}/publish`,{method:"POST"});await loadTeacherAuthoring();}
        catch(error){alert(error.message);button.disabled=false;}
      });
      action.append(button);
    } else action.textContent="—";
  });
}

async function loadRoleWorkspace(role) {
  const section = roleWorkspaceSection();
  $("#role-workspace-heading").textContent = role === "teacher" ? "Teacher workspace" : "Student workspace";
  $("#role-workspace-subtitle").textContent = role === "teacher"
    ? "Your assigned batches, teaching work and scheduled classes."
    : "Your enrolled batches, assignments, learning materials and classes.";

  try {
    const [workspace, batches, assignments, materials, live] = await Promise.all([
      api("/api/workspace"),
      api("/api/my/batches"),
      api("/api/my/assignments"),
      api("/api/my/materials"),
      api("/api/my/live-classes")
    ]);

    $("#my-batch-count").textContent = workspace.stats?.batches ?? 0;
    $("#my-assignment-count").textContent = workspace.stats?.assignments ?? 0;
    $("#my-material-count").textContent = workspace.stats?.materials ?? 0;
    $("#my-live-count").textContent = workspace.stats?.upcoming_classes ?? 0;

    addWorkspaceRow($("#my-batches-list"), (batches.batches || []).map(item => [
      item.batch_name, item.class_name, item.subject_name,
      item.batch_type === "one_to_one" ? "One-to-one" : "Group", item.status
    ]), "No batches assigned yet.", 5);

    addWorkspaceRow($("#my-assignments-list"), (assignments.assignments || []).map(item => [
      item.title, item.batch_name || item.class_name,
      item.due_at ? new Date(item.due_at).toLocaleString() : "—",
      item.submission_status || item.status,
      item.marks_awarded == null ? (item.teacher_feedback || "—") : String(item.marks_awarded)
    ]), "No assignments available.", 5);

    addWorkspaceRow($("#my-materials-list"), (materials.materials || []).map(item => [
      item.title, item.file_name, item.description,
      item.created_at ? new Date(item.created_at).toLocaleDateString() : "—"
    ]), "No study materials available.", 4);

    addWorkspaceRow($("#my-live-list"), (live.live_classes || []).map(item => [
      item.title, item.batch_id || item.class_id,
      item.starts_at ? new Date(item.starts_at).toLocaleString() : "—",
      item.status, safeMeetingLink(item.meeting_url)
    ]), "No scheduled classes available.", 5);

    if (role === "teacher") {
      teacherWorkspaceBatches = batches.batches || [];
      populateTeacherBatchSelects();
      $("#question-type").addEventListener("change",()=>{
        const enabled=["mcq","multiple_select"].includes($("#question-type").value);
        $("#question-options-wrap").classList.toggle("hidden",!enabled);
      });
      $("#exam-batch").addEventListener("change",refreshExamQuestionOptions);
      await loadTeacherAuthoring();
    } else if (role === "student") {
      await loadStudentExams();
    }
  } catch (error) {
    const message = document.createElement("p");
    message.className = "message";
    message.textContent = error.message || "Unable to load your workspace.";
    section.prepend(message);
  }
}

function dashboard(p, email) {
  profile = p;

  hideAllViews();
  $("#dashboard-view").classList.remove("hidden");

  const n = p.full_name || email || "User";

  $("#user-name").textContent = n;
  $("#user-role").textContent = p.role;
  $("#avatar").textContent = n[0].toUpperCase();

  $("#welcome-title").textContent =
    p.role === "admin" ? "Admin dashboard" : `${p.role} dashboard`;
  const eyebrow = $("#dashboard-view .topbar .eyebrow");
  if (eyebrow) eyebrow.textContent = p.role === "admin"
    ? "DHYANSHEDU / ADMINISTRATION"
    : `DHYANSHEDU / ${p.role.toUpperCase()} WORKSPACE`;

  document.querySelectorAll("[data-admin-only]").forEach(x =>
    x.classList.toggle("hidden", p.role !== "admin")
  );

  if (p.role === "admin") {
    const existing = $("#role-workspace-page");
    if (existing) existing.remove();
    page("overview");
    loadStats();
  } else if (p.role === "teacher" || p.role === "student") {
    ["overview-page","teachers-page","classes-page","subjects-page","batches-page","assignments-page","students-page"]
      .forEach(id => { const el = $("#"+id); if (el) el.classList.add("hidden"); });
    document.querySelectorAll(".nav-item[data-page]").forEach(x => x.classList.remove("active"));
    loadRoleWorkspace(p.role);
  } else {
    showLogin("This account role is not enabled for portal access.");
  }
}

async function loadProfile(session) {
  try {
    const d = await api("/api/me");
    dashboard(d.profile, session.user.email);
  } catch (e) {
    await supabase.auth.signOut();
    showLogin(e.message);
  }
}

async function loadStats() {
  try {
    const { stats } = await api("/api/dashboard/stats");

    $("#teacher-count").textContent = stats.teachers;
    $("#student-count").textContent = stats.students;
    $("#exam-count").textContent = stats.exams;
    $("#attempt-count").textContent = stats.attempts;

    $("#dashboard-message").textContent =
      "Connected to DhyanshEdu backend.";

  } catch (e) {
    $("#dashboard-message").textContent = e.message;
  }
}

async function loadTeachers() {
  const body = $("#teacher-list");

  body.innerHTML = '<tr><td colspan="4">Loading…</td></tr>';

  try {
    const { teachers } = await api("/api/teachers");

    $("#teacher-total").textContent = teachers.length;

    $("#teacher-pending").textContent =
      teachers.filter(t => t.status === "pending").length;

    $("#teacher-approved").textContent =
      teachers.filter(t => t.status === "approved").length;

    body.replaceChildren();

    if (!teachers.length) {
      body.innerHTML =
        '<tr><td colspan="4" class="empty-state">No teachers yet. Select Add teacher to invite one.</td></tr>';
      return;
    }

    for (const t of teachers) {
      const tr = document.createElement("tr");

      for (const value of [t.full_name, t.email]) {
        const td = document.createElement("td");
        td.textContent = value || "";
        tr.append(td);
      }

      const st = document.createElement("td");
      const badge = document.createElement("span");

      badge.className = `status-pill ${t.status}`;
      badge.textContent = t.status;

      st.append(badge);
      tr.append(st);

      const action = document.createElement("td");
      const select = document.createElement("select");

      select.className = "status-select";

      ["pending", "approved", "inactive"].forEach(v => {
        const o = document.createElement("option");

        o.value = v;
        o.textContent = v[0].toUpperCase() + v.slice(1);
        o.selected = v === t.status;

        select.append(o);
      });

      select.addEventListener("change", async () => {
        select.disabled = true;

        try {
          await api(
            `/api/teachers/${encodeURIComponent(t.id)}/status`,
            {
              method: "PATCH",
              body: JSON.stringify({
                status: select.value
              })
            }
          );

          await loadTeachers();

        } catch (e) {
          alert(e.message);
          select.disabled = false;
        }
      });

      action.append(select);

      // Remove Teacher button
      const removeButton = document.createElement("button");

      removeButton.type = "button";
      removeButton.textContent = "Remove teacher";

      removeButton.setAttribute(
        "aria-label",
        `Remove ${t.full_name || "teacher"}`
      );

      removeButton.style.marginLeft = "8px";
      removeButton.style.padding = "7px 10px";
      removeButton.style.border = "1px solid #b42318";
      removeButton.style.borderRadius = "6px";
      removeButton.style.background = "#fff";
      removeButton.style.color = "#b42318";
      removeButton.style.cursor = "pointer";

      removeButton.addEventListener("click", async () => {

        const confirmed = window.confirm(
          `Remove ${t.full_name || "this teacher"}?\n\n` +
          "They will lose portal access and disappear from the active teacher list. " +
          "Historical exams, marks and audit records will be preserved."
        );

        if (!confirmed) return;

        removeButton.disabled = true;
        removeButton.textContent = "Removing…";
        select.disabled = true;

        try {
          await api(
            `/api/teachers/${encodeURIComponent(t.id)}`,
            {
              method: "DELETE"
            }
          );

          await loadTeachers();
          await loadStats();

          alert(
            `${t.full_name || "Teacher"} has been removed successfully.`
          );

        } catch (e) {
          alert(e.message || "Could not remove teacher.");

          removeButton.disabled = false;
          removeButton.textContent = "Remove teacher";
          select.disabled = false;
        }
      });

      action.append(removeButton);
      tr.append(action);
      body.append(tr);
    }

  } catch (e) {
    body.innerHTML = "";

    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 4;
    td.textContent = e.message;

    tr.append(td);
    body.append(tr);
  }
}


const adminCache = { teachers: [], students: [], classes: [], subjects: [], batches: [], curricula: [], pathways: [], academicYears: [] };

function showMessage(id, message) {
  const el = $("#" + id);
  if (el) el.textContent = message || "";
}
function fillSelect(select, items, label, placeholder) {
  select.replaceChildren();
  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder;
  select.append(first);
  items.forEach(item => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = label(item);
    select.append(option);
  });
}
function addCell(row, value) {
  const td = document.createElement("td");
  td.textContent = value ?? "—";
  row.append(td);
  return td;
}
function addStatusSelect(parent, current, values, save) {
  const select = document.createElement("select");
  select.className = "status-select";
  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value[0].toUpperCase() + value.slice(1);
    option.selected = value === current;
    select.append(option);
  });
  select.addEventListener("change", async () => {
    select.disabled = true;
    try { await save(select.value); await loadAdminPage(document.querySelector(".nav-item.active")?.dataset.page); }
    catch (error) { alert(error.message); select.disabled = false; }
  });
  parent.append(select);
}
function statusTag(value) {
  const span = document.createElement("span");
  span.className = `status-pill ${value}`;
  span.textContent = value;
  return span;
}
async function loadMasterData() {
  const d=await api("/api/master-data");
  adminCache.curricula=d.curricula||[]; adminCache.pathways=d.pathways||[]; adminCache.academicYears=d.academic_years||[];
  const activeYears=adminCache.academicYears.filter(x=>Number(x.is_active)===1);
  fillSelect($("#class-curriculum"),adminCache.curricula,x=>x.name,"Select curriculum");
  fillSelect($("#class-year"),activeYears,x=>x.name,"Select active academic year");
  fillSelect($("#batch-curriculum"),adminCache.curricula,x=>x.name,"Select curriculum");
  fillSelect($("#batch-year"),activeYears,x=>x.name,"Select active academic year");
  fillSelect($("#batch-class"),[],x=>x.class_name,"Select class");
  fillSelect($("#batch-subject"),[],x=>x.subject_name,"Select subject");
  const yearHost=$("#academic-year-list");
  if(yearHost){
    yearHost.replaceChildren();
    const table=document.createElement("table");
    table.innerHTML="<thead><tr><th>Academic year</th><th>Dates</th><th>Status</th><th>Action</th></tr></thead>";
    const tbody=document.createElement("tbody");
    adminCache.academicYears.forEach(y=>{
      const tr=tbody.insertRow(); tr.insertCell().textContent=y.name;
      tr.insertCell().textContent=[y.start_date,y.end_date].filter(Boolean).join(" to ")||"—";
      tr.insertCell().append(statusTag(Number(y.is_active)===1?"active":"inactive"));
      const action=tr.insertCell();
      if(Number(y.is_active)!==1){const btn=document.createElement("button");btn.className="btn btn-small btn-primary";btn.textContent="Set active";btn.addEventListener("click",async()=>{try{await api("/api/academic-years/active",{method:"PATCH",body:JSON.stringify({id:y.id})});await loadMasterData();}catch(e){alert(e.message);}});action.append(btn);}else action.textContent="Current";
    });
    if(!adminCache.academicYears.length){const tr=tbody.insertRow();const td=tr.insertCell();td.colSpan=4;td.textContent="No academic years yet. Add one above.";}
    table.append(tbody);yearHost.append(table);
  }
}
function refreshBatchClassOptions() {
  const curriculumId=$("#batch-curriculum").value;
  const items=adminCache.classes.filter(x=>x.status==="active" && String(x.curriculum_id)===String(curriculumId));
  fillSelect($("#batch-class"),items,x=>`${x.class_name}${x.section ? " - "+x.section : ""}`,"Select class");
  refreshBatchSubjectOptions();
}
function refreshBatchSubjectOptions() {
  const cls=adminCache.classes.find(x=>String(x.id)===String($("#batch-class").value));
  const items=cls?adminCache.subjects.filter(x=>x.status==="active"):[];
  fillSelect($("#batch-subject"),items,x=>x.subject_name,"Select subject");
}

async function loadClasses() {
  const body = $("#class-list"); body.replaceChildren();
  await loadMasterData();
  const { classes } = await api("/api/classes");
  adminCache.classes = classes;
  classes.forEach(item => {
    const row = body.insertRow();
    addCell(row, item.class_name); addCell(row, item.section || "—"); addCell(row, item.academic_year || "—");
    const status = row.insertCell(); status.append(statusTag(item.status));
    addStatusSelect(row.insertCell(), item.status, ["active", "inactive"], value =>
      api(`/api/classes/${item.id}/status`, { method: "PATCH", body: JSON.stringify({ status: value }) })
    );
  });
  if (!classes.length) { const row=body.insertRow(); const td=addCell(row,"No classes created yet."); td.colSpan=5; }
}
async function loadSubjects() {
  const body = $("#subject-list"); body.replaceChildren();
  const { subjects } = await api("/api/subjects");
  adminCache.subjects = subjects;
  subjects.forEach(item => {
    const row=body.insertRow(); addCell(row,item.subject_name);
    const status=row.insertCell(); status.append(statusTag(item.status));
    addStatusSelect(row.insertCell(),item.status,["active","inactive"],value =>
      api(`/api/subjects/${item.id}/status`,{method:"PATCH",body:JSON.stringify({status:value})})
    );
  });
  if (!subjects.length) { const row=body.insertRow(); const td=addCell(row,"No subjects created yet."); td.colSpan=3; }
}
async function loadBatches() {
  const body=$("#batch-list"); body.replaceChildren();
  await loadMasterData();
  const [batchData,classData,subjectData,teacherData,studentData]=await Promise.all([
    api("/api/batches"),api("/api/classes"),api("/api/subjects"),api("/api/teachers"),api("/api/students")
  ]);
  adminCache.batches=batchData.batches;
  adminCache.classes=classData.classes;
  adminCache.subjects=subjectData.subjects;
  adminCache.teachers=teacherData.teachers.filter(x=>x.status==="approved");
  adminCache.students=studentData.students.filter(x=>x.status==="approved");
  refreshBatchClassOptions();
  fillSelect($("#manage-batch"),adminCache.batches.filter(x=>x.status==="active"),x=>x.batch_name,"Select batch");
  fillSelect($("#batch-teacher"),adminCache.teachers,x=>x.full_name,"Select approved teacher");
  fillSelect($("#batch-student"),adminCache.students,x=>x.full_name,"Select approved student");
  adminCache.batches.forEach(item=>{
    const row=body.insertRow(); addCell(row,item.batch_name); addCell(row,item.class_name || "—"); addCell(row,item.subject_name || "—");
    addCell(row,item.batch_type==="one_to_one"?"One-to-one":"Group");
    const status=row.insertCell(); status.append(statusTag(item.status));
    const action=row.insertCell();
    addStatusSelect(action,item.status,["active","inactive","completed"],value=>
      api(`/api/batches/${item.id}/status`,{method:"PATCH",body:JSON.stringify({status:value})})
    );
    if(item.status==="active") {
      const remove=document.createElement("button"); remove.className="btn btn-danger btn-small"; remove.textContent="Remove"; remove.style.marginLeft="8px";
      remove.addEventListener("click",async()=>{
        if(!confirm(`Remove batch “${item.batch_name}”? It will be hidden from active use, but historical records will be preserved.`)) return;
        remove.disabled=true;
        try { await api(`/api/batches/${item.id}`,{method:"DELETE"}); await loadBatches(); }
        catch(e){alert(e.message);remove.disabled=false;}
      });
      action.append(remove);
    }
  });
  if (!adminCache.batches.length) { const row=body.insertRow(); const td=addCell(row,"No batches created yet."); td.colSpan=6; }
}
async function loadAssignments() {
  const body=$("#assignment-list"); body.replaceChildren();
  const [a,t,c,s]=await Promise.all([api("/api/teacher-assignments"),api("/api/teachers"),api("/api/classes"),api("/api/subjects")]);
  adminCache.teachers=t.teachers.filter(x=>x.status==="approved");
  adminCache.classes=c.classes.filter(x=>x.status==="active");
  adminCache.subjects=s.subjects.filter(x=>x.status==="active");
  fillSelect($("#assignment-teacher"),adminCache.teachers,x=>x.full_name,"Select teacher");
  fillSelect($("#assignment-class"),adminCache.classes,x=>`${x.class_name}${x.section ? " - "+x.section : ""}`,"Select class");
  fillSelect($("#assignment-subject"),adminCache.subjects,x=>x.subject_name,"Select subject");
  a.assignments.forEach(item=>{
    const row=body.insertRow(); addCell(row,item.teacher_name); addCell(row,item.class_name || "—"); addCell(row,item.subject_name || "—");
    const action=row.insertCell(); const btn=document.createElement("button"); btn.className="btn btn-danger btn-small"; btn.textContent="Remove";
    btn.addEventListener("click",async()=>{if(!confirm("Remove this teacher assignment?"))return;try{await api(`/api/teacher-assignments/${item.id}`,{method:"DELETE"});await loadAssignments();}catch(e){alert(e.message);}});
    action.append(btn);
  });
  if (!a.assignments.length) { const row=body.insertRow(); const td=addCell(row,"No teacher assignments yet."); td.colSpan=4; }
}
async function loadStudents() {
  const body=$("#student-list"); body.replaceChildren();
  const {students}=await api("/api/students"); adminCache.students=students;
  students.forEach(item=>{
    const row=body.insertRow(); addCell(row,item.full_name); addCell(row,item.email);
    const status=row.insertCell(); status.append(statusTag(item.status));
    addStatusSelect(row.insertCell(),item.status,["pending","approved","inactive"],value=>
      api(`/api/students/${item.id}/status`,{method:"PATCH",body:JSON.stringify({status:value})})
    );
  });
  if (!students.length) { const row=body.insertRow(); const td=addCell(row,"No students invited yet."); td.colSpan=4; }
}
async function loadAdminPage(name) {
  try {
    if (name==="classes") await loadClasses();
    if (name==="subjects") await loadSubjects();
    if (name==="batches") await loadBatches();
    if (name==="assignments") await loadAssignments();
    if (name==="students") await loadStudents();
    if (name==="teachers") await loadTeachers();
  } catch(error) { $("#dashboard-message").textContent=error.message; }
}

document.addEventListener("click",async e=>{
  const save=e.target.closest(".student-save-answer");
  if(save){const card=save.closest(".student-question");if(card)await saveStudentAnswer(card);return;}
  if(e.target.id==="student-submit-exam"){await submitStudentExam(false);}
});

document.addEventListener("submit",async e=>{
  if(e.target.id!=="teacher-question-form") return;
  e.preventDefault();
  const button=$("#save-question-button"), message=$("#question-form-message");
  const batch=teacherWorkspaceBatches.find(x=>x.id===$("#question-batch").value);
  if(!batch){message.textContent="Select one of your assigned batches.";return;}
  const type=$("#question-type").value;
  const lines=$("#question-options").value.split("\n").map(x=>x.trim()).filter(Boolean);
  const labels=$("#question-correct").value.toUpperCase().split(",").map(x=>x.trim()).filter(Boolean);
  const options=lines.map((option_text,i)=>({option_text,is_correct:labels.includes(String.fromCharCode(65+i))}));
  button.disabled=true;message.textContent="Saving question…";
  try{
    await api("/api/teacher/questions",{method:"POST",body:JSON.stringify({
      question_type:type,question_text:$("#question-text").value.trim(),topic:$("#question-topic").value.trim(),
      difficulty:$("#question-difficulty").value,default_marks:Number($("#question-marks").value),
      subject_id:batch.subject_id,class_id:batch.class_id,explanation:$("#question-explanation").value.trim(),
      options:["mcq","multiple_select"].includes(type)?options:[]
    })});
    e.target.reset();$("#question-marks").value="1";$("#question-options-wrap").classList.remove("hidden");
    message.textContent="Question saved to your question bank.";
    await loadTeacherAuthoring();
  }catch(error){message.textContent=error.message;}
  finally{button.disabled=false;}
});

document.addEventListener("submit",async e=>{
  if(e.target.id!=="teacher-exam-form") return;
  e.preventDefault();
  const button=$("#save-exam-button"),message=$("#exam-form-message");
  const questionIds=Array.from($("#exam-questions").selectedOptions).map(x=>x.value);
  const start=$("#exam-start").value?new Date($("#exam-start").value).toISOString():null;
  const end=$("#exam-end").value?new Date($("#exam-end").value).toISOString():null;
  button.disabled=true;message.textContent="Creating exam…";
  try{
    const result=await api("/api/teacher/exams",{method:"POST",body:JSON.stringify({
      title:$("#exam-title").value.trim(),description:$("#exam-description").value.trim(),
      batch_id:$("#exam-batch").value,duration_minutes:Number($("#exam-duration").value),
      pass_marks:$("#exam-pass-marks").value===""?null:Number($("#exam-pass-marks").value),
      starts_at:start,ends_at:end,question_ids:questionIds
    })});
    e.target.reset();$("#exam-duration").value="60";
    message.textContent=`Exam created as ${result.status}. Total marks: ${result.total_marks}. Review it below and publish when ready.`;
    await loadTeacherAuthoring();
  }catch(error){message.textContent=error.message;}
  finally{button.disabled=false;}
});

$("#academic-year-form").addEventListener("submit",async e=>{
  e.preventDefault();
  try{
    await api("/api/academic-years",{method:"POST",body:JSON.stringify({name:$("#academic-year-name").value.trim(),start_date:$("#academic-year-start").value||null,end_date:$("#academic-year-end").value||null,is_active:adminCache.academicYears.length===0})});
    $("#academic-year-form").reset();showMessage("academic-year-message","Academic year added.");await loadMasterData();
  }catch(error){showMessage("academic-year-message",error.message);}
});

$("#class-form").addEventListener("submit",async e=>{
  e.preventDefault(); const b=$("#save-class-button"); b.disabled=true;
  try {
    await api("/api/classes",{method:"POST",body:JSON.stringify({
      class_name:$("#class-name").value.trim(),section:$("#class-section").value.trim(),curriculum_id:$("#class-curriculum").value,academic_year_id:$("#class-year").value
    })});
    $("#class-form").reset(); showMessage("class-message","Class created successfully."); await loadClasses();
  } catch(error){showMessage("class-message",error.message);} finally{b.disabled=false;}
});
$("#subject-form").addEventListener("submit",async e=>{
  e.preventDefault(); const b=$("#save-subject-button"); b.disabled=true;
  try {
    await api("/api/subjects",{method:"POST",body:JSON.stringify({subject_name:$("#subject-name").value.trim()})});
    $("#subject-form").reset(); showMessage("subject-message","Subject created successfully."); await loadSubjects();
  } catch(error){showMessage("subject-message",error.message);} finally{b.disabled=false;}
});
$("#batch-form").addEventListener("submit",async e=>{
  e.preventDefault(); const b=$("#save-batch-button"); b.disabled=true;
  try {
    await api("/api/batches",{method:"POST",body:JSON.stringify({
      batch_name:$("#batch-name").value.trim(),batch_type:$("#batch-type").value,
      class_id:$("#batch-class").value,subject_id:$("#batch-subject").value,academic_year_id:$("#batch-year").value,
      capacity:$("#batch-type").value==="one_to_one"?1:$("#batch-capacity").value,start_date:$("#batch-start").value || null,end_date:$("#batch-end").value || null
    })});
    $("#batch-form").reset(); showMessage("batch-message","Batch created successfully."); await loadBatches();
  } catch(error){showMessage("batch-message",error.message);} finally{b.disabled=false;}
});
$("#batch-curriculum").addEventListener("change",()=>refreshBatchClassOptions());
$("#batch-class").addEventListener("change",()=>refreshBatchSubjectOptions());
$("#batch-type").addEventListener("change",()=>{
  const one=$("#batch-type").value==="one_to_one";
  $("#batch-capacity").disabled=one; if(one) $("#batch-capacity").value="1"; else if($("#batch-capacity").value==="1") $("#batch-capacity").value="";
});

$("#batch-teacher-form").addEventListener("submit",async e=>{
  e.preventDefault(); const batch=$("#manage-batch").value;
  if(!batch){showMessage("batch-assign-message","Select a batch first.");return;}
  try{await api(`/api/batches/${batch}/teachers`,{method:"POST",body:JSON.stringify({teacher_id:$("#batch-teacher").value})});showMessage("batch-assign-message","Teacher assigned to batch.");}
  catch(error){showMessage("batch-assign-message",error.message);}
});
$("#batch-student-form").addEventListener("submit",async e=>{
  e.preventDefault(); const batch=$("#manage-batch").value;
  if(!batch){showMessage("batch-assign-message","Select a batch first.");return;}
  try{await api(`/api/batches/${batch}/students`,{method:"POST",body:JSON.stringify({student_id:$("#batch-student").value})});showMessage("batch-assign-message","Student enrolled in batch.");}
  catch(error){showMessage("batch-assign-message",error.message);}
});
$("#teacher-assignment-form").addEventListener("submit",async e=>{
  e.preventDefault();
  try{await api("/api/teacher-assignments",{method:"POST",body:JSON.stringify({
    teacher_id:$("#assignment-teacher").value,class_id:$("#assignment-class").value,subject_id:$("#assignment-subject").value
  })});showMessage("assignment-message","Teacher assignment created.");await loadAssignments();}
  catch(error){showMessage("assignment-message",error.message);}
});
$("#student-form").addEventListener("submit",async e=>{
  e.preventDefault(); const b=$("#save-student-button"); b.disabled=true; b.textContent="Sending…";
  try{await api("/api/students",{method:"POST",body:JSON.stringify({
    full_name:$("#student-full-name").value.trim(),email:$("#student-email").value.trim()
  })});$("#student-form").reset();showMessage("student-message","Student invitation sent. Access is pending Admin approval.");await loadStudents();}
  catch(error){showMessage("student-message",error.message);}
  finally{b.disabled=false;b.textContent="+ Invite student";}
});

async function completeInvitation(e) {
  e.preventDefault();

  const password = $("#invite-password").value;
  const confirmation = $("#invite-password-confirm").value;
  const button = $("#invite-button");
  const message = $("#invite-message");

  message.textContent = "";

  if (password.length < 8) {
    message.textContent =
      "Use a password with at least 8 characters.";
    return;
  }

  if (password !== confirmation) {
    message.textContent = "The passwords do not match.";
    return;
  }

  button.disabled = true;
  button.textContent = "Saving password…";

  try {
    const { error } = await supabase.auth.updateUser({ password });

    if (error) throw error;

    // Password is set. Admin approval is still required.
    await supabase.auth.signOut();

    $("#invite-form").reset();
    showPendingApproval();

  } catch (err) {
    message.textContent =
      err.message ||
      "Could not save your password. Reopen the invitation email and try again.";

  } finally {
    button.disabled = false;
    button.textContent = "Create password";
  }
}

$("#toggle-password").addEventListener("click", () => {
  const i = $("#password");
  const show = i.type === "password";

  i.type = show ? "text" : "password";
  $("#toggle-password").textContent = show ? "Hide" : "Show";
});

$("#login-form").addEventListener("submit", async e => {
  e.preventDefault();

  const b = $("#login-button");

  b.disabled = true;
  b.textContent = "Signing in…";

  const { data, error } = await supabase.auth.signInWithPassword({
    email: $("#email").value.trim(),
    password: $("#password").value
  });

  b.disabled = false;
  b.innerHTML = 'Sign in <span>→</span>';

  if (error) {
    $("#login-message").textContent = error.message;
    return;
  }

  await loadProfile(data.session);
});

$("#invite-form").addEventListener("submit", completeInvitation);

$("#pending-login-button").addEventListener("click", () => {
  showLogin(
    "Your password is set. Sign in after the administrator approves your account."
  );
});

$("#signout-button").addEventListener("click", async () => {
  await supabase.auth.signOut();

  profile = null;
  showLogin("You have signed out.");
});

document.querySelectorAll(".nav-item[data-page]").forEach(a => {
  a.addEventListener("click", e => {
    e.preventDefault();

    if (profile?.role === "admin") {
      page(a.dataset.page);
    }
  });
});

$("#add-teacher-button").addEventListener("click", () => {
  $("#teacher-form").reset();
  $("#teacher-form-message").textContent = "";
  $("#teacher-dialog").showModal();
});

$("#close-teacher-dialog").addEventListener("click", () =>
  $("#teacher-dialog").close()
);

$("#teacher-form").addEventListener("submit", async e => {
  e.preventDefault();

  const b = $("#save-teacher-button");

  b.disabled = true;
  b.textContent = "Sending…";

  $("#teacher-form-message").textContent = "";

  try {
    await api("/api/teachers", {
      method: "POST",
      body: JSON.stringify({
        full_name: $("#teacher-full-name").value.trim(),
        email: $("#teacher-email").value.trim()
      })
    });

    $("#teacher-form-message").textContent =
      "Invitation sent. Access is pending Admin approval.";

    await loadTeachers();

    setTimeout(() => $("#teacher-dialog").close(), 1200);

  } catch (err) {
    $("#teacher-form-message").textContent = err.message;

  } finally {
    b.disabled = false;
    b.textContent = "Send invitation";
  }
});

async function initializePortal() {
  const invitationLink = isInvitationCallback();
  const { data, error } = await supabase.auth.getSession();

  if (invitationLink) {
    if (data.session) {
      invitationFlowStarted = true;
      showInvitationForm();
    } else {
      showLogin(
        "This invitation link is invalid or has expired. Ask the administrator to send a new invitation."
      );
    }

    return;
  }

  if (error) {
    showLogin(error.message);
    return;
  }

  if (data.session) {
    await loadProfile(data.session);
  } else {
    showLogin();
  }
}

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT" && !invitationFlowStarted) {
    profile = null;
    showLogin();
  }
});

initializePortal();
