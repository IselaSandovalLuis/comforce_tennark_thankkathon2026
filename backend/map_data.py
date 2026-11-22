"""Public incident projections for the active map and reviewer-approved areas."""

from datetime import date, time

# Coarse reference points for named public areas, never derived from a private address.
AREAS = {
    "Downtown": (43.04, -87.91),
    "Harambee": (43.06, -87.91),
    "Riverwest": (43.07, -87.90),
    "Washington Park": (43.05, -87.96),
    "Sherman Park": (43.07, -87.98),
    "Near West Side": (43.04, -87.95),
    "Bay View": (42.99, -87.90),
    "Lincoln Village": (43.00, -87.93),
    "West Capitol Drive": (43.09, -88.03),
    "Southwest Milwaukee": (42.95, -87.95),
}


def migrate_map(db, transaction):
    with transaction(db):
        db.execute("""CREATE TABLE IF NOT EXISTS map_public_details (
            incident_id INTEGER PRIMARY KEY REFERENCES incidents(id),
            area TEXT, public_time TEXT, fictional INTEGER NOT NULL DEFAULT 0
        )""")
        columns = {column["name"] for column in db.execute("PRAGMA table_info(map_public_details)")}
        for name in ("reviewed_demo", "assistance_requested"):
            if name not in columns:
                db.execute(f"ALTER TABLE map_public_details ADD COLUMN {name} INTEGER NOT NULL DEFAULT 0")


def save_public_details(db, incident_id, area, public_time, fictional, reviewed_demo=False, assistance_requested=False):
    if area is not None and area not in AREAS:
        raise ValueError("Choose a supported general public area.")
    if public_time:
        try:
            public_time = time.fromisoformat(public_time).strftime("%H:00")
        except ValueError as error:
            raise ValueError("Enter a valid public time.") from error
    db.execute("""INSERT INTO map_public_details (incident_id, area, public_time, fictional, reviewed_demo, assistance_requested)
                  VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (incident_id) DO UPDATE SET
                  area = excluded.area, public_time = excluded.public_time,
                  fictional = MAX(map_public_details.fictional, excluded.fictional),
                  reviewed_demo = MAX(map_public_details.reviewed_demo, excluded.reviewed_demo),
                  assistance_requested = excluded.assistance_requested""",
               (incident_id, area, public_time, int(fictional), int(reviewed_demo), int(assistance_requested)))


def public_point(lat, lon):
    if lat is None or lon is None:
        return None, None
    # Geofenced to the Milwaukee city area and generalized to a roughly 1 km grid.
    if not (42.90 <= lat <= 43.21 and -88.10 <= lon <= -87.85):
        return None, None
    return round(lat, 2), round(lon, 2)


def iso_date(value):
    try:
        return date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        return None


def active_incidents(db, *, view="active"):
    """Project approved Milwaukee records by service lifecycle."""
    rows = db.execute("""
        WITH case_rollup AS (
            SELECT incident_id,
                max(status = 'assistance_needed') AS pending,
                max(status = 'in_progress') AS working,
                max(status = 'awaiting_confirmation' AND coalesce(contact.email_opt_in, 0) = 1) AS awaiting,
                max(status = 'awaiting_confirmation' AND coalesce(contact.email_opt_in, 0) = 0) AS unconfirmed,
                max(status = 'needs_follow_up') AS follow_up,
                min(status = 'assistance_confirmed') AS all_confirmed
            FROM service_cases LEFT JOIN contacts contact ON contact.id = service_cases.contact_id
            GROUP BY incident_id
        ), imports AS (
            SELECT incident_id, min(post_date) AS post_date
            FROM reports WHERE source <> 'manual' GROUP BY incident_id
        )
        SELECT i.id, i.incident_type, i.incident_date, i.public_summary,
               i.public_latitude, i.public_longitude, p.area, p.public_time, p.reviewed_demo,
               imports.incident_id IS NOT NULL AS imported, imports.post_date,
               CASE WHEN c.all_confirmed THEN 'assistance_confirmed'
                    WHEN c.follow_up THEN 'needs_follow_up'
                    WHEN c.working THEN 'in_progress'
                    WHEN c.awaiting THEN 'awaiting_confirmation'
                    WHEN c.pending THEN 'referral_pending'
                    WHEN c.unconfirmed THEN 'completed_unconfirmed'
                    WHEN p.assistance_requested AND c.incident_id IS NULL THEN 'assistance_needed'
                    ELSE 'no_service_case' END AS service_status,
               CASE WHEN c.all_confirmed THEN 'confirmed'
                    WHEN c.awaiting THEN 'awaiting_confirmation'
                    WHEN c.follow_up THEN 'needs_follow_up'
                    ELSE 'not_requested' END AS verification_status
        FROM incidents i
        LEFT JOIN map_public_details p ON p.incident_id = i.id
        LEFT JOIN case_rollup c ON c.incident_id = i.id
        LEFT JOIN imports ON imports.incident_id = i.id
        WHERE lower(trim(i.city)) = 'milwaukee' AND i.verification_status = 'verified'
          AND length(trim(i.public_summary)) > 0 AND coalesce(p.fictional, 0) = 0
          AND (? = 'all' OR coalesce(c.all_confirmed, 0) = (? = 'completed'))
        ORDER BY i.id
    """, (view, view)).fetchall()
    result = []
    for row in rows:
        latitude, longitude = public_point(row["public_latitude"], row["public_longitude"])
        date_of_incident = iso_date(row["incident_date"])
        result.append({
            "id": row["id"], "incident_type": row["incident_type"],
            "public_summary": row["public_summary"],
            "area": row["area"], "latitude": latitude, "longitude": longitude,
            "date": date_of_incident or iso_date(row["post_date"]),
            "date_basis": "incident" if date_of_incident else "source_post",
            "approximate_time": row["public_time"] if date_of_incident else None,
            "source": "reviewed_demo" if row["reviewed_demo"] else "imported" if row["imported"] else "community",
            "service_status": row["service_status"], "verification_status": row["verification_status"],
        })
    return result
