import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const SUPABASE_URL="https://vxifxiuitprdafvgpojh.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_WbeQeyK02QCDwayhi2NMjw_T-gOIpxG";
const API_URL="https://dhyanshedu-api.dhyanshedu.workers.dev";
const $=s=>document.querySelector(s);
const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
let profile=null;
$("#year").textContent=new Date().getFullYear();

async function api(path,opts={}) {
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error("Please sign in again.");
  const r=await fetch(API_URL+path,{...opts,headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`,...(opts.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`);
  return d;
}
function login(text=""){ $("#dashboard-view").classList.add("hidden");$("#login-view").classList.remove("hidden");$("#login-message").textContent=text; }
function page(name){
  $("#overview-page").classList.toggle("hidden",name!=="overview");
  $("#teachers-page").classList.toggle("hidden",name!=="teachers");
  document.querySelectorAll(".nav-item[data-page]").forEach(x=>x.classList.toggle("active",x.dataset.page===name));
  if(name==="teachers")loadTeachers();
}
function dashboard(p,email){
  profile=p;$("#login-view").classList.add("hidden");$("#dashboard-view").classList.remove("hidden");
  const n=p.full_name||email||"User";$("#user-name").textContent=n;$("#user-role").textContent=p.role;$("#avatar").textContent=n[0].toUpperCase();
  $("#welcome-title").textContent=p.role==="admin"?"Admin dashboard":`${p.role} dashboard`;
  document.querySelectorAll("[data-admin-only]").forEach(x=>x.classList.toggle("hidden",p.role!=="admin"));
  page("overview");if(p.role==="admin")loadStats();else $("#dashboard-message").textContent="Your workspace will be enabled in a later phase.";
}
async function loadProfile(session){
  try{const d=await api("/api/me");dashboard(d.profile,session.user.email);}
  catch(e){await supabase.auth.signOut();login(e.message);}
}
async function loadStats(){
  try{const {stats}=await api("/api/dashboard/stats");$("#teacher-count").textContent=stats.teachers;$("#student-count").textContent=stats.students;$("#exam-count").textContent=stats.exams;$("#attempt-count").textContent=stats.attempts;$("#dashboard-message").textContent="Connected to DhyanshEdu backend.";}
  catch(e){$("#dashboard-message").textContent=e.message;}
}
async function loadTeachers(){
  const body=$("#teacher-list");body.innerHTML='<tr><td colspan="4">Loading…</td></tr>';
  try{
    const {teachers}=await api("/api/teachers");$("#teacher-total").textContent=teachers.length;
    $("#teacher-pending").textContent=teachers.filter(t=>t.status==="pending").length;
    $("#teacher-approved").textContent=teachers.filter(t=>t.status==="approved").length;
    body.replaceChildren();
    if(!teachers.length){body.innerHTML='<tr><td colspan="4" class="empty-state">No teachers yet. Select Add teacher to invite one.</td></tr>';return;}
    for(const t of teachers){
      const tr=document.createElement("tr");
      for(const value of [t.full_name,t.email]){
        const td=document.createElement("td");td.textContent=value||"";tr.append(td);
      }
      const st=document.createElement("td"), badge=document.createElement("span");badge.className=`status-pill ${t.status}`;badge.textContent=t.status;st.append(badge);tr.append(st);
      const action=document.createElement("td"),select=document.createElement("select");select.className="status-select";
      ["pending","approved","inactive"].forEach(v=>{const o=document.createElement("option");o.value=v;o.textContent=v[0].toUpperCase()+v.slice(1);o.selected=v===t.status;select.append(o)});
      select.addEventListener("change",async()=>{select.disabled=true;try{await api(`/api/teachers/${encodeURIComponent(t.id)}/status`,{method:"PATCH",body:JSON.stringify({status:select.value})});await loadTeachers();}catch(e){alert(e.message);select.disabled=false;}});
      action.append(select);tr.append(action);body.append(tr);
    }
  }catch(e){body.innerHTML="";const tr=document.createElement("tr"),td=document.createElement("td");td.colSpan=4;td.textContent=e.message;tr.append(td);body.append(tr);}
}
$("#toggle-password").addEventListener("click",()=>{const i=$("#password"),show=i.type==="password";i.type=show?"text":"password";$("#toggle-password").textContent=show?"Hide":"Show";});
$("#login-form").addEventListener("submit",async e=>{e.preventDefault();const b=$("#login-button");b.disabled=true;b.textContent="Signing in…";const {data,error}=await supabase.auth.signInWithPassword({email:$("#email").value.trim(),password:$("#password").value});b.disabled=false;b.innerHTML='Sign in <span>→</span>';if(error){$("#login-message").textContent=error.message;return;}await loadProfile(data.session);});
$("#signout-button").addEventListener("click",async()=>{await supabase.auth.signOut();profile=null;login("You have signed out.");});
document.querySelectorAll(".nav-item[data-page]").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();if(profile?.role==="admin")page(a.dataset.page);}));
$("#add-teacher-button").addEventListener("click",()=>{$("#teacher-form").reset();$("#teacher-form-message").textContent="";$("#teacher-dialog").showModal();});
$("#close-teacher-dialog").addEventListener("click",()=>$("#teacher-dialog").close());
$("#teacher-form").addEventListener("submit",async e=>{e.preventDefault();const b=$("#save-teacher-button");b.disabled=true;b.textContent="Sending…";$("#teacher-form-message").textContent="";try{await api("/api/teachers",{method:"POST",body:JSON.stringify({full_name:$("#teacher-full-name").value.trim(),email:$("#teacher-email").value.trim()})});$("#teacher-form-message").textContent="Invitation sent. Access is pending Admin approval.";await loadTeachers();setTimeout(()=>$("#teacher-dialog").close(),1200);}catch(err){$("#teacher-form-message").textContent=err.message;}finally{b.disabled=false;b.textContent="Send invitation";}});
supabase.auth.getSession().then(({data})=>{if(data.session)loadProfile(data.session);});
supabase.auth.onAuthStateChange((event,session)=>{if(event==="SIGNED_OUT"||!session)login();});
