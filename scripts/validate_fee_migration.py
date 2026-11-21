import sqlite3
from pathlib import Path

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")

# Exact Phase 1 fee-related schema and referenced tables from the live D1 database.
schema = [
"""CREATE TABLE users (id TEXT PRIMARY KEY, full_name TEXT, role TEXT, status TEXT, email TEXT)""",
"""CREATE TABLE classes (id INTEGER PRIMARY KEY, class_name TEXT NOT NULL)""",
"""CREATE TABLE subjects (id INTEGER PRIMARY KEY, subject_name TEXT NOT NULL)""",
"""CREATE TABLE batches (id TEXT PRIMARY KEY, batch_name TEXT NOT NULL)""",
"""CREATE TABLE fee_plans (id TEXT PRIMARY KEY, plan_name TEXT NOT NULL, description TEXT, amount_paise INTEGER NOT NULL, billing_period TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')))""",
"""CREATE TABLE student_fee_accounts (id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES users(id), fee_plan_id TEXT REFERENCES fee_plans(id), total_amount_paise INTEGER NOT NULL, paid_amount_paise INTEGER NOT NULL DEFAULT 0, due_date TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')))""",
"""CREATE TABLE fee_transactions (id TEXT PRIMARY KEY, fee_account_id TEXT NOT NULL REFERENCES student_fee_accounts(id), amount_paise INTEGER NOT NULL, payment_method TEXT, transaction_reference TEXT, payment_status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')))""",
"""CREATE TABLE fee_receipts (id TEXT PRIMARY KEY, fee_transaction_id TEXT NOT NULL REFERENCES fee_transactions(id), receipt_number TEXT NOT NULL UNIQUE, receipt_file_key TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))""",
"""CREATE TABLE audit_logs (id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, details TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"""
]
for statement in schema:
    db.execute(statement)

db.execute("INSERT INTO users(id,full_name,role,status,email) VALUES('student-1','Test Student','student','approved','student@example.test')")
db.execute("INSERT INTO users(id,full_name,role,status,email) VALUES('admin-1','Test Admin','admin','approved','admin@example.test')")
db.execute("INSERT INTO fee_plans(id,plan_name,description,amount_paise,billing_period) VALUES('plan-1','Existing Plan','Existing description',100000,'monthly')")
db.execute("INSERT INTO student_fee_accounts(id,student_id,fee_plan_id,total_amount_paise,paid_amount_paise) VALUES('account-1','student-1','plan-1',100000,25000)")
db.execute("INSERT INTO fee_transactions(id,fee_account_id,amount_paise,payment_method,payment_status) VALUES('tx-1','account-1',25000,'cash','paid')")
db.execute("INSERT INTO fee_receipts(id,fee_transaction_id,receipt_number) VALUES('receipt-1','tx-1','DHE-TEST-001')")
db.execute("INSERT INTO audit_logs(id,actor_id,action,entity_type,entity_id,details) VALUES('audit-1','admin-1','legacy_action','fee_plan','plan-1','{}')")

migration = Path("migrations/0003_fee_management.sql").read_text()
db.executescript(migration)

assert db.execute("SELECT name,billing_frequency FROM fee_plans WHERE id='plan-1'").fetchone() == ("Existing Plan", "monthly")
assert db.execute("SELECT description,amount_due_paise FROM student_fee_accounts WHERE id='account-1'").fetchone() == ("Existing Plan", 100000)
assert db.execute("SELECT student_id,status FROM fee_transactions WHERE id='tx-1'").fetchone() == ("student-1", "recorded")
assert db.execute("SELECT transaction_id,issued_at FROM fee_receipts WHERE id='receipt-1'").fetchone()[0] == "tx-1"
assert db.execute("SELECT actor_user_id,details_json FROM audit_logs WHERE id='audit-1'").fetchone() == ("admin-1", "{}")

# Validate additive exam-answer feedback migration against the live D1 answer schema.
db.execute("""CREATE TABLE student_answers (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    exam_question_id TEXT NOT NULL,
    answer_text TEXT,
    selected_option_ids TEXT,
    is_correct INTEGER,
    marks_awarded REAL,
    answered_at TEXT,
    UNIQUE(attempt_id, exam_question_id)
)""")
db.execute("""INSERT INTO student_answers(id,attempt_id,exam_question_id,answer_text,marks_awarded)
              VALUES('answer-1','attempt-1','question-1','Existing answer',2)""")
feedback_migration = Path("migrations/0004_exam_answer_feedback.sql").read_text()
db.executescript(feedback_migration)
db.execute("UPDATE student_answers SET teacher_feedback='Good working' WHERE id='answer-1'")
assert db.execute("SELECT answer_text,marks_awarded,teacher_feedback FROM student_answers WHERE id='answer-1'").fetchone() == ("Existing answer", 2, "Good working")

print("Fee and exam-feedback migrations passed against the Phase 1 schema fixture; legacy fee and answer records were preserved.")
