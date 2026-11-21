const ALLOWED_ORIGINS = new Set([
  "https://dhyanshedu.com",
  "https://www.dhyanshedu.com",
  "https://dhyanshedu-lab.github.io",
  "https://dhyanshedu-exam-portal.dhyanshedu.workers.dev"
]);

function json(request, data, status = 200) {
  const origin = request.headers.get("Origin") || "";
  const headers = { "Content-Type": "application/json", "Vary": "Origin" };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const validEmail = value => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPhone = value => /^[+\d][\d\s().-]{7,19}$/.test(value);

async function readBody(request) {
  const raw = await request.text();
  if (raw.length > 12000) throw new Error("Request is too large.");
  try { return JSON.parse(raw || "{}"); }
  catch { throw new Error("Invalid JSON body."); }
}

async function logActivity(db, enquiryId, type, summary, actorId = null, previous = null, next = null, followUp = null) {
  await db.prepare(
    "INSERT INTO enquiry_activities(id,enquiry_id,activity_type,summary,previous_value,new_value,performed_by,next_follow_up_at) VALUES(?,?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), enquiryId, type, summary, previous, next, actorId, followUp).run();
}

export async function handleEnquiryRequest(request, env, user, account, path, method) {
  // Public website enquiry intake. No account or student login is required.
  if (path === "/api/public/enquiries" && method === "POST") {
    let b;
    try { b = await readBody(request); } catch (e) { return json(request, { error: e.message }, 400); }

    // Honeypot field for basic bot filtering. Real visitors leave this blank.
    if (clean(b.website, 160)) return json(request, { success: true, message: "Thank you. Your enquiry has been received." }, 201);

    const studentName = clean(b.student_name, 120);
    const phone = clean(b.phone, 24);
    const email = clean(b.email, 254).toLowerCase();
    const learningMode = clean(b.learning_mode, 20);
    if (!studentName || !validPhone(phone)) return json(request, { error: "Enter the student's name and a valid contact number." }, 400);
    if (b.privacy_accepted !== true) return json(request, { error: "Please acknowledge the privacy notice before submitting." }, 400);
    if (!validEmail(email)) return json(request, { error: "Enter a valid email address." }, 400);
    if (learningMode && !["group", "one_to_one"].includes(learningMode)) return json(request, { error: "Choose group or one-to-one learning." }, 400);

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await env.DB1.prepare(
        "INSERT INTO enquiries(id,student_name,parent_name,phone,email,class_label,curriculum_id,exam_pathway_id,subject_id,learning_mode,message,source,status,privacy_notice_version,consent_recorded_at,marketing_consent,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'website','new',?,?,?,?,?)"
      ).bind(
        id, studentName, clean(b.parent_name, 120) || null, phone, email || null,
        clean(b.class_label, 60) || null, clean(b.curriculum_id, 64) || null,
        clean(b.exam_pathway_id, 64) || null, Number.isInteger(Number(b.subject_id)) && b.subject_id !== "" ? Number(b.subject_id) : null,
        learningMode || null, clean(b.message, 2000) || null,
        clean(b.privacy_notice_version, 40) || "website-v1", now,
        b.marketing_consent === true ? 1 : 0, now, now
      ).run();
      await logActivity(env.DB1, id, "created", "Enquiry received from public website.");
      return json(request, { success: true, message: "Thank you. Your enquiry has been received.", enquiry_id: id }, 201);
    } catch (e) {
      return json(request, { error: "We could not save your enquiry. Please try again later." }, 500);
    }
  }

  if (!path.startsWith("/api/admin/enquiries") && !path.startsWith("/api/admin/demos") && !path.startsWith("/api/admin/admissions")) return null;
  if (!account || account.role !== "admin") return json(request, { error: "Admin access required." }, 403);

  if (path === "/api/admin/enquiries" && method === "GET") {
    const status = clean(new URL(request.url).searchParams.get("status"), 40);
    const search = clean(new URL(request.url).searchParams.get("q"), 120);
    const where = [];
    const params = [];
    if (status && ["new","contacted","interested","follow_up_required","converted","not_interested","closed"].includes(status)) {
      where.push("e.status=?"); params.push(status);
    }
    if (search) {
      where.push("(e.student_name LIKE ? OR e.parent_name LIKE ? OR e.phone LIKE ? OR e.email LIKE ?)");
      const q = "%" + search + "%"; params.push(q,q,q,q);
    }
    const sql = `SELECT e.*,u.full_name assigned_to_name FROM enquiries e LEFT JOIN users u ON u.id=e.assigned_to ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY CASE WHEN e.next_follow_up_at IS NOT NULL AND e.next_follow_up_at<=datetime('now') THEN 0 ELSE 1 END,e.created_at DESC LIMIT 300`;
    const result = await env.DB1.prepare(sql).bind(...params).all();
    return json(request, { success: true, enquiries: result.results || [] });
  }

  let match = path.match(/^\/api\/admin\/enquiries\/([0-9a-f-]+)$/i);
  if (match && method === "GET") {
    const enquiry = await env.DB1.prepare("SELECT e.*,u.full_name assigned_to_name FROM enquiries e LEFT JOIN users u ON u.id=e.assigned_to WHERE e.id=?").bind(match[1]).first();
    if (!enquiry) return json(request, { error: "Enquiry not found." }, 404);
    const activities = await env.DB1.prepare("SELECT a.*,u.full_name performed_by_name FROM enquiry_activities a LEFT JOIN users u ON u.id=a.performed_by WHERE a.enquiry_id=? ORDER BY a.created_at DESC").bind(match[1]).all();
    return json(request, { success: true, enquiry, activities: activities.results || [] });
  }

  match = path.match(/^\/api\/admin\/enquiries\/([0-9a-f-]+)$/i);
  if (match && method === "PATCH") {
    const b = await readBody(request);
    const enquiry = await env.DB1.prepare("SELECT id,status,assigned_to,next_follow_up_at FROM enquiries WHERE id=?").bind(match[1]).first();
    if (!enquiry) return json(request, { error: "Enquiry not found." }, 404);
    const allowed = ["new","contacted","interested","follow_up_required","converted","not_interested","closed"];
    const status = b.status === undefined ? enquiry.status : clean(b.status, 40);
    const owner = b.assigned_to === undefined ? enquiry.assigned_to : (clean(b.assigned_to, 64) || null);
    const followUp = b.next_follow_up_at === undefined ? enquiry.next_follow_up_at : (clean(b.next_follow_up_at, 40) || null);
    if (!allowed.includes(status)) return json(request, { error: "Invalid enquiry status." }, 400);
    if (owner) {
      const staff = await env.DB1.prepare("SELECT id FROM users WHERE id=? AND role IN ('admin','teacher') AND status='approved' AND deleted_at IS NULL").bind(owner).first();
      if (!staff) return json(request, { error: "Choose an active admin or approved teacher as the follow-up owner." }, 400);
    }
    await env.DB1.prepare("UPDATE enquiries SET status=?,assigned_to=?,next_follow_up_at=?,updated_at=datetime('now') WHERE id=?").bind(status, owner, followUp, match[1]).run();
    if (status !== enquiry.status) await logActivity(env.DB1, match[1], "status_change", "Enquiry status updated.", user.id, enquiry.status, status, followUp);
    if (owner !== enquiry.assigned_to) await logActivity(env.DB1, match[1], "owner_change", "Follow-up owner updated.", user.id, enquiry.assigned_to, owner, followUp);
    if (followUp) await logActivity(env.DB1, match[1], "follow_up", "Next follow-up scheduled.", user.id, null, null, followUp);
    return json(request, { success: true });
  }

  match = path.match(/^\/api\/admin\/enquiries\/([0-9a-f-]+)\/activities$/i);
  if (match && method === "POST") {
    const b = await readBody(request);
    const type = clean(b.activity_type, 30);
    const summary = clean(b.summary, 1000);
    if (!["call","email","whatsapp","note","follow_up"].includes(type) || !summary) return json(request, { error: "Choose an activity type and enter a short note." }, 400);
    const enquiry = await env.DB1.prepare("SELECT id FROM enquiries WHERE id=?").bind(match[1]).first();
    if (!enquiry) return json(request, { error: "Enquiry not found." }, 404);
    const followUp = clean(b.next_follow_up_at, 40) || null;
    await logActivity(env.DB1, match[1], type, summary, user.id, null, null, followUp);
    if (followUp) await env.DB1.prepare("UPDATE enquiries SET next_follow_up_at=?,status='follow_up_required',updated_at=datetime('now') WHERE id=?").bind(followUp, match[1]).run();
    return json(request, { success: true }, 201);
  }

  if (path === "/api/admin/demos" && method === "GET") {
    const result = await env.DB1.prepare("SELECT d.*,u.full_name assigned_teacher_name FROM demo_bookings d LEFT JOIN users u ON u.id=d.assigned_teacher_id ORDER BY COALESCE(d.preferred_at,d.created_at) DESC LIMIT 300").all();
    return json(request, { success: true, demos: result.results || [] });
  }

  if (path === "/api/admin/demos" && method === "POST") {
    const b = await readBody(request);
    const studentName = clean(b.student_name, 120), phone = clean(b.contact_phone, 24);
    const mode = clean(b.learning_mode, 20);
    if (!studentName || !validPhone(phone) || !["group","one_to_one"].includes(mode)) return json(request, { error: "Enter the student name, valid phone and learning mode." }, 400);
    const id = crypto.randomUUID();
    await env.DB1.prepare("INSERT INTO demo_bookings(id,enquiry_id,student_name,parent_name,contact_phone,contact_email,class_label,curriculum_id,exam_pathway_id,subject_id,learning_mode,preferred_at,timezone,status,admin_notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'requested',?)").bind(
      id, clean(b.enquiry_id,64)||null, studentName, clean(b.parent_name,120)||null, phone,
      clean(b.contact_email,254)||null, clean(b.class_label,60)||null, clean(b.curriculum_id,64)||null,
      clean(b.exam_pathway_id,64)||null, Number.isInteger(Number(b.subject_id)) && b.subject_id !== "" ? Number(b.subject_id) : null,
      mode, clean(b.preferred_at,40)||null, clean(b.timezone,60)||"Asia/Kolkata", clean(b.admin_notes,1000)||null
    ).run();
    return json(request, { success: true, id }, 201);
  }

  match = path.match(/^\/api\/admin\/demos\/([0-9a-f-]+)$/i);
  if (match && method === "PATCH") {
    const b = await readBody(request);
    const statuses = ["requested","pending_confirmation","confirmed","rescheduled","completed","cancelled","no_show"];
    const current = await env.DB1.prepare("SELECT id,status FROM demo_bookings WHERE id=?").bind(match[1]).first();
    if (!current) return json(request, { error: "Demo booking not found." }, 404);
    const status = clean(b.status, 40);
    if (!statuses.includes(status)) return json(request, { error: "Invalid demo status." }, 400);
    const teacherId = clean(b.assigned_teacher_id, 64) || null;
    if (teacherId) {
      const teacher = await env.DB1.prepare("SELECT id FROM users WHERE id=? AND role='teacher' AND status='approved' AND deleted_at IS NULL").bind(teacherId).first();
      if (!teacher) return json(request, { error: "Choose an approved active teacher." }, 400);
    }
    await env.DB1.prepare("UPDATE demo_bookings SET status=?,assigned_teacher_id=COALESCE(?,assigned_teacher_id),confirmed_starts_at=COALESCE(?,confirmed_starts_at),confirmed_ends_at=COALESCE(?,confirmed_ends_at),meeting_url=COALESCE(?,meeting_url),admin_notes=COALESCE(?,admin_notes),updated_at=datetime('now') WHERE id=?").bind(
      status, teacherId, clean(b.confirmed_starts_at,40)||null, clean(b.confirmed_ends_at,40)||null,
      clean(b.meeting_url,1000)||null, b.admin_notes === undefined ? null : clean(b.admin_notes,1000), match[1]
    ).run();
    return json(request, { success: true });
  }

  if (path === "/api/admin/admissions" && method === "GET") {
    const result = await env.DB1.prepare("SELECT a.*,u.full_name student_name,u.email FROM student_admissions a JOIN users u ON u.id=a.student_id ORDER BY a.admission_date DESC LIMIT 300").all();
    return json(request, { success: true, admissions: result.results || [] });
  }

  if (path === "/api/admin/admissions" && method === "POST") {
    const b = await readBody(request);
    const studentId = clean(b.student_id, 64), admissionNumber = clean(b.admission_number, 40);
    const admissionDate = clean(b.admission_date, 20);
    if (!studentId || !admissionNumber || !/^\d{4}-\d{2}-\d{2}$/.test(admissionDate)) return json(request, { error: "Select a student and enter an admission number and valid admission date." }, 400);
    const student = await env.DB1.prepare("SELECT id FROM users WHERE id=? AND role='student' AND status='approved' AND deleted_at IS NULL").bind(studentId).first();
    if (!student) return json(request, { error: "An approved active student account is required before admission." }, 400);
    const id = crypto.randomUUID();
    try {
      await env.DB1.prepare("INSERT INTO student_admissions(id,student_id,enquiry_id,admission_number,admission_date,academic_year_id,curriculum_id,exam_pathway_id,class_id,subject_id,learning_mode,status,agreed_fee_amount_paise,notes,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)").bind(
        id, studentId, clean(b.enquiry_id,64)||null, admissionNumber, admissionDate,
        clean(b.academic_year_id,64)||null, clean(b.curriculum_id,64)||null, clean(b.exam_pathway_id,64)||null,
        Number.isInteger(Number(b.class_id)) && b.class_id !== "" ? Number(b.class_id) : null,
        Number.isInteger(Number(b.subject_id)) && b.subject_id !== "" ? Number(b.subject_id) : null,
        ["group","one_to_one"].includes(b.learning_mode) ? b.learning_mode : null,
        Number.isInteger(Number(b.agreed_fee_amount_paise)) && b.agreed_fee_amount_paise !== "" ? Number(b.agreed_fee_amount_paise) : null,
        clean(b.notes,2000)||null, user.id
      ).run();
      await env.DB1.prepare("INSERT INTO student_admission_history(id,admission_id,old_status,new_status,reason,changed_by) VALUES(?,?,NULL,'active','Admission created.',?)").bind(crypto.randomUUID(),id,user.id).run();
      if (b.enquiry_id) {
        await env.DB1.prepare("UPDATE enquiries SET status='converted',converted_student_id=?,updated_at=datetime('now') WHERE id=?").bind(studentId,clean(b.enquiry_id,64)).run();
        await logActivity(env.DB1, clean(b.enquiry_id,64), "conversion", "Enquiry converted to admission.", user.id, null, studentId);
      }
      return json(request, { success: true, id }, 201);
    } catch (e) {
      return json(request, { error: "Admission could not be created. Check that the admission number is unique and linked records are valid." }, 409);
    }
  }

  return null;
}
