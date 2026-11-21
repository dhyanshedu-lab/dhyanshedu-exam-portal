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

# Reproduce the existing live D1 enquiry schema, including its legacy history columns.
db.execute("""CREATE TABLE enquiries (
    id TEXT PRIMARY KEY, student_name TEXT NOT NULL, parent_name TEXT, phone TEXT NOT NULL,
    email TEXT NOT NULL, student_class TEXT NOT NULL, board TEXT,
    source TEXT NOT NULL DEFAULT 'public_website',
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','demo_scheduled','enrolled','closed')),
    assigned_to TEXT REFERENCES users(id), follow_up_at TEXT, admin_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)""")
db.execute("""CREATE TABLE enquiry_history (
    id TEXT PRIMARY KEY, enquiry_id TEXT NOT NULL REFERENCES enquiries(id),
    actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, old_value TEXT,
    new_value TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
)""")
db.execute("INSERT INTO enquiries(id,student_name,phone,email,student_class) VALUES('legacy-enq','Legacy Student','9876543210','legacy@example.test','Class 7')")
db.execute("""INSERT INTO enquiry_history(id,enquiry_id,actor_id,action,old_value,new_value,notes)
              VALUES('legacy-eh','legacy-enq','admin-1','status_changed','new','contacted','Existing note')""")

# Validate the enquiry migration on the same D1 fixture.
enquiry_migration = Path("migrations/0004_enquiries.sql").read_text()
db.executescript(enquiry_migration)
db.execute("INSERT INTO users(id,full_name,role,status,email) VALUES('teacher-1','Test Teacher','teacher','approved','teacher@example.test')")
db.execute("""INSERT INTO enquiries(id,student_name,parent_name,phone,email,student_class,board,status)
              VALUES('enq-1','Student','Parent','9876543210','parent@example.test','Class 8','CBSE','new')""")
db.execute("""INSERT INTO enquiry_history(id,enquiry_id,actor_user_id,action,field_name,old_value,new_value)
              VALUES('eh-1','enq-1',NULL,'created','status',NULL,'new')""")
db.execute("""UPDATE enquiries SET status='contacted',assigned_to='teacher-1',
              follow_up_at='2026-11-25',admin_notes='Call in evening',updated_at=datetime('now')
              WHERE id='enq-1'""")
db.execute("""INSERT INTO enquiry_history(id,enquiry_id,actor_user_id,action,field_name,old_value,new_value)
              VALUES('eh-2','enq-1','admin-1','updated','status','new','contacted')""")
assert db.execute("SELECT status,assigned_to,follow_up_at,admin_notes FROM enquiries WHERE id='enq-1'").fetchone() == ("contacted","teacher-1","2026-11-25","Call in evening")
assert db.execute("SELECT COUNT(*) FROM enquiry_history WHERE enquiry_id='enq-1'").fetchone()[0] == 2
assert db.execute("SELECT actor_user_id,field_name FROM enquiry_history WHERE id='legacy-eh'").fetchone() == ("admin-1", None)
assert db.execute("SELECT source FROM enquiries WHERE id='legacy-enq'").fetchone() == ("public_website",)

print("Fee and enquiry migrations passed against the Phase 1 D1 schema fixture; legacy fee records and enquiry follow-up history were preserved.")
