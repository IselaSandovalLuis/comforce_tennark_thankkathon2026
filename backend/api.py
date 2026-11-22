"""FastAPI application for the desktop and mobile ComForce views."""

import os
import secrets
import re
from contextlib import asynccontextmanager, closing
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import parse_qs

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool

from ai.report_schema import ServiceCategory
from backend import comforce_db as storage
from backend import map_data, notifications, parser, queries, staff_auth
from backend.migrations import DEPARTMENTS

load_dotenv(Path(__file__).with_name(".env"))

ShortText = Annotated[str, Field(max_length=250)]
LongText = Annotated[str, Field(max_length=5000)]
Note = Annotated[str, Field(max_length=2000)]


class Contact(BaseModel):
    name: ShortText | None = None
    email: ShortText | None = None
    phone: ShortText | None = None

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        value = storage.optional_text(value)
        if value and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address.")
        return value


class IncidentFields(BaseModel):
    incident_type: ShortText | None = None
    city: ShortText | None = None
    location: ShortText | None = None
    incident_date: ShortText | None = None
    incident_time: ShortText | None = None
    description: LongText | None = None

    @field_validator("incident_date", "incident_time")
    @classmethod
    def valid_incident_time(cls, value, info):
        value = storage.optional_text(value)
        if value is None:
            return None
        try:
            convert = date.fromisoformat if info.field_name == "incident_date" else time.fromisoformat
            return convert(value).isoformat()
        except ValueError as error:
            raise ValueError("Use YYYY-MM-DD for incident dates and HH:MM for incident times.") from error


class ReportInput(Contact):
    narrative: LongText
    location: ShortText | None = None
    anonymous: bool = False
    email_opt_in: bool = False
    department: str = "comforce"
    reporter_suggestions: IncidentFields | None = None

    @field_validator("department")
    @classmethod
    def known_department(cls, value):
        value = value.strip().lower()
        if value not in DEPARTMENTS:
            raise ValueError("Choose a valid department.")
        return value


class TipInput(Contact):
    tip_text: LongText


class LoginInput(BaseModel):
    username: ShortText
    password: Annotated[str, Field(max_length=128)]


class ReviewInput(BaseModel):
    assistance_requested: bool = False
    service_category: ServiceCategory | None = None
    incident_id: int | None = None
    fields: IncidentFields = Field(default_factory=IncidentFields)
    public_summary: LongText | None = None
    public_area: ShortText | None = None
    public_time: ShortText | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class CaseInput(BaseModel):
    incident_id: int
    organization: ShortText | None = None
    contact_id: int | None = None


class ProgressInput(BaseModel):
    status: Literal["in_progress", "completed"]
    notes: Note | None = None


def database_path():
    return Path(os.getenv("COMFORCE_DB", "milwaukee-together.sqlite3"))


