
"""Tests for ComForce AI report categorization."""

import argparse
import json
import sys
import unittest
from pathlib import Path

from pydantic import ValidationError

from ai.categorizer import (
    approved_team_for_category,
    categorize_report,
    estimate_cost_usd,
)

from ai.report_schema import (
    SERVICE_LABELS,
    StructuredReport,
    service_label,
)


AI_DIR = Path(__file__).resolve().parent
SAMPLES_PATH = AI_DIR / "sample_reports.json"


def load_test_reports():
    """Load fictional reports and expected results."""
    with SAMPLES_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


class OfflineTests(unittest.TestCase):
    """Run tests without making OpenAI API requests."""

    def test_eight_service_categories(self):
        """Verify that all eight services are configured."""
        self.assertEqual(len(SERVICE_LABELS), 8)

    def test_service_labels(self):
        """Check that identifiers map to service names."""
        self.assertEqual(
            service_label("shelter"),
            "Homelessness / Emergency Shelter"
        )

        self.assertEqual(
            service_label("employment_support"),
            "Bridge to Employment"
        )

    def test_sample_reports(self):
        """Validate all expected sample outputs."""
        reports = load_test_reports()

        self.assertEqual(len(reports), 10)

        for report in reports:
            with self.subTest(report=report["report_id"]):
                expected = report["expected_structured_report"]

                validated = StructuredReport.model_validate(
                    expected
                )

                self.assertTrue(validated.needs_review)

    def test_all_services_covered(self):
        """Ensure examples cover the eight categories."""
        reports = load_test_reports()

        tested_categories = {
            report["expected_structured_report"][
                "suggested_category"
            ]
            for report in reports
        }

        for category in SERVICE_LABELS:
            self.assertIn(category, tested_categories)

    def test_invalid_category(self):
        """Reject categories outside the approved list."""
        with self.assertRaises(ValidationError):
            StructuredReport(
                summary="Invalid test category.",
                suggested_category="1"
            )

    def test_review_required(self):
        """AI reports must always require human review."""
        with self.assertRaises(ValidationError):
            StructuredReport(
                summary="Test report.",
                suggested_category="shelter",
                needs_review=False
            )

    def test_team_routing(self):
        """Verify provisional team assignments."""
        for category in SERVICE_LABELS:
            with self.subTest(category=category):
                team = approved_team_for_category(category)

                self.assertIsInstance(team, str)
                self.assertTrue(team.strip())

        self.assertEqual(
            approved_team_for_category("shelter"),
            "Disaster Relief Division"
        )

    def test_unknown_team(self):
        """Unknown categories must not receive a team."""
        self.assertIsNone(
            approved_team_for_category(None)
        )

    def test_cost_calculation(self):
        """Verify the cost of the measured sample request."""
        cost = estimate_cost_usd(
            input_tokens=683,
            output_tokens=37,
            cached_tokens=0
        )

        self.assertAlmostEqual(cost, 0.00012465)

    def test_cached_input_cost(self):
        """Cached input should use the discounted rate."""
        regular = estimate_cost_usd(1000, 100, 0)
        cached = estimate_cost_usd(1000, 100, 500)

        self.assertLess(cached, regular)


def run_live_tests():
    """Evaluate classifications using actual OpenAI calls."""

    reports = load_test_reports()
    passed = 0

    for test in reports:
        report_id = test["report_id"]
        original_text = test["original_submission"]
        expected = test["expected_structured_report"]

        print(f"\nTesting report: {report_id}")

        try:
            result = categorize_report(
                original_text,
                show_usage=True
            )

            print("AI Output:")
            print(result.model_dump_json(indent=2))

            # Compare predicted and expected categories
            category_matches = (
                result.suggested_category
                == expected["suggested_category"]
            )

            # Verify team mapping
            expected_team = approved_team_for_category(
                result.suggested_category
            )

            team_matches = (
                result.suggested_team == expected_team
            )

            # Verify that human review is required
            review_required = (
                result.needs_review is True
            )

            if (
                category_matches
                and team_matches
                and review_required
            ):
                print("PASS: Classification and routing valid.")
                passed += 1
            else:
                print("REVIEW: Unexpected AI result.")

                if not category_matches:
                    print(
                        "Expected category:",
                        expected["suggested_category"]
                    )

                    print(
                        "Received category:",
                        result.suggested_category
                    )

                if not team_matches:
                    print("Team routing mismatch.")

                if not review_required:
                    print("Human review requirement missing.")

        except Exception as error:
            print(f"ERROR: {type(error).__name__}: {error}")

    total = len(reports)

    print("\n--- LIVE TEST SUMMARY ---")
    print(f"Passed: {passed}/{total}")
    print(f"Category and routing agreement: {passed / total * 100:.1f}%")
    print("Summaries still require manual quality review.")

    return 0 if passed == total else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Test ComForce AI categorization."
    )

    parser.add_argument(
        "--live",
        action="store_true",
        help="Run real AI tests using OpenAI credits."
    )

    args = parser.parse_args()

    if args.live:
        sys.exit(run_live_tests())

    # Run offline tests by default
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(
        OfflineTests
    )

    result = unittest.TextTestRunner(
        verbosity=2
    ).run(suite)

    sys.exit(0 if result.wasSuccessful() else 1)
