import type { RecipientVerification, RecipientVerificationStatus, ServiceProgressStatus, ServiceUpdate } from '../types/accounts'
import type { Incident } from '../types/incident'

export const caseChange = 'comforce-case-change'
export const announceCaseChange = () => window.dispatchEvent(new Event(caseChange))

export interface CaseSummary {
  incident: Incident
  updates: ServiceUpdate[]
  verifications: RecipientVerification[]
  latest?: ServiceUpdate
  serviceProgress: ServiceProgressStatus
  recipientVerificationStatus: RecipientVerificationStatus
  lastUpdated: string
}

export function assignedDepartment(incident: Incident) {
  return incident.assignedDepartment ?? incident.selectedDepartment
}

export function emptyCase(incident: Incident): CaseSummary {
  return {
    incident, updates: [], verifications: [], serviceProgress: 'not-started',
    recipientVerificationStatus: 'not-requested', lastUpdated: incident.updatedAt,
  }
}
