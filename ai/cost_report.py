
"""Estimate monthly AI categorization costs for ComForce MKE."""

import argparse
import csv
from decimal import Decimal, InvalidOperation
from pathlib import Path


AI_DIR = Path(__file__).resolve().parent
LOG_PATH = AI_DIR / "usage_log.csv"


def load_costs():
    """Read recorded API costs from the usage CSV."""

    if not LOG_PATH.exists():
        raise FileNotFoundError(
            "usage_log.csv was not found. "
            "Run the categorizer first."
        )

    costs = []

    with LOG_PATH.open(
        "r",
        encoding="utf-8",
        newline=""
    ) as file:
        reader = csv.DictReader(file)

        if "estimated_cost_usd" not in (
            reader.fieldnames or []
        ):
            raise ValueError(
                "CSV does not contain estimated_cost_usd."
            )

        for line_number, row in enumerate(reader, start=2):

            if None in row:
                raise ValueError(
                    f"Inconsistent CSV columns at line "
                    f"{line_number}. Check the log format."
                )

            try:
                cost = Decimal(
                    row["estimated_cost_usd"]
                )
            except (InvalidOperation, TypeError):
                raise ValueError(
                    f"Invalid cost at line {line_number}."
                )

            if cost < 0:
                raise ValueError("Cost cannot be negative.")

            costs.append(cost)

    if not costs:
        raise ValueError("No usage records were found.")

    return costs


def calculate_average(costs):
    """Calculate average API cost per report."""

    return sum(costs) / Decimal(len(costs))


def estimate_monthly_cost(average_cost, reports):
    """Estimate cost based on monthly report volume."""

    if reports < 0:
        raise ValueError(
            "Number of reports cannot be negative."
        )

    return average_cost * Decimal(reports)


def main():
    """Display API usage statistics and monthly estimates."""

    parser = argparse.ArgumentParser(
        description="ComForce monthly AI cost calculator."
    )

    parser.add_argument(
        "--reports",
        type=int,
        default=1000,
        help="Expected number of reports per month."
    )

    parser.add_argument(
        "--last",
        type=int,
        default=10,
        help="Use the most recent N recorded requests."
    )

    args = parser.parse_args()

    if args.last <= 0:
        parser.error("--last must be greater than zero.")

    if args.reports < 0:
        parser.error("--reports cannot be negative.")

    # Load recorded API costs
    all_costs = load_costs()

    # Use the latest requests for the estimate
    costs = all_costs[-args.last:]

    # Calculate statistics
    total_cost = sum(costs)
    average_cost = calculate_average(costs)

    monthly_cost = estimate_monthly_cost(
        average_cost,
        args.reports
    )

    annual_cost = monthly_cost * 12

    # Display results
    print("\n--- ComForce AI Cost Analysis ---")

    print(f"Recorded requests analyzed: {len(costs)}")
    print(f"Total estimated test cost: ${total_cost:.8f}")
    print(f"Average cost per report: ${average_cost:.8f}")

    print("\n--- Monthly Cost Estimate ---")

    print(f"Reports per month: {args.reports:,}")
    print(f"Monthly API cost: ${monthly_cost:.4f}")
    print(f"Annual API cost: ${annual_cost:.4f}")

    print("\n--- Different Usage Scenarios ---")

    for reports in [100, 500, 1000, 1500, 5000, 10000]:
        cost = estimate_monthly_cost(
            average_cost,
            reports
        )

        print(
            f"{reports:>6,} reports/month: ${cost:.4f}"
        )

    print("\n--- Planning Allowance ---")

    print(
        "Illustrative 3x monthly allowance: "
        f"${monthly_cost * 3:.4f}"
    )

    print(
        "\nEstimates exclude hosting, storage, "
        "maintenance, and human review."
    )


if __name__ == "__main__":
    main()
