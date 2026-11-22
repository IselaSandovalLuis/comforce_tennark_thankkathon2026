"""Explicitly approved, privacy-minimized excerpts for the local demonstration."""

import json

from backend.comforce_db import approve_incident, require_staff

# Approximate area presets only. Sources for the area assignments are in README.md.
EXCERPTS = (
    ("USFIR-000035", "Harambee", "A vehicle crash involving a motorcycle was reported near the Harambee and Riverwest boundary."),
    ("USFIR-000084", "Downtown", "Construction equipment reportedly overturned downtown."),
)


def publish(db, reviewer):
    require_staff(db, reviewer, admin_only=True)
    count = 0
    for post_id, area, summary in EXCERPTS:
        row = db.execute(
            """SELECT id, incident_id, imported_fields, reviewed_at
               FROM reports WHERE source = 'usfir' AND post_id = ?""", (post_id,),
        ).fetchone()
        if row is None or row["reviewed_at"]:
            continue
        fields = json.loads(row["imported_fields"])
        if fields["city"] != "Milwaukee":
            continue
        approve_incident(db, row["incident_id"], reviewer, fields, public_summary=summary,
                         public_area=area, report_id=row["id"], reviewed_demo=True)
        count += 1
    return count
