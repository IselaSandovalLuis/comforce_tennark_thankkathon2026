
# ComForce MKE — AI Report Categorization

## Overview

This component uses the OpenAI API to analyze community
assistance requests submitted to ComForce MKE.

The AI generates:
- A factual summary of the report.
- A suggested assistance category.
- A suggested ComForce division.
- A flag requiring coordinator review.

The categorizer uses GPT-4o mini and returns structured
JSON validated using Pydantic.

All team assignments are provisional demonstration
suggestions and must be confirmed by ComForce.

## Supported Services

| Category | ComForce Service |
| --- | --- |
| shelter | Homelessness / Emergency Shelter |
| missing_person_support | Missing Persons Network |
| food_assistance | Meal Programs / Pantry |
| violence_prevention_interruption | Violence Prevention / Interruption |
| transportation | Transportation Service |
| incident_de_escalation | Incident De-escalation |
| burial_assistance | Burial Assistance |
| employment_support | Bridge to Employment |

## AI Workflow

1. Receive a free-text assistance request.
2. Send the report to the OpenAI API.
3. Generate a summary and suggested category.
4. Validate the response using Pydantic.
5. Look up a provisional team assignment.
6. Return the structured report for coordinator review.
7. Log API token usage and estimated cost.

The AI does not automatically send referrals.

If multiple services are requested or the category is
unclear, suggested_category is null.

## Output Format

Example response:

{
  "summary": "A family is requesting emergency shelter.",
  "suggested_category": "shelter",
  "suggested_team": "Disaster Relief Division",
  "needs_review": true
}

The suggested team is a provisional demo assignment.

The output follows the structured_report contract
defined in ../README.md.

## Project Files

- report_schema.py: Output schema and service labels.
- categorizer.py: AI classification and team routing.
- approved_team_routing.json: Provisional team mappings.
- test_categorizer.py: Offline and live tests.
- sample_reports.json: Fictional test reports.
- sample_outputs.json: Backend integration examples.
- cost_report.py: Monthly AI cost estimates.
- requirements.txt: Python dependencies.
- usage_log.csv: Local API usage records.

## Installation

From the repository root, create a virtual environment:

    python -m venv .venv

Activate it on Windows PowerShell:

    .\.venv\Scripts\Activate.ps1

Install dependencies:

    python -m pip install -r ai/requirements.txt

Create a backend/.env file containing:

    OPENAI_API_KEY=your_api_key_here

Never commit API keys to GitHub.

## Running the Categorizer

From the project root:

    python -m ai.categorizer

The program categorizes a fictional shelter request
and displays the structured output.

## Running Tests

Offline tests (no API cost):

    python -m ai.test_categorizer

Live AI tests (uses API credits):

    python -m ai.test_categorizer --live

The live tests compare AI classifications with
the expected results in sample_reports.json.

## Evaluation Results

Initial live evaluation:
- 10 fictional reports tested.
- 10 expected categories matched.
- All eight services represented.
- Multiple-needs and unclear reports handled.

These results do not establish accuracy on real
community reports.

Summaries and suggested assignments require review.

## AI Cost Analysis

Latest evaluation results:

- Average cost per report: approximately $0.00012764
- 1,000 reports/month: approximately $0.13
- 5,000 reports/month: approximately $0.64
- 10,000 reports/month: approximately $1.28

These estimates use GPT-4o mini API rates and the
latest 10 fictional test reports.

Actual costs depend on report length, model pricing,
token usage, and processing volume.

Hosting, storage, maintenance, and human review are
not included.

## Monthly Cost Calculator

Run:

    python ai/cost_report.py

Custom monthly volume:

    python ai/cost_report.py --reports 1500

The calculator uses recent entries from usage_log.csv.

## Backend Integration

The unified FastAPI backend calls the categorizer through ai.backend_adapter.
The adapter keeps the summary, assistance category, team, and review flag in
separate report fields. Coordinators can review or revise assistance categories
from Manage Incidents.

The result can be converted into a dictionary using:

    result.model_dump()

Or into JSON using:

    result.model_dump_json()

The backend is responsible for:
- Assigning report IDs.
- Storing original submissions.
- Saving structured reports.
- Managing authentication and permissions.
- Supporting coordinator corrections.
- Creating service records and referrals.

The AI component does not implement API routes.

## Important Limitations

- AI-generated suggestions require human approval.
- Team assignments are provisional examples.
- Multiple assistance needs currently return null.
- The model must not be used for emergency triage.
- Real sensitive submissions require approved
  privacy and data-handling arrangements.
- No real personal information should appear in
  public demos, tests, or GitHub commits.
- The current prototype does not include a
  production security or access-control system.

## Future Improvements

- Support multiple service categories per report.
- Add more realistic evaluation examples.
- Measure category-level accuracy.
- Replace provisional routing with approved teams.
- Improve monitoring and production security.
