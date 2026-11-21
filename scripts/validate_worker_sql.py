import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
fixture = json.loads((ROOT / "scripts/live_d1_schema_fixture.json").read_text())

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = OFF")
for table in fixture:
    db.execute(table["sql"])

# Apply additive migrations to model the schema expected by the current API modules.
for migration_name in ("0003_fee_management.sql", "0004_exam_answer_feedback.sql"):
    db.executescript((ROOT / "migrations" / migration_name).read_text())

# Seed the minimal parent rows needed for SQLite to compile INSERT/UPSERT statements.
# EXPLAIN never executes a statement, so no test data is written to any live database.
sources = [
    ROOT / "worker/src/index.js",
    ROOT / "worker/src/fees.js",
    ROOT / "worker/src/study.js",
]
prepared = []
pattern = re.compile(r"\\.prepare\\(\\s*(\"(?:\\\\.|[^\"\\\\])*\")\\s*\\)", re.S)
for source_path in sources:
    source = source_path.read_text()
    for match in pattern.finditer(source):
        sql = json.loads(match.group(1))
        if "${" in sql:
            continue
        prepared.append((source_path.relative_to(ROOT).as_posix(), sql))

errors = []
for source_name, sql in prepared:
    try:
        db.execute("EXPLAIN " + sql, [None] * sql.count("?"))
    except sqlite3.Error as exc:
        errors.append((source_name, sql, str(exc)))

if errors:
    for source_name, sql, error in errors:
        print(f"SQL compatibility failure in {source_name}: {error}\\n  {sql}")
    raise SystemExit(f"{len(errors)} of {len(prepared)} prepared SQL statements failed schema validation.")

print(f"Validated {len(prepared)} prepared SQL statements against {len(fixture)} live D1 table definitions plus migrations 0003 and 0004.")
