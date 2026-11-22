const ALLOWED_ORIGINS = [
  "https://dhyanshedu.com",
  "https://www.dhyanshedu.com",
  "https://dhyanshedu-exam-portal.pages.dev",
  "https://dhyanshedu-exam-portal.dhyanshedu.workers.dev",
  "https://dhyanshedu-lab.github.io"
];

const json = (data, status, request) => {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
  if (ALLOWED_ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(data), { status, headers });
};
const fail = (message, status, request) => json({ error: message }, status, request);
const clean = (value, max = 240) => String(value ?? "").trim().slice(0, max);
const uuid = () => crypto.randomUUID();
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
const sha256 = async value => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
const newToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return hex(bytes);
};
const publicRequest = request => {
  const origin = request.headers.get("Origin") || "";
  return !!origin && ALLOWED_ORIGINS.includes(origin);
};
const nowIso = () => new Date().toISOString();
const isOpen = row => {
  const now = Date.now();
  return (!row.starts_at || new Date(row.starts_at).getTime() <= now) &&
    (!row.ends_at || new Date(row.ends_at).getTime() >= now);
};
const attemptDeadline = (startedAt, duration, examEnd) => Math.min(
  new Date(startedAt).getTime() + Number(duration) * 60000,
  examEnd ? new Date(examEnd).getTime() : Infinity
);
const audit = (env, actor, action, entity, details) => env.DB.prepare(
  "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)"
).bind(uuid(), actor, action, "public_exam", entity, JSON.stringify(details || {}));

async function getPublishedExam(env, slug) {
  return env.DB.prepare(
    "SELECT p.id publication_id,p.public_slug,p.max_attempts,p.results_mode,p.starts_at public_starts_at,p.ends_at public_ends_at,e.id,e.title,e.description,e.duration_minutes,e.total_marks,e.pass_marks,e.status exam_status,e.ends_at exam_ends_at,(SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id=e.id) question_count FROM public_exam_publications p JOIN exams e ON e.id=p.exam_id WHERE p.public_slug=? AND p.status='published'"
  ).bind(slug).first();
}
async function validateAttempt(request, env, attemptId) {
  const token = request.headers.get("X-Public-Attempt-Token") || "";
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;
  const hash = await sha256(token);
  return env.DB.prepare(
    "SELECT a.id,a.registration_id,a.exam_id,a.attempt_number,a.started_at,a.submitted_at,a.expires_at,a.status,a.score,a.total_marks,a.percentage,a.result_released_at,r.student_name,e.title,e.duration_minutes,e.ends_at,p.results_mode FROM public_assessment_attempts a JOIN public_assessment_registrations r ON r.id=a.registration_id JOIN exams e ON e.id=a.exam_id JOIN public_exam_publications p ON p.exam_id=e.id WHERE a.id=? AND a.access_token_hash=?"
  ).bind(attemptId, hash).first();
}
async function publicQuestions(env, examId) {
  const [questions, options] = await Promise.all([
    env.DB.prepare(
      "SELECT eq.id exam_question_id,eq.marks,eq.negative_marks,eq.sort_order,q.question_type,q.question_text,q.topic FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.sort_order"
    ).bind(examId).all(),
    env.DB.prepare(
      "SELECT qo.id,qo.option_label,qo.option_text,eq.id exam_question_id FROM exam_questions eq JOIN question_options qo ON qo.question_id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.sort_order,qo.sort_order"
    ).bind(examId).all()
  ]);
  return (questions.results || []).map(q => ({
    ...q,
    options: (options.results || []).filter(o => o.exam_question_id === q.exam_question_id)
      .map(o => ({ id: o.id, label: o.option_label, text: o.option_text }))
  }));
}

