"""Report analysis and optional legacy incident field parsing."""

import importlib
import json
from collections.abc import Callable
from datetime import date, time

from ai.backend_adapter import AIUnavailable, parse_report as categorize
from backend.comforce_db import INCIDENT_FIELDS, get_or_raise, incident_values


def load_parser(spec: str | None) -> Callable[[str], dict]:
    if not spec:
        return categorize
    module, function = spec.split(":", 1)
    return getattr(importlib.import_module(module), function)


def parse_report(db, report_id, parser):
    report = get_or_raise(db, "SELECT * FROM reports WHERE id = ?", (report_id,), "Report")
    if report["source"] != "manual" or report["reviewed_at"]:
        raise ValueError("Only pending manual reports can be parsed.")
    try:
        analysis = parser(report["original_text"])
        fields = dict(zip(INCIDENT_FIELDS, incident_values(analysis)))
        for field, converter in (("incident_date", date), ("incident_time", time)):
            value = fields[field]
            if value:
                try:
                    fields[field] = converter.fromisoformat(value).isoformat()
                except ValueError:
                    fields[field] = None
        output = json.dumps(fields, ensure_ascii=False) if any(fields.values()) else None
        status, ai_status = "parsed", "ready" if analysis.get("ai_summary") else None
    except AIUnavailable:
        output, status, ai_status, analysis = None, "failed", "unavailable", {}
    except Exception:
        output, status, ai_status, analysis = None, "failed", "failed", {}
    db.execute(
        """UPDATE reports SET parser_output = COALESCE(?, parser_output), parse_status = ?,
               ai_status = ?, ai_summary = COALESCE(?, ai_summary),
               suggested_service_category = CASE WHEN ? = 'ready' THEN ? ELSE suggested_service_category END,
               suggested_team = CASE WHEN ? = 'ready' THEN ? ELSE suggested_team END,
               needs_review = COALESCE(?, needs_review)
           WHERE id = ? AND reviewed_at IS NULL""",
        (output, status, ai_status, analysis.get("ai_summary"),
         ai_status, analysis.get("suggested_service_category"),
         ai_status, analysis.get("suggested_team"), analysis.get("needs_review"), report_id),
    )
    return status
