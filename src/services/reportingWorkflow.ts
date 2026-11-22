import type { DepartmentId } from '../reports'
import type { Incident } from '../types/incident'
import { apiRequest } from './apiClient'
import { announceCaseChange, type CaseSummary } from './caseData'
import { incidentId, utcTime } from './incidentService'

export const incidentFields = ['incident_type', 'city', 'location', 'incident_date', 'incident_time', 'description'] as const
export type IncidentFields = Partial<Record<(typeof incidentFields)[number], string | null>>

export interface ReviewReport {
  id: number
  incident_id: number
  source: string
  ai_status: Incident['aiStatus']
  post_id: string | null
  parse_status: 'pending' | 'parsed' | 'failed'
  incident_type: string | null
}

interface PrivateReport extends Omit<ReviewReport, 'incident_type'> {
  ai_summary: string | null
  suggested_service_category: string | null
  suggested_team: string | null
  reviewed_service_category: string | null
  needs_review: number | null
  anonymous: number | null
  source_metadata: Record<string, string> | null
  original_text: string | null
  requested_department: string | null
  submitted_location: string | null
  post_url: string | null
  post_date: string | null
  source_verification_status: string | null
  related_post_urls: string | null
  manual_review_reason: string | null
  name: string | null
  email: string | null
  phone: string | null
  contact_id: number | null
  email_opt_in: number | null
  reviewed_at: string | null
  parser_output: IncidentFields | null
  imported_fields: IncidentFields | null
  reporter_suggestions: IncidentFields | null
}

interface PrivateTip {
  id: number
  tip_text: string
  created_at: string
  name: string | null
  email: string | null
  phone: string | null
}

export interface OpenableIncident {
  id: number
  incident_type: string | null
  city: string | null
  public_summary: string
}

export type StaffIncident = IncidentFields & OpenableIncident & {
  public_latitude: number | null
  public_longitude: number | null
  reports: PrivateReport[]
  tips: PrivateTip[]
}

interface WorkerUpdate {
  id: number
  staff_id?: string | null
  status: string
  worker_action: 'in_progress' | 'completed' | null
  notes?: string | null
  response_to: number | null
  created_at: string
}

export type CaseStatus = 'assistance_needed' | 'in_progress' | 'awaiting_confirmation' | 'assistance_confirmed' | 'needs_follow_up'
export interface BackendCase {
  id: number
  organization: string
  status: CaseStatus
  confirmation_available: number
}

interface ServiceCase extends BackendCase { incident_id: number }

interface ServerCase {
  case: ServiceCase
  updates: WorkerUpdate[]
  incident: {
    id: number; incident_type: string | null; location: string | null; created_at: string
    public_summary: string | null; verification_status: string
  }
}

export const caseLabels: Record<CaseStatus, string> = {
  assistance_needed: 'Assistance needed',
  in_progress: 'In progress',
  awaiting_confirmation: 'Awaiting confirmation',
  assistance_confirmed: 'Assistance confirmed',
  needs_follow_up: 'Needs follow-up',
}

export function summarizeCase(service: BackendCase, updates: WorkerUpdate[], incident: Incident): CaseSummary {
  const id = incident.incidentId
  const history = updates.filter(update => update.worker_action).map(update => ({
    updateId: String(update.id), incidentId: id, workerId: update.staff_id ?? '',
    departmentId: service.organization, notes: update.notes ?? '',
    progressStatus: update.worker_action === 'completed' ? 'completed' as const : 'in-progress' as const,
    createdAt: utcTime(update.created_at),
  }))
  const verifications = updates.flatMap(update => {
    if (update.response_to === null) return []
    return [{
      verificationId: String(update.id), incidentId: id, serviceUpdateId: String(update.response_to),
      recipientId: '', verificationStatus: update.status === 'assistance_confirmed' ? 'confirmed' as const : 'disputed' as const,
      feedback: update.notes ?? '', verifiedAt: utcTime(update.created_at),
    }]
  })
  const recipients = {
    assistance_needed: 'not-requested', in_progress: 'not-requested',
    awaiting_confirmation: service.confirmation_available ? 'awaiting-verification' as const : 'not-requested' as const, assistance_confirmed: 'confirmed', needs_follow_up: 'disputed',
  } as const
  return {
    incident, updates: history, verifications, latest: history.at(-1),
    serviceProgress: history.at(-1)?.progressStatus ?? 'not-started',
    recipientVerificationStatus: recipients[service.status],
    lastUpdated: updates.at(-1) ? utcTime(updates.at(-1)!.created_at) : incident.updatedAt,
  }
}