export async function handlePublicExamRequest(request, env, path, method) {
  if (!path.startsWith("/api/public/exams") && !path.startsWith("/api/public/attempts/")) return null;
  if (!publicRequest(request)) return fail("Origin not allowed", 403, request);

  if (path === "/api/public/exams" && method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT p.public_slug,p.max_attempts,p.results_mode,p.starts_at,p.ends_at,e.title,e.description,e.duration_minutes,e.total_marks,(SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id=e.id) question_count FROM public_exam_publications p JOIN exams e ON e.id=p.exam_id WHERE p.status='published' AND e.status IN ('published','scheduled') ORDER BY COALESCE(p.starts_at,p.published_at) DESC LIMIT 100"
    ).all();
    const exams = (rows.results || []).filter(isOpen).map(x => ({
      slug: x.public_slug, title: x.title, description: x.description,
      duration_minutes: x.duration_minutes, total_marks: x.total_marks,
      question_count: x.question_count, max_attempts: x.max_attempts,
      starts_at: x.starts_at, ends_at: x.ends_at
    }));
    return json({ success: true, exams }, 200, request);
  }

  const detailMatch = path.match(/^\/api\/public\/exams\/([a-z0-9-]+)$/i);
  if (detailMatch && method === "GET") {
    const exam = await getPublishedExam(env, detailMatch[1]);
    if (!exam || !isOpen({ starts_at: exam.public_starts_at, ends_at: exam.public_ends_at }) ||
        !["published", "scheduled"].includes(exam.exam_status)) return fail("This free exam is not available.", 404, request);
    return json({ success: true, exam: {
      slug: exam.public_slug, title: exam.title, description: exam.description,
      duration_minutes: exam.duration_minutes, total_marks: exam.total_marks,
      question_count: exam.question_count, max_attempts: exam.max_attempts,
      starts_at: exam.public_starts_at, ends_at: exam.public_ends_at
    } }, 200, request);
  }

  const registerMatch = path.match(/^\/api\/public\/exams\/([a-z0-9-]+)\/register$/i);
  if (registerMatch && method === "POST") {
    const b = await request.json().catch(() => ({}));
    const name = clean(b.student_name, 120), parent = clean(b.parent_name, 120);
    const phone = clean(b.phone, 30), email = clean(b.email, 254).toLowerCase();
    const classLabel = clean(b.class_label, 40);
    const privacyAccepted = b.privacy_accepted === true;
    const marketingConsent = b.marketing_consent === true;
    if (!name || !classLabel || phone.replace(/\D/g, "").length < 7 ||
        phone.replace(/\D/g, "").length > 15 ||
        (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || !privacyAccepted) {
      return fail("Enter your name, valid mobile number and class, and accept the privacy notice.", 400, request);
    }
    const exam = await getPublishedExam(env, registerMatch[1]);
    if (!exam || !isOpen({ starts_at: exam.public_starts_at, ends_at: exam.public_ends_at }) ||
        !["published", "scheduled"].includes(exam.exam_status)) return fail("This free exam is not available.", 404, request);
    if (!Number(exam.question_count)) return fail("This exam does not have any questions yet.", 409, request);

    const identityKey = await sha256(phone.replace(/\D/g, "") + "|" + name.toLocaleLowerCase("en"));
    const token = newToken(), tokenHash = await sha256(token);
    const registrationId = uuid(), attemptId = uuid(), started = nowIso();
    const expiryMs = attemptDeadline(started, exam.duration_minutes, exam.exam_ends_at);
    const publicExpiryMs = exam.public_ends_at ? new Date(exam.public_ends_at).getTime() : Infinity;
    const finalExpiry = Math.min(expiryMs, publicExpiryMs);
    if (!Number.isFinite(finalExpiry) || finalExpiry <= Date.now()) return fail("This exam's attempt window has ended.", 409, request);
    const expires = new Date(finalExpiry).toISOString();
    try {
      const existing = await env.DB.prepare(
        "SELECT id FROM public_assessment_registrations WHERE identity_key=?"
      ).bind(identityKey).first();
      const regId = existing?.id || registrationId;
      if (!existing) {
        await env.DB.prepare(
          "INSERT INTO public_assessment_registrations(id,student_name,parent_name,phone,email,class_label,privacy_notice_version,privacy_consent_at,marketing_consent,identity_key) VALUES(?,?,?,?,?,?,'2026-11-v1',?,?,?,?,?)"
        ).bind(regId, name, parent || null, phone, email || null, classLabel, started, marketingConsent ? 1 : 0, identityKey).run();
      } else {
        await env.DB.prepare(
          "UPDATE public_assessment_registrations SET email=COALESCE(?,email),parent_name=COALESCE(?,parent_name),class_label=?,privacy_notice_version='2026-11-v1',privacy_consent_at=?,marketing_consent=CASE WHEN ?=1 THEN 1 ELSE marketing_consent END WHERE id=?"
        ).bind(email || null, parent || null, classLabel, started, marketingConsent ? 1 : 0, regId).run();
      }
      const count = await env.DB.prepare(
        "SELECT COUNT(*) total FROM public_assessment_attempts WHERE registration_id=? AND exam_id=? AND status IN ('in_progress','submitted','evaluated','expired')"
      ).bind(regId, exam.id).first();
      if (Number(count?.total || 0) >= Number(exam.max_attempts)) return fail("You have used all attempts allowed for this exam.", 409, request);
      const attemptNumber = Number(count?.total || 0) + 1;
      await env.DB.prepare(
        "INSERT INTO public_assessment_attempts(id,registration_id,exam_id,attempt_number,access_token_hash,started_at,expires_at,status) VALUES(?,?,?,?,?,?,?,'in_progress')"
      ).bind(attemptId, regId, exam.id, attemptNumber, tokenHash, started, expires).run();
    } catch (e) {
      if (String(e.message || "").includes("UNIQUE")) return fail("An attempt for this exam already exists for these details.", 409, request);
      throw e;
    }
    return json({ success: true, attempt_id: attemptId, access_token: token, expires_at: expires,
      exam: { title: exam.title, duration_minutes: exam.duration_minutes, total_marks: exam.total_marks } }, 201, request);
  }

  const attemptMatch = path.match(/^\/api\/public\/attempts\/([0-9a-f-]+)$/i);
  if (attemptMatch && method === "GET") {
    const attempt = await validateAttempt(request, env, attemptMatch[1]);
    if (!attempt) return fail("Attempt not found or access token is invalid.", 404, request);
    if (attempt.status === "in_progress" && Date.now() > new Date(attempt.expires_at).getTime()) {
      await env.DB.prepare("UPDATE public_assessment_attempts SET status='expired' WHERE id=? AND status='in_progress'").bind(attempt.id).run();
      return fail("The exam time has ended. Submit is no longer available.", 409, request);
    }
    const [questions, answers] = await Promise.all([
      publicQuestions(env, attempt.exam_id),
      env.DB.prepare("SELECT exam_question_id,answer_text,selected_option_ids FROM public_assessment_answers WHERE public_attempt_id=?").bind(attempt.id).all()
    ]);
    const answerMap = new Map((answers.results || []).map(x => [x.exam_question_id, x]));
    return json({ success: true, attempt: {
      id: attempt.id, status: attempt.status, title: attempt.title,
      started_at: attempt.started_at, expires_at: attempt.expires_at,
      questions: questions.map(q => ({ ...q,
        answer: answerMap.get(q.exam_question_id)?.answer_text || "",
        selected_option_ids: JSON.parse(answerMap.get(q.exam_question_id)?.selected_option_ids || "[]")
      }))
    } }, 200, request);
  }

  const answersMatch = path.match(/^\/api\/public\/attempts\/([0-9a-f-]+)\/answers$/i);
  if (answersMatch && method === "POST") {
    const attempt = await validateAttempt(request, env, answersMatch[1]);
    if (!attempt) return fail("Attempt not found or access token is invalid.", 404, request);
    if (attempt.status !== "in_progress") return fail("This attempt is already submitted.", 409, request);
    if (Date.now() > new Date(attempt.expires_at).getTime()) return fail("The exam time has ended.", 409, request);
    const b = await request.json().catch(() => ({}));
    const qid = clean(b.exam_question_id, 64), answerText = clean(b.answer_text, 8000);
    const selected = Array.isArray(b.selected_option_ids) ? [...new Set(b.selected_option_ids.map(x => clean(x, 64)))] : [];
    const question = await env.DB.prepare(
      "SELECT eq.id,q.question_type FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.id=? AND eq.exam_id=?"
    ).bind(qid, attempt.exam_id).first();
    if (!question) return fail("Question does not belong to this exam.", 400, request);
    if (selected.length) {
      const placeholders = selected.map(() => "?").join(",");
      const valid = await env.DB.prepare(
        "SELECT COUNT(*) total FROM question_options qo JOIN exam_questions eq ON eq.question_id=qo.question_id WHERE eq.id=? AND qo.id IN (" + placeholders + ")"
      ).bind(qid, ...selected).first();
      if (Number(valid?.total) !== selected.length || !["mcq", "multiple_select"].includes(question.question_type))
        return fail("One or more selected options are invalid.", 400, request);
      if (question.question_type === "mcq" && selected.length > 1) return fail("Select only one option.", 400, request);
    }
    await env.DB.prepare(
      "INSERT INTO public_assessment_answers(id,public_attempt_id,exam_question_id,answer_text,selected_option_ids,answered_at) VALUES(?,?,?,?,?,?) ON CONFLICT(public_attempt_id,exam_question_id) DO UPDATE SET answer_text=excluded.answer_text,selected_option_ids=excluded.selected_option_ids,answered_at=excluded.answered_at"
    ).bind(uuid(), attempt.id, qid, answerText || null, JSON.stringify(selected), nowIso()).run();
    await env.DB.prepare("UPDATE public_assessment_attempts SET last_activity_at=? WHERE id=?").bind(nowIso(), attempt.id).run();
    return json({ success: true, saved: true }, 200, request);
  }

  const submitMatch = path.match(/^\/api\/public\/attempts\/([0-9a-f-]+)\/submit$/i);
  if (submitMatch && method === "POST") {
    const attempt = await validateAttempt(request, env, submitMatch[1]);
    if (!attempt) return fail("Attempt not found or access token is invalid.", 404, request);
    if (attempt.status !== "in_progress") return fail("This attempt has already been submitted.", 409, request);
    if (Date.now() > new Date(attempt.expires_at).getTime()) return fail("The exam time has ended.", 409, request);
    const questions = await env.DB.prepare(
      "SELECT eq.id,eq.marks,eq.negative_marks,q.question_type FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.sort_order"
    ).bind(attempt.exam_id).all();
    const answers = await env.DB.prepare(
      "SELECT exam_question_id,answer_text,selected_option_ids FROM public_assessment_answers WHERE public_attempt_id=?"
    ).bind(attempt.id).all();
    const answerMap = new Map((answers.results || []).map(x => [x.exam_question_id, x]));
    let score = 0, manual = 0;
    const writes = [];
    for (const q of questions.results || []) {
      const answer = answerMap.get(q.id);
      if (["numerical", "short_answer", "long_answer"].includes(q.question_type)) {
        manual++;
        continue;
      }
      let correct = false;
      if (["mcq", "multiple_select"].includes(q.question_type)) {
        const selected = new Set(JSON.parse(answer?.selected_option_ids || "[]"));
        const correctRows = await env.DB.prepare(
          "SELECT qo.id FROM question_options qo JOIN exam_questions eq ON eq.question_id=qo.question_id WHERE eq.id=? AND qo.is_correct=1"
        ).bind(q.id).all();
        const right = new Set((correctRows.results || []).map(x => x.id));
        correct = selected.size === right.size && [...selected].every(id => right.has(id)) && right.size > 0;
      }
      const awarded = correct ? Number(q.marks) : (answer && ["mcq", "multiple_select"].includes(q.question_type) ? -Number(q.negative_marks || 0) : 0);
      score += awarded;
      writes.push(env.DB.prepare(
        "UPDATE public_assessment_answers SET is_correct=?,marks_awarded=? WHERE public_attempt_id=? AND exam_question_id=?"
      ).bind(correct ? 1 : 0, awarded, attempt.id, q.id));
    }
    score = Math.max(0, score);
    const total = Number(attempt.total_marks || 0);
    const percentage = total > 0 ? Math.round(score / total * 10000) / 100 : 0;
    const status = manual ? "submitted" : "evaluated";
    writes.push(env.DB.prepare(
      "UPDATE public_assessment_attempts SET status=?,submitted_at=?,score=?,total_marks=?,percentage=? WHERE id=? AND status='in_progress'"
    ).bind(status, nowIso(), score, total, percentage, attempt.id));
    await env.DB.batch(writes);
    const publication = await env.DB.prepare("SELECT results_mode FROM public_exam_publications WHERE exam_id=?").bind(attempt.exam_id).first();
    const available = !manual && publication?.results_mode === "immediate";
    if (available) await env.DB.prepare("UPDATE public_assessment_attempts SET result_released_at=? WHERE id=?").bind(nowIso(), attempt.id).run();
    return json({ success: true, status, marks_obtained: score, total_marks: total,
      manual_review_required: manual > 0, result_available: available }, 200, request);
  }

  const resultMatch = path.match(/^\/api\/public\/attempts\/([0-9a-f-]+)\/result$/i);
  if (resultMatch && method === "GET") {
    const attempt = await validateAttempt(request, env, resultMatch[1]);
    if (!attempt) return fail("Attempt not found or access token is invalid.", 404, request);
    if (!["submitted", "evaluated"].includes(attempt.status)) return fail("Submit your exam before viewing results.", 409, request);
    if (!attempt.result_released_at) return json({ success: true, pending: true, message: "Your result is being reviewed and is not available yet." }, 200, request);
    const [answers, questions] = await Promise.all([
      env.DB.prepare("SELECT exam_question_id,answer_text,selected_option_ids,is_correct,marks_awarded,teacher_feedback FROM public_assessment_answers WHERE public_attempt_id=?").bind(attempt.id).all(),
      env.DB.prepare("SELECT eq.id exam_question_id,eq.marks,q.question_type,q.question_text,q.explanation FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.sort_order").bind(attempt.exam_id).all()
    ]);
    const options = await env.DB.prepare(
      "SELECT qo.id,qo.option_label,qo.option_text,qo.is_correct,eq.id exam_question_id FROM exam_questions eq JOIN question_options qo ON qo.question_id=eq.question_id WHERE eq.exam_id=? ORDER BY eq.sort_order,qo.sort_order"
    ).bind(attempt.exam_id).all();
    const answerMap = new Map((answers.results || []).map(x => [x.exam_question_id, x]));
    return json({ success: true, pending: false, result: {
      title: attempt.title, score: attempt.score, total_marks: attempt.total_marks,
      percentage: attempt.percentage, status: attempt.status,
      questions: (questions.results || []).map(q => ({
        ...q, answer: answerMap.get(q.exam_question_id)?.answer_text || "",
        selected_option_ids: JSON.parse(answerMap.get(q.exam_question_id)?.selected_option_ids || "[]"),
        is_correct: answerMap.get(q.exam_question_id)?.is_correct ?? null,
        marks_awarded: answerMap.get(q.exam_question_id)?.marks_awarded ?? null,
        teacher_feedback: answerMap.get(q.exam_question_id)?.teacher_feedback || "",
        options: (options.results || []).filter(o => o.exam_question_id === q.exam_question_id)
          .map(o => ({ id: o.id, label: o.option_label, text: o.option_text, is_correct: !!o.is_correct }))
      }))
    } }, 200, request);
  }
  return null;
}

