-- DhyanshEdu Exam Portal
-- Consolidated D1 foundation migration v1
-- Safe/additive migration: creates new tables and indexes only.
-- It does NOT drop, rename, truncate, or alter existing tables or records.
-- Run against the existing Cloudflare D1 database after taking a backup.
--
-- Architecture:
--   Supabase Auth: authentication credentials only
--   Cloudflare D1: structured application records
--   Cloudflare R2: uploaded files/attachments (store object keys in D1)
--
-- Important compatibility decisions:
--   * Existing classes.id is INTEGER; new class references use INTEGER.
--   * Existing subjects.id is INTEGER; new subject references use INTEGER.
--   * Existing populated curricula table is canonical. The empty misspelled
--     curriculam table is intentionally left untouched pending code review.
--   * Existing batches, batch_teachers, users, classes, and other tables remain.
--   * No destructive cleanup is performed in this migration.

-- D1 enforces foreign keys by default; do not toggle PRAGMA foreign_keys here.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 1. Academic structure and curriculum mapping
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS curriculum_exam_pathways (
    id TEXT PRIMARY KEY,
    curriculum_id TEXT NOT NULL REFERENCES curricula(id),
    exam_pathway_id TEXT NOT NULL REFERENCES exam_pathways(id),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (curriculum_id, exam_pathway_id)
);

CREATE TABLE IF NOT EXISTS curriculum_class_levels (
    id TEXT PRIMARY KEY,
    curriculum_id TEXT NOT NULL REFERENCES curricula(id),
    class_label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 100,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (curriculum_id, class_label)
);

CREATE TABLE IF NOT EXISTS class_subjects (
    id TEXT PRIMARY KEY,
    class_id INTEGER NOT NULL REFERENCES classes(id),
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (class_id, subject_id)
);

CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY,
    curriculum_id TEXT REFERENCES curricula(id),
    exam_pathway_id TEXT REFERENCES exam_pathways(id),
    class_id INTEGER REFERENCES classes(id),
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    chapter_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 100,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','inactive')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL REFERENCES chapters(id),
    topic_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 100,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','inactive')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (chapter_id, topic_name)
);

