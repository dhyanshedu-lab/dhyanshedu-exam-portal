// Cloudflare Pages static portal entry point.
// Frontend template syntax validated; password recovery and CORS proxy enabled.
// Cache-bust release marker: 2026-11-22 proxy routing verification.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://vxifxiuitprdafvgpojh.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_WbeQeyK02QCDwayhi2NMjw_T-gOIpxG";
const API_URL = "https://dhyanshedu-api-proxy.dhyanshedu.workers.dev";

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

// A role-specific URL prevents a remembered Admin session from being mistaken
// for a Teacher or Student sign-in.
const requestedRole = new URLSearchParams(window.location.search).get("role");
const expectedRole = ["admin", "teacher", "student"].includes(requestedRole) ? requestedRole : null;
function configureLoginMode() {
  const labels = { admin: "Administrator", teacher: "Teacher", student: "Student" };
  const label = expectedRole ? labels[expectedRole] : null;
  $("#login-heading").textContent = label ? label + " sign in" : "Welcome back";
  $("#login-description").textContent = label
    ? "Sign in with your " + label.toLowerCase() + " account."
    : "Choose your portal and sign in with the account provided to you.";
  $("#login-button").innerHTML = (label ? "Sign in as " + label : "Sign in") + ' <span>→</span>';
}
configureLoginMode();

$("#year").textContent = new Date().getFullYear();
$("#invite-year").textContent = new Date().getFullYear();
$("#pending-year").textContent = new Date().getFullYear();

function isInvitationCallback() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);

  return hash.get("type") === "invite" ||
         query.get("type") === "invite";
}

function isPasswordRecovery() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  return hash.get("type") === "recovery" || query.get("type") === "recovery";
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

async function apiForm(path, formData) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Please sign in again.");
  const r = await fetch(API_URL + path, { method:"POST", headers:{Authorization:`Bearer ${session.access_token}`}, body:formData });
  const d = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}