export async function handleAdminPublicExamRequest(request, env, path, method, user) {
  if (path === "/api/admin/public-exams" && method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT e.id exam_id,e.title,e.status exam_status,e.duration_minutes,e.total_marks,p.public_slug,p.status public_status,p.max_attempts,p.results_mode,p.starts_at,p.ends_at,p.published_at,(SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id=e.id) question_count,(SELECT COUNT(*) FROM public_assessment_attempts a WHERE a.exam_id=e.id) attempts FROM exams e LEFT JOIN public_exam_publications p ON p.exam_id=e.id ORDER BY e.created_at DESC LIMIT 250"
    ).all();
    return json({ success: true, exams: rows.results || [] }, 200, request);
  }
  const publicationMatch = path.match(/^\/api\/admin\/public-exams\/([0-9a-f-]+)$/i);
  if (publicationMatch && method === "PUT") {
    const b = await request.json().catch(() => ({}));
    const examId = publicationMatch[1], status = clean(b.status, 20);
    const slug = clean(b.public_slug, 100).toLowerCase();
    const maxAttempts = Number(b.max_attempts || 1);
    const resultsMode = clean(b.results_mode, 20) || "immediate";
    const startsAt = clean(b.starts_at, 40) || null, endsAt = clean(b.ends_at, 40) || null;
    if (!["draft", "published", "archived"].includes(status) ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
        !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10 ||
        !["immediate", "after_review"].includes(resultsMode) ||
        (startsAt && Number.isNaN(Date.parse(startsAt))) || (endsAt && Number.isNaN(Date.parse(endsAt))) ||
        (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt))) {
      return fail("Enter a valid public slug, status, attempt limit, result mode and date window.", 400, request);
    }
    const exam = await env.DB.prepare(
      "SELECT id,status,(SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id=exams.id) question_count FROM exams WHERE id=?"
    ).bind(examId).first();
    if (!exam) return fail("Exam not found.", 404, request);
    if (status === "published" && (!["published", "scheduled"].includes(exam.status) || !Number(exam.question_count)))
      return fail("Publish the exam to students and add at least one question before making it public.", 409, request);
    const existing = await env.DB.prepare("SELECT id FROM public_exam_publications WHERE exam_id=?").bind(examId).first();
    const publicationId = existing?.id || uuid();
    try {
      await env.DB.prepare(
        "INSERT INTO public_exam_publications(id,exam_id,public_slug,status,max_attempts,results_mode,starts_at,ends_at,published_at,published_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(exam_id) DO UPDATE SET public_slug=excluded.public_slug,status=excluded.status,max_attempts=excluded.max_attempts,results_mode=excluded.results_mode,starts_at=excluded.starts_at,ends_at=excluded.ends_at,published_at=CASE WHEN excluded.status='published' THEN COALESCE(public_exam_publications.published_at,excluded.published_at) ELSE public_exam_publications.published_at END,published_by=excluded.published_by,updated_at=excluded.updated_at"
      ).bind(publicationId, examId, slug, status, maxAttempts, resultsMode, startsAt, endsAt,
        status === "published" ? nowIso() : null, user.id, nowIso()).run();
    } catch (e) {
      if (String(e.message || "").includes("UNIQUE")) return fail("That public URL is already used by another exam.", 409, request);
      throw e;
    }
    await audit(env, user.id, "public_exam_" + status, examId, { slug, max_attempts: maxAttempts, results_mode: resultsMode }).run();
    return json({ success: true, status, public_slug: slug }, 200, request);
  }

  if (path === "/api/admin/public-attempts" && method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT a.id attempt_id,a.exam_id,e.title exam_title,r.student_name,r.phone,r.email,r.class_label,a.attempt_number,a.started_at,a.submitted_at,a.expires_at,a.status,a.score,a.total_marks,a.percentage,a.result_released_at FROM public_assessment_attempts a JOIN public_assessment_registrations r ON r.id=a.registration_id JOIN exams e ON e.id=a.exam_id ORDER BY a.started_at DESC LIMIT 500"
    ).all();
    return json({ success: true, attempts: rows.results || [] }, 200, request);
  }

  const gradeMatch = path.match(/^\/api\/admin\/public-attempts\/([0-9a-f-]+)\/evaluate$/i);
  if (gradeMatch && method === "POST") {
    const b = await request.json().catch(() => ({}));
    const attempt = await env.DB.prepare(
      "SELECT a.id,a.exam_id,a.status,e.total_marks FROM public_assessment_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=?"
    ).bind(gradeMatch[1]).first();
    if (!attempt) return fail("Public attempt not found.", 404, request);
    if (!["submitted", "evaluated"].includes(attempt.status)) return fail("Only submitted public attempts can be evaluated.", 409, request);
    const grades = Array.isArray(b.grades) ? b.grades : [];
    if (grades.length > 200) return fail("Too many grades were supplied.", 400, request);
    const manual = await env.DB.prepare(
      "SELECT eq.id exam_question_id,eq.marks,q.question_type FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=? AND q.question_type IN ('numerical','short_answer','long_answer')"
    ).bind(attempt.exam_id).all();
    const allowed = new Map((manual.results || []).map(x => [x.exam_question_id, Number(x.marks)]));
    const seen = new Set(), writes = [];
    for (const g of grades) {
      const qid = clean(g.exam_question_id, 64), marks = Number(g.marks_awarded);
      if (!allowed.has(qid) || seen.has(qid) || !Number.isFinite(marks) || marks < 0 || marks > allowed.get(qid))
        return fail("Each grade must reference a unique written/numerical question and be within its mark limit.", 400, request);
      seen.add(qid);
      writes.push(env.DB.prepare(
        "UPDATE public_assessment_answers SET marks_awarded=?,teacher_feedback=?,evaluated_by=?,evaluated_at=? WHERE public_attempt_id=? AND exam_question_id=?"
      ).bind(marks, clean(g.teacher_feedback, 2000) || null, user.id, nowIso(), attempt.id, qid));
    }
    if (seen.size !== allowed.size) return fail("Grade every written/numerical question before completing evaluation.", 400, request);
    const auto = await env.DB.prepare(
      "SELECT COALESCE(SUM(COALESCE(marks_awarded,0)),0) score FROM public_assessment_answers WHERE public_attempt_id=?"
    ).bind(attempt.id).first();
    const score = Number(auto?.score || 0), total = Number(attempt.total_marks || 0);
    const percentage = total > 0 ? Math.round(score / total * 10000) / 100 : 0;
    writes.push(env.DB.prepare(
      "UPDATE public_assessment_attempts SET status='evaluated',score=?,total_marks=?,percentage=? WHERE id=?"
    ).bind(score, total, percentage, attempt.id));
    await env.DB.batch(writes);
    await audit(env, user.id, "public_exam_attempt_evaluated", attempt.id, { score, total_marks: total }).run();
    return json({ success: true, status: "evaluated", score, total_marks: total, percentage }, 200, request);
  }

  const releaseMatch = path.match(/^\/api\/admin\/public-attempts\/([0-9a-f-]+)\/release-result$/i);
  if (releaseMatch && method === "POST") {
    const attempt = await env.DB.prepare(
      "SELECT id,status FROM public_assessment_attempts WHERE id=?"
    ).bind(releaseMatch[1]).first();
    if (!attempt) return fail("Public attempt not found.", 404, request);
    if (attempt.status !== "evaluated") return fail("Complete evaluation before releasing the result.", 409, request);
    await env.DB.prepare("UPDATE public_assessment_attempts SET result_released_at=? WHERE id=?").bind(nowIso(), attempt.id).run();
    await audit(env, user.id, "public_exam_result_released", attempt.id, {}).run();
    return json({ success: true, released: true }, 200, request);
  }
  return null;
}