def create_app(db_path=None, *, parse=None, adapter_factory=notifications.email_adapter):
    path = db_path or database_path()

    @asynccontextmanager
    async def lifespan(app):
        with closing(storage.connect(path)) as db:
            storage.init_db(db)
            if db_path is None:
                storage.import_csv(db, Path(__file__).resolve().parent.parent / "data" / "usfir_incidents.csv")
        app.state.parser = parse or parser.load_parser(os.getenv("COMFORCE_PARSER"))
        yield

    app = FastAPI(title="ComForce MKE", lifespan=lifespan)

    @app.middleware("http")
    async def protect_responses(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Referrer-Policy"] = "no-referrer"
        return response

    def database():
        with closing(storage.connect(path)) as db:
            yield db

    def staff(request: Request, db=Depends(database)):
        account = staff_auth.current_staff(db, request.cookies.get(staff_auth.SESSION_COOKIE))
        if account is None:
            raise HTTPException(401, "Sign in with a provisioned staff account.")
        return account

    def admin(account=Depends(staff)):
        if account["role"] != "admin":
            raise HTTPException(403, "Reviewer access required.")
        return account

    for error_type, code in ((LookupError, 404), (PermissionError, 403), (ValueError, 400)):
        def handler(status):
            async def error_response(request, error):
                return JSONResponse({"detail": str(error)}, status_code=status)
            return error_response
        app.add_exception_handler(error_type, handler(code))

    def identity(account):
        return {"username": account["id"], "organization": account["organization"], "role": account["role"]}

    @app.post("/api/staff/login")
    def login(data: LoginInput, response: Response, db=Depends(database)):
        username = data.username.strip().lower()
        token = staff_auth.login(db, username, data.password)
        if not token:
            raise HTTPException(401, "Incorrect username or password.")
        response.set_cookie(
            staff_auth.SESSION_COOKIE, token, httponly=True, samesite="strict",
            secure=os.getenv("COMFORCE_SECURE_COOKIES") == "1", max_age=staff_auth.SESSION_SECONDS,
        )
        return identity(staff_auth.current_staff(db, token))

    @app.get("/api/staff/me")
    def me(account=Depends(staff)):
        return identity(account)

    @app.post("/api/staff/logout")
    def logout(request: Request, response: Response, db=Depends(database)):
        token = request.cookies.get(staff_auth.SESSION_COOKIE)
        if token:
            db.execute("DELETE FROM staff_sessions WHERE token_hash = ?", (storage.token_hash(token),))
        response.delete_cookie(staff_auth.SESSION_COOKIE)
        return {"signed_out": True}

    @app.get("/api/map/areas")
    def public_areas():
        return list(map_data.AREAS)

    @app.get("/api/map/incidents")
    def active_map(view: Literal["active", "completed", "all"] = "active", db=Depends(database)):
        return map_data.active_incidents(db, view=view)

    @app.get("/api/staff/map-action/{incident_id}")
    def map_action(incident_id: int, account=Depends(staff), db=Depends(database)):
        if not queries.can_open_incident(db, incident_id, account):
            raise HTTPException(404, "Incident unavailable to your organization.")
        case = db.execute(
            """SELECT id FROM service_cases WHERE incident_id = ?
               AND (? = 'admin' OR organization = ?)
               ORDER BY (status = 'assistance_confirmed'), (organization <> ?), id LIMIT 1""",
            (incident_id, account["role"], account["organization"], account["organization"]),
        ).fetchone()
        return {"case_id": case["id"] if case else None, "can_view_report": bool(case) or account["role"] == "admin"}

    @app.get("/api/incidents")
    def pins(db=Depends(database)):
        return storage.public_map_incidents(db)

    @app.get("/api/incidents/{incident_id}")
    def public_incident(incident_id: int, db=Depends(database)):
        matches = storage.public_map_incidents(db, incident_id)
        if not matches:
            raise HTTPException(404, "Public incident was not found.")
        return matches[0]

    @app.post("/api/reports", status_code=201)
    def submit(data: ReportInput, db=Depends(database)):
        secret = secrets.token_urlsafe(32)
        saved = storage.submit_report(
            db, data.narrative, name=data.name, email=data.email, phone=data.phone,
            email_opt_in=data.email_opt_in, department=data.department, submitted_location=data.location,
            tracking_hash=storage.token_hash(secret), anonymous=data.anonymous,
            reporter_suggestions=data.reporter_suggestions.model_dump_json() if data.reporter_suggestions else None,
        )
        report_id = saved["report_id"]
        status = parser.parse_report(db, report_id, app.state.parser)
        result = db.execute("SELECT ai_status FROM reports WHERE id = ?", (report_id,)).fetchone()
        return {
            "ai_status": result["ai_status"], "report_id": report_id, "incident_id": saved["incident_id"],
            "parse_status": status, "tracking_key": secret,
        }

    @app.get("/api/reports/{report_id}/status")
    def tracking(report_id: int, tracking_key: Annotated[str, Header(alias="X-Report-Key")] = "",
                 db=Depends(database)):
        return queries.tracked_report(db, report_id, tracking_key)

    @app.post("/api/incidents/{incident_id}/tips", status_code=201)
    def tip(incident_id: int, data: TipInput, db=Depends(database)):
        storage.get_or_raise(db, """SELECT id FROM incidents WHERE id = ?
                             AND verification_status = 'verified' AND length(trim(public_summary)) > 0""",
                             (incident_id,), "Public incident")
        tip_id = storage.add_tip(db, incident_id, data.tip_text, name=data.name, email=data.email, phone=data.phone)
        return {"tip_id": tip_id, "incident_id": incident_id}

    @app.get("/api/staff/review")
    def review_queue(account=Depends(admin), db=Depends(database)):
        return [dict(row) for row in db.execute(
            """SELECT r.id, r.incident_id, r.parse_status, r.ai_status, r.source, r.post_id, i.incident_type
               FROM reports r JOIN incidents i ON i.id = r.incident_id
               WHERE r.reviewed_at IS NULL ORDER BY (r.source = 'manual') DESC, r.id DESC"""
        )]

    @app.post("/api/staff/reports/{report_id}/parse")
    def retry_parse(report_id: int, account=Depends(admin), db=Depends(database)):
        return {"parse_status": parser.parse_report(db, report_id, app.state.parser)}

    @app.post("/api/staff/reports/{report_id}/review")
    def approve(report_id: int, data: ReviewInput, account=Depends(admin), db=Depends(database)):
        original = storage.get_or_raise(db, "SELECT incident_id FROM reports WHERE id = ?", (report_id,), "Report")
        target = data.incident_id if data.incident_id is not None else original["incident_id"]
        storage.approve_incident(
            db, target, account["id"], data.fields.model_dump(), public_summary=data.public_summary,
            public_latitude=data.latitude, public_longitude=data.longitude, report_id=report_id,
            public_area=data.public_area, public_time=data.public_time,
            reviewed_service_category=data.service_category, assistance_requested=data.assistance_requested,
        )
        return {"incident_id": target}

    @app.post("/api/staff/reports/{report_id}/decline")
    def decline(report_id: int, account=Depends(admin), db=Depends(database)):
        saved = db.execute(
            """UPDATE reports SET reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, publication_declined = 1
               WHERE id = ? AND reviewed_at IS NULL""",
            (account["id"], report_id),
        )
        if not saved.rowcount:
            raise HTTPException(409, "Report is unavailable for review.")
        return {"declined": True}

    @app.get("/api/staff/incidents")
    def eligible(account=Depends(staff), db=Depends(database)):
        return queries.eligible_incidents(db, account)

    @app.get("/api/staff/incidents/{incident_id}")
    def incident_for_staff(incident_id: int, account=Depends(staff), db=Depends(database)):
        if account["role"] != "admin":
            storage.get_or_raise(
                db, "SELECT id FROM service_cases WHERE incident_id = ? AND organization = ?",
                (incident_id, account["organization"]), "Organization case",
            )
        return queries.incident_details(
            db, incident_id, organization=account['organization'] if account['role'] != 'admin' else None,
        )

    @app.get("/api/staff/cases")
    def cases(account=Depends(staff), db=Depends(database)):
        rows = db.execute(
            """SELECT id FROM service_cases WHERE ? = 'admin' OR organization = ?
               ORDER BY (status = 'needs_follow_up') DESC, id DESC""",
            (account["role"], account["organization"]),
        )
        result = []
        for row in rows:
            item = storage.case_history(db, row["id"], account["id"])
            item["incident"] = dict(storage.get_or_raise(
                db, """SELECT id, incident_type, location, created_at, public_summary,
                              verification_status FROM incidents WHERE id = ?""",
                (item["case"]["incident_id"],), "Incident",
            ))
            result.append(item)
        return result

    @app.get("/api/staff/cases/{case_id}")
    def case(case_id: int, account=Depends(staff), db=Depends(database)):
        return storage.case_history(db, case_id, account["id"])

    @app.post("/api/staff/cases", status_code=201)
    def open_case(data: CaseInput, account=Depends(staff), db=Depends(database)):
        organization = data.organization or account["organization"]
        storage.require_staff(db, account["id"], organization=organization)
        if not queries.can_open_incident(db, data.incident_id, account):
            raise HTTPException(403, "This incident is outside your organization’s access.")
        contact_id = data.contact_id
        if contact_id is None:
            # Prefer the earliest opted-in submitter routed to this organization.
            contact = db.execute(
                """SELECT c.id FROM contacts c JOIN reports r ON r.contact_id = c.id
                   WHERE r.incident_id = ? AND c.email_opt_in = 1
                     AND lower(r.requested_department) IN ('comforce', ?)
                   ORDER BY r.id LIMIT 1""", (data.incident_id, organization),
            ).fetchone()
            contact_id = contact["id"] if contact else None
        if contact_id is not None and account["role"] != "admin":
            storage.get_or_raise(
                db, """SELECT id FROM reports WHERE incident_id = ? AND contact_id = ?
                       AND lower(requested_department) IN ('comforce', ?)""",
                (data.incident_id, contact_id, organization), "Eligible reporter contact",
            )
        return {"case_id": storage.open_service_case(
            db, data.incident_id, account["id"], organization, contact_id=contact_id, approved_only=True,
        )}

    def deliver(db, *, retry=False):
        origin = os.getenv("COMFORCE_PUBLIC_ORIGIN", "http://localhost:5180").rstrip("/")
        return notifications.deliver_pending(db, adapter_factory(db, origin), include_failed=retry)

    @app.post("/api/staff/cases/{case_id}/updates", status_code=201)
    def update(case_id: int, data: ProgressInput, account=Depends(staff), db=Depends(database)):
        update_id = storage.record_service_progress(db, case_id, account["id"], data.status, notes=data.notes)
        # The update and outbox row commit first. The demo delivers queued messages immediately.
        if os.getenv("COMFORCE_EMAIL_MODE", "demo") == "demo":
            notice = db.execute("SELECT id FROM notifications WHERE update_id = ?", (update_id,)).fetchone()
            if notice:
                origin = os.getenv("COMFORCE_PUBLIC_ORIGIN", "http://localhost:5180").rstrip("/")
                storage.deliver_notification(db, notice["id"], adapter_factory(db, origin))
        return {"update_id": update_id}

    @app.get("/api/staff/outbox")
    def outbox(account=Depends(admin), db=Depends(database)):
        return [dict(row) for row in db.execute(
            """SELECT id, update_id, status, attempts, last_error, sent_at
               FROM notifications ORDER BY id DESC"""
        )]

    @app.post("/api/staff/outbox/retry")
    def retry_delivery(account=Depends(admin), db=Depends(database)):
        if os.getenv("COMFORCE_EMAIL_MODE", "demo") == "smtp":
            # SMTP has its own explicit delivery command.
            raise HTTPException(409, "Run the SMTP delivery command to process the live outbox.")
        return {"delivered": deliver(db, retry=True)}

    @app.get("/api/staff/demo-inbox")
    def demo_inbox(account=Depends(admin), db=Depends(database)):
        return [dict(row) for row in db.execute("SELECT * FROM demo_inbox ORDER BY notification_id DESC")]

    def response_page(body, status=200):
        return HTMLResponse(
            '<!doctype html><html lang="en"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>ComForce MKE assistance response</title>'
            '<style>body{font:1rem system-ui;color:#16382f;background:#eef3ee;'
            'max-width:36rem;margin:4rem auto;padding:0 1rem}textarea,button{font:inherit}'
            'textarea{width:100%}button{margin:.5rem .5rem .5rem 0;padding:.5rem}</style>'
            '<main><h1>ComForce MKE assistance response</h1>' + body + '</main></html>',
            status_code=status,
            headers={"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"},
        )

    invalid_link = "<p>This response link has expired, has been used, or is no longer current.</p>"

    @app.get("/api/response/{token}", response_class=HTMLResponse)
    def choose_response(token: str, db=Depends(database)):
        if not storage.active_confirmation(db, token, datetime.now(timezone.utc).isoformat()):
            return response_page(invalid_link, 410)
        return response_page(
            '<p>A provider marked assistance complete. Did you receive the assistance?</p>'
            '<form method="post"><p><label for="response-note">Optional note</label></p>'
            '<textarea id="response-note" name="notes" rows="4" maxlength="2000"></textarea>'
            '<p><button name="decision" value="confirm">Confirm assistance</button>'
            '<button name="decision" value="dispute">Report an issue</button></p></form>'
        )

    @app.post("/api/response/{token}", response_class=HTMLResponse)
    async def submit_response(token: str, request: Request):
        if request.headers.get("content-type", "").split(";")[0] != "application/x-www-form-urlencoded":
            return response_page("<p>Submit a response using the form.</p>", 415)
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 24_000:
                return response_page("<p>The response is too long.</p>", 413)
        try:
            form = parse_qs(body.decode("utf-8", errors="replace"), max_num_fields=5)
        except ValueError:
            return response_page("<p>The response form could not be read.</p>", 400)
        decision = form.get("decision", [""])[0]
        notes = form.get("notes", [""])[0]
        if decision not in {"confirm", "dispute"} or len(notes) > 2000:
            return response_page("<p>Choose a response and use at most 2,000 characters.</p>", 400)
        # Use the synchronous database on a worker thread, like the other routes.
        def save():
            with closing(storage.connect(path)) as db:
                return storage.record_confirmation(db, token, decision, notes=notes)

        try:
            status = await run_in_threadpool(save)
        except ValueError:
            return response_page(invalid_link, 410)
        return response_page("<p>Assistance confirmed. Thank you.</p>" if status == "assistance_confirmed"
                             else "<p>Your issue was recorded for staff follow-up.</p>")

    return app


app = create_app()
