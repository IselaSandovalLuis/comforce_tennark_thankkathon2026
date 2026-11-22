import csv
import json
import os
import sqlite3
import unittest
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.parse import urlsplit

from fastapi.testclient import TestClient

from backend import comforce_db as store
from backend.api import create_app
from backend.notifications import email_adapter
from backend.staff_auth import provision_staff


PASSWORD = "synthetic-test-password"


class ReportingWorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        template = Path(cls.temp.name) / "staff-template.sqlite3"
        with closing(store.connect(template)) as db:
            store.init_db(db)
            provision_staff(db, "reviewer", "comforce", "admin", PASSWORD)
            provision_staff(db, "worker", "comforce", "worker", PASSWORD)
            provision_staff(db, "fire-worker", "fire", "worker", PASSWORD)
        cls.template = template.read_bytes()

    def setUp(self):
        from tempfile import mkdtemp
        self.db = Path(mkdtemp(dir=self.temp.name)) / "workflow.sqlite3"
        self.db.write_bytes(self.template)
        settings = patch.dict(os.environ, {"COMFORCE_EMAIL_MODE": "demo", "COMFORCE_SECURE_COOKIES": "0"})
        settings.start()
        self.addCleanup(settings.stop)

    def client(self, **options):
        client = TestClient(create_app(self.db, **options))
        self.addCleanup(client.__exit__, None, None, None)
        return client.__enter__()

    def login(self, client, username):
        response = client.post("/api/staff/login", json={"username": username, "password": PASSWORD})
        self.assertEqual(response.status_code, 200, response.text)

    def submit(self, client, *, contact=True, department="comforce"):
        data = {"narrative": "A private narrative with case details.", "location": "Private address", "department": department}
        if contact:
            data.update(name="Fictional Resident", email="demo@example.test", email_opt_in=True)
        response = client.post("/api/reports", json=data)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def approve(self, client, report, *, coordinates=True):
        data = {
            "fields": {"incident_type": "Road closure", "city": "Milwaukee", "location": "Private address"},
            "public_summary": "A road closure was reported in Milwaukee.",
        }
        if coordinates:
            data.update(latitude=43.04, longitude=-87.91)
        response = client.post(f"/api/staff/reports/{report['report_id']}/review", json=data)
        self.assertEqual(response.status_code, 200, response.text)

    def open_case(self, client, incident_id):
        response = client.post("/api/staff/cases", json={"incident_id": incident_id})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["case_id"]

    def update(self, client, case, status):
        response = client.post(f"/api/staff/cases/{case}/updates", json={"status": status, "notes": "Private staff note."})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["update_id"]

    def response_path(self, client):
        inbox = client.get("/api/staff/demo-inbox")
        self.assertEqual(inbox.status_code, 200, inbox.text)
        return urlsplit(next(item["response_url"] for item in inbox.json() if item["response_url"])).path

    def test_csv_import_is_repeatable_and_preserves_source_fields(self):
        with TemporaryDirectory() as folder:
            supplied = os.getenv("COMFORCE_TEST_CSV")
            path = Path(supplied) if supplied else Path(folder) / "usfir.csv"
            if not supplied:
                with path.open("w", encoding="utf-8-sig", newline="") as output:
                    writer = csv.DictWriter(output, fieldnames=sorted(store.CSV_FIELDS))
                    writer.writeheader()
                    writer.writerow({
                        "post_id": "synthetic-1", "post_url": "https://source.example.test/post/1",
                        "post_date": "2026-11-20", "incident_type": "Road closure", "city": "Milwaukee",
                        "location": "Test intersection", "incident_time": "14:22",
                        "description": "Test", "original_text": "  Original multiline\ntext. ",
                        "verification_status": "source-only", "related_post_urls": "https://source.example.test/related",
                        "manual_review_reason": "Time still needs review.",
                    })
            with path.open(encoding="utf-8-sig", newline="") as csv_file:
                records = list(csv.DictReader(csv_file))
            with closing(store.connect(self.db)) as db:
                self.assertEqual(db.execute("PRAGMA foreign_keys").fetchone()[0], 1)
                identity_count = len({row["post_id"].strip() for row in records})
                self.assertEqual(store.import_csv(db, path), {"imported": identity_count, "skipped": len(records) - identity_count})
                self.assertEqual(store.import_csv(db, path), {"imported": 0, "skipped": len(records)})
                row = db.execute("SELECT * FROM reports ORDER BY id").fetchone()
                first = records[0]
                self.assertEqual(row["source"], "usfir")
                self.assertEqual(row["post_id"], first["post_id"].strip())
                self.assertEqual(row["original_text"], first["original_text"])
                for column in ("post_url", "post_date", "related_post_urls", "manual_review_reason"):
                    self.assertEqual(row[column], first[column].strip() or None)
                self.assertEqual(row["source_verification_status"], first["verification_status"].strip() or None)
                self.assertIsNone(row["reviewed_at"])
                fields = json.loads(row["imported_fields"])
                self.assertIsNone(fields["incident_date"])
                self.assertEqual(fields["incident_time"], first["incident_time"].strip() or None)
                self.assertEqual(store.public_map_incidents(db), [])
            client = self.client()
            self.login(client, "reviewer")
            report = {"report_id": row["id"], "incident_id": row["incident_id"]}
            self.approve(client, report)
            case = self.open_case(client, report["incident_id"])
            self.update(client, case, "in_progress")
            self.update(client, case, "completed")
            self.assertEqual(client.get(f"/api/staff/cases/{case}").json()["case"]["status"], "awaiting_confirmation")
            self.assertEqual(client.get("/api/staff/demo-inbox").json(), [])

    def test_active_map_projection_coordinates_and_completion(self):
        client = self.client()
        report = self.submit(client)
        missing = self.submit(client, contact=False)
        pending = self.submit(client, contact=False)
        iid = report["incident_id"]
        public = lambda: {item["id"]: item for item in client.get("/api/map/incidents").json()}
        self.assertEqual(public(), {})
        self.assertEqual(client.get(f"/api/staff/map-action/{iid}").status_code, 401)
        self.login(client, "reviewer")
        response = client.post(f"/api/staff/reports/{report['report_id']}/review", json={
            "fields": {"incident_type": "Obstruction", "city": "Milwaukee", "location": "123 Private address",
                       "incident_date": "2026-11-21", "incident_time": "14:31"},
            "public_summary": "Sidewalk obstruction reported.",
            "public_time": "14:31", "public_area": "Bay View", "latitude": 42.9952, "longitude": -87.9032,
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.approve(client, missing, coordinates=False)
        self.assertNotIn(pending["incident_id"], public())
        self.assertIsNone(public()[missing["incident_id"]]["latitude"])
        pin = public()[iid]
        self.assertEqual((pin["latitude"], pin["longitude"]), (43.0, -87.9))
        self.assertEqual((pin["area"], pin["approximate_time"]), ("Bay View", "14:00"))
        self.assertEqual(pin["service_status"], "no_service_case")
        self.assertNotIn("Private address", json.dumps(public()))
        self.assertEqual(client.get(f"/api/staff/map-action/{iid}").json(),
                         {"case_id": None, "can_view_report": True})

        path = f"/api/incidents/{iid}/tips"
        tip = client.post(path, json={"tip_text": "Private anonymous supplement."}).json()
        case = self.open_case(client, iid)
        self.assertEqual(public()[iid]["service_status"], "referral_pending")
        self.login(client, "fire-worker")
        self.assertEqual(client.get(f"/api/staff/incidents/{iid}").status_code, 404)
        self.assertFalse(client.get(f"/api/staff/map-action/{iid}").json()["can_view_report"])
        self.login(client, "worker")
        self.assertEqual(client.get(f"/api/staff/map-action/{iid}").json(),
                         {"case_id": case, "can_view_report": True})
        self.assertEqual(client.get(f"/api/staff/incidents/{iid}").json()["tips"][0]["id"], tip["tip_id"])
        self.update(client, case, "in_progress")
        self.assertEqual(public()[iid]["service_status"], "in_progress")
        self.update(client, case, "completed")
        self.assertEqual(public()[iid]["service_status"], "awaiting_confirmation")
        self.assertNotIn("Private anonymous supplement", json.dumps(public()))
        self.login(client, "reviewer")
        self.assertEqual(client.post(self.response_path(client), data={"decision": "confirm"}).status_code, 200)
        self.assertNotIn(iid, public())
        history = client.get("/api/map/incidents?view=completed").json()
        self.assertEqual([(item["id"], item["service_status"], item["verification_status"]) for item in history],
                         [(iid, "assistance_confirmed", "confirmed")])
        self.assertEqual(client.get(f"/api/staff/cases/{case}").json()["case"]["status"], "assistance_confirmed")
        self.assertEqual(client.get(f"/api/staff/incidents/{iid}").json()["tips"][0]["id"], tip["tip_id"])

    def test_bundled_dataset_and_reviewed_demo_are_repeatable(self):
        from backend.reviewed_demo import publish

        csv_path = Path(__file__).resolve().parents[1] / "data" / "usfir_incidents.csv"
        client = self.client()
        self.assertEqual(client.get("/api/map/incidents").json(), [])
        with closing(store.connect(self.db)) as db:
            self.assertEqual(store.import_csv(db, csv_path), {"imported": 100, "skipped": 0})
            self.assertEqual(store.import_csv(db, csv_path), {"imported": 0, "skipped": 100})
            self.assertEqual(db.execute("SELECT count(*) FROM incidents WHERE city = 'Milwaukee'").fetchone()[0], 74)
        self.login(client, "reviewer")
        self.assertEqual(len(client.get("/api/staff/review").json()), 100)
        with closing(store.connect(self.db)) as db:
            self.assertEqual(publish(db, "reviewer"), 2)
            self.assertEqual(publish(db, "reviewer"), 0)
        pins = client.get("/api/map/incidents").json()
        self.assertEqual(len(pins), 2)
        for item in pins:
            self.assertEqual(item["date_basis"], "source_post")
            self.assertEqual(item["source"], "reviewed_demo")
            self.assertEqual(item["service_status"], "no_service_case")
            self.assertIsNotNone(item["latitude"])
        self.assertEqual(len(client.get("/api/staff/review").json()), 98)

    def test_teammate_adapter_stores_ai_separately_and_preserves_anonymity(self):
        from ai.report_schema import StructuredReport

        client = self.client()
        with patch.dict(os.environ, {"OPENAI_API_KEY": "synthetic-key-for-mock-only"}):
            with patch("ai.backend_adapter.categorize_report", return_value=StructuredReport(
                summary="Family requests shelter.", suggested_category="shelter", suggested_team="Demo team",
            )) as model:
                saved = client.post("/api/reports", json={
                    "narrative": "Please help my family find shelter.", "anonymous": True,
                    "name": "Omit this name", "location": "Residency details",
                    "reporter_suggestions": {"incident_type": "Housing concern"},
                }).json()
                model.assert_called_once_with("Please help my family find shelter.")
        self.assertEqual(saved["ai_status"], "ready")
        self.login(client, "reviewer")
        info = client.get(f"/api/staff/incidents/{saved['incident_id']}").json()
        report = info["reports"][0]
        self.assertIsNone(info["incident_type"])
        self.assertIsNone(report["parser_output"])
        self.assertEqual(report["reporter_suggestions"]["incident_type"], "Housing concern")
        self.assertEqual(report["suggested_service_category"], "shelter")
        self.assertEqual(report["ai_summary"], "Family requests shelter.")
        self.assertEqual(report["suggested_team"], "Demo team")
        self.assertEqual(report["needs_review"], 1)
        self.assertEqual(report["anonymous"], 1)
        self.assertIsNone(report["name"])
        with TestClient(create_app(self.db)) as restarted:
            self.login(restarted, "reviewer")
            after = restarted.get(f"/api/staff/incidents/{saved['incident_id']}").json()
            self.assertEqual(after["reports"][0]["suggested_service_category"], "shelter")

    def test_missing_key_leaves_original_available_and_review_can_decline(self):
        client = self.client()
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            saved = self.submit(client)
        self.assertEqual(saved["ai_status"], "unavailable")
        self.login(client, "reviewer")
        report_url = f"/api/staff/reports/{saved['report_id']}"
        self.assertEqual(client.post(report_url + "/decline").status_code, 200)
        self.assertEqual(client.post(report_url + "/decline").status_code, 409)
        self.assertEqual(client.get("/api/staff/review").json(), [])
        details = client.get(f"/api/staff/incidents/{saved['incident_id']}").json()
        self.assertEqual(details["reports"][0]["original_text"], "A private narrative with case details.")
        self.assertEqual(client.get("/api/incidents").json(), [])
        tracked = client.get(f"/api/reports/{saved['report_id']}/status",
                             headers={"X-Report-Key": saved["tracking_key"]}).json()
        self.assertEqual(tracked["publication_declined"], 1)

    def test_public_geocoder_caches_and_generalizes(self):
        from unittest.mock import MagicMock
        from backend.public_geocoder import lookup_public_place

        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps([
            {"lat": "43.04842", "lon": "-87.96198", "display_name": "Washington Park"},
            {"lat": "40.1", "lon": "-88.0", "display_name": "Out of area"},
        ]).encode()
        with closing(store.connect(self.db)) as db, patch.dict(os.environ, {"MILWAUKEE_GEOCODER_CONTACT": "qa@example.test"}):
            with patch("backend.public_geocoder.urlopen", return_value=response) as fetch:
                expected = [{"label": "Washington Park", "latitude": 43.05, "longitude": -87.96}]
                self.assertEqual(lookup_public_place(db, "Washington Park"), expected)
                self.assertEqual(lookup_public_place(db, "washington   park"), expected)
                fetch.assert_called_once()
                with self.assertRaisesRegex(ValueError, "Wait a moment"):
                    lookup_public_place(db, "Another public location")

    def test_migration_preserves_legacy_records(self):
        self.db.unlink()
        with closing(store.connect(self.db)) as db:
            db.executescript(store.SCHEMA)
            db.execute("INSERT INTO incidents (id, city) VALUES (40, 'Milwaukee')")
            db.execute("INSERT INTO contacts (id, email_opt_in) VALUES (21, 0)")
            db.execute("INSERT INTO reports (id, source, incident_id, contact_id, original_text, parser_output) VALUES (50, 'manual', 40, 21, 'Original', '{}')")
            db.execute("INSERT INTO tips (id, incident_id, tip_text) VALUES (60, 40, 'Original tip')")
            db.execute("INSERT INTO staff VALUES ('legacy', 'Legacy Organization', 'worker')")
            db.execute("INSERT INTO service_cases (id, incident_id, organization, contact_id) VALUES (70, 40, 'Legacy Organization', 21)")
            db.execute("INSERT INTO service_updates (id, case_id, staff_id, status) VALUES (80, 70, 'legacy', 'awaiting_confirmation')")
            db.execute("INSERT INTO notifications (id, update_id, contact_id) VALUES (90, 80, 21)")
            store.init_db(db)
            store.init_db(db)
            self.assertEqual(db.execute("SELECT original_text, parse_status FROM reports WHERE id = 50").fetchone()[:], ("Original", "parsed"))
            self.assertEqual(db.execute("SELECT incident_id FROM tips WHERE id = 60").fetchone()[0], 40)
            self.assertEqual(db.execute("SELECT worker_action FROM service_updates WHERE id = 80").fetchone()[0], "completed")
            self.assertEqual(db.execute("SELECT update_id FROM notifications WHERE id = 90").fetchone()[0], 80)
            self.assertEqual(db.execute("SELECT id FROM organizations WHERE id = 'Legacy Organization'").fetchone()[0], "Legacy Organization")
            self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("INSERT INTO tips (incident_id, tip_text) VALUES (999, 'Orphan')")

    def test_original_saved_before_parser_and_survives_backend_restart(self):
        def see_saved_first(narrative):
            with closing(store.connect(self.db)) as db:
                self.assertEqual(db.execute("SELECT original_text FROM reports").fetchone()[0], narrative)
            return {"incident_type": "Road closure", "incident_date": "unknown", "incident_time": "14:10"}

        with TestClient(create_app(self.db, parse=see_saved_first)) as first_process:
            report = self.submit(first_process)
        self.assertEqual(report["parse_status"], "parsed")
        client = self.client()
        self.login(client, "reviewer")
        incident = client.get(f"/api/staff/incidents/{report['incident_id']}").json()
        saved = incident["reports"][0]
        self.assertEqual(saved["original_text"], "A private narrative with case details.")
        self.assertEqual(saved["submitted_location"], "Private address")
        self.assertEqual(saved["parser_output"]["incident_type"], "Road closure")
        self.assertEqual(saved["parser_output"]["incident_time"], "14:10:00")
        self.assertIsNone(saved["parser_output"]["incident_date"])
        url = f"/api/reports/{report['report_id']}/status"
        self.assertEqual(client.get(url).status_code, 404)
        self.assertEqual(client.get(url, headers={"X-Report-Key": report["tracking_key"]}).status_code, 200)

    def test_parser_failure_can_be_retried(self):
        calls = []

        def intermittent_parser(narrative):
            calls.append(narrative)
            if len(calls) == 1:
                raise RuntimeError("Demo failure")
            return {"city": "Milwaukee"}

        client = self.client(parse=intermittent_parser)
        report = self.submit(client, contact=False)
        self.assertEqual(report["parse_status"], "failed")
        url = f"/api/staff/reports/{report['report_id']}/parse"
        self.assertEqual(client.post(url).status_code, 401)
        self.login(client, "reviewer")
        self.assertEqual(client.post(url).json(), {"parse_status": "parsed"})
        details = client.get(f"/api/staff/incidents/{report['incident_id']}").json()
        self.assertEqual(details["reports"][0]["parser_output"]["city"], "Milwaukee")
        self.assertEqual(calls, [details["reports"][0]["original_text"]] * 2)

    def test_review_link_tip_and_public_privacy(self):
        client = self.client()
        first = self.submit(client)
        second = self.submit(client, contact=False)
        third = self.submit(client, contact=False)
        iid = first["incident_id"]
        public_url = f"/api/incidents/{iid}"
        self.assertEqual(client.get("/api/incidents").json(), [])
        self.assertEqual(client.get(public_url).status_code, 404)
        self.assertEqual(client.post(public_url + "/tips", json={"tip_text": "Guess"}).status_code, 404)
        self.login(client, "worker")
        self.assertEqual(client.get("/api/staff/review").status_code, 403)
        self.assertEqual(client.post(f"/api/staff/reports/{first['report_id']}/review", json={}).status_code, 403)
        self.login(client, "reviewer")
        self.approve(client, first)
        self.approve(client, third, coordinates=False)
        linked = client.post(f"/api/staff/reports/{second['report_id']}/review", json={"incident_id": iid})
        self.assertEqual(linked.status_code, 200, linked.text)
        tip1 = client.post(public_url + "/tips", json={"tip_text": "A confidential tip.", "email": "tip@example.test"})
        tip2 = client.post(public_url + "/tips", json={"tip_text": "A second confidential tip."})
        self.assertEqual((tip1.status_code, tip2.status_code), (201, 201))
        self.assertNotEqual(tip1.json()["tip_id"], tip2.json()["tip_id"])
        self.assertEqual(tip1.json()["incident_id"], iid)
        public = client.get("/api/incidents").json()
        self.assertEqual([item["id"] for item in public], [iid, third["incident_id"]])
        self.assertEqual(client.get(public_url).json(), public[0])
        self.assertEqual(set(public[0]), {
            "id", "incident_type", "city", "incident_date", "public_summary", "verification_status",
            "created_at", "post_date", "latitude", "longitude", "service_status",
        })
        self.assertNotIn("Private address", json.dumps(public))
        details = client.get(f"/api/staff/incidents/{iid}").json()
        self.assertEqual([row["id"] for row in details["reports"]], [first["report_id"], second["report_id"]])
        self.assertEqual(details["tips"][0]["email"], "tip@example.test")
        with TestClient(create_app(self.db)) as guest:
            self.assertEqual(guest.get(f"/api/staff/incidents/{iid}").status_code, 401)

    def test_worker_ownership_delivery_retry_confirmation_and_map_aggregation(self):
        attempts = []

        def fail_first_delivery(db, origin):
            actual = email_adapter(db, origin)

            def send(email, message, token, notice_id):
                attempts.append(notice_id)
                if len(attempts) == 1:
                    raise OSError("Demo adapter was temporarily unavailable.")
                actual(email, message, token, notice_id)

            return send

        client = self.client(adapter_factory=fail_first_delivery)
        report = self.submit(client)
        iid = report["incident_id"]
        self.login(client, "reviewer")
        self.approve(client, report)
        self.login(client, "worker")
        case = self.open_case(client, iid)
        self.assertEqual(self.open_case(client, iid), case)
        updates = f"/api/staff/cases/{case}/updates"
        self.assertEqual(client.post(updates, json={"status": "completed"}).status_code, 400)
        client.post("/api/staff/logout")
        self.assertEqual(client.post(updates, json={"status": "in_progress"}).status_code, 401)
        self.login(client, "fire-worker")
        self.assertEqual(client.post(updates, json={"status": "in_progress"}).status_code, 403)
        self.assertEqual(client.get(f"/api/staff/cases/{case}").status_code, 403)
        self.assertEqual(client.get("/api/staff/cases").json(), [])
        self.login(client, "worker")
        in_progress = self.update(client, case, "in_progress")
        self.update(client, case, "completed")
        self.assertEqual(client.get(f"/api/incidents/{iid}").json()["service_status"], "in_progress")
        self.assertEqual(client.get("/api/staff/demo-inbox").status_code, 403)
        self.login(client, "reviewer")
        outbox = client.get("/api/staff/outbox").json()
        failed = next(item for item in outbox if item["update_id"] == in_progress)
        self.assertEqual((failed["status"], failed["attempts"]), ("failed", 1))
        self.assertEqual(client.post("/api/staff/outbox/retry").json(), {"delivered": 1})
        self.assertEqual(client.post("/api/staff/outbox/retry").json(), {"delivered": 0})
        inbox = client.get("/api/staff/demo-inbox").json()
        self.assertEqual(len(inbox), 2)
        self.assertTrue(all(item["email"] == "demo@example.test" for item in inbox))
        path = self.response_path(client)
        client.post("/api/staff/logout")
        self.assertIn("Confirm assistance", client.get(path).text)
        self.assertIn("Report an issue", client.get(path).text)
        self.assertEqual(client.get(path).status_code, 200)
        self.assertEqual(client.get(f"/api/incidents/{iid}").json()["service_status"], "in_progress")
        self.assertEqual(client.post(path, data={"decision": "confirm", "notes": "Received assistance."}).status_code, 200)
        self.assertEqual(client.post(path, data={"decision": "dispute"}).status_code, 410)
        self.assertEqual(client.get(path).status_code, 410)
        self.assertEqual(client.get(f"/api/incidents/{iid}").json()["service_status"], "assistance_confirmed")
        self.login(client, "fire-worker")
        follow_on = self.open_case(client, iid)
        self.assertNotEqual(case, follow_on)
        self.assertEqual(client.get(f"/api/incidents/{iid}").json()["service_status"], "assistance_needed")
        self.login(client, "worker")
        history = client.get(f"/api/staff/cases/{case}").json()
        self.assertEqual([row["status"] for row in history["updates"]], ["in_progress", "awaiting_confirmation", "assistance_confirmed"])
        self.assertEqual(history["updates"][1]["worker_action"], "completed")
        self.assertEqual(history["updates"][0]["staff_id"], "worker")
        self.assertTrue(history["updates"][0]["created_at"])
        tracked = client.get(f"/api/reports/{report['report_id']}/status", headers={"X-Report-Key": report["tracking_key"]}).json()
        self.assertNotIn("Private staff note.", json.dumps(tracked))

    def test_update_and_notification_are_atomic(self):
        client = self.client()
        report = self.submit(client)
        self.login(client, "reviewer")
        self.approve(client, report)
        case = self.open_case(client, report["incident_id"])
        with closing(store.connect(self.db)) as db:
            db.execute(
                """CREATE TRIGGER fail_notice BEFORE INSERT ON notifications
                   BEGIN SELECT RAISE(ABORT, 'Synthetic write failure'); END"""
            )
            with self.assertRaises(sqlite3.IntegrityError):
                store.record_service_progress(db, case, "reviewer", "in_progress")
            self.assertEqual(db.execute("SELECT status FROM service_cases WHERE id = ?", (case,)).fetchone()[0], "assistance_needed")
            self.assertEqual(db.execute("SELECT COUNT(*) FROM service_updates").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM notifications").fetchone()[0], 0)
            db.execute("DROP TRIGGER fail_notice")
        self.update(client, case, "in_progress")
        self.assertEqual(len(client.get("/api/staff/demo-inbox").json()), 1)

    def test_dispute_expired_and_outdated_links(self):
        client = self.client()
        self.login(client, "reviewer")
        report = self.submit(client)
        self.approve(client, report)
        case = self.open_case(client, report["incident_id"])
        self.update(client, case, "in_progress")
        first_completion = self.update(client, case, "completed")
        original = self.response_path(client)
        self.assertEqual(client.post(original, data={"decision": "dispute", "notes": "Support is still needed."}).status_code, 200)
        queue = client.get("/api/staff/cases").json()
        self.assertEqual(queue[0]["case"]["status"], "needs_follow_up")
        self.assertEqual(queue[0]["updates"][-1]["response_to"], first_completion)
        self.assertEqual(queue[0]["updates"][-1]["notes"], "Support is still needed.")
        self.update(client, case, "in_progress")
        second_completion = self.update(client, case, "completed")
        fresh = self.response_path(client)
        self.assertNotEqual(fresh, original)
        with closing(store.connect(self.db)) as db:
            # Make the earlier token unused to isolate the outdated-update check.
            db.execute("UPDATE notifications SET used_at = NULL WHERE update_id = ?", (first_completion,))
            db.execute("UPDATE notifications SET expires_at = '2000-01-01T00:00:00+00:00' WHERE update_id = ?", (second_completion,))
        self.assertEqual(client.get(original).status_code, 410)
        self.assertEqual(client.post(original, data={"decision": "confirm"}).status_code, 410)
        self.assertEqual(client.get(fresh).status_code, 410)
        self.assertEqual(client.post(fresh, data={"decision": "confirm"}).status_code, 410)
        self.assertEqual(client.get(f"/api/staff/cases/{case}").json()["case"]["status"], "awaiting_confirmation")

    def test_anonymous_and_no_consent_do_not_queue_email(self):
        client = self.client()
        anonymous = self.submit(client, contact=False)
        self.assertEqual(client.post("/api/reports", json={"narrative": "No email", "email_opt_in": True}).status_code, 400)
        opted_out = client.post("/api/reports", json={"narrative": "No email updates", "email": "example@example.test"}).json()
        self.login(client, "reviewer")
        for report in (anonymous, opted_out):
            self.approve(client, report)
            case = self.open_case(client, report["incident_id"])
            self.update(client, case, "in_progress")
            self.update(client, case, "completed")
            self.assertEqual(client.get(f"/api/staff/cases/{case}").json()["case"]["status"], "awaiting_confirmation")
        self.assertEqual(client.get("/api/staff/outbox").json(), [])
        self.assertEqual(client.get("/api/staff/demo-inbox").json(), [])


if __name__ == "__main__":
    unittest.main()