-- Adds structured classification to the existing question bank without
-- changing the existing questions table.
CREATE TABLE IF NOT EXISTS question_bank_metadata (
    question_id TEXT PRIMARY KEY REFERENCES questions(id),
    curriculum_id TEXT REFERENCES curricula(id),
    exam_pathway_id TEXT REFERENCES exam_pathways(id),
    chapter_id TEXT REFERENCES chapters(id),
    topic_id TEXT REFERENCES topics(id),
    review_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending','approved','rejected')),
    reviewed_by TEXT REFERENCES users(id),
    reviewed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS question_media (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES questions(id),
    r2_object_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INTEGER,
    media_role TEXT NOT NULL DEFAULT 'question'
        CHECK (media_role IN ('question','option','solution','reference')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 2. Teacher assignments, substitutions, timetable and class delivery
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS teacher_class_assignment_periods (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL REFERENCES users(id),
    class_id INTEGER NOT NULL REFERENCES classes(id),
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    assignment_role TEXT NOT NULL DEFAULT 'primary'
        CHECK (assignment_role IN ('primary','substitute')),
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    reason TEXT,
    leave_reference TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','active','completed','cancelled')),
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teacher_batch_assignment_periods (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL REFERENCES users(id),
    batch_id TEXT NOT NULL REFERENCES batches(id),
    assignment_role TEXT NOT NULL DEFAULT 'primary'
        CHECK (assignment_role IN ('primary','substitute')),
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    reason TEXT,
    leave_reference TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','active','completed','cancelled')),
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teacher_assignment_events (
    id TEXT PRIMARY KEY,
    assignment_scope TEXT NOT NULL
        CHECK (assignment_scope IN ('class','batch')),
    assignment_period_id TEXT NOT NULL,
    event_type TEXT NOT NULL
        CHECK (event_type IN ('created','activated','substituted','extended','ended','cancelled','reverted')),
    actor_id TEXT REFERENCES users(id),
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teacher_availability (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL REFERENCES users(id),
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    availability_type TEXT NOT NULL
        CHECK (availability_type IN ('available','unavailable','leave')),
    reason TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS class_timetable (
    id TEXT PRIMARY KEY,
    class_id INTEGER REFERENCES classes(id),
    batch_id TEXT REFERENCES batches(id),
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    primary_teacher_id TEXT REFERENCES users(id),
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    starts_at_local TEXT NOT NULL,
    ends_at_local TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','inactive')),
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (ends_at_local > starts_at_local),
    CHECK (class_id IS NOT NULL OR batch_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS class_sessions (
    id TEXT PRIMARY KEY,
    timetable_id TEXT REFERENCES class_timetable(id),
    class_id INTEGER REFERENCES classes(id),
    batch_id TEXT REFERENCES batches(id),
    subject_id INTEGER REFERENCES subjects(id),
    scheduled_teacher_id TEXT REFERENCES users(id),
    actual_teacher_id TEXT REFERENCES users(id),
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    meeting_provider TEXT
        CHECK (meeting_provider IN ('google_meet','jitsi','other')),
    meeting_url TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','live','completed','cancelled','rescheduled','no_show')),
    cancellation_reason TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS class_session_attendance (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES class_sessions(id),
    student_id TEXT NOT NULL REFERENCES users(id),
    attendance_status TEXT NOT NULL DEFAULT 'present'
        CHECK (attendance_status IN ('present','late','absent','excused')),
    joined_at TEXT,
    left_at TEXT,
    marked_by TEXT REFERENCES users(id),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (session_id, student_id)
);

-- ---------------------------------------------------------------------------
-- 3. Enquiries, follow-ups, demos and admissions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS enquiries (
    id TEXT PRIMARY KEY,
    student_name TEXT NOT NULL,
    parent_name TEXT,
    phone TEXT NOT NULL,
    email TEXT,
    class_label TEXT,
    curriculum_id TEXT REFERENCES curricula(id),
    exam_pathway_id TEXT REFERENCES exam_pathways(id),
    subject_id INTEGER REFERENCES subjects(id),
    learning_mode TEXT CHECK (learning_mode IN ('group','one_to_one')),
    message TEXT,
    source TEXT NOT NULL DEFAULT 'website',
    status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new','contacted','interested','follow_up_required','converted','not_interested','closed')),
    assigned_to TEXT REFERENCES users(id),
    next_follow_up_at TEXT,
    converted_student_id TEXT REFERENCES users(id),
    privacy_notice_version TEXT,
    consent_recorded_at TEXT,
    marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (marketing_consent IN (0,1)),
    identity_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enquiry_activities (
    id TEXT PRIMARY KEY,
    enquiry_id TEXT NOT NULL REFERENCES enquiries(id),
    activity_type TEXT NOT NULL
        CHECK (activity_type IN ('created','call','email','whatsapp','note','status_change','owner_change','follow_up','conversion')),
    summary TEXT NOT NULL,
    previous_value TEXT,
    new_value TEXT,
    performed_by TEXT REFERENCES users(id),
    next_follow_up_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS demo_bookings (
    id TEXT PRIMARY KEY,
    enquiry_id TEXT REFERENCES enquiries(id),
    student_name TEXT NOT NULL,
    parent_name TEXT,
    contact_phone TEXT NOT NULL,
    contact_email TEXT,
    class_label TEXT,
    curriculum_id TEXT REFERENCES curricula(id),
    exam_pathway_id TEXT REFERENCES exam_pathways(id),
    subject_id INTEGER REFERENCES subjects(id),
    learning_mode TEXT NOT NULL CHECK (learning_mode IN ('group','one_to_one')),
    preferred_at TEXT,
    confirmed_starts_at TEXT,
    confirmed_ends_at TEXT,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    assigned_teacher_id TEXT REFERENCES users(id),
    meeting_url TEXT,
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested','pending_confirmation','confirmed','rescheduled','completed','cancelled','no_show')),
    admin_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS demo_feedback (
    id TEXT PRIMARY KEY,
    demo_booking_id TEXT NOT NULL UNIQUE REFERENCES demo_bookings(id),
    teacher_id TEXT REFERENCES users(id),
    feedback TEXT,
    student_interest TEXT,
    recommended_plan TEXT,
    follow_up_required INTEGER NOT NULL DEFAULT 1 CHECK (follow_up_required IN (0,1)),
    submitted_at TEXT,
    reviewed_by TEXT REFERENCES users(id),
    reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS student_admissions (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES users(id),
    enquiry_id TEXT REFERENCES enquiries(id),
    admission_number TEXT NOT NULL UNIQUE,
    admission_date TEXT NOT NULL,
    academic_year_id TEXT REFERENCES academic_years(id),
    curriculum_id TEXT REFERENCES curricula(id),
    exam_pathway_id TEXT REFERENCES exam_pathways(id),
    class_id INTEGER REFERENCES classes(id),
    subject_id INTEGER REFERENCES subjects(id),
    learning_mode TEXT CHECK (learning_mode IN ('group','one_to_one')),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('application','active','on_hold','transferred','withdrawn','completed')),
    agreed_fee_amount_paise INTEGER,
    notes TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS student_admission_history (
    id TEXT PRIMARY KEY,
    admission_id TEXT NOT NULL REFERENCES student_admissions(id),
    old_status TEXT,
    new_status TEXT NOT NULL,
    reason TEXT,
    changed_by TEXT REFERENCES users(id),
    changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 4. Invitations and account onboarding (credentials remain in Supabase Auth)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    invite_type TEXT NOT NULL CHECK (invite_type IN ('teacher','student')),
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    user_id TEXT REFERENCES users(id),
    enquiry_id TEXT REFERENCES enquiries(id),
    admission_id TEXT REFERENCES student_admissions(id),
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','sent','accepted','expired','revoked','failed')),
    expires_at TEXT NOT NULL,
    sent_at TEXT,
    accepted_at TEXT,
    revoked_at TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invitation_events (
    id TEXT PRIMARY KEY,
    invitation_id TEXT NOT NULL REFERENCES invitations(id),
    event_type TEXT NOT NULL
        CHECK (event_type IN ('created','sent','resent','accepted','expired','revoked','failed')),
    details TEXT,
    actor_id TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 5. Public self-assessment registration and attempt linkage
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public_exam_publications (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL UNIQUE REFERENCES exams(id),
    public_slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','published','archived')),
    max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 10),
    starts_at TEXT,
    ends_at TEXT,
    published_at TEXT,
    published_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public_assessment_registrations (
    id TEXT PRIMARY KEY,
    student_name TEXT NOT NULL,
    parent_name TEXT,
    phone TEXT NOT NULL,
    email TEXT,
    class_label TEXT NOT NULL,
    curriculum_id TEXT REFERENCES curricula(id),
    exam_pathway_id TEXT REFERENCES exam_pathways(id),
    privacy_notice_version TEXT NOT NULL,
    privacy_consent_at TEXT NOT NULL,
    registered_at TEXT NOT NULL DEFAULT (datetime('now')),
    marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (marketing_consent IN (0,1)),
    identity_key TEXT NOT NULL UNIQUE,
    converted_enquiry_id TEXT REFERENCES enquiries(id),
    converted_student_id TEXT REFERENCES users(id)
);

-- Only the guest identity, timing and final score are retained. No answer text,
-- selected options, per-question responses or answer-sheet table is created.
CREATE TABLE IF NOT EXISTS public_assessment_attempts (
    id TEXT PRIMARY KEY,
    registration_id TEXT NOT NULL REFERENCES public_assessment_registrations(id),
    exam_id TEXT NOT NULL REFERENCES exams(id),
    attempt_number INTEGER NOT NULL DEFAULT 1,
    access_token_hash TEXT NOT NULL UNIQUE,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    submitted_at TEXT,
    result_released_at TEXT,
    expires_at TEXT NOT NULL,
    score REAL,
    total_marks REAL,
    percentage REAL,
    status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress','submitted','expired')),
    UNIQUE (registration_id, exam_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS public_assessment_rate_limits (
    id TEXT PRIMARY KEY,
    ip_hash TEXT NOT NULL,
    route_key TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    UNIQUE (ip_hash, route_key, window_start)
);

-- 6. Uploaded handwritten answer sheets and controlled evaluation
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS answer_sheet_submissions (
    id TEXT PRIMARY KEY,
    exam_attempt_id TEXT REFERENCES exam_attempts(id),
    assignment_submission_id TEXT REFERENCES assignment_submissions(id),
    student_id TEXT NOT NULL REFERENCES users(id),
    exam_id TEXT REFERENCES exams(id),
    batch_id TEXT REFERENCES batches(id),
    original_r2_key TEXT NOT NULL,
    original_file_name TEXT NOT NULL,
    mime_type TEXT,
    file_size_bytes INTEGER,
    page_count INTEGER,
    status TEXT NOT NULL DEFAULT 'uploaded'
        CHECK (status IN ('uploaded','assigned','evaluating','submitted_for_review','approved','returned','published')),
    assigned_evaluator_id TEXT REFERENCES users(id),
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (exam_attempt_id IS NOT NULL OR assignment_submission_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS answer_sheet_pages (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES answer_sheet_submissions(id),
    page_number INTEGER NOT NULL,
    r2_object_key TEXT NOT NULL,
    width_pixels INTEGER,
    height_pixels INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (submission_id, page_number)
);

CREATE TABLE IF NOT EXISTS answer_evaluations (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL UNIQUE REFERENCES answer_sheet_submissions(id),
    evaluator_id TEXT NOT NULL REFERENCES users(id),
    total_marks REAL NOT NULL DEFAULT 0,
    marks_awarded REAL NOT NULL DEFAULT 0,
    overall_feedback TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress','submitted','approved','returned')),
    submitted_at TEXT,
    reviewed_by TEXT REFERENCES users(id),
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS answer_evaluation_items (
    id TEXT PRIMARY KEY,
    evaluation_id TEXT NOT NULL REFERENCES answer_evaluations(id),
    exam_question_id TEXT REFERENCES exam_questions(id),
    question_number TEXT NOT NULL,
    max_marks REAL NOT NULL,
    marks_awarded REAL NOT NULL DEFAULT 0,
    feedback TEXT,
    marking_scheme TEXT,
    model_answer TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (evaluation_id, question_number)
);

CREATE TABLE IF NOT EXISTS answer_annotations (
    id TEXT PRIMARY KEY,
    evaluation_id TEXT NOT NULL REFERENCES answer_evaluations(id),
    page_id TEXT NOT NULL REFERENCES answer_sheet_pages(id),
    annotation_type TEXT NOT NULL
        CHECK (annotation_type IN ('comment','highlight','correct','incorrect','mark')),
    annotation_data TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evaluation_review_events (
    id TEXT PRIMARY KEY,
    evaluation_id TEXT NOT NULL REFERENCES answer_evaluations(id),
    action TEXT NOT NULL CHECK (action IN ('submitted','approved','returned','reassigned','score_changed')),
    previous_marks REAL,
    new_marks REAL,
    comments TEXT,
    actor_id TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 7. Fees, price publication, student agreements and refunds
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fee_plan_details (
    fee_plan_id TEXT PRIMARY KEY REFERENCES fee_plans(id),
    curriculum_id TEXT REFERENCES curricula(id),
    exam_pathway_id TEXT REFERENCES exam_pathways(id),
    class_id INTEGER REFERENCES classes(id),
    subject_id INTEGER REFERENCES subjects(id),
    batch_id TEXT REFERENCES batches(id),
    learning_mode TEXT NOT NULL CHECK (learning_mode IN ('group','one_to_one')),
    billing_period TEXT NOT NULL
        CHECK (billing_period IN ('monthly','quarterly','one_time','custom')),
    currency_code TEXT NOT NULL DEFAULT 'INR',
    public_description TEXT,
    inclusions TEXT,
    terms_text TEXT,
    is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0,1)),
    published_at TEXT,
    effective_from TEXT,
    effective_to TEXT,
    updated_by TEXT REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fee_plan_versions (
    id TEXT PRIMARY KEY,
    fee_plan_id TEXT NOT NULL REFERENCES fee_plans(id),
    version_number INTEGER NOT NULL,
    amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
    billing_period TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    published_snapshot TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (fee_plan_id, version_number)
);

CREATE TABLE IF NOT EXISTS student_fee_agreements (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES users(id),
    admission_id TEXT REFERENCES student_admissions(id),
    fee_plan_id TEXT REFERENCES fee_plans(id),
    fee_plan_version_id TEXT REFERENCES fee_plan_versions(id),
    agreed_amount_paise INTEGER NOT NULL CHECK (agreed_amount_paise >= 0),
    currency_code TEXT NOT NULL DEFAULT 'INR',
    billing_period TEXT NOT NULL,
    discount_paise INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
    scholarship_paise INTEGER NOT NULL DEFAULT 0 CHECK (scholarship_paise >= 0),
    instalment_terms TEXT,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','superseded','closed')),
    agreed_terms_snapshot TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fee_adjustments (
    id TEXT PRIMARY KEY,
    fee_account_id TEXT NOT NULL REFERENCES student_fee_accounts(id),
    adjustment_type TEXT NOT NULL
        CHECK (adjustment_type IN ('discount','scholarship','credit','debit','waiver','refund')),
    amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
    reason TEXT NOT NULL,
    approved_by TEXT REFERENCES users(id),
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refund_requests (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES users(id),
    fee_account_id TEXT REFERENCES student_fee_accounts(id),
    fee_transaction_id TEXT REFERENCES fee_transactions(id),
    amount_requested_paise INTEGER NOT NULL CHECK (amount_requested_paise >= 0),
    amount_approved_paise INTEGER CHECK (amount_approved_paise >= 0),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested','under_review','approved','rejected','processed','cancelled')),
    requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_by TEXT REFERENCES users(id),
    reviewed_at TEXT,
    processed_at TEXT,
    refund_reference TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS money_back_policies (
    id TEXT PRIMARY KEY,
    policy_name TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    policy_text TEXT NOT NULL,
    eligibility_days INTEGER,
    eligible_paid_classes INTEGER,
    refund_percentage REAL NOT NULL DEFAULT 100 CHECK (refund_percentage BETWEEN 0 AND 100),
    is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    approved_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (policy_name, policy_version)
);

CREATE TABLE IF NOT EXISTS student_money_back_terms (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES users(id),
    admission_id TEXT REFERENCES student_admissions(id),
    policy_id TEXT NOT NULL REFERENCES money_back_policies(id),
    accepted_at TEXT NOT NULL,
    policy_snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 8. Notifications, email delivery, privacy and system configuration
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification_deliveries (
    id TEXT PRIMARY KEY,
    notification_id TEXT REFERENCES notifications(id),
    user_id TEXT REFERENCES users(id),
    channel TEXT NOT NULL CHECK (channel IN ('in_app','email')),
    recipient TEXT,
    provider TEXT,
    provider_message_id TEXT,
    delivery_status TEXT NOT NULL DEFAULT 'queued'
        CHECK (delivery_status IN ('queued','sent','delivered','failed','bounced')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    sent_at TEXT,
    delivered_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    email_enabled INTEGER NOT NULL DEFAULT 1 CHECK (email_enabled IN (0,1)),
    in_app_enabled INTEGER NOT NULL DEFAULT 1 CHECK (in_app_enabled IN (0,1)),
    class_reminders INTEGER NOT NULL DEFAULT 1 CHECK (class_reminders IN (0,1)),
    exam_reminders INTEGER NOT NULL DEFAULT 1 CHECK (exam_reminders IN (0,1)),
    assignment_reminders INTEGER NOT NULL DEFAULT 1 CHECK (assignment_reminders IN (0,1)),
    fee_reminders INTEGER NOT NULL DEFAULT 1 CHECK (fee_reminders IN (0,1)),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY,
    template_key TEXT NOT NULL UNIQUE,
    subject_template TEXT NOT NULL,
    html_template TEXT NOT NULL,
    text_template TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    updated_by TEXT REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS privacy_consents (
    id TEXT PRIMARY KEY,
    subject_type TEXT NOT NULL
        CHECK (subject_type IN ('enquiry','public_assessment','student','teacher')),
    subject_id TEXT NOT NULL,
    consent_type TEXT NOT NULL
        CHECK (consent_type IN ('privacy_notice','marketing','terms','money_back_policy')),
    policy_version TEXT NOT NULL,
    consent_value INTEGER NOT NULL CHECK (consent_value IN (0,1)),
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
    source TEXT
);

CREATE TABLE IF NOT EXISTS portal_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1)),
    updated_by TEXT REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 9. R2 file access and lifecycle metadata
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS file_access_events (
    id TEXT PRIMARY KEY,
    file_asset_id TEXT REFERENCES file_assets(id),
    r2_object_key TEXT NOT NULL,
    actor_id TEXT REFERENCES users(id),
    action TEXT NOT NULL CHECK (action IN ('upload','view','download','replace','delete')),
    purpose TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 10. Indexes for common dashboard, search and workflow queries
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_curriculum_pathways_curriculum
    ON curriculum_exam_pathways(curriculum_id, is_active);
CREATE INDEX IF NOT EXISTS idx_class_subjects_class
    ON class_subjects(class_id, is_active);
CREATE INDEX IF NOT EXISTS idx_chapters_subject_class
    ON chapters(subject_id, class_id, status);
CREATE INDEX IF NOT EXISTS idx_topics_chapter
    ON topics(chapter_id, status);
CREATE INDEX IF NOT EXISTS idx_question_metadata_review
    ON question_bank_metadata(review_status, curriculum_id, exam_pathway_id);
CREATE INDEX IF NOT EXISTS idx_teacher_class_periods_lookup
    ON teacher_class_assignment_periods(class_id, subject_id, status, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_teacher_batch_periods_lookup
    ON teacher_batch_assignment_periods(batch_id, status, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_teacher_assignment_events_period
    ON teacher_assignment_events(assignment_scope, assignment_period_id, created_at);
CREATE INDEX IF NOT EXISTS idx_teacher_availability_teacher_time
    ON teacher_availability(teacher_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_timetable_batch_weekday
    ON class_timetable(batch_id, weekday, status);
CREATE INDEX IF NOT EXISTS idx_sessions_teacher_start
    ON class_sessions(actual_teacher_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_sessions_batch_start
    ON class_sessions(batch_id, starts_at, status);
CREATE INDEX IF NOT EXISTS idx_session_attendance_student
    ON class_session_attendance(student_id, session_id);
CREATE INDEX IF NOT EXISTS idx_enquiries_status_followup
    ON enquiries(status, next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_enquiries_phone
    ON enquiries(phone);
CREATE INDEX IF NOT EXISTS idx_enquiry_activities_enquiry
    ON enquiry_activities(enquiry_id, created_at);
CREATE INDEX IF NOT EXISTS idx_demo_bookings_status_time
    ON demo_bookings(status, preferred_at, confirmed_starts_at);
CREATE INDEX IF NOT EXISTS idx_demo_bookings_teacher_time
    ON demo_bookings(assigned_teacher_id, confirmed_starts_at);
CREATE INDEX IF NOT EXISTS idx_student_admissions_student
    ON student_admissions(student_id, status);
CREATE INDEX IF NOT EXISTS idx_student_admissions_year
    ON student_admissions(academic_year_id, status);
CREATE INDEX IF NOT EXISTS idx_invitations_status_expiry
    ON invitations(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_invitations_email
    ON invitations(email, invite_type);
CREATE INDEX IF NOT EXISTS idx_public_exam_publications_status
    ON public_exam_publications(status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_public_assessment_phone
    ON public_assessment_registrations(phone);
CREATE INDEX IF NOT EXISTS idx_public_assessment_attempts_registration
    ON public_assessment_attempts(registration_id, exam_id);
CREATE INDEX IF NOT EXISTS idx_public_assessment_attempts_expiry
    ON public_assessment_attempts(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_public_assessment_rate_limits_window
    ON public_assessment_rate_limits(window_start);
CREATE INDEX IF NOT EXISTS idx_answer_sheets_student_status
    ON answer_sheet_submissions(student_id, status);
CREATE INDEX IF NOT EXISTS idx_answer_sheets_evaluator
    ON answer_sheet_submissions(assigned_evaluator_id, status);
CREATE INDEX IF NOT EXISTS idx_answer_evaluation_items_evaluation
    ON answer_evaluation_items(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_answer_annotations_page
    ON answer_annotations(page_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fee_plan_details_public
    ON fee_plan_details(is_published, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_fee_plan_versions_effective
    ON fee_plan_versions(fee_plan_id, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_student_fee_agreements_student
    ON student_fee_agreements(student_id, status);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status
    ON refund_requests(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status
    ON notification_deliveries(delivery_status, created_at);
CREATE INDEX IF NOT EXISTS idx_file_access_events_key
    ON file_access_events(r2_object_key, created_at);
CREATE INDEX IF NOT EXISTS idx_privacy_consents_subject
    ON privacy_consents(subject_type, subject_id, consent_type);

-- Record the migration. INSERT OR IGNORE keeps re-runs safe.
INSERT OR IGNORE INTO schema_migrations (version, description)
VALUES ('2026-11-21-001', 'Additive DhyanshEdu academic, operations, admissions, assessment, evaluation, fee and notification foundation');

-- ---------------------------------------------------------------------------
-- 11. Post-migration validation
-- The console may display "No rows affected" for DDL statements. That is
-- normal. These SELECT statements provide a visible validation result.
-- ---------------------------------------------------------------------------

SELECT 'schema_migrations' AS check_name, COUNT(*) AS records
FROM schema_migrations
WHERE version = '2026-11-21-001';

SELECT name AS required_table
FROM sqlite_master
WHERE type = 'table'
  AND name IN (
    'curriculum_exam_pathways',
    'curriculum_class_levels',
    'class_subjects',
    'chapters',
    'topics',
    'question_bank_metadata',
    'teacher_class_assignment_periods',
    'teacher_batch_assignment_periods',
    'teacher_assignment_events',
    'class_timetable',
    'class_sessions',
    'class_session_attendance',
    'enquiries',
    'enquiry_activities',
    'demo_bookings',
    'demo_feedback',
    'student_admissions',
    'invitations',
    'invitation_events',
    'public_exam_publications',
    'public_assessment_registrations',
    'public_assessment_attempts',
    'public_assessment_rate_limits',
    'answer_sheet_submissions',
    'answer_sheet_pages',
    'answer_evaluations',
    'answer_evaluation_items',
    'answer_annotations',
    'evaluation_review_events',
    'fee_plan_details',
    'fee_plan_versions',
    'student_fee_agreements',
    'fee_adjustments',
    'refund_requests',
    'money_back_policies',
    'student_money_back_terms',
    'notification_deliveries',
    'notification_preferences',
    'email_templates',
    'privacy_consents',
    'portal_settings',
    'file_access_events'
  )
ORDER BY name;

PRAGMA foreign_key_check;