export type WorkerCase = CaseSummary & { caseId: number; databaseIncidentId: number; state: CaseStatus; organization: string; confirmationAvailable: boolean }

interface InboxMessage {
  notification_id: number
  email: string
  message: string
  response_url: string | null
}

interface OutboxMessage { id: number; status: string; attempts: number; last_error: string | null }

export const reportingWorkflow = {
  reviewQueue: () => apiRequest<ReviewReport[]>('/api/staff/review'),
  incident: (id: number) => apiRequest<StaffIncident>(`/api/staff/incidents/${id}`),
  candidates: () => apiRequest<OpenableIncident[]>('/api/staff/incidents'),
  parse: (id: number) => apiRequest(`/api/staff/reports/${id}/parse`, { method: 'POST' }),
  decline: (id: number) => apiRequest(`/api/staff/reports/${id}/decline`, { method: 'POST' }),
  async review(id: number, data: {
    incident_id?: number; service_category?: string | null; assistance_requested?: boolean; fields?: IncidentFields; public_summary?: string; public_area?: string; public_time?: string; latitude?: number; longitude?: number
  }) {
    await apiRequest(`/api/staff/reports/${id}/review`, { method: 'POST', body: JSON.stringify(data) })
    announceCaseChange()
  },
  async cases(): Promise<WorkerCase[]> {
    const cases = await apiRequest<ServerCase[]>('/api/staff/cases')
    return cases.map(({ case: service, incident: raw, updates }) => ({
      ...summarizeCase(service, updates, {
        incidentId: incidentId(raw.id),
        anonymous: true, reporterName: '', reporterContact: { email: '', phone: '' },
        originalDescription: raw.public_summary ?? '', incidentType: raw.incident_type,
        incidentDate: null, incidentTime: null,
        incidentLocation: raw.location ? { rawAddress: raw.location } : null,
        selectedDepartment: service.organization as DepartmentId,
        verificationStatus: raw.verification_status === 'verified' ? 'approved' : 'pending-review',
        assistanceStatus: 'not-assessed',
        createdAt: utcTime(raw.created_at), updatedAt: utcTime(raw.created_at),
      }),
      caseId: service.id, databaseIncidentId: raw.id, state: service.status, organization: service.organization, confirmationAvailable: Boolean(service.confirmation_available),
    }))
  },
  async openCase(id: number, organization?: string) {
    const result = await apiRequest<{ case_id: number }>('/api/staff/cases', {
      method: 'POST', body: JSON.stringify({ incident_id: id, organization }),
    })
    announceCaseChange()
    return result
  },
  async updateCase(caseId: number, status: 'in-progress' | 'completed', notes: string) {
    await apiRequest(`/api/staff/cases/${caseId}/updates`, {
      method: 'POST', body: JSON.stringify({ status: status === 'in-progress' ? 'in_progress' : status, notes }),
    })
    announceCaseChange()
  },
  inbox: () => apiRequest<InboxMessage[]>('/api/staff/demo-inbox'),
  outbox: () => apiRequest<OutboxMessage[]>('/api/staff/outbox'),
  retry: () => apiRequest('/api/staff/outbox/retry', { method: 'POST' }),
}
