"""Read models for privacy and organization boundaries."""

import json

from backend.comforce_db import get_or_raise, token_hash


def incident_details(db, incident_id, *, organization=None):
    incident = dict(get_or_raise(db, "SELECT * FROM incidents WHERE id = ?", (incident_id,), "Incident"))
    reports = db.execute(
        """SELECT r.id, r.incident_id, r.source, r.post_id, r.post_url, r.post_date,
                  r.original_text, r.source_metadata, r.source_verification_status, r.related_post_urls,
                  r.manual_review_reason, r.requested_department, r.submitted_location,
                  r.reporter_suggestions, r.imported_fields, r.parser_output, r.parse_status,
                  r.created_at, r.reviewed_at, r.contact_id, c.name, c.email, c.phone, c.email_opt_in,
                  r.anonymous, r.ai_status, r.ai_summary, r.suggested_service_category, r.suggested_team,
                  r.needs_review, r.reviewed_service_category, r.publication_declined
           FROM reports r LEFT JOIN contacts c ON c.id = r.contact_id
           WHERE r.incident_id = ?
             AND (? IS NULL OR COALESCE(lower(r.requested_department), 'comforce') IN ('comforce', ?))
           ORDER BY r.id""", (incident_id, organization, organization),
    )
    incident["reports"] = [
        {**dict(row), **{key: json.loads(row[key]) if row[key] else None
                        for key in ("parser_output", "imported_fields", "reporter_suggestions", "source_metadata")}}
        for row in reports
    ]
    incident["tips"] = [
        dict(row) for row in db.execute(
            """SELECT t.id, t.tip_text, t.created_at, c.name, c.email, c.phone
               FROM tips t LEFT JOIN contacts c ON c.id = t.contact_id
               WHERE t.incident_id = ? ORDER BY t.id""", (incident_id,),
        )
    ]
    return incident


def eligible_incidents(db, staff):
    return [dict(row) for row in db.execute(
        """SELECT i.id, i.incident_type, i.city, i.public_summary
           FROM incidents i WHERE i.verification_status = 'verified'
             AND (? = 'admin' OR EXISTS (
               SELECT 1 FROM reports r WHERE r.incident_id = i.id
               AND COALESCE(lower(r.requested_department), 'comforce') IN ('comforce', ?)
             ) OR EXISTS (
               SELECT 1 FROM service_cases c WHERE c.incident_id = i.id AND c.organization = ?
             ))
           ORDER BY i.id DESC""", (staff["role"], staff["organization"], staff["organization"]),
    )]


def can_open_incident(db, incident_id, staff):
    return any(item["id"] == incident_id for item in eligible_incidents(db, staff))


def tracked_report(db, report_id, secret):
    report = get_or_raise(
        db,
        """SELECT r.id, r.incident_id, r.created_at, r.reviewed_at, r.publication_declined, r.ai_status,
                  COALESCE(r.requested_department, 'comforce') AS requested_department
           FROM reports r WHERE r.id = ? AND r.tracking_hash = ?""",
        (report_id, token_hash(secret)), "Report",
    )
    cases = db.execute(
        """SELECT sc.id, sc.organization, sc.status, coalesce(c.email_opt_in, 0) AS confirmation_available
           FROM service_cases sc LEFT JOIN contacts c ON c.id = sc.contact_id WHERE sc.incident_id = ? ORDER BY sc.id""",
        (report["incident_id"],),
    ).fetchall()
    return {**dict(report), "cases": [
        {**dict(case), "updates": [
            dict(update) for update in db.execute(
                """SELECT id, status, worker_action, response_to, created_at
                   FROM service_updates WHERE case_id = ? ORDER BY id""", (case["id"],),
            )
        ]} for case in cases
    ]}
