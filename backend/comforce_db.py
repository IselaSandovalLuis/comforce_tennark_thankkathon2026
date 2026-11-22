"""ComForce MKE SQLite storage. Run "python -m backend.comforce_db --help" to get started.

Python 3.10+ with SQLite. Call init_db once at backend startup. All methods
accept an open connection from connect(). Use one connection per request.
staff_id must come from the backend's authenticated session.

Backend wiring:
  1. submit_report saves the original text and returns report/incident IDs.
  2. Pass the original text to your parser and call save_parsed_report with its
     dictionary. review_queue returns the proposals and original reports.
  3. approve_incident takes the complete reviewed dictionary plus an explicit
     public summary and optional public coordinates. public_map_incidents
     returns the approved pins.
  4. Run one delivery worker that calls pending_notification_ids and
     deliver_notification with an email adapter. A web GET can show a form
     with Confirm and Dispute; call record_confirmation only on form POST.

"""

import argparse
import csv
import hashlib
import json
import os
import secrets
import sqlite3
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

SCHEMA = """
CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY,
    incident_type TEXT,
    city TEXT,
    location TEXT,
    incident_date TEXT,
    incident_time TEXT,
    description TEXT,
    verification_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('unverified', 'verified')),
    public_summary TEXT,
    public_latitude REAL CHECK (public_latitude BETWEEN -90 AND 90),
    public_longitude REAL CHECK (public_longitude BETWEEN -180 AND 180),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY,
    name TEXT,
    email TEXT,
    phone TEXT,
    email_opt_in INTEGER NOT NULL CHECK (email_opt_in IN (0, 1)),
    CHECK (email_opt_in = 0 OR email IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id),
    source TEXT NOT NULL,
    post_id TEXT,
    post_url TEXT,
    post_date TEXT,
    original_text TEXT,
    source_verification_status TEXT,
    related_post_urls TEXT,
    manual_review_reason TEXT,
    contact_id INTEGER REFERENCES contacts(id),
    requested_department TEXT,
    parser_output TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source, post_id)
);

CREATE TABLE IF NOT EXISTS tips (
    id INTEGER PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id),
    tip_text TEXT NOT NULL CHECK (length(trim(tip_text)) > 0),
    contact_id INTEGER REFERENCES contacts(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    organization TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'worker'))
);

CREATE TABLE IF NOT EXISTS service_cases (
    id INTEGER PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id),
    organization TEXT NOT NULL,
    contact_id INTEGER REFERENCES contacts(id),
    status TEXT NOT NULL DEFAULT 'assistance_needed'
        CHECK (status IN ('assistance_needed', 'in_progress',
                          'awaiting_confirmation', 'assistance_confirmed',
                          'needs_follow_up'))
);

CREATE TABLE IF NOT EXISTS service_updates (
    id INTEGER PRIMARY KEY,
    case_id INTEGER NOT NULL REFERENCES service_cases(id),
    staff_id TEXT REFERENCES staff(id),
    status TEXT NOT NULL,
    notes TEXT,
    response_to INTEGER UNIQUE REFERENCES service_updates(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY,
    update_id INTEGER NOT NULL UNIQUE REFERENCES service_updates(id),
    contact_id INTEGER NOT NULL REFERENCES contacts(id),
    token_hash TEXT UNIQUE,
    pending_token TEXT,
    sent_at TEXT,
    expires_at TEXT,
    used_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS reports_incident_idx ON reports(incident_id);
CREATE INDEX IF NOT EXISTS tips_incident_idx ON tips(incident_id);
CREATE INDEX IF NOT EXISTS cases_incident_idx ON service_cases(incident_id);
CREATE INDEX IF NOT EXISTS updates_case_idx ON service_updates(case_id, id);
CREATE INDEX IF NOT EXISTS notifications_status_idx ON notifications(status, id);
"""

INCIDENT_FIELDS = (
    "incident_type", "city", "location", "incident_date", "incident_time",
    "description",
)
CSV_FIELDS = {
    "post_id", "post_url", "post_date", "incident_type", "city", "location",
    "incident_time", "description", "original_text", "verification_status",
    "related_post_urls", "manual_review_reason",
}
NOTICE_MESSAGES = {
    "in_progress": "A ComForce service provider has started working on your case.",
    "awaiting_confirmation": (
        "A ComForce provider marked assistance complete. Please confirm whether "
        "you received assistance or let ComForce know if you still need follow-up."
    ),
}


