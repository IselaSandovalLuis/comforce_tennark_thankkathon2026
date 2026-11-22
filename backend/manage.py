"""Provision local staff or deliver the notification outbox."""

import argparse
import json
import os
from contextlib import closing
from getpass import getpass

from backend.api import database_path
from backend.comforce_db import connect, import_csv, init_db
from backend.notifications import deliver_pending, email_adapter
from backend.staff_auth import provision_staff


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    staff = commands.add_parser("staff")
    staff.add_argument("username")
    staff.add_argument("--organization", default="comforce")
    staff.add_argument("--role", choices=("admin", "worker"), default="worker")
    delivery = commands.add_parser("deliver")
    delivery.add_argument("--retry-failed", action="store_true")
    commands.add_parser("inbox")
    commands.add_parser("init", help="Migrate SQLite and import the bundled USFiR data.")
    demo = commands.add_parser("reviewed-demo", help="Publish two curated CSV excerpts for a local demo.")
    demo.add_argument("reviewer", help="Provisioned coordinator username.")
    demo.add_argument("--approve", action="store_true", required=True,
                      help="Approve the curated public wording and approximate area points.")
    geocode = commands.add_parser("geocode", help="Look up one public landmark, intersection, or address.")
    geocode.add_argument("public_place")
    geocode.add_argument("--public", action="store_true", required=True,
                         help="Confirm the query contains only public location information.")
    options = parser.parse_args()
    with closing(connect(database_path())) as db:
        init_db(db)
        if options.command == "staff":
            password = os.getenv("COMFORCE_STAFF_PASSWORD") or getpass("Staff password (12–128 characters): ")
            provision_staff(db, options.username.strip().lower(), options.organization, options.role, password)
            print("Staff account ready.")
        elif options.command in {"init", "reviewed-demo"}:
            from pathlib import Path

            csv_path = Path(__file__).resolve().parent.parent / "data" / "usfir_incidents.csv"
            print(import_csv(db, csv_path))
            if options.command == "reviewed-demo":
                from backend.reviewed_demo import publish

                print(f"Published {publish(db, options.reviewer.lower())} new reviewed demo incidents.")
        elif options.command == "deliver":
            origin = os.getenv("COMFORCE_PUBLIC_ORIGIN", "http://localhost:5180").rstrip("/")
            print(f"Delivered {deliver_pending(db, email_adapter(db, origin), include_failed=options.retry_failed)} messages.")
        elif options.command == "geocode":
            from backend.public_geocoder import lookup_public_place

            try:
                result = lookup_public_place(db, options.public_place)
            except ValueError as error:
                parser.error(str(error))
            print(json.dumps(result, indent=2))
        else:
            print(json.dumps([dict(row) for row in db.execute("SELECT * FROM demo_inbox ORDER BY notification_id")], indent=2))


if __name__ == "__main__":
    main()
