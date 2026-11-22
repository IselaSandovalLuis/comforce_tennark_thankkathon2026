import type { DepartmentId, IncidentLocation } from '../reports'

export type VerificationStatus = 'pending-review' | 'approved' | 'rejected'
export type AssistanceStatus = 'not-assessed' | 'needed' | 'in-progress' | 'confirmed'

export interface Incident {
  incidentId: string
  reportId?: string
  trackingKey?: string
  reporterId?: string
  recipientId?: string
  assignedDepartment?: DepartmentId
  anonymous: boolean
  reporterName: string
  reporterContact: { email: string; phone: string }
  originalDescription: string
  incidentType: string | null
  incidentDate: string | null
  incidentTime: string | null
  incidentLocation: IncidentLocation | null
  selectedDepartment: DepartmentId
  verificationStatus: VerificationStatus
  assistanceStatus: AssistanceStatus
  createdAt: string
  updatedAt: string
  aiStatus?: 'ready' | 'unavailable' | 'failed' | null
}

export interface ServiceProgress {
  progressId: string
  incidentId: string
  department: DepartmentId
  currentStatus: AssistanceStatus
  lastUpdated: string
  recipientConfirmed: boolean
}

// Public data has its own shape, with no raw address, narrative, or reporter identity.
export interface IncidentSummary {
  id: string
  title: string
  area: string
  summary: string
  incidentType: string
  reportedAt: string
  dateBasis: 'incident' | 'source post'
  assistanceStatus: AssistanceStatus
}
