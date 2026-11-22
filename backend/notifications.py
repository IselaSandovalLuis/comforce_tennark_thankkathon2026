"""Outbox delivery. The default adapter writes to a private SQLite demo inbox."""

import os
import smtplib
from email.message import EmailMessage

from backend.comforce_db import deliver_notification, pending_notification_ids


def email_adapter(db, public_origin):
    def send(email, message, token, notice_id):
        response_url = f"{public_origin}/api/response/{token}" if token else None
        if os.getenv("COMFORCE_EMAIL_MODE", "demo") != "smtp":
            db.execute(
                """INSERT INTO demo_inbox (notification_id, email, message, response_url)
                   VALUES (?, ?, ?, ?) ON CONFLICT(notification_id) DO NOTHING""",
                (notice_id, email, message, response_url),
            )
            return

        if not public_origin.startswith("https://"):
            raise ValueError("Set COMFORCE_PUBLIC_ORIGIN to your HTTPS site for live delivery.")
        message_to_send = EmailMessage()
        message_to_send["From"] = os.environ["COMFORCE_SMTP_FROM"]
        message_to_send["To"] = email
        message_to_send["Subject"] = "ComForce MKE service update"
        message_to_send["Message-ID"] = f"<comforce-{notice_id}@{message_to_send['From'].addresses[0].domain}>"
        message_to_send.set_content(f"{message}\n\n{response_url}" if response_url else message)
        with smtplib.SMTP_SSL(
            os.environ["COMFORCE_SMTP_HOST"], int(os.getenv("COMFORCE_SMTP_PORT", "465")), timeout=5,
        ) as smtp:
            smtp.login(os.environ["COMFORCE_SMTP_USERNAME"], os.environ["COMFORCE_SMTP_PASSWORD"])
            smtp.send_message(message_to_send)

    return send


def deliver_pending(db, adapter, *, include_failed=False):
    if include_failed:
        ids = pending_notification_ids(db)
    else:
        ids = [
            row["id"] for row in db.execute("SELECT id FROM notifications WHERE status = 'queued' ORDER BY id")
        ]
    return sum(deliver_notification(db, notice_id, adapter) for notice_id in ids)