def connect(path):
    """Open a connection with foreign-key checks enabled."""
    db = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def init_db(db):
    from backend.map_data import migrate_map
    from backend.migrations import migrate

    db.executescript(SCHEMA)
    migrate(db, write_transaction)
    migrate_map(db, write_transaction)


@contextmanager
def write_transaction(db):
    # Reserve the write lock before reading data used in a state transition.
    db.execute("BEGIN IMMEDIATE")
    try:
        yield
        db.commit()
    except BaseException:
        db.rollback()
        raise


def optional_text(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Text fields must be strings or null.")
    return value.strip() or None


def required_text(value, label):
    cleaned = optional_text(value)
    if cleaned is None:
        raise ValueError(f"{label} is required.")
    return cleaned


def incident_values(fields):
    if not isinstance(fields, dict):
        raise ValueError("Structured incident fields must be an object.")
    values = tuple(optional_text(fields.get(name)) for name in INCIDENT_FIELDS)
    for field, value in zip(INCIDENT_FIELDS, values):
        limit = 5000 if field == "description" else 250
        if value and len(value) > limit:
            raise ValueError(f"{field} must be at most {limit} characters.")
    return values


def insert_incident(db, fields):
    return db.execute(
        """INSERT INTO incidents
           (incident_type, city, location, incident_date, incident_time, description)
           VALUES (?, ?, ?, ?, ?, ?)""",
        incident_values(fields),
    ).lastrowid


def get_or_raise(db, sql, parameters, label):
    row = db.execute(sql, parameters).fetchone()
    if row is None:
        raise LookupError(f"{label} was not found.")
    return row


def import_csv(db, csv_path, *, source="usfir"):
    """Import new posts. Reruns skip matching (source, post_id) pairs."""
    source = required_text(source, "Source")
    if source == "manual":
        raise ValueError("Use an internet source name for imports.")
    imported = skipped = 0
    with open(csv_path, encoding="utf-8-sig", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        missing = (CSV_FIELDS - {"related_post_urls"}).difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Missing CSV columns: {', '.join(sorted(missing))}")

        with write_transaction(db):
            for row in reader:
                post_id = required_text(row["post_id"], f"Post ID on line {reader.line_num}")
                existing = db.execute(
                    "SELECT id, source_metadata FROM reports WHERE source = ? AND post_id = ?",
                    (source, post_id),
                ).fetchone()
                if existing is not None:
                    latitude = optional_text(row.get("latitude"))
                    longitude = optional_text(row.get("longitude"))
                    if latitude is not None and longitude is not None:
                        metadata = json.loads(existing["source_metadata"] or "{}")
                        if (metadata.get("latitude"), metadata.get("longitude")) != (latitude, longitude):
                            metadata.update(latitude=latitude, longitude=longitude)
                            db.execute(
                                "UPDATE reports SET source_metadata = ? WHERE id = ?",
                                (json.dumps(metadata), existing["id"]),
                            )
                    skipped += 1
                    continue

                incident_id = insert_incident(db, row)
                db.execute(
                    """INSERT INTO reports
                       (incident_id, source, post_id, post_url, post_date, original_text,
                        source_verification_status, related_post_urls, manual_review_reason,
                        imported_fields, source_metadata)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        incident_id, source, post_id, optional_text(row["post_url"]),
                        optional_text(row["post_date"]), row["original_text"],
                        optional_text(row["verification_status"]),
                        optional_text(row.get("related_post_urls")),
                        optional_text(row["manual_review_reason"]),
                        json.dumps(dict(zip(INCIDENT_FIELDS, incident_values(row)))),
                        json.dumps({key: value for key, value in row.items()
                                    if key and key not in CSV_FIELDS and optional_text(value)}),
                    ),
                )
                imported += 1
    return {"imported": imported, "skipped": skipped}


def insert_contact(db, name, email, phone, email_opt_in):
    name, email = optional_text(name), optional_text(email)
    phone = optional_text(phone)
    if email_opt_in and email is None:
        raise ValueError("An email address is required to opt in.")
    if name is None and email is None and phone is None:
        return None
    return db.execute(
        "INSERT INTO contacts (name, email, phone, email_opt_in) VALUES (?, ?, ?, ?)",
        (name, email, phone, int(bool(email_opt_in))),
    ).lastrowid


def submit_report(db, original_text, *, name=None, email=None, phone=None,
                  email_opt_in=False,
                  department="ComForce", incident_id=None, submitted_location=None,
                  tracking_hash=None, reporter_suggestions=None, anonymous=None):
    """Save a resident's original submission before running the parser."""
    required_text(original_text, "Report text")
    department = required_text(department, "Department")
    with write_transaction(db):
        if incident_id is None:
            incident_id = insert_incident(db, {})
        contact_id = insert_contact(db, None if anonymous else name, email, phone, email_opt_in)
        report_id = db.execute(
            """INSERT INTO reports
               (incident_id, source, original_text, contact_id, requested_department,
                submitted_location, tracking_hash, reporter_suggestions, anonymous)
               VALUES (?, 'manual', ?, ?, ?, ?, ?, ?, ?)""",
            (incident_id, original_text, contact_id, department,
             optional_text(submitted_location), tracking_hash, reporter_suggestions, anonymous),
        ).lastrowid
    return {"report_id": report_id, "incident_id": incident_id, "contact_id": contact_id}


def save_parsed_report(db, report_id, fields):
    """Store the AI's proposed values on the report for staff review."""
    parsed = dict(zip(INCIDENT_FIELDS, incident_values(fields)))
    result = db.execute(
        """UPDATE reports SET parser_output = ?, parse_status = 'parsed'
           WHERE id = ?""",
        (json.dumps(parsed, ensure_ascii=False), report_id),
    )
    if result.rowcount == 0:
        raise LookupError("Report was not found.")


def add_tip(db, incident_id, tip_text, *, name=None, email=None, phone=None):
    """Attach a new tip and optional private contact to an existing incident."""
    required_text(tip_text, "Tip text")
    with write_transaction(db):
        contact_id = insert_contact(db, name, email, phone, False)
        return db.execute(
            "INSERT INTO tips (incident_id, tip_text, contact_id) VALUES (?, ?, ?)",
            (incident_id, tip_text, contact_id),
        ).lastrowid


def register_staff(db, staff_id, organization, *, role="worker"):
    """Provision staff from trusted setup code, never a public form."""
    organization = required_text(organization, "Organization")
    with write_transaction(db):
        db.execute("INSERT OR IGNORE INTO organizations (id) VALUES (?)", (organization,))
        db.execute(
            "INSERT INTO staff (id, organization, role) VALUES (?, ?, ?)",
            (required_text(staff_id, "Staff ID"), organization, role),
        )


def require_staff(db, staff_id, *, organization=None, admin_only=False):
    staff = db.execute("SELECT * FROM staff WHERE id = ?", (staff_id,)).fetchone()
    if staff is None:
        raise PermissionError("Staff access required.")
    if staff["role"] != "admin" and (admin_only or (
        organization is not None and staff["organization"] != organization
    )):
        raise PermissionError("Staff member does not have access to this action.")
    return staff


def review_queue(db, staff_id):
    require_staff(db, staff_id, admin_only=True)
    return [
        dict(row) for row in db.execute(
            """SELECT r.*, i.incident_type, i.city, i.location, i.incident_date,
                      i.incident_time, i.description
               FROM reports r JOIN incidents i ON i.id = r.incident_id
               WHERE r.reviewed_at IS NULL ORDER BY r.id"""
        )
    ]


def approve_incident(db, incident_id, staff_id, fields, *, public_summary,
                     public_latitude=None, public_longitude=None, report_id=None,
                     public_area=None, public_time=None, fictional=False, reviewed_service_category=None, reviewed_demo=False,
                     assistance_requested=False):
    """Save approved fields, or link a reviewed report to a verified incident."""
    from backend.map_data import AREAS, save_public_details

    with write_transaction(db):
        require_staff(db, staff_id, admin_only=True)
        if report_id is not None:
            report = get_or_raise(db, "SELECT * FROM reports WHERE id = ?", (report_id,), "Report")
            if report["reviewed_at"]:
                raise ValueError("This report has already been reviewed.")
            if report["incident_id"] != incident_id:
                get_or_raise(
                    db, "SELECT id FROM incidents WHERE id = ? AND verification_status = 'verified'",
                    (incident_id,), "Approved incident",
                )
                db.execute(
                    """UPDATE reports SET incident_id = ?, reviewed_by = ?,
                       reviewed_at = CURRENT_TIMESTAMP, reviewed_service_category = ? WHERE id = ?""",
                    (incident_id, staff_id, reviewed_service_category, report_id),
                )
                return

        summary = required_text(public_summary, "Public summary")
        if (public_latitude is None) != (public_longitude is None):
            raise ValueError("Provide both public coordinates or leave both blank.")
        if public_area in AREAS and public_latitude is None:
            public_latitude, public_longitude = AREAS[public_area]
        # Store the same generalized point that will be exposed publicly.
        if public_latitude is not None:
            public_latitude, public_longitude = round(public_latitude, 2), round(public_longitude, 2)
        result = db.execute(
            """UPDATE incidents
               SET incident_type = ?, city = ?, location = ?, incident_date = ?,
                   incident_time = ?, description = ?, verification_status = 'verified',
                   public_summary = ?, public_latitude = ?, public_longitude = ?,
                   approved_by = ?, approved_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (*incident_values(fields), summary, public_latitude, public_longitude,
             staff_id, incident_id),
        )
        if result.rowcount == 0:
            raise LookupError("Incident was not found.")
        save_public_details(db, incident_id, public_area, public_time, fictional, reviewed_demo, assistance_requested)
        if report_id is not None:
            db.execute(
                """UPDATE reports SET reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
                   reviewed_service_category = ? WHERE id = ?""", (staff_id, reviewed_service_category, report_id),
            )
        else:
            db.execute(
                """UPDATE reports SET reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
                   WHERE incident_id = ? AND reviewed_at IS NULL""", (staff_id, incident_id),
            )


def public_map_incidents(db, incident_id=None):
    """Return only explicitly public fields for approved incidents."""
    rows = db.execute(
        """SELECT i.id, i.incident_type, i.city, i.incident_date, i.public_summary,
                  (SELECT min(r.post_date) FROM reports r WHERE r.incident_id = i.id AND r.source <> 'manual') AS post_date,
                  'approved' AS verification_status, i.created_at,
                  round(i.public_latitude, 2) AS latitude, round(i.public_longitude, 2) AS longitude,
                  CASE
                      WHEN SUM(CASE WHEN c.status IN ('assistance_needed', 'needs_follow_up')
                                    THEN 1 ELSE 0 END) > 0 THEN 'assistance_needed'
                      WHEN SUM(CASE WHEN c.status IN ('in_progress', 'awaiting_confirmation')
                                    THEN 1 ELSE 0 END) > 0 THEN 'in_progress'
                      WHEN COUNT(c.id) > 0 THEN 'assistance_confirmed'
                      WHEN p.assistance_requested THEN 'assistance_needed'
                      ELSE 'no_service_case'
                  END AS service_status
           FROM incidents i LEFT JOIN service_cases c ON c.incident_id = i.id
           LEFT JOIN map_public_details p ON p.incident_id = i.id
           WHERE i.verification_status = 'verified'
             AND length(trim(i.public_summary)) > 0
             AND NOT EXISTS (SELECT 1 FROM map_public_details p WHERE p.incident_id = i.id AND p.fictional = 1)
             AND (? IS NULL OR i.id = ?)
           GROUP BY i.id ORDER BY i.id""", (incident_id, incident_id)
    )
    return [dict(row) for row in rows]


def case_history(db, case_id, staff_id):
    case = get_or_raise(
        db, """SELECT sc.*, coalesce(c.email_opt_in, 0) AS confirmation_available
               FROM service_cases sc LEFT JOIN contacts c ON c.id = sc.contact_id WHERE sc.id = ?""",
        (case_id,), "Case",
    )
    require_staff(db, staff_id, organization=case["organization"])
    updates = db.execute(
        "SELECT * FROM service_updates WHERE case_id = ? ORDER BY id", (case_id,)
    )
    return {"case": dict(case), "updates": [dict(row) for row in updates]}


def open_service_case(db, incident_id, staff_id, organization, *, contact_id=None,
                      approved_only=False):
    organization = required_text(organization, "Organization")
    with write_transaction(db):
        require_staff(db, staff_id, organization=organization)
        incident = get_or_raise(db, "SELECT * FROM incidents WHERE id = ?", (incident_id,), "Incident")
        if approved_only and incident["verification_status"] != "verified":
            raise ValueError("Approve the incident before opening a service case.")
        get_or_raise(db, "SELECT id FROM organizations WHERE id = ?", (organization,), "Organization")
        existing = db.execute(
            "SELECT id FROM service_cases WHERE incident_id = ? AND organization = ? ORDER BY id",
            (incident_id, organization),
        ).fetchone()
        if existing:
            return existing["id"]
        if contact_id is not None:
            get_or_raise(
                db, "SELECT id FROM reports WHERE incident_id = ? AND contact_id = ?",
                (incident_id, contact_id), "Reporter contact for this incident",
            )
        return db.execute(
            """INSERT INTO service_cases (incident_id, organization, contact_id)
               VALUES (?, ?, ?)""",
            (incident_id, organization, contact_id),
        ).lastrowid


def token_hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def record_service_progress(db, case_id, staff_id, status, *, notes=None):
    """Record worker progress and queue a notice in the same transaction."""
    transitions = {
        "in_progress": {"assistance_needed", "needs_follow_up"},
        "completed": {"in_progress", "needs_follow_up"},
    }
    if status not in transitions:
        raise ValueError("Worker status must be in_progress or completed.")

    with write_transaction(db):
        case = get_or_raise(db, "SELECT * FROM service_cases WHERE id = ?", (case_id,), "Case")
        require_staff(db, staff_id, organization=case["organization"])
        if case["status"] not in transitions[status]:
            raise ValueError(f"Cannot move from {case['status']} to {status}.")
        new_status = "awaiting_confirmation" if status == "completed" else status
        update_id = db.execute(
            """INSERT INTO service_updates (case_id, staff_id, status, notes, worker_action)
               VALUES (?, ?, ?, ?, ?)""",
            (case_id, staff_id, new_status, optional_text(notes), status),
        ).lastrowid
        db.execute("UPDATE service_cases SET status = ? WHERE id = ?", (new_status, case_id))

        contact = db.execute(
            "SELECT id FROM contacts WHERE id = ? AND email_opt_in = 1",
            (case["contact_id"],),
        ).fetchone()
        if contact is not None:
            token = secrets.token_urlsafe(32) if status == "completed" else None
            digest = token_hash(token) if token is not None else None
            db.execute(
                """INSERT INTO notifications (update_id, contact_id, token_hash, pending_token)
                   VALUES (?, ?, ?, ?)""",
                (update_id, contact["id"], digest, token),
            )
    return update_id


def deliver_notification(db, notice_id, send):
    """Send or retry a notice. Run one delivery worker for this SQLite demo.

    send receives (email, message, confirmation_token_or_none, notice_id).
    Have the adapter create the HTTPS link and use notice_id for deduplication
    if supported by the email provider. The callback should raise on failure.
    """
    with write_transaction(db):
        notice = get_or_raise(
            db,
            """SELECT n.*, c.email, c.email_opt_in, u.status AS service_status
               FROM notifications n JOIN contacts c ON c.id = n.contact_id
               JOIN service_updates u ON u.id = n.update_id WHERE n.id = ?""",
            (notice_id,), "Notification",
        )
        if notice["status"] == "sent" or not notice["email_opt_in"]:
            return False
        try:
            send(notice["email"], NOTICE_MESSAGES[notice["service_status"]],
                 notice["pending_token"], notice_id)
        except Exception as error:
            db.execute(
                """UPDATE notifications
                   SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?""",
                (type(error).__name__, notice_id),
            )
            return False

        now = datetime.now(timezone.utc)
        expires = (now + timedelta(hours=72)).isoformat() if notice["pending_token"] else None
        db.execute(
            """UPDATE notifications SET status = 'sent', sent_at = ?, expires_at = ?,
               pending_token = NULL, attempts = attempts + 1, last_error = NULL WHERE id = ?""",
            (now.isoformat(), expires, notice_id),
        )
        return True


def pending_notification_ids(db):
    return [
        row["id"] for row in db.execute(
            """SELECT n.id FROM notifications n JOIN contacts c ON c.id = n.contact_id
               WHERE n.status IN ('queued', 'failed') AND c.email_opt_in = 1 ORDER BY n.id"""
        )
    ]


def active_confirmation(db, token, now):
    return db.execute(
        """SELECT n.id, n.update_id, u.case_id FROM notifications n
           JOIN service_updates u ON u.id = n.update_id
           JOIN service_cases c ON c.id = u.case_id
           WHERE n.token_hash = ? AND n.status = 'sent'
             AND n.used_at IS NULL AND n.expires_at > ?
             AND c.status = 'awaiting_confirmation'
             AND u.id = (SELECT MAX(id) FROM service_updates WHERE case_id = u.case_id)""",
        (token_hash(required_text(token, "Confirmation token")), now),
    ).fetchone()


def record_confirmation(db, token, decision, *, notes=None):
    """Consume a delivered, unexpired token and record a recipient response."""
    outcomes = {"confirm": "assistance_confirmed", "dispute": "needs_follow_up"}
    if decision not in outcomes:
        raise ValueError("Decision must be confirm or dispute.")
    with write_transaction(db):
        now = datetime.now(timezone.utc).isoformat()
        notice = active_confirmation(db, token, now)
        if notice is None:
            raise ValueError("Invalid, expired, or already used confirmation link.")
        status = outcomes[decision]
        db.execute("UPDATE notifications SET used_at = ? WHERE id = ?", (now, notice["id"]))
        db.execute(
            """INSERT INTO service_updates (case_id, status, notes, response_to)
               VALUES (?, ?, ?, ?)""",
            (notice["case_id"], status, optional_text(notes), notice["update_id"]),
        )
        db.execute("UPDATE service_cases SET status = ? WHERE id = ?", (status, notice["case_id"]))
        return status


def run_demo(db, decision):
    """Show a synthetic resident-to-provider workflow with an in-memory inbox."""
    register_staff(db, "demo-admin", "ComForce", role="admin")
    register_staff(db, "demo-worker", "ComForce")
    report = submit_report(
        db, "A resident requested transportation after a road closure.",
        email="resident@example.test", email_opt_in=True,
    )
    fields = {
        "incident_type": "Road closure", "city": "Milwaukee",
        "description": "A resident requested transportation after a road closure.",
    }
    save_parsed_report(db, report["report_id"], fields)
    parsed = json.loads(review_queue(db, "demo-admin")[0]["parser_output"])
    incident = report["incident_id"]
    approve_incident(
        db, incident, "demo-admin", parsed, public_summary="Road closure in Milwaukee.",
        public_latitude=43.039, public_longitude=-87.906,
    )
    tip = add_tip(db, incident, "The west end was also closed.", email="tipster@example.test")
    case = open_service_case(
        db, incident, "demo-admin", "ComForce", contact_id=report["contact_id"],
    )
    for status in ("in_progress", "completed"):
        record_service_progress(db, case, "demo-worker", status)

    inbox = []

    def show_inbox(email, message, token, notice_id):
        inbox.append(token)
        print(f"Demo email {notice_id} to {email}\n  {message}")

    for notice_id in pending_notification_ids(db):
        deliver_notification(db, notice_id, show_inbox)
    status = record_confirmation(db, inbox[-1], decision)
    print(f"Report {report['report_id']} and tip {tip} are linked to incident {incident}.")
    print(f"Final case status: {status}")
    print("Public map response:")
    print(json.dumps(public_map_incidents(db), indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=Path(os.getenv("COMFORCE_DB", "milwaukee-heatmap.sqlite3")))
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init", help="Create the database and tables.")
    import_command = commands.add_parser("import-csv", help="Load a USFiR CSV.")
    import_command.add_argument("csv", type=Path)
    import_command.add_argument("--source", default="usfir")
    demo = commands.add_parser("demo", help="Try the workflow in a temporary database.")
    demo.add_argument("--decision", choices=("confirm", "dispute"), default="confirm")
    args = parser.parse_args()

    try:
        if args.command == "demo":
            with TemporaryDirectory() as folder:
                with closing(connect(Path(folder) / "demo.sqlite3")) as db:
                    init_db(db)
                    run_demo(db, args.decision)
            return

        with closing(connect(args.db)) as db:
            init_db(db)
            if args.command == "init":
                print(f"SQLite database ready at {args.db.resolve()}")
            else:
                result = import_csv(db, args.csv, source=args.source)
                print(f"Imported {result['imported']} reports. Skipped {result['skipped']} duplicates.")
    except (OSError, sqlite3.Error, ValueError, LookupError, PermissionError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
