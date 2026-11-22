"""Project teammate classifications into report review fields."""

import os

from ai.categorizer import categorize_report


def parse_report(narrative: str) -> dict:
    if not os.getenv("OPENAI_API_KEY", "").strip():
        raise AIUnavailable
    result = categorize_report(narrative)
    return {
        "ai_summary": result.summary,
        "suggested_service_category": result.suggested_category,
        "suggested_team": result.suggested_team,
        "needs_review": result.needs_review,
    }


class AIUnavailable(RuntimeError):
    """The backend API key is missing."""
