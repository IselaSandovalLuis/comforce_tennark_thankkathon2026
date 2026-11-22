"""Add workflow fields to the original comforce_db schema without rewriting its tables."""

import json

DEPARTMENTS = (
    "comforce", "public-safety", "fire", "ems", "community-support", "housing", "other",
)


def migrate(db, write_transaction):
    migrate_original_workflow(db, write_transaction)
    with write_transaction(db):
        if not db.execute("SELECT 1 FROM workflow_migrations WHERE version = 3").fetchone():
            db.execute("ALTER TABLE reports ADD COLUMN source_metadata TEXT")
            db.execute("INSERT INTO workflow_migrations VALUES (3)")
        if db.execute("SELECT 1 FROM workflow_migrations WHERE version = 2").fetchone():
            return
        for name, definition in (
            ("anonymous", "INTEGER"),
            ("ai_status", "TEXT"),
            ("ai_summary", "TEXT"),
            ("suggested_service_category", "TEXT"),
            ("suggested_team", "TEXT"),
            ("needs_review", "INTEGER"),
            ("reviewed_service_category", "TEXT"),
            ("publication_declined", "INTEGER NOT NULL DEFAULT 0"),
        ):
            db.execute(f"ALTER TABLE reports ADD COLUMN {name} {definition}")
        db.execute("INSERT INTO workflow_migrations VALUES (2)")


def migrate_original_workflow(db, write_transaction):
    with write_transaction(db):
        db.execute("CREATE TABLE IF NOT EXISTS workflow_migrations (version INTEGER PRIMARY KEY)")
        if db.execute("SELECT 1 FROM workflow_migrations WHERE version = 1").fetchone():
            return

        statements = (
            "CREATE TABLE organizations (id TEXT PRIMARY KEY)",
            "INSERT OR IGNORE INTO organizations SELECT organization FROM staff",
            "INSERT OR IGNORE INTO organizations SELECT organization FROM service_cases",
            "ALTER TABLE reports ADD COLUMN submitted_location TEXT",
            "ALTER TABLE reports ADD COLUMN tracking_hash TEXT",
            "ALTER TABLE reports ADD COLUMN reporter_suggestions TEXT",
            "ALTER TABLE reports ADD COLUMN imported_fields TEXT",
            """ALTER TABLE reports ADD COLUMN parse_status TEXT NOT NULL DEFAULT 'pending'
               CHECK (parse_status IN ('pending', 'parsed', 'failed'))""",
            "ALTER TABLE reports ADD COLUMN reviewed_by TEXT REFERENCES staff(id)",
            "ALTER TABLE reports ADD COLUMN reviewed_at TEXT",
            "ALTER TABLE incidents ADD COLUMN approved_by TEXT REFERENCES staff(id)",
            "ALTER TABLE incidents ADD COLUMN approved_at TEXT",
            "ALTER TABLE service_updates ADD COLUMN worker_action TEXT",
            """UPDATE service_updates SET worker_action =
                 CASE WHEN status = 'awaiting_confirmation' THEN 'completed' ELSE status END
               WHERE staff_id IS NOT NULL""",
            "UPDATE reports SET parse_status = 'parsed' WHERE parser_output IS NOT NULL",
            """UPDATE reports SET reviewed_at = created_at WHERE incident_id IN
               (SELECT id FROM incidents WHERE verification_status = 'verified')""",
            """CREATE TABLE staff_credentials (
                 staff_id TEXT PRIMARY KEY REFERENCES staff(id),
                 salt BLOB NOT NULL,
                 password_hash BLOB NOT NULL
               )""",
            """CREATE TABLE staff_sessions (
                 token_hash TEXT PRIMARY KEY,
                 staff_id TEXT NOT NULL REFERENCES staff(id),
                 expires_at TEXT NOT NULL
               )""",
            """CREATE TABLE demo_inbox (
                 notification_id INTEGER PRIMARY KEY REFERENCES notifications(id),
                 email TEXT NOT NULL,
                 message TEXT NOT NULL,
                 response_url TEXT,
                 delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
               )""",
        )
        for statement in statements:
            db.execute(statement)
        imported = db.execute(
            """SELECT r.id, i.incident_type, i.city, i.location, i.incident_date, i.incident_time,
                      i.description
               FROM reports r JOIN incidents i ON i.id = r.incident_id WHERE r.source != 'manual'"""
        ).fetchall()
        db.executemany(
            "UPDATE reports SET imported_fields = ? WHERE id = ?",
            ((json.dumps({field: row[field] for field in row.keys() if field != "id"}), row["id"]) for row in imported),
        )
        db.executemany("INSERT OR IGNORE INTO organizations VALUES (?)", ((org,) for org in DEPARTMENTS))
        db.execute("INSERT INTO workflow_migrations VALUES (1)")