async function downloadPortalFile(path, filename) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Please sign in again.");
  const r=await fetch(API_URL+path,{headers:{Authorization:`Bearer ${session.access_token}`}});
  if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||"Download failed.");}
  const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=filename||"download";document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);
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
  const pages = ["overview", "teachers", "classes", "subjects", "batches", "assignments", "students", "exam-monitoring", "public-exams", "live-classes", "fees", "enquiries", "system-health"];
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
    <div class="table-card"><div class="table-heading"><h3>Classes and meeting links</h3><p class="muted">Teachers can update class status and record attendance. Students can join their scheduled lessons.</p></div><div class="table-scroll"><table><thead><tr><th>Class</th><th>Batch</th><th>Schedule</th><th>Status</th><th>Meeting</th><th>Teacher actions</th></tr></thead><tbody id="my-live-list"><tr><td colspan="6">Loading…</td></tr></tbody></table></div>
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
      <div class="form-card"><h3>Import questions from CSV / XLSX</h3><p class="muted">Required column: question_text. Optional: question_type, topic, difficulty, default_marks, option_a through option_h, correct_answers, explanation. For MCQs, correct_answers uses labels such as A or A,C. Maximum 100 questions per file.</p><div class="form-grid"><div><label for="question-import-batch">Assigned batch</label><select id="question-import-batch"><option value="">Select batch</option></select></div><div><label for="question-import-file">CSV or XLSX file</label><input id="question-import-file" type="file" accept=".csv,.xlsx"></div><div><button class="btn btn-primary" type="button" id="import-questions-button">Import questions</button></div></div><p id="question-import-message" class="message"></p></div>
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
          <div class="full"><label for="exam-paper-file">Question paper / supporting file (optional: PDF, DOCX or PPTX; max 12 MB)</label><input id="exam-paper-file" type="file" accept=".pdf,.docx,.pptx"><small class="muted">Students in this batch can download the attachment from their Exam Centre.</small></div>
          <div><button class="btn btn-primary" type="submit" id="save-exam-button">Create exam</button></div>
        </form><p id="exam-form-message" class="message"></p>
      </div>
      <div class="table-card"><div class="table-heading"><h3>My exams</h3></div><div class="table-scroll"><table><thead><tr><th>Exam</th><th>Batch</th><th>Questions</th><th>Total marks</th><th>Schedule</th><th>Status</th><th>Action</th></tr></thead><tbody id="teacher-exam-list"><tr><td colspan="7">Loading…</td></tr></tbody></table></div></div>
      <div class="section-heading lower"><div><h2>Evaluation Centre</h2><p class="muted">Review submitted answers, award marks, add feedback and publish results.</p></div></div>
      <div class="table-card"><div class="table-heading"><h3>Student submissions</h3></div><div class="table-scroll"><table><thead><tr><th>Student</th><th>Exam</th><th>Batch</th><th>Submitted</th><th>Status</th><th>Score</th><th>Action</th></tr></thead><tbody id="teacher-evaluation-list"><tr><td colspan="7">Loading…</td></tr></tbody></table></div></div>
      <div id="teacher-evaluation-panel" class="hidden"></div>

      <div class="section-heading lower"><div><h2>Study materials</h2><p class="muted">Upload worksheets, notes and PDFs for your assigned batches.</p></div></div>
      <div class="form-card"><form id="teacher-material-form" class="form-grid">
        <div><label for="material-title">Material title</label><input id="material-title" required maxlength="180" placeholder="e.g. Algebra worksheet 1"></div>
        <div><label for="material-batch">Assigned batch</label><select id="material-batch" required><option value="">Select batch</option></select></div>
        <div class="full"><label for="material-description">Description</label><textarea id="material-description" rows="2" maxlength="2000"></textarea></div>
        <div class="full"><label for="material-file">File (max 12 MB)</label><input id="material-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.docx,.pptx,.xlsx" required></div>
        <div><button class="btn btn-primary" type="submit">Upload material</button></div>
      </form><p id="material-form-message" class="message"></p></div>
      <div class="section-heading lower"><div><h2>Assignments</h2><p class="muted">Publish homework for an assigned batch and review student submissions.</p></div></div>
      <div class="form-card"><form id="teacher-assignment-form" class="form-grid">
        <div><label for="assignment-title">Assignment title</label><input id="assignment-title" required maxlength="180" placeholder="e.g. Chapter 4 homework"></div>
        <div><label for="assignment-batch">Assigned batch</label><select id="assignment-batch" required><option value="">Select batch</option></select></div>
        <div><label for="assignment-due">Due date and time</label><input id="assignment-due" type="datetime-local"></div>
        <div><label for="assignment-max-marks">Maximum marks</label><input id="assignment-max-marks" type="number" min="0" step="0.5"></div>
        <div class="full"><label for="assignment-instructions">Instructions</label><textarea id="assignment-instructions" rows="3" maxlength="6000"></textarea></div>
        <div class="full"><label for="assignment-attachment">Assignment file (optional, max 12 MB)</label><input id="assignment-attachment" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.docx,.pptx,.xlsx"></div>
        <div><button class="btn btn-primary" type="submit">Publish assignment</button></div>
      </form><p id="teacher-assignment-message" class="message"></p></div>
      <div class="table-card"><div class="table-heading"><h3>Published assignments</h3></div><div class="table-scroll"><table><thead><tr><th>Assignment</th><th>Batch</th><th>Due</th><th>Status</th><th>Submissions</th></tr></thead><tbody id="teacher-assignment-list"><tr><td colspan="5">Loading…</td></tr></tbody></table></div></div>
      <div id="teacher-submissions-panel" class="hidden"></div>
    `;
    section.append(authoring);
  } else if (profile?.role === "student") {
    const exams = document.createElement("div");
    exams.id = "student-exam-centre";
    exams.innerHTML = `
      <div class="section-heading lower"><div><h2>Exam Centre</h2><p class="muted">View available exams, continue an attempt and check published results.</p></div></div>
      <div id="student-exam-list" class="table-card"><div class="table-heading"><h3>My exams</h3></div><div class="table-scroll"><table><thead><tr><th>Exam</th><th>Batch</th><th>Schedule</th><th>Duration</th><th>Status</th><th>Result</th><th>Action</th></tr></thead><tbody id="student-exams-body"><tr><td colspan="7">Loading…</td></tr></tbody></table></div></div>
      <div id="student-attempt-panel" class="hidden"></div><div id="student-result-panel" class="hidden"></div>

      <div class="section-heading lower"><div><h2>Assignments and homework</h2><p class="muted">Read instructions, download worksheets and submit your completed work.</p></div></div>
      <div class="table-card"><div class="table-heading"><h3>My assignments</h3></div><div class="table-scroll"><table><thead><tr><th>Assignment</th><th>Batch</th><th>Due</th><th>Status</th><th>Marks / Feedback</th><th>Action</th></tr></thead><tbody id="student-assignment-list"><tr><td colspan="6">Loading…</td></tr></tbody></table></div></div>
      <div id="student-submission-panel" class="hidden"></div>
      <div class="section-heading lower"><div><h2>My fees and receipts</h2><p class="muted">View your agreed fee, instalments, payments and receipt numbers.</p></div></div>
      <div id="student-fee-accounts"><div class="table-card table-heading">Loading fee information…</div></div>
    `;
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
      (result.attachments||[]).filter(f=>f.exam_id===exam.id).forEach(f=>{const paperButton=document.createElement("button");paperButton.type="button";paperButton.className="btn btn-secondary btn-small";paperButton.textContent="Question paper";paperButton.addEventListener("click",()=>downloadPortalFile("/api/exams/"+encodeURIComponent(exam.id)+"/attachments/"+encodeURIComponent(f.id)+"/download",f.file_name).catch(err=>alert(err.message)));action.append(paperButton);});
      if(exam.result_visible && exam.attempt_id){
        const button=document.createElement("button");button.type="button";button.className="btn btn-primary btn-small";
        button.textContent="View result";button.addEventListener("click",()=>loadStudentResult(exam.attempt_id));
        action.append(button);
      }else if(exam.availability==="available"||exam.availability==="in_progress"){
        const button=document.createElement("button");button.type="button";button.className="btn btn-primary btn-small";
        button.textContent=exam.availability==="in_progress"?"Continue":"Start exam";
        button.addEventListener("click",()=>startStudentExam(exam.id));
        action.append(button);
      }else action.textContent=exam.availability==="upcoming"?"Not open yet":exam.attempt_status==="submitted"?"Awaiting evaluation":"—";
    });
  }catch(error){body.replaceChildren();const row=body.insertRow();const cell=row.insertCell();cell.colSpan=7;cell.textContent=error.message;}
}

async function loadStudentResult(attemptId) {
  const panel=$("#student-result-panel");if(!panel)return;
  panel.classList.remove("hidden");panel.replaceChildren();
  const loading=document.createElement("p");loading.textContent="Loading published result…";panel.append(loading);
  try{
    const data=await api(`/api/student/results/${encodeURIComponent(attemptId)}`);
    const r=data.result,questions=data.questions||[];
    panel.replaceChildren();
    const card=document.createElement("section");card.className="table-card student-result-summary";
    const heading=document.createElement("div");heading.className="section-heading lower";
    const title=document.createElement("h2");title.textContent=r.exam_title;
    const score=document.createElement("strong");score.className="student-result-score";score.textContent=`${r.marks_obtained} / ${r.total_marks} marks`;
    const percentage=document.createElement("p");percentage.className="student-result-percentage";percentage.textContent=`${Number(r.percentage).toFixed(2)}% ${r.pass_marks==null?"":(Number(r.marks_obtained)>=Number(r.pass_marks)?"· Pass":"· Below pass marks")}`;
    const submitted=document.createElement("p");submitted.className="muted";submitted.textContent=`Submitted: ${r.submitted_at?new Date(r.submitted_at).toLocaleString():"—"} · Published: ${r.published_at?new Date(r.published_at).toLocaleString():"—"}`;
    heading.append(title);card.append(heading,score,percentage,submitted);panel.append(card);
    const section=document.createElement("div");section.className="section-heading lower";
    const subTitle=document.createElement("h2");subTitle.textContent="Question-wise review";section.append(subTitle);panel.append(section);
    questions.forEach((q,index)=>{
      const item=document.createElement("article");item.className="table-card student-result-question";
      const h=document.createElement("h3");h.textContent=`Question ${index+1} · ${q.marks} marks`;
      const prompt=document.createElement("p");prompt.textContent=q.question_text;item.append(h,prompt);
      if(q.options?.length){
        const list=document.createElement("ul");
        q.options.forEach(o=>{
          const li=document.createElement("li");
          const selected=(q.selected_option_ids||[]).includes(o.id);
          li.textContent=`${o.label}. ${o.text}${o.is_correct?" · Correct answer":selected?" · Your selection":""}`;
          if(o.is_correct)li.classList.add("result-correct-option");
          else if(selected)li.classList.add("result-selected-wrong");
          list.append(li);
        });item.append(list);
      }
      if(q.answer_text){
        const answer=document.createElement("p");answer.className="student-result-answer";answer.textContent="Your answer: "+q.answer_text;item.append(answer);
      }else if(!q.options?.length){
        const answer=document.createElement("p");answer.className="student-result-answer";answer.textContent="No written answer submitted.";item.append(answer);
      }
      const mark=document.createElement("p");mark.className="student-result-marks";
      mark.textContent=`Marks awarded: ${q.marks_awarded??0} / ${q.marks}${q.is_correct===1?" · Correct":q.is_correct===0?" · Incorrect":""}`;
      item.append(mark);
      if(q.teacher_feedback){
        const feedback=document.createElement("div");feedback.className="student-teacher-feedback";
        const label=document.createElement("strong");label.textContent="Teacher feedback";
        const text=document.createElement("p");text.textContent=q.teacher_feedback;feedback.append(label,text);item.append(feedback);
      }
      panel.append(item);
    });
    panel.scrollIntoView({behavior:"smooth",block:"start"});
  }catch(error){panel.replaceChildren();const message=document.createElement("p");message.className="message";message.textContent=error.message;panel.append(message);}
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
    if(!saved && !auto){const submit=$("#student-submit-exam");if(submit)submit.disabled=false;return;}
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

async function loadTeacherEvaluations() {
  const body=$("#teacher-evaluation-list");if(!body)return;
  body.innerHTML='<tr><td colspan="7">Loading…</td></tr>';
  try{
    const result=await api("/api/teacher/evaluations");
    body.replaceChildren();
    const rows=result.evaluations||[];
    if(!rows.length){const row=body.insertRow();const cell=row.insertCell();cell.colSpan=7;cell.textContent="No student submissions are waiting for evaluation.";return;}
    rows.forEach(item=>{
      const row=body.insertRow();
      [item.student_name,item.exam_title,item.batch_name,item.submitted_at?new Date(item.submitted_at).toLocaleString():"—",item.attempt_status,
       item.marks_obtained==null?"Pending":`${item.marks_obtained} / ${item.total_marks}`].forEach(value=>{const cell=row.insertCell();cell.textContent=value??"—";});
      const action=row.insertCell();
      const button=document.createElement("button");button.type="button";button.className="btn btn-primary btn-small";
      button.textContent=item.published_at?"View":"Review";
      button.addEventListener("click",()=>openTeacherEvaluation(item.attempt_id));
      action.append(button);
    });
  }catch(error){body.replaceChildren();const row=body.insertRow();const cell=row.insertCell();cell.colSpan=7;cell.textContent=error.message;}
}

async function openTeacherEvaluation(attemptId) {
  const panel=$("#teacher-evaluation-panel");panel.classList.remove("hidden");panel.replaceChildren();
  const loading=document.createElement("p");loading.textContent="Loading student answers…";panel.append(loading);
  try{
    const result=await api(`/api/teacher/evaluations/${encodeURIComponent(attemptId)}`);
    const attempt=result.attempt,questions=result.questions||[];
    panel.replaceChildren();
    const heading=document.createElement("div");heading.className="section-heading lower";
    const title=document.createElement("h2");title.textContent=`${attempt.student_name} — ${attempt.exam_title}`;
    const summary=document.createElement("p");summary.className="muted";summary.textContent=`Batch: ${attempt.batch_name} · Submitted: ${attempt.submitted_at?new Date(attempt.submitted_at).toLocaleString():"—"} · Maximum: ${attempt.total_marks} marks`;
    heading.append(title);panel.append(heading,summary);
    const form=document.createElement("form");form.id="teacher-grade-form";form.dataset.attemptId=attemptId;
    questions.forEach((q,index)=>{
      const card=document.createElement("article");card.className="table-card evaluation-question";
      const h=document.createElement("h3");h.textContent=`Question ${index+1} · ${q.question_type} · ${q.marks} marks`;
      const prompt=document.createElement("p");prompt.textContent=q.question_text;
      card.append(h,prompt);
      if(q.options?.length){
        const list=document.createElement("ul");
        q.options.forEach(o=>{const li=document.createElement("li");li.textContent=`${o.label}. ${o.text}${o.is_correct?" — Correct answer":""}`;list.append(li);});
        card.append(list);
      }
      const answer=document.createElement("div");answer.className="evaluation-answer";
      answer.textContent=q.answer_text||((q.selected_option_ids||"")?"Selected option IDs: "+q.selected_option_ids:"No answer submitted");
      card.append(answer);
      if(["numerical","short_answer","long_answer"].includes(q.question_type)){
        const grade=document.createElement("div");grade.className="evaluation-grade-fields";
        const label=document.createElement("label");label.textContent=`Marks awarded (0–${q.marks})`;
        const input=document.createElement("input");input.type="number";input.min="0";input.max=String(q.marks);input.step="0.25";input.required=true;input.value=q.marks_awarded==null?"":String(q.marks_awarded);input.dataset.questionId=q.exam_question_id;
        const feedbackLabel=document.createElement("label");feedbackLabel.textContent="Feedback for student";
        const feedback=document.createElement("textarea");feedback.rows=2;feedback.maxLength=2000;feedback.value=q.teacher_feedback||"";feedback.dataset.feedbackFor=q.exam_question_id;feedback.placeholder="Explain what was correct and what can improve";
        grade.append(label,input,feedbackLabel,feedback);card.append(grade);
      }else{
        const score=document.createElement("p");score.className="muted";score.textContent=`Automatically awarded: ${q.marks_awarded??0} marks`;card.append(score);
      }
      form.append(card);
    });
    if(attempt.attempt_status!=="evaluated"){
      const save=document.createElement("button");save.type="submit";save.className="btn btn-primary";save.textContent="Save evaluation";form.append(save);
    }else{
      const note=document.createElement("p");note.className="message";note.textContent="Evaluation completed.";form.append(note);
    }
    if(!attempt.published_at){
      const publish=document.createElement("button");publish.type="button";publish.className="btn btn-primary";publish.textContent="Publish result";publish.addEventListener("click",async()=>{
        if(!confirm("Publish this result so the student can see the score and feedback?"))return;
        publish.disabled=true;
        try{await api(`/api/teacher/evaluations/${encodeURIComponent(attemptId)}/publish`,{method:"POST"});await openTeacherEvaluation(attemptId);await loadTeacherEvaluations();}
        catch(error){alert(error.message);publish.disabled=false;}
      });form.append(publish);
    }else{
      const published=document.createElement("p");published.className="message";published.textContent="Result published to the student.";form.append(published);
    }
    panel.append(form);panel.scrollIntoView({behavior:"smooth",block:"start"});
  }catch(error){panel.replaceChildren();const message=document.createElement("p");message.className="message";message.textContent=error.message;panel.append(message);}
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


async function loadLearningTasks(role){
  if(role==="teacher"){
    const [list]=await Promise.all([api("/api/my/assignments")]);
    const batchOptions=teacherWorkspaceBatches||[];
    ["#material-batch","#assignment-batch"].forEach(selector=>{const el=$(selector);if(!el)return;el.replaceChildren();const first=document.createElement("option");first.value="";first.textContent="Select batch";el.append(first);batchOptions.forEach(b=>{const o=document.createElement("option");o.value=b.id;o.textContent=b.batch_name;el.append(o);});});
    const body=$("#teacher-assignment-list");body.replaceChildren();
    (list.assignments||[]).forEach(a=>{const tr=body.insertRow();[a.title,a.batch_name||a.class_name,a.due_at?new Date(a.due_at).toLocaleString():"—",a.status].forEach(v=>{const td=tr.insertCell();td.textContent=v||"—";});const td=tr.insertCell(),btn=document.createElement("button");btn.className="btn btn-secondary btn-small";btn.textContent="Review submissions";btn.addEventListener("click",()=>openTeacherSubmissions(a.id,a.title));td.append(btn);});
    if(!body.children.length){const tr=body.insertRow(),td=tr.insertCell();td.colSpan=5;td.textContent="No assignments created yet.";}
  }else{
    const data=await api("/api/student/assignments"),body=$("#student-assignment-list");body.replaceChildren();
    (data.assignments||[]).forEach(a=>{const tr=body.insertRow();[a.title,a.batch_name,a.due_at?new Date(a.due_at).toLocaleString():"—",a.submission_status||"Not submitted",a.marks_awarded==null?(a.teacher_feedback||"—"):(a.marks_awarded+(a.teacher_feedback?" · "+a.teacher_feedback:""))].forEach(v=>{const td=tr.insertCell();td.textContent=v??"—";});
      const action=tr.insertCell();(data.attachments||[]).filter(f=>f.assignment_id===a.id).forEach(f=>{const b=document.createElement("button");b.className="btn btn-secondary btn-small";b.textContent="Download "+f.file_name;b.addEventListener("click",()=>downloadPortalFile("/api/assignments/"+a.id+"/attachments/"+f.id+"/download",f.file_name).catch(e=>alert(e.message)));action.append(b);});
      const submit=document.createElement("button");submit.className="btn btn-primary btn-small";submit.textContent=a.submission_status==="evaluated"?"View feedback":"Submit work";submit.addEventListener("click",()=>openStudentSubmission(a));action.append(submit);
    });
    if(!body.children.length){const tr=body.insertRow(),td=tr.insertCell();td.colSpan=6;td.textContent="No assignments have been published for your batches.";}
  }
}
async function openTeacherSubmissions(id,title){
  const panel=$("#teacher-submissions-panel");panel.classList.remove("hidden");panel.innerHTML="<div class='form-card'><h3>Submissions · "+title+"</h3><p>Loading student work…</p></div>";
  try{const d=await api("/api/teacher/assignments/"+encodeURIComponent(id)+"/submissions");panel.innerHTML="<div class='form-card'><h3>Submissions · "+title+"</h3><div class='table-scroll'><table><thead><tr><th>Student</th><th>Submitted</th><th>Answer</th><th>Attachments</th><th>Marks</th><th>Feedback</th><th>Action</th></tr></thead><tbody id='teacher-submission-rows'></tbody></table></div></div>";
    const body=$("#teacher-submission-rows");(d.submissions||[]).forEach(s=>{const tr=body.insertRow();[s.student_name,s.submitted_at?new Date(s.submitted_at).toLocaleString():"—",s.answer_text||"—"].forEach(v=>{const td=tr.insertCell();td.textContent=v;});
      const files=body.rows[body.rows.length-1].insertCell();(d.attachments||[]).filter(f=>f.submission_id===s.submission_id).forEach(f=>{const b=document.createElement("button");b.className="btn btn-secondary btn-small";b.textContent=f.file_name;b.addEventListener("click",()=>downloadPortalFile("/api/submissions/"+s.submission_id+"/attachments/"+f.id+"/download",f.file_name).catch(e=>alert(e.message)));files.append(b);});
      const marks=tr.insertCell(),mi=document.createElement("input");mi.type="number";mi.min="0";mi.step="0.5";mi.max=d.assignment.max_marks??"";mi.value=s.marks_awarded??"";marks.append(mi);
      const feedback=tr.insertCell(),fi=document.createElement("textarea");fi.rows=2;fi.value=s.teacher_feedback||"";feedback.append(fi);
      const action=tr.insertCell(),btn=document.createElement("button");btn.className="btn btn-primary btn-small";btn.textContent="Save grade";btn.addEventListener("click",async()=>{try{await api("/api/teacher/submissions/"+s.submission_id+"/grade",{method:"POST",body:JSON.stringify({marks_awarded:Number(mi.value),teacher_feedback:fi.value})});btn.textContent="Saved";}catch(e){alert(e.message);}});action.append(btn);
    });
    if(!body.children.length){const tr=body.insertRow(),td=tr.insertCell();td.colSpan=7;td.textContent="No student submissions yet.";}
  }catch(e){panel.textContent=e.message;}
}
function openStudentSubmission(a){
  const panel=$("#student-submission-panel");panel.classList.remove("hidden");panel.innerHTML="<div class='form-card'><h3>Submit · "+a.title+"</h3><p class='muted'>"+(a.instructions||"Upload your completed worksheet or enter your answer below.")+"</p><form id='student-assignment-submit' class='form-grid' data-assignment-id='"+a.id+"'><div class='full'><label for='student-assignment-answer'>Answer / comments</label><textarea id='student-assignment-answer' rows='4' maxlength='8000'></textarea></div><div class='full'><label for='student-assignment-file'>Completed work (PDF, image, TXT or DOCX; max 12 MB)</label><input id='student-assignment-file' type='file' accept='.pdf,.jpg,.jpeg,.png,.webp,.txt,.docx'></div><div><button class='btn btn-primary' type='submit'>Submit assignment</button></div></form><p id='student-assignment-message' class='message'></p><p class='muted'>Current status: "+(a.submission_status||"Not submitted")+(a.teacher_feedback?" · Teacher feedback: "+a.teacher_feedback:"")+"</p></div>";
}

async function loadTeacherLeaves(){
  const body=$("#teacher-leave-list");if(!body)return;
  try{const d=await api("/api/teacher/leaves");body.replaceChildren();(d.leaves||[]).forEach(x=>{const tr=body.insertRow();[x.start_date+" – "+x.end_date,x.leave_type,x.reason,x.status].forEach(v=>addCell(tr,v));const td=tr.insertCell();if(x.status==="pending"){const b=document.createElement("button");b.className="btn btn-secondary btn-small";b.textContent="Cancel";b.addEventListener("click",async()=>{try{await api("/api/teacher/leaves/"+x.id+"/cancel",{method:"POST"});await loadTeacherLeaves();}catch(e){alert(e.message);}});td.append(b);}else td.textContent=x.review_note||"—";});if(!body.children.length){const tr=body.insertRow();const td=tr.insertCell();td.colSpan=5;td.textContent="No leave requests yet.";}}catch(e){body.innerHTML="<tr><td colspan='5'>"+e.message+"</td></tr>";}
}
async function loadStudentClassProgress(){
  const target=$("#student-class-progress"),badges=$("#student-achievement-badges");if(!target||!badges)return;
  try{const d=await api("/api/student/class-progress");target.replaceChildren();(d.progress||[]).forEach(p=>{const card=document.createElement("div");card.className="form-card";const h=document.createElement("h4");h.textContent=p.batch_name+" · "+p.subject_name;const label=document.createElement("p");label.textContent=p.completed_classes+" / "+p.total_classes+" classes completed · "+p.completion_percent+"%";const bar=document.createElement("progress");bar.max=100;bar.value=p.completion_percent;bar.style.width="100%";card.append(h,label,bar);target.append(card);});if(!target.children.length)target.textContent="Your class progress will appear once the Admin sets your class entitlement.";
  badges.replaceChildren();(d.badges||[]).forEach(b=>{const card=document.createElement("article");card.className="stat-card";const name=document.createElement("p");name.textContent=b.badge_emoji+" "+b.badge_name;const desc=document.createElement("small");desc.textContent=b.threshold_percent+"% milestone · "+b.description;card.append(name,desc);badges.append(card);});if(!badges.children.length){const p=document.createElement("p");p.className="muted";p.textContent="Your badges will appear as you complete class milestones.";badges.append(p);}
  }catch(e){target.textContent=e.message;}
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

    const materialBody=$("#my-materials-list");materialBody.replaceChildren();
    (materials.materials||[]).forEach(item=>{const tr=materialBody.insertRow();const title=tr.insertCell();title.textContent=item.title;const file=tr.insertCell(),download=document.createElement("button");download.className="btn btn-secondary btn-small";download.textContent="Download "+item.file_name;download.addEventListener("click",()=>downloadPortalFile("/api/materials/"+item.id+"/download",item.file_name).catch(e=>alert(e.message)));file.append(download);[item.description,item.created_at?new Date(item.created_at).toLocaleDateString():"—"].forEach(v=>{const td=tr.insertCell();td.textContent=v||"—";});});
    if(!materialBody.children.length){const tr=materialBody.insertRow(),td=tr.insertCell();td.colSpan=4;td.textContent="No study materials available.";}

    const liveBody=$("#my-live-list");liveBody.replaceChildren();(live.live_classes||[]).forEach(item=>{const tr=liveBody.insertRow();[item.title,item.batch_name||item.batch_id||item.class_id,item.starts_at?new Date(item.starts_at).toLocaleString():"—",item.status].forEach(v=>{const td=tr.insertCell();td.textContent=v??"—";});const meeting=tr.insertCell();meeting.append(safeMeetingLink(item.meeting_url));const actions=tr.insertCell();if(role==="teacher"){const attendance=document.createElement("button");attendance.className="btn btn-secondary btn-small";attendance.textContent="Mark attendance";attendance.addEventListener("click",()=>openTeacherAttendance(item.id,item.title));actions.append(attendance);const status=document.createElement("select");status.className="status-select";status.style.marginLeft="5px";[["scheduled","Scheduled"],["live","Live"],["completed","Completed"],["cancelled","Cancelled"]].forEach(([v,l])=>{const o=document.createElement("option");o.value=v;o.textContent=l;status.append(o);});status.value=item.status;status.addEventListener("change",async()=>{try{await api("/api/teacher/live-classes/"+encodeURIComponent(item.id)+"/status",{method:"PATCH",body:JSON.stringify({status:status.value})});await loadRoleWorkspace("teacher");}catch(e){alert(e.message);status.value=item.status;}});actions.append(status);}else actions.textContent=item.teacher_name||"—";});if(!liveBody.children.length){const tr=liveBody.insertRow(),td=tr.insertCell();td.colSpan=6;td.textContent="No scheduled classes available."; }

    if (role === "teacher") {
      const leavePanel=document.createElement("div");
      leavePanel.className="form-card";
      leavePanel.innerHTML="<h3>Apply for leave</h3><form id='teacher-leave-form' class='form-grid'><div><label for='leave-type'>Leave type</label><select id='leave-type'><option value='personal'>Personal</option><option value='sick'>Sick</option><option value='emergency'>Emergency</option><option value='other'>Other</option></select></div><div><label for='leave-start'>Start date</label><input id='leave-start' type='date' required></div><div><label for='leave-end'>End date</label><input id='leave-end' type='date' required></div><div class='full'><label for='leave-reason'>Reason</label><textarea id='leave-reason' rows='2' maxlength='1000' required></textarea></div><div><button class='btn btn-primary' type='submit'>Submit leave request</button></div></form><p id='teacher-leave-message' class='message'></p><h3>My leave requests</h3><div class='table-scroll'><table><thead><tr><th>Dates</th><th>Type</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead><tbody id='teacher-leave-list'><tr><td colspan='5'>Loading…</td></tr></tbody></table></div>";
      section.append(leavePanel);
      await loadTeacherLeaves();
      teacherWorkspaceBatches = batches.batches || [];
      populateTeacherBatchSelects();
      const importBatch=$("#question-import-batch");if(importBatch){importBatch.replaceChildren();const first=document.createElement("option");first.value="";first.textContent="Select batch";importBatch.append(first);teacherWorkspaceBatches.forEach(b=>{const o=document.createElement("option");o.value=b.id;o.textContent=b.batch_name+" — "+(b.subject_name||"Subject");importBatch.append(o);});}
      $("#question-type").addEventListener("change",()=>{
        const enabled=["mcq","multiple_select"].includes($("#question-type").value);
        $("#question-options-wrap").classList.toggle("hidden",!enabled);
      });
      $("#exam-batch").addEventListener("change",refreshExamQuestionOptions);
      await loadTeacherAuthoring();
      await loadTeacherEvaluations();
      await loadLearningTasks("teacher");
    } else if (role === "student") {
      const progressPanel=document.createElement("div");
      progressPanel.className="table-card";
      progressPanel.innerHTML="<div class='table-heading'><h3>My class progress</h3><p class='muted'>Completed lessons count when your attendance is Present or Late.</p></div><div id='student-class-progress'><p class='muted'>Loading progress…</p></div><div class='table-heading'><h3>Achievement badges</h3></div><div id='student-achievement-badges' class='stats-grid'></div>";
      section.append(progressPanel);
      await loadStudentClassProgress();
      await loadStudentExams();
      await loadLearningTasks("student");
      await loadStudentFees();
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
    if (expectedRole && d.profile.role !== expectedRole) {
      profile = null;
      showLogin("This account is registered as " + d.profile.role + ". Please sign in with a " + expectedRole + " account.");
      return;
    }
    dashboard(d.profile, session.user.email);
  } catch (e) {
    // Keep the valid Supabase session when the portal API is temporarily unavailable.
    // Signing out here hides the real API failure and forces users to re-enter credentials.
    showLogin("Your sign-in is still active, but the portal could not load your profile: " + e.message + ". Please try again shortly.");
  }
}

async function loadStats() {
  try {
    const { stats } = await api("/api/dashboard/stats");

    $("#teacher-count").textContent = stats.teachers;
    $("#student-count").textContent = stats.students;
    $("#exam-count").textContent = stats.exams;
    $("#attempt-count").textContent = stats.attempts;
    $("#overview-classes").textContent = stats.classes ?? 0;
    $("#overview-subjects").textContent = stats.subjects ?? 0;
    $("#overview-batches").textContent = stats.batches ?? 0;
    $("#overview-exams").textContent = stats.exams ?? 0;
    $("#overview-attempts").textContent = stats.attempts ?? 0;
    $("#overview-teachers").textContent = stats.teachers ?? 0;
    const enquiries = stats.enquiries || {};
    $("#overview-enquiries-total").textContent = enquiries.total ?? 0;
    $("#overview-enquiries-new").textContent = enquiries.new ?? 0;
    $("#overview-enquiries-contacted").textContent = enquiries.contacted ?? 0;
    $("#overview-enquiries-demo").textContent = enquiries.demo_scheduled ?? 0;
    $("#overview-enquiries-enrolled").textContent = enquiries.enrolled ?? 0;
    $("#overview-enquiries-due").textContent = enquiries.follow_up_due ?? 0;

    try {
      const { teachers } = await api("/api/teachers");
      const approved = teachers.filter(t => t.status === "approved").length;
      const pending = teachers.filter(t => t.status === "pending").length;
      $("#overview-teacher-approved").textContent = approved;
      $("#overview-teacher-pending").textContent = pending;
    } catch (_) {
      $("#overview-teacher-approved").textContent = "—";
      $("#overview-teacher-pending").textContent = "—";
    }

    $("#dashboard-message").textContent =
      "Connected to DhyanshEdu backend. Overview counts are live.";

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
  const [{students},{batches}]=await Promise.all([api("/api/students"),api("/api/batches")]); adminCache.students=students;adminCache.batches=batches;
  students.forEach(item=>{
    const row=body.insertRow(); addCell(row,item.full_name); addCell(row,item.email);
    const status=row.insertCell(); status.append(statusTag(item.status));
    addStatusSelect(row.insertCell(),item.status,["pending","approved","inactive"],value=>
      api(`/api/students/${item.id}/status`,{method:"PATCH",body:JSON.stringify({status:value})})
    );
  });
  if (!students.length) { const row=body.insertRow(); const td=addCell(row,"No students invited yet."); td.colSpan=4; }
  fillSelect($("#entitlement-student"),students.filter(x=>x.status==="approved"),x=>x.full_name,"Select student");
  fillSelect($("#entitlement-batch"),batches.filter(x=>x.status==="active"),x=>x.batch_name+" · "+x.subject_name,"Select batch");
  await loadAdminTeacherLeaves();
}
async function loadAdminTeacherLeaves(){
  const body=$("#admin-teacher-leaves");if(!body)return;
  try{
    const [{leaves},{teachers}]=await Promise.all([api("/api/admin/teacher-leaves"),api("/api/teachers")]);
    const approved=teachers.filter(t=>t.status==="approved");
    body.replaceChildren();
    for(const leave of leaves){
      const tr=body.insertRow();addCell(tr,leave.teacher_name);addCell(tr,leave.start_date+" – "+leave.end_date);addCell(tr,leave.reason);
      const st=tr.insertCell();st.append(statusTag(leave.status));
      const actions=tr.insertCell();
      if(leave.status!=="pending"){actions.textContent=leave.review_note||"—";continue;}
      const coverage=[];
      (leave.coverage_scopes||[]).forEach(scope=>{
        const wrap=document.createElement("div"),label=document.createElement("label"),select=document.createElement("select");
        label.textContent="Backup for "+scope.label;select.required=true;
        const empty=document.createElement("option");empty.value="";empty.textContent="Select approved substitute";select.append(empty);
        approved.filter(t=>t.id!==leave.teacher_id).forEach(t=>{const o=document.createElement("option");o.value=t.id;o.textContent=t.full_name;select.append(o);});
        wrap.append(label,select);actions.append(wrap);coverage.push({scope,select});
      });
      const approve=document.createElement("button");approve.className="btn btn-primary btn-small";approve.textContent="Approve";
      approve.addEventListener("click",async()=>{
        if(coverage.some(x=>!x.select.value)){alert("Select an approved substitute for every affected teaching assignment.");return;}
        const payload=coverage.map(x=>({scope_type:x.scope.scope_type,batch_id:x.scope.batch_id,class_id:x.scope.class_id,subject_id:x.scope.subject_id,substitute_teacher_id:x.select.value}));
        try{await api("/api/admin/teacher-leaves/"+leave.id+"/review",{method:"POST",body:JSON.stringify({decision:"approved",coverage:payload})});await loadAdminTeacherLeaves();}catch(e){alert(e.message);}
      });
      const reject=document.createElement("button");reject.className="btn btn-danger btn-small";reject.textContent="Reject";reject.style.marginLeft="6px";
      reject.addEventListener("click",async()=>{const note=prompt("Optional review note")||"";try{await api("/api/admin/teacher-leaves/"+leave.id+"/review",{method:"POST",body:JSON.stringify({decision:"rejected",review_note:note})});await loadAdminTeacherLeaves();}catch(e){alert(e.message);}});
      actions.append(approve,reject);
    }
    if(!body.children.length){const tr=body.insertRow(),td=tr.insertCell();td.colSpan=5;td.textContent="No teacher leave requests."; }
  }catch(e){body.innerHTML="<tr><td colspan='5'>"+e.message+"</td></tr>";}
}
let examMonitoringRows = [];

function renderExamMonitoringRows() {
  const body=$("#exam-monitoring-list");if(!body)return;
  const status=$("#monitor-status-filter")?.value||"";
  const search=($("#monitor-search")?.value||"").trim().toLowerCase();
  const rows=examMonitoringRows.filter(x=>
    (!status||x.status===status) &&
    (!search||[x.title,x.teacher_name,x.batch_name,x.class_name,x.subject_name].some(v=>String(v||"").toLowerCase().includes(search)))
  );
  body.replaceChildren();
  if(!rows.length){const tr=body.insertRow();const td=tr.insertCell();td.colSpan=11;td.textContent="No examinations match the selected filters.";return;}
  rows.forEach(x=>{
    const tr=body.insertRow();
    const exam=addCell(tr,x.title);
    const subject=document.createElement("small");subject.className="muted";subject.textContent=x.subject_name||"";
    exam.append(document.createElement("br"),subject);
    addCell(tr,x.teacher_name);
    addCell(tr,[x.batch_name,x.class_name].filter(Boolean).join(" / "));
    tr.insertCell().append(statusTag(x.status));
    [x.enrolled_students,x.attempts,x.in_progress,x.pending_evaluation,x.evaluated,x.published_results,
     x.average_percentage==null?"—":Number(x.average_percentage).toFixed(2)+"%"].forEach(v=>addCell(tr,v));
  });
}

async function loadExamMonitoring() {
  const body=$("#exam-monitoring-list");if(!body)return;
  body.innerHTML='<tr><td colspan="11">Loading exam monitoring data…</td></tr>';
  showMessage("exam-monitoring-message","");
  try{
    const d=await api("/api/admin/exam-monitoring");
    const s=d.summary||{};
    const values={
      "monitor-total-exams":s.total_exams??0,
      "monitor-published-exams":s.published_exams??0,
      "monitor-total-attempts":s.total_attempts??0,
      "monitor-in-progress":s.in_progress_attempts??0,
      "monitor-pending-evaluation":s.pending_evaluation??0,
      "monitor-evaluated":s.evaluated_attempts??0,
      "monitor-published-results":s.published_results??0,
      "monitor-average-score":s.average_published_percentage==null?"—":Number(s.average_published_percentage).toFixed(2)+"%"
    };
    Object.entries(values).forEach(([id,value])=>{const el=$("#"+id);if(el)el.textContent=value;});
    examMonitoringRows=d.exams||[];
    renderExamMonitoringRows();
  }catch(error){
    body.replaceChildren();const tr=body.insertRow();const td=tr.insertCell();td.colSpan=11;td.textContent=error.message;
    showMessage("exam-monitoring-message","Could not load examination monitoring.");
  }
}

async function loadPublicExams(){
  const body=$("#public-exams-list"),attemptBody=$("#public-attempts-list");
  if(!body||!attemptBody)return;
  body.innerHTML='<tr><td colspan="7">Loading public exam catalogue…</td></tr>';
  attemptBody.innerHTML='<tr><td colspan="9">Loading guest attempts…</td></tr>';
  showMessage("public-exams-message","");
  try{
    const [catalogue,attempts]=await Promise.all([api("/api/admin/public-exams"),api("/api/admin/public-attempts")]);
    body.replaceChildren();
    (catalogue.exams||[]).forEach(x=>{
      const tr=body.insertRow();
      const title=tr.insertCell();title.textContent=x.title||"Untitled";
      [x.exam_status,x.public_status||"Not published",x.public_slug||"—",x.question_count,x.attempts].forEach(v=>{const td=tr.insertCell();td.textContent=v??"—";});
      const action=tr.insertCell();
      const btn=document.createElement("button");btn.className="btn btn-small "+(x.public_status==="published"?"btn-danger":"btn-primary");
      btn.textContent=x.public_status==="published"?"Unpublish":"Publish / Update";
      btn.addEventListener("click",async()=>{
        try{
          let payload;
          if(x.public_status==="published"){
            if(!confirm("Remove this exam from the public catalogue? Existing attempts will remain preserved."))return;
            payload={status:"draft",public_slug:x.public_slug||"exam-"+x.exam_id.slice(0,8),max_attempts:x.max_attempts||1,results_mode:x.results_mode||"immediate",starts_at:x.starts_at||null,ends_at:x.ends_at||null};
          }else{
            const suggested=(x.title||"free-exam").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80)||"free-exam";
            const slug=prompt("Public page URL slug (free-exams.html? no, this becomes /free-exams.html#"+suggested+")",x.public_slug||suggested);if(slug===null)return;
            const max=prompt("Maximum attempts per student (1–10)",String(x.max_attempts||1));if(max===null)return;
            const mode=prompt("Result mode: immediate or after_review",x.results_mode||"immediate");if(mode===null)return;
            const starts=prompt("Public exam opening date/time (optional ISO format, e.g. 2026-11-25T09:00:00)",x.starts_at||"");if(starts===null)return;
            const ends=prompt("Public exam closing date/time (optional ISO format)",x.ends_at||"");if(ends===null)return;
            payload={status:"published",public_slug:slug,max_attempts:Number(max),results_mode:mode,starts_at:starts||null,ends_at:ends||null};
          }
          await api("/api/admin/public-exams/"+encodeURIComponent(x.exam_id),{method:"PUT",body:JSON.stringify(payload)});
          await loadPublicExams();
        }catch(e){alert(e.message);}
      });
      action.append(btn);
    });
    if(!body.children.length){const tr=body.insertRow(),td=tr.insertCell();td.colSpan=7;td.textContent="No exams have been created yet.";}
    attemptBody.replaceChildren();
    (attempts.attempts||[]).forEach(x=>{
      const tr=attemptBody.insertRow();
      [x.started_at?new Date(x.started_at).toLocaleString():"—",x.student_name,x.phone+(x.email?" · "+x.email:""),x.class_label,x.exam_title,"#"+x.attempt_number,x.status,x.score==null?"—":Number(x.score).toFixed(2)+" / "+Number(x.total_marks||0).toFixed(2)].forEach(v=>{const td=tr.insertCell();td.textContent=v??"—";});
      const td=tr.insertCell();
      if(x.status==="evaluated"&&!x.result_released_at){
        const release=document.createElement("button");release.className="btn btn-small btn-primary";release.textContent="Release result";
        release.addEventListener("click",async()=>{if(!confirm("Release this result to the student?"))return;try{await api("/api/admin/public-attempts/"+encodeURIComponent(x.attempt_id)+"/release-result",{method:"POST",body:"{}"});await loadPublicExams();}catch(e){alert(e.message);}});
        td.append(release);
      }else td.textContent=x.result_released_at?"Released":x.status==="submitted"?"Pending evaluation":"—";
    });
    if(!attemptBody.children.length){const tr=attemptBody.insertRow(),td=tr.insertCell();td.colSpan=9;td.textContent="No public exam attempts yet.";}
  }catch(e){
    body.innerHTML='<tr><td colspan="7">'+e.message+'</td></tr>';
    attemptBody.innerHTML='<tr><td colspan="9">Could not load guest attempts.</td></tr>';
    showMessage("public-exams-message","Could not load public exam data.");
  }
}
document.addEventListener("click",e=>{if(e.target.id==="refresh-public-exams")loadPublicExams();});

document.addEventListener("change",e=>{
  if(e.target.id==="monitor-status-filter")renderExamMonitoringRows();
});
document.addEventListener("input",e=>{
  if(e.target.id==="monitor-search")renderExamMonitoringRows();
});
document.addEventListener("click",e=>{
  if(e.target.id==="refresh-exam-monitoring")loadExamMonitoring();
});

async function loadAdminLiveClasses(){
 const body=$("#admin-live-class-list");if(!body)return;body.innerHTML='<tr><td colspan="9">Loading classes…</td></tr>';
 try{const d=await api("/api/admin/live-classes");
 const fill=(el,items,label)=>{el.replaceChildren();const first=document.createElement("option");first.value="";first.textContent=label;el.append(first);items.forEach(x=>{const o=document.createElement("option");o.value=x.id;o.textContent=label==="Select batch"?x.batch_name:x.full_name;el.append(o);});};
 fill($("#live-batch"),d.batches||[],"Select batch");fill($("#live-teacher"),d.teachers||[],"Select teacher");body.replaceChildren();
 (d.live_classes||[]).forEach(item=>{const tr=body.insertRow();[item.title,item.batch_name,item.teacher_name,new Date(item.starts_at).toLocaleString()+" – "+new Date(item.ends_at).toLocaleTimeString(),item.status,item.enrolled_students,item.marked_students,item.present_students].forEach(v=>{const td=tr.insertCell();td.textContent=v??"—";});const td=tr.insertCell(),btn=document.createElement("button");btn.className="btn btn-secondary btn-small";btn.textContent="View attendance";btn.addEventListener("click",()=>loadAdminLiveAttendance(item.id,item.title));td.append(btn);if(item.status==="scheduled"){const cancel=document.createElement("button");cancel.className="btn btn-danger btn-small";cancel.style.marginLeft="6px";cancel.textContent="Cancel class";cancel.addEventListener("click",async()=>{if(!confirm("Cancel this scheduled class? Students and the assigned teacher will no longer see it as scheduled."))return;cancel.disabled=true;try{await api("/api/admin/live-classes/"+encodeURIComponent(item.id)+"/status",{method:"PATCH",body:JSON.stringify({status:"cancelled"})});await loadAdminLiveClasses();}catch(e){alert(e.message);cancel.disabled=false;}});td.append(cancel);}});
 if(!body.children.length){const tr=body.insertRow(),td=tr.insertCell();td.colSpan=9;td.textContent="No online classes scheduled yet.";}
 }catch(e){body.replaceChildren();const tr=body.insertRow(),td=tr.insertCell();td.colSpan=9;td.textContent=e.message;}
}
async function loadAdminLiveAttendance(id,title){const panel=$("#admin-live-attendance"),body=$("#admin-live-attendance-list");panel.classList.remove("hidden");$("#admin-live-attendance-title").textContent="Attendance · "+title;body.innerHTML="<tr><td colspan=\"4\">Loading…</td></tr>";try{const d=await api("/api/admin/live-classes/"+encodeURIComponent(id)+"/attendance");body.replaceChildren();(d.students||[]).forEach(s=>{const tr=body.insertRow();[s.student_name,s.email,s.attendance_status||"Not marked",s.marked_by_name||"—"].forEach(v=>{const td=tr.insertCell();td.textContent=v;});});if(!body.children.length){const tr=body.insertRow(),td=tr.insertCell();td.colSpan=4;td.textContent="No active students enrolled in this batch.";}}catch(e){body.textContent=e.message;}}
async function openTeacherAttendance(id,title){let panel=$("#teacher-attendance-panel");if(!panel){panel=document.createElement("div");panel.id="teacher-attendance-panel";panel.className="form-card";$("#my-live-list").closest(".table-card").after(panel);}panel.innerHTML="<h3>Attendance · "+title+"</h3><p class=\"muted\">Choose Present, Late, Absent or Excused for each actively enrolled student.</p><div class=\"table-scroll\"><table><thead><tr><th>Student</th><th>Email</th><th>Attendance</th></tr></thead><tbody id=\"teacher-attendance-roster\"><tr><td colspan=\"3\">Loading…</td></tr></tbody></table></div><button id=\"save-teacher-attendance\" class=\"btn btn-primary\" type=\"button\" data-class-id=\""+id+"\">Save attendance</button><p id=\"teacher-attendance-message\" class=\"message\"></p>";try{const d=await api("/api/teacher/live-classes/"+encodeURIComponent(id)+"/attendance"),body=$("#teacher-attendance-roster");body.replaceChildren();(d.students||[]).forEach(s=>{const tr=body.insertRow();[s.student_name,s.email].forEach(v=>{const td=tr.insertCell();td.textContent=v||"—";});const td=tr.insertCell(),sel=document.createElement("select");sel.className="status-select";sel.dataset.studentId=s.student_id;[["","Select status"],["present","Present"],["late","Late"],["absent","Absent"],["excused","Excused"]].forEach(([v,l])=>{const o=document.createElement("option");o.value=v;o.textContent=l;sel.append(o);});sel.value=s.attendance_status||"";td.append(sel);});if(!body.children.length){const tr=body.insertRow(),td=tr.insertCell();td.colSpan=3;td.textContent="No active students enrolled in this batch.";}}catch(e){panel.textContent=e.message;}}

let inrUsdRate = null;
let inrUsdRateFetchedAt = 0;
async function refreshInrUsdRate(force=false){
  const now=Date.now();
  if(!force&&inrUsdRate&&now-inrUsdRateFetchedAt<6*60*60*1000)return inrUsdRate;
  try{
    const response=await fetch("https://open.er-api.com/v6/latest/INR",{cache:"no-store"});
    if(!response.ok)throw new Error("Exchange-rate service unavailable");
    const data=await response.json();
    const rate=Number(data?.rates?.USD);
    if(data?.result!=="success"||!Number.isFinite(rate)||rate<=0)throw new Error("Invalid INR/USD exchange rate");
    inrUsdRate=rate;inrUsdRateFetchedAt=now;
    return rate;
  }catch(error){
    console.warn("Could not refresh INR/USD rate; displaying INR only.",error);
    return inrUsdRate;
  }
}
function rupees(paise){
  const inr=Number(paise||0)/100;
  const inrLabel="₹"+inr.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
  if(!inrUsdRate)return inrLabel;
  const usd=Math.ceil(inr*inrUsdRate);
  return "$"+usd.toLocaleString("en-US")+" · "+inrLabel;
}
async function loadAdminFees(){
  await refreshInrUsdRate();
  const plansBody=$("#fee-plan-list"),accountsBody=$("#fee-account-list");
  if(!plansBody||!accountsBody)return;
  plansBody.innerHTML='<tr><td colspan="7">Loading…</td></tr>';accountsBody.innerHTML='<tr><td colspan="8">Loading…</td></tr>';
  try{
    const [boot,plans,accounts]=await Promise.all([api("/api/admin/fees/bootstrap"),api("/api/admin/fee-plans"),api("/api/admin/fee-accounts")]);
    fillSelect($("#fee-account-student"),boot.students||[],x=>x.full_name+" · "+x.email,"Select approved student");
    fillSelect($("#fee-account-plan"),boot.fee_plans||[],x=>x.name+" · "+rupees(x.amount_paise),"Custom agreed fee");
    fillSelect($("#fee-plan-curriculum"),boot.curricula||[],x=>x.name,"Any curriculum");
    fillSelect($("#fee-plan-class"),boot.classes||[],x=>x.class_name,"Any class");
    fillSelect($("#fee-plan-subject"),boot.subjects||[],x=>x.subject_name,"Any subject");
    fillSelect($("#fee-plan-batch"),boot.batches||[],x=>x.batch_name,"Any batch");
    plansBody.replaceChildren();
    (plans.fee_plans||[]).forEach(p=>{
      const frequencyLabel = p.billing_frequency === "one_time" && p.batch_type ? "Per 60-min session" : p.billing_frequency;
      const tr=plansBody.insertRow();[p.name,p.pricing_scope,frequencyLabel,rupees(p.amount_paise),[p.effective_from,p.effective_to].filter(Boolean).join(" – ")||"—",p.public_status].forEach(v=>addCell(tr,v));
      const action=tr.insertCell(),sel=document.createElement("select");sel.className="status-select";
      ["draft","published","archived"].forEach(v=>{const o=document.createElement("option");o.value=v;o.textContent=v;sel.append(o);});sel.value=p.public_status;
      const btn=document.createElement("button");btn.className="btn btn-secondary btn-small";btn.textContent="Save status";
      btn.addEventListener("click",async()=>{btn.disabled=true;try{await api("/api/admin/fee-plans/"+encodeURIComponent(p.id)+"/status",{method:"PATCH",body:JSON.stringify({status:sel.value})});await loadAdminFees();}catch(e){alert(e.message);btn.disabled=false;}});
      action.append(sel,btn);
    });
    if(!plansBody.children.length){const tr=plansBody.insertRow(),td=tr.insertCell();td.colSpan=7;td.textContent="No fee plans created yet.";}
    accountsBody.replaceChildren();
    (accounts.accounts||[]).forEach(a=>{
      const paid=Number(a.paid_paise||0),credit=Number(a.adjustment_credit_paise||0),balance=Math.max(0,Number(a.amount_due_paise)-paid-credit),status=balance===0?"paid":a.due_date&&a.due_date<new Date().toISOString().slice(0,10)?"overdue":paid>0||credit>0?"partial":"pending";
      const tr=accountsBody.insertRow();[a.student_name,a.description,rupees(a.amount_due_paise),rupees(paid),rupees(balance),a.due_date||"—",status].forEach(v=>addCell(tr,v));
      const action=tr.insertCell();
      const pay=document.createElement("button");pay.className="btn btn-primary btn-small";pay.textContent="Record payment";pay.disabled=balance<=0;
      pay.addEventListener("click",async()=>{const value=prompt("Payment amount in INR. Outstanding: "+rupees(balance));if(value===null)return;const amount=Math.round(Number(value)*100);if(!Number.isSafeInteger(amount)||amount<=0){alert("Enter a valid positive amount.");return;}const method=prompt("Payment method: cash, bank_transfer, upi_manual or other","cash");if(!method)return;const reference=prompt("Transaction / bank reference (optional)","")||"";pay.disabled=true;try{const result=await api("/api/admin/fee-accounts/"+encodeURIComponent(a.id)+"/payments",{method:"POST",body:JSON.stringify({amount_paise:amount,payment_method:method,transaction_reference:reference})});alert("Payment recorded. Receipt: "+result.receipt_number);await loadAdminFees();}catch(e){alert(e.message);pay.disabled=false;}});
      const adj=document.createElement("button");adj.className="btn btn-secondary btn-small";adj.textContent="Adjustment / refund";
      adj.addEventListener("click",async()=>{const type=prompt("Type: credit, debit, refund or waiver","credit");if(!type)return;const value=prompt("Adjustment amount in INR");if(value===null)return;const amount=Math.round(Number(value)*100),reason=prompt("Reason (required)");if(!Number.isSafeInteger(amount)||amount<=0||!reason)return;try{await api("/api/admin/fee-accounts/"+encodeURIComponent(a.id)+"/adjustments",{method:"POST",body:JSON.stringify({adjustment_type:type,amount_paise:amount,reason})});await loadAdminFees();}catch(e){alert(e.message);}});
      action.append(pay,adj);
    });
    if(!accountsBody.children.length){const tr=accountsBody.insertRow(),td=tr.insertCell();td.colSpan=8;td.textContent="No student fee accounts created yet.";}
    showMessage("fee-management-message","");
  }catch(e){showMessage("fee-management-message",e.message);plansBody.innerHTML='<tr><td colspan="7">Could not load fee plans.</td></tr>';accountsBody.innerHTML='<tr><td colspan="8">Could not load fee accounts.</td></tr>';}
}
async function printPortalReceipt(receiptId){
  const win=window.open("about:blank","_blank");
  if(!win){alert("Allow pop-ups to print the receipt.");return;}
  try{const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error("Please sign in again.");const response=await fetch(API_URL+"/api/fee-receipts/"+encodeURIComponent(receiptId),{headers:{Authorization:"Bearer "+session.access_token}});if(!response.ok){const d=await response.json().catch(()=>({}));throw new Error(d.error||"Receipt could not be loaded.");}win.document.open();win.document.write(await response.text());win.document.close();}catch(e){win.close();alert(e.message);}
}
async function loadStudentFees(){
  await refreshInrUsdRate();
  const root=$("#student-fee-accounts");if(!root)return;root.textContent="Loading fee information…";
  try{
    const d=await api("/api/student/fees");root.replaceChildren();
    (d.accounts||[]).forEach(a=>{
      const card=document.createElement("div");card.className="table-card";
      const heading=document.createElement("div");heading.className="table-heading";
      const h=document.createElement("h3");h.textContent=a.description;const sub=document.createElement("p");sub.className="muted";sub.textContent=(a.plan_name||"Custom fee")+" · Agreed "+rupees(a.amount_due_paise)+" · Paid "+rupees(a.paid_paise)+" · Outstanding "+rupees(Math.max(0,Number(a.amount_due_paise)-Number(a.paid_paise||0)-Number(a.adjustment_credit_paise||0)));
      heading.append(h,sub);card.append(heading);
      const wrap=document.createElement("div");wrap.className="table-scroll";const table=document.createElement("table");table.innerHTML="<thead><tr><th>Payment date</th><th>Method</th><th>Amount</th><th>Receipt</th><th>Reference</th></tr></thead>";
      const tbody=document.createElement("tbody");
      (a.transactions||[]).forEach(t=>{const tr=tbody.insertRow();[t.received_at?new Date(t.received_at).toLocaleDateString():"—",t.payment_method,rupees(t.amount_paise)].forEach(v=>addCell(tr,v));const receiptCell=tr.insertCell();if(t.receipt_id){const btn=document.createElement("button");btn.className="btn btn-secondary btn-small";btn.textContent="Print "+(t.receipt_number||"receipt");btn.addEventListener("click",()=>printPortalReceipt(t.receipt_id));receiptCell.append(btn);}else receiptCell.textContent=t.receipt_number||"—";addCell(tr,t.transaction_reference||"—");});
      if(!tbody.children.length){const tr=tbody.insertRow(),td=tr.insertCell();td.colSpan=5;td.textContent="No payments recorded yet.";}
      table.append(tbody);wrap.append(table);card.append(wrap);
      if((a.installments||[]).length){const list=document.createElement("p");list.className="hint";list.textContent="Instalments: "+a.installments.map(x=>x.description+" · "+rupees(x.amount_paise)+" · due "+x.due_date).join(" | ");card.append(list);}
      root.append(card);
    });
    if(!(d.accounts||[]).length)root.textContent="No fee account has been assigned to you yet.";
  }catch(e){root.textContent=e.message;}
}


async function loadEnquiries(){
 const body=$("#enquiries-list"),message=$("#enquiries-message");if(!body)return;
 body.innerHTML='<tr><td colspan="11">Loading enquiries…</td></tr>';message.textContent="";
 try{
  const [d,t]=await Promise.all([api("/api/enquiries"+($("#enquiry-status-filter")?.value?"?status="+encodeURIComponent($("#enquiry-status-filter").value):"")),api("/api/teachers")]);
  const teachers=t.teachers||[];body.replaceChildren();
  (d.enquiries||[]).forEach(e=>{
   const tr=body.insertRow();
   const cell=(v)=>{const td=tr.insertCell();td.textContent=v??"—";return td;};
   cell(new Date(e.created_at+"Z").toLocaleString());
   cell(e.student_name+(e.parent_name?" / "+e.parent_name:""));
   const contact=cell("");const a=document.createElement("a");a.href="tel:"+e.phone;a.textContent=e.phone;contact.append(a);const em=document.createElement("div");const mail=document.createElement("a");mail.href="mailto:"+e.email;mail.textContent=e.email;em.append(mail);contact.append(em);
   cell("Class "+e.student_class+" / "+(e.board||"Not specified"));
   cell(e.course_interest||"Not specified");
   const st=cell("");const status=document.createElement("select");[["new","New"],["contacted","Contacted"],["demo_scheduled","Demo scheduled"],["enrolled","Enrolled"],["closed","Closed"]].forEach(([v,l])=>{const o=document.createElement("option");o.value=v;o.textContent=l;status.append(o);});status.value=e.status;st.append(status);
   const ow=cell("");const owner=document.createElement("select");const none=document.createElement("option");none.value="";none.textContent="Unassigned";owner.append(none);teachers.filter(x=>x.status==="approved").forEach(x=>{const o=document.createElement("option");o.value=x.id;o.textContent=x.full_name;owner.append(o);});owner.value=e.assigned_to||"";ow.append(owner);
   const fd=cell("");const follow=document.createElement("input");follow.type="date";follow.value=e.follow_up_at?e.follow_up_at.slice(0,10):"";fd.append(follow);
   const nt=cell("");const notes=document.createElement("textarea");notes.rows=2;notes.maxLength=2000;notes.value=e.admin_notes||"";notes.placeholder="Internal follow-up notes";nt.append(notes);
   const saveCell=cell("");const save=document.createElement("button");save.className="btn btn-primary btn-small";save.textContent="Save";save.addEventListener("click",async()=>{save.disabled=true;try{await api("/api/enquiries/"+encodeURIComponent(e.id),{method:"PATCH",body:JSON.stringify({status:status.value,assigned_to:owner.value||null,follow_up_at:follow.value||null,admin_notes:notes.value})});message.textContent="Enquiry updated.";await loadEnquiries();}catch(err){message.textContent=err.message;save.disabled=false;}});saveCell.append(save);
   const hist=cell("");const hb=document.createElement("button");hb.className="btn btn-secondary btn-small";hb.textContent="View";hb.addEventListener("click",()=>loadEnquiryHistory(e.id,e.student_name));hist.append(hb);
  });
  if(!body.children.length){const tr=body.insertRow(),td=tr.insertCell();td.colSpan=11;td.textContent="No website enquiries found.";}
 }catch(e){body.innerHTML='<tr><td colspan="11"></td></tr>';body.querySelector("td").textContent=e.message;}
}
async function loadEnquiryHistory(id,name){
 const panel=$("#enquiry-history-panel"),list=$("#enquiry-history-list");panel.classList.remove("hidden");$("#enquiry-history-title").textContent="History · "+name;list.textContent="Loading…";
 try{const d=await api("/api/enquiries/"+encodeURIComponent(id)+"/history");list.replaceChildren();(d.history||[]).forEach(h=>{const p=document.createElement("p");p.className="hint";p.textContent=new Date(h.created_at+"Z").toLocaleString()+" · "+(h.actor_name||"System")+" · "+h.action+": "+(h.old_value||"—")+" → "+(h.new_value||"—");list.append(p);});if(!list.children.length)list.textContent="No changes recorded yet.";}catch(e){list.textContent=e.message;}
}
document.addEventListener("click",e=>{if(e.target.id==="refresh-enquiries")loadEnquiries();});
document.addEventListener("change",e=>{if(e.target.id==="enquiry-status-filter")loadEnquiries();});


async function loadSystemHealth() {
  const ids=["health-worker","health-d1","health-r2","health-supabase"];
  ids.forEach(id=>{const el=$("#"+id);if(el)el.textContent="Checking…";});
  $("#system-health-message").textContent="Checking service connectivity and portal record totals…";
  try {
    const d=await api("/api/admin/system-health");
    const set=(key,value,detail)=>{
      $("#health-"+key).textContent=value;
      $("#health-"+key+"-detail").textContent=detail||"";
      $("#health-"+key).classList.toggle("health-good",value==="Online");
      $("#health-"+key).classList.toggle("health-bad",value!=="Online");
    };
    set("worker",d.services.worker.status,d.services.worker.detail);
    set("d1",d.services.d1.status,d.services.d1.detail);
    set("r2",d.services.r2.status,d.services.r2.detail);
    set("supabase",d.services.supabase.status,d.services.supabase.detail);
    $("#usage-users").textContent=d.activity.users;
    $("#usage-exams").textContent=d.activity.exams;
    $("#usage-attempts").textContent=d.activity.attempts;
    $("#usage-files").textContent=d.activity.files;
    $("#system-health-refreshed").textContent="Last checked "+new Date(d.checked_at).toLocaleString();
    const failed=Object.values(d.services).filter(x=>x.status!=="Online").length;
    $("#system-health-message").textContent=failed
      ? failed+" service check(s) need attention. Open the relevant provider dashboard for details."
      : "All connected services passed their checks. Provider quota consumption is shown in the linked provider dashboards.";
  } catch(e) {
    $("#system-health-message").textContent=e.message;
    ["worker","d1","r2","supabase"].forEach(k=>{const el=$("#health-"+k);el.textContent="Unavailable";el.classList.add("health-bad");});
  }
}

async function loadAdminPage(name) {
  try {
    if (name==="classes") await loadClasses();
    if (name==="subjects") await loadSubjects();
    if (name==="batches") await loadBatches();
    if (name==="assignments") await loadAssignments();
    if (name==="students") await loadStudents();
    if (name==="teachers") await loadTeachers();
    if (name==="exam-monitoring") await loadExamMonitoring();
    if (name==="public-exams") await loadPublicExams();
    if (name==="live-classes") await loadAdminLiveClasses();
    if (name==="fees") await loadAdminFees();
    if (name==="enquiries") await loadEnquiries();
    if (name==="system-health") await loadSystemHealth();
  } catch(error) { $("#dashboard-message").textContent=error.message; }
}

document.addEventListener("submit",async e=>{
  if(e.target.id!=="teacher-grade-form") return;
  e.preventDefault();
  const form=e.target,button=form.querySelector('button[type="submit"]');
  const grades=Array.from(form.querySelectorAll("input[data-question-id]")).map(input=>({
    exam_question_id:input.dataset.questionId,
    marks_awarded:Number(input.value),
    teacher_feedback:form.querySelector(`textarea[data-feedback-for="${input.dataset.questionId}"]`)?.value||""
  }));
  button.disabled=true;button.textContent="Saving evaluation…";
  try{
    const result=await api(`/api/teacher/evaluations/${encodeURIComponent(form.dataset.attemptId)}/grade`,{method:"POST",body:JSON.stringify({grades})});
    await loadTeacherEvaluations();
    await openTeacherEvaluation(form.dataset.attemptId);
    alert(`Evaluation saved. Final score: ${result.marks_obtained} / ${result.total_marks}.`);
  }catch(error){alert(error.message);button.disabled=false;button.textContent="Save evaluation";}
});

document.addEventListener("click",async e=>{
  const overviewNav = e.target.closest("[data-page]");
  if (overviewNav && overviewNav.closest("#overview-page")) {
    page(overviewNav.dataset.page);
    return;
  }
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
    const paper=$("#exam-paper-file").files[0];
    if(paper){const form=new FormData();form.append("file",paper);message.textContent="Exam created. Uploading question paper…";await apiForm("/api/teacher/exams/"+encodeURIComponent(result.exam_id)+"/attachments",form);}
    e.target.reset();$("#exam-duration").value="60";
    message.textContent="Exam created as "+result.status+(paper?" with question paper attached":"")+". Total marks: "+result.total_marks+". Review it below and publish when ready.";
    await loadTeacherAuthoring();
  }catch(error){message.textContent=error.message;}
  finally{button.disabled=false;}
});

$("#import-questions-button")?.addEventListener("click",async()=>{
  const button=$("#import-questions-button"),message=$("#question-import-message"),file=$("#question-import-file").files[0],batch=teacherWorkspaceBatches.find(x=>String(x.id)===String($("#question-import-batch").value));
  if(!batch||!file){message.textContent="Choose an assigned batch and a CSV/XLSX file.";return;}
  button.disabled=true;let added=0;message.textContent="Reading spreadsheet…";
  try{
    const XLSX=await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
    const book=XLSX.read(await file.arrayBuffer(),{type:"array"}),rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{defval:""});
    if(!rows.length||rows.length>100)throw new Error("The first sheet must contain 1–100 question rows.");
    for(let i=0;i<rows.length;i++){
      const r={};Object.entries(rows[i]).forEach(([k,v])=>r[String(k).trim().toLowerCase().replace(/\s+/g,"_")]=v);
      const q=String(r.question_text??"").trim();if(!q)throw new Error("Row "+(i+2)+": question_text is required.");
      const type=String(r.question_type||"mcq").trim().toLowerCase(),difficulty=String(r.difficulty||"medium").trim().toLowerCase(),correct=String(r.correct_answers||"").toUpperCase().split(/[\s,;]+/).filter(Boolean),options=[];
      for(let n=0;n<8;n++){const label=String.fromCharCode(97+n),v=r["option_"+label];if(String(v??"").trim())options.push({option_text:String(v).trim(),is_correct:correct.includes(label.toUpperCase())});}
      if(!["mcq","multiple_select","numerical","short_answer","long_answer"].includes(type))throw new Error("Row "+(i+2)+": unsupported question_type.");
      if(!["easy","medium","hard"].includes(difficulty))throw new Error("Row "+(i+2)+": difficulty must be easy, medium or hard.");
      if(["mcq","multiple_select"].includes(type)&&(options.length<2||options.filter(o=>o.is_correct).length<1||(type==="mcq"&&options.filter(o=>o.is_correct).length!==1)))throw new Error("Row "+(i+2)+": provide 2–8 options and valid correct_answers.");
      const marks=Number(r.default_marks||1);if(!Number.isFinite(marks)||marks<=0)throw new Error("Row "+(i+2)+": default_marks must be positive.");
      await api("/api/teacher/questions",{method:"POST",body:JSON.stringify({question_type:type,question_text:q,topic:String(r.topic||""),difficulty: difficulty,default_marks:marks,subject_id:String(batch.subject_id),class_id:batch.class_id==null?null:String(batch.class_id),explanation:String(r.explanation||""),options:["mcq","multiple_select"].includes(type)?options:[]})});
      added++;message.textContent="Imported "+added+" of "+rows.length+" questions…";
    }
    $("#question-import-file").value="";message.textContent="Successfully imported "+added+" questions into your question bank.";await loadTeacherAuthoring();
  }catch(error){message.textContent="Imported "+added+" question(s). "+error.message;await loadTeacherAuthoring();}
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

    // A password recovery returns the user to the login screen.
    const recoveringPassword = isPasswordRecovery();
    await supabase.auth.signOut();

    $("#invite-form").reset();
    if (recoveringPassword) showLogin("Your password has been reset. Please sign in.");
    else showPendingApproval();

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

$("#forgot-password").addEventListener("click", async () => {
  const email = $("#email").value.trim();
  const message = $("#login-message");
  if (!email) {
    message.textContent = "Enter your email address first, then select Forgot password.";
    $("#email").focus();
    return;
  }
  const button = $("#forgot-password");
  button.disabled = true;
  message.textContent = "Sending password reset email…";
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/"
    });
    if (error) throw error;
    message.textContent = "If an account exists for this email, a password reset link has been sent.";
  } catch (error) {
    message.textContent = error.message || "Could not send the password reset email.";
  } finally {
    button.disabled = false;
  }
});

$("#pending-login-button").addEventListener("click", () => {
  showLogin(
    "Your password is set. Sign in after the administrator approves your account."
  );
});

$("#refresh-system-health")?.addEventListener("click",()=>loadSystemHealth());

async function signOutPortal() {
  const buttons = [$("#signout-button"), $("#topbar-signout")].filter(Boolean);
  buttons.forEach(button => { button.disabled = true; button.textContent = "Signing out…"; });
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    profile = null;
    const workspace = $("#role-workspace-page");
    if (workspace) workspace.remove();
    showLogin("You have signed out.");
  } catch (error) {
    buttons.forEach(button => { button.disabled = false; button.textContent = "↪ Sign out"; });
    const message = $("#dashboard-message") || $("#login-message");
    if (message) message.textContent = "Could not sign out: " + (error.message || "Please try again.");
  }
}

$("#signout-button")?.addEventListener("click", signOutPortal);

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
  const recoveryLink = isPasswordRecovery();
  const { data, error } = await supabase.auth.getSession();

  if (invitationLink || recoveryLink) {
    if (data.session) {
      invitationFlowStarted = true;
      showInvitationForm(recoveryLink ? "Choose a new password for your account." : "");
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

document.addEventListener("submit",async e=>{if(e.target.id!=="admin-live-class-form")return;e.preventDefault();const btn=$("#save-live-class"),msg=$("#live-class-message");btn.disabled=true;msg.textContent="Scheduling class…";try{await api("/api/admin/live-classes",{method:"POST",body:JSON.stringify({title:$("#live-title").value.trim(),description:$("#live-description").value.trim(),batch_id:$("#live-batch").value,teacher_id:$("#live-teacher").value,meeting_provider:$("#live-provider").value,meeting_url:$("#live-url").value.trim(),starts_at:new Date($("#live-start").value).toISOString(),ends_at:new Date($("#live-end").value).toISOString()})});e.target.reset();msg.textContent="Class scheduled. Enrolled students can now see the meeting link.";await loadAdminLiveClasses();}catch(err){msg.textContent=err.message;}finally{btn.disabled=false;}});
document.addEventListener("click",async e=>{if(e.target.id==="refresh-live-classes")await loadAdminLiveClasses();if(e.target.id==="save-teacher-attendance"){const btn=e.target,rows=Array.from($("#teacher-attendance-roster").querySelectorAll("select[data-student-id]")),attendance=rows.map(x=>({student_id:x.dataset.studentId,attendance_status:x.value}));if(attendance.some(x=>!x.attendance_status)){alert("Select an attendance status for every student before saving.");return;}btn.disabled=true;try{const d=await api("/api/teacher/live-classes/"+encodeURIComponent(btn.dataset.classId)+"/attendance",{method:"POST",body:JSON.stringify({attendance})});$("#teacher-attendance-message").textContent="Attendance saved for "+d.saved+" students.";}catch(err){alert(err.message);}finally{btn.disabled=false;}}});

document.addEventListener("submit",async e=>{
 if(e.target.id==="teacher-material-form"){e.preventDefault();const f=e.target,msg=$("#material-form-message"),btn=f.querySelector("button[type=submit]");btn.disabled=true;msg.textContent="Uploading to secure file storage…";try{const data=new FormData();data.append("title",$("#material-title").value.trim());data.append("description",$("#material-description").value.trim());data.append("batch_id",$("#material-batch").value);data.append("file",$("#material-file").files[0]);await apiForm("/api/teacher/materials",data);f.reset();msg.textContent="Study material uploaded and assigned to the batch.";await loadRoleWorkspace("teacher");}catch(err){msg.textContent=err.message;}finally{btn.disabled=false;}}
 if(e.target.id==="teacher-assignment-form"){e.preventDefault();const f=e.target,msg=$("#teacher-assignment-message"),btn=f.querySelector("button[type=submit]");btn.disabled=true;msg.textContent="Publishing assignment…";try{const d=await api("/api/teacher/assignments",{method:"POST",body:JSON.stringify({title:$("#assignment-title").value.trim(),instructions:$("#assignment-instructions").value.trim(),batch_id:$("#assignment-batch").value,due_at:$("#assignment-due").value?new Date($("#assignment-due").value).toISOString():null,max_marks:$("#assignment-max-marks").value||null})});const file=$("#assignment-attachment").files[0];if(file){const data=new FormData();data.append("file",file);await apiForm("/api/teacher/assignments/"+d.id+"/attachments",data);}f.reset();msg.textContent="Assignment published.";await loadLearningTasks("teacher");}catch(err){msg.textContent=err.message;}finally{btn.disabled=false;}}
 if(e.target.id==="student-assignment-submit"){e.preventDefault();const f=e.target,msg=$("#student-assignment-message"),btn=f.querySelector("button[type=submit]");btn.disabled=true;msg.textContent="Submitting work…";try{const data=new FormData();data.append("answer_text",$("#student-assignment-answer").value);const file=$("#student-assignment-file").files[0];if(file)data.append("file",file);await apiForm("/api/student/assignments/"+f.dataset.assignmentId+"/submit",data);msg.textContent="Your assignment has been submitted.";await loadLearningTasks("student");}catch(err){msg.textContent=err.message;}finally{btn.disabled=false;}}
});


document.addEventListener("submit",async e=>{
  if(e.target.id==="student-entitlement-form"){
    e.preventDefault();const f=e.target,msg=$("#entitlement-message"),btn=f.querySelector("button[type=submit]");btn.disabled=true;
    const batch=adminCache.batches.find(x=>x.id===$("#entitlement-batch").value);
    try{if(!batch)throw new Error("Select an active batch.");await api("/api/admin/student-entitlements",{method:"POST",body:JSON.stringify({student_id:$("#entitlement-student").value,batch_id:batch.id,subject_id:batch.subject_id,total_classes:Number($("#entitlement-total").value)})});msg.textContent="Class entitlement saved. Student progress will update automatically.";f.reset();}
    catch(err){msg.textContent=err.message;}finally{btn.disabled=false;}
  }
  if(e.target.id==="teacher-leave-form"){
    e.preventDefault();const f=e.target,msg=$("#teacher-leave-message"),btn=f.querySelector("button[type=submit]");btn.disabled=true;msg.textContent="Submitting request…";
    try{await api("/api/teacher/leaves",{method:"POST",body:JSON.stringify({leave_type:$("#leave-type").value,start_date:$("#leave-start").value,end_date:$("#leave-end").value,reason:$("#leave-reason").value.trim()})});f.reset();msg.textContent="Leave request submitted to Admin.";await loadTeacherLeaves();}
    catch(err){msg.textContent=err.message;}finally{btn.disabled=false;}
  }
  if(e.target.id==="fee-plan-form"){
    e.preventDefault();const f=e.target,msg=$("#fee-plan-message");msg.textContent="Saving draft…";
    try{await api("/api/admin/fee-plans",{method:"POST",body:JSON.stringify({name:$("#fee-plan-name").value.trim(),amount_paise:Math.round(Number($("#fee-plan-amount").value)*100),billing_frequency:$("#fee-plan-frequency").value,pricing_scope:$("#fee-plan-scope").value,batch_type:$("#fee-plan-batch-type").value||null,curriculum_id:$("#fee-plan-curriculum").value||null,class_id:$("#fee-plan-class").value||null,subject_id:$("#fee-plan-subject").value||null,batch_id:$("#fee-plan-batch").value||null,effective_from:$("#fee-plan-effective-from").value||null,effective_to:$("#fee-plan-effective-to").value||null,description:$("#fee-plan-description").value,inclusions:$("#fee-plan-inclusions").value,terms:$("#fee-plan-terms").value})});f.reset();msg.textContent="Fee plan saved as draft. Publish it when ready.";await loadAdminFees();}catch(err){msg.textContent=err.message;}
  }
  if(e.target.id==="fee-account-form"){
    e.preventDefault();const f=e.target,msg=$("#fee-account-message");msg.textContent="Creating student fee account…";
    const original=Math.round(Number($("#fee-account-original").value)*100),discount=Math.round(Number($("#fee-account-discount").value||0)*100),scholarship=Math.round(Number($("#fee-account-scholarship").value||0)*100),total=Math.round(Number($("#fee-account-total").value)*100),count=Math.max(1,Math.min(24,Number($("#fee-account-installments").value||1))),first=$("#fee-account-due").value;
    const installments=[];
    if(count>1&&!first){msg.textContent="Select the first instalment due date.";return;}
    if(first){let remaining=total;for(let i=0;i<count;i++){const part=i===count-1?remaining:Math.floor(total/count);remaining-=part;const date=new Date(first+"T12:00:00");date.setMonth(date.getMonth()+i);installments.push({amount_paise:part,due_date:date.toISOString().slice(0,10),description:"Instalment "+(i+1)});}}
    try{await api("/api/admin/fee-accounts",{method:"POST",body:JSON.stringify({student_id:$("#fee-account-student").value,fee_plan_id:$("#fee-account-plan").value||null,description:$("#fee-account-description").value.trim(),original_amount_paise:original,discount_paise:discount,scholarship_paise:scholarship,amount_due_paise:total,due_date:first||null,installments,notes:$("#fee-account-notes").value})});f.reset();$("#fee-account-discount").value="0";$("#fee-account-scholarship").value="0";$("#fee-account-installments").value="1";msg.textContent="Student fee account created. Agreed amount is now fixed.";await loadAdminFees();}catch(err){msg.textContent=err.message;}
  }
});
document.addEventListener("change",e=>{
  if(e.target.id==="fee-account-plan"&&e.target.value){const p=Array.from(e.target.options).find(x=>x.value===e.target.value);if(p){const match=p.textContent.match(/·\s*₹([\d,]+(?:\.\d{2})?)/);if(match){const v=Number(match[1].replace(/,/g,""));$("#fee-account-original").value=v.toFixed(2);$("#fee-account-total").value=v.toFixed(2);}$("#fee-account-description").value=p.textContent.split(" · ")[0];}}
  if(["fee-account-original","fee-account-discount","fee-account-scholarship"].includes(e.target.id)){const o=Number($("#fee-account-original").value||0),d=Number($("#fee-account-discount").value||0),s=Number($("#fee-account-scholarship").value||0);$("#fee-account-total").value=Math.max(0,o-d-s).toFixed(2);}
});
document.addEventListener("click",e=>{if(e.target.id==="refresh-fees")loadAdminFees();});
document.addEventListener("click",e=>{if(e.target.id==="refresh-teacher-leaves")loadAdminTeacherLeaves();});
