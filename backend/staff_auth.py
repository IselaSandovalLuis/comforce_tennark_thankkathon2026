"""Password-backed local staff sign-in. Provision accounts from the setup command."""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from backend.comforce_db import get_or_raise, token_hash, write_transaction

SESSION_COOKIE = "comforce_staff"
SESSION_SECONDS = 8 * 60 * 60


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)


def provision_staff(db, staff_id, organization, role, password):
    if not staff_id.strip() or not 12 <= len(password) <= 128:
        raise ValueError("Enter a staff username and a password of 12–128 characters.")
    salt = secrets.token_bytes(16)
    digest = password_hash(password, salt)
    with write_transaction(db):
        get_or_raise(db, "SELECT id FROM organizations WHERE id = ?", (organization,), "Organization")
        db.execute(
            """INSERT INTO staff (id, organization, role) VALUES (?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET organization = excluded.organization, role = excluded.role""",
            (staff_id, organization, role),
        )
        db.execute(
            """INSERT INTO staff_credentials VALUES (?, ?, ?)
               ON CONFLICT(staff_id) DO UPDATE SET salt = excluded.salt, password_hash = excluded.password_hash""",
            (staff_id, salt, digest),
        )
        db.execute("DELETE FROM staff_sessions WHERE staff_id = ?", (staff_id,))


def login(db, username, password):
    credentials = db.execute("SELECT * FROM staff_credentials WHERE staff_id = ?", (username,)).fetchone()
    salt = credentials["salt"] if credentials else bytes(16)
    digest = password_hash(password, salt)
    if not credentials or not hmac.compare_digest(digest, credentials["password_hash"]):
        return None
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=SESSION_SECONDS)
    with write_transaction(db):
        # A credential rotation between validation and session creation invalidates this login.
        current = db.execute("SELECT password_hash FROM staff_credentials WHERE staff_id = ?", (username,)).fetchone()
        if not current or not hmac.compare_digest(digest, current["password_hash"]):
            return None
        db.execute("DELETE FROM staff_sessions WHERE expires_at <= ?", (now.isoformat(),))
        db.execute("INSERT INTO staff_sessions VALUES (?, ?, ?)", (token_hash(token), username, expires.isoformat()))
    return token


def current_staff(db, token):
    if not token:
        return None
    return db.execute(
        """SELECT s.* FROM staff_sessions ss JOIN staff s ON s.id = ss.staff_id
           WHERE ss.token_hash = ? AND ss.expires_at > ?""",
        (token_hash(token), datetime.now(timezone.utc).isoformat()),
    ).fetchone()
