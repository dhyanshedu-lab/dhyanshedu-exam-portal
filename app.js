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

  document.querySelectorAll("[data-admin-only]").forEach(x =>
    x.classList.toggle("hidden", p.role !== "admin")
  );

  page("overview");

  if (p.role === "admin") {
    loadStats();
  } else {
    $("#dashboard-message").textContent =
      "Your teacher workspace will be enabled in a later phase.";
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
