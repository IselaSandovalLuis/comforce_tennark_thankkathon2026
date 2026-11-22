
"""Shared AI output contract and ComForce public service catalog."""

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


# These are ComForce's eight publicly listed services.
ServiceCategory = Literal[
    "shelter",
    "missing_person_support",
    "food_assistance",
    "violence_prevention_interruption",
    "transportation",
    "incident_de_escalation",
    "burial_assistance",
    "employment_support",
]


# Convert category identifiers into official service names.
SERVICE_LABELS: dict[str, str] = {
    "shelter": "Homelessness / Emergency Shelter",
    "missing_person_support": "Missing Persons Network",
    "food_assistance": "Meal Programs / Pantry",
    "violence_prevention_interruption": "Violence Prevention / Interruption",
    "transportation": "Transportation Service",
    "incident_de_escalation": "Incident De-escalation",
    "burial_assistance": "Burial Assistance",
    "employment_support": "Bridge to Employment",
}


def service_label(category: ServiceCategory | None) -> str | None:
    """Return the official service name for a category."""
    return SERVICE_LABELS.get(category) if category else None


class StructuredReport(BaseModel):
    """Defines the structured report expected by the backend."""

    model_config = ConfigDict(extra="forbid")

    summary: str = Field(
        min_length=1,
        max_length=500,
        description="Brief, factual summary of the submitted report."
    )

    suggested_category: ServiceCategory | None = Field(
        default=None,
        description="Suggested ComForce service category, or null if unclear."
    )

    suggested_team: str | None = Field(
        default=None,
        description="Approved ComForce team assignment, or null if unknown."
    )

    needs_review: Literal[True] = Field(
        default=True,
        description="Every AI-generated report requires coordinator review."
    )
