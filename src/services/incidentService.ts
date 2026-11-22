import { validate, type ReportDraft } from '../reports'
import type { Incident, IncidentSummary } from '../types/incident'
import { apiRequest } from './apiClient'
import { announceCaseChange } from './caseData'

interface SavedReport {
  report_id: number
  incident_id: number
  parse_status: 'parsed' | 'failed' | 'pending'
  ai_status: Incident['aiStatus']
  tracking_key: string
}

interface PublicIncident {
  id: number
  incident_type: string | null
  city: string | null
  public_summary: string
  incident_date: string | null
  post_date: string | null
  created_at: string
  latitude: number
  longitude: number
  service_status: 'assistance_needed' | 'in_progress' | 'assistance_confirmed' | 'no_service_case'
}

export const incidentId = (id: number) => `MKE-${id}`
export const reportId = (id: number) => `RPT-${id}`
export const utcTime = (value: string) => value.includes('T') ? value : value.replace(' ', 'T') + 'Z'
const referencePrefix = 'comforce-mke:report-reference:'

export interface ReportReference { key: string; owner?: string }

export function reportReference(id: string): ReportReference | undefined {
  try {
    const raw = localStorage.getItem(referencePrefix + id)
    return raw ? JSON.parse(raw) as ReportReference : undefined
  } catch { return undefined }
}

export function reportReferences() {
  try {
    return Object.keys(localStorage).filter(key => key.startsWith(referencePrefix))
      .map(key => key.slice(referencePrefix.length)).filter(id => !reportReference(id)?.owner)
  } catch { return [] }
}

export const incidentService = {
  async listPublic(): Promise<readonly IncidentSummary[]> {
    const incidents = await apiRequest<PublicIncident[]>('/api/incidents')
    const statuses = {
      assistance_needed: 'needed',
      in_progress: 'in-progress',
      assistance_confirmed: 'confirmed',
      no_service_case: 'not-assessed',
    } as const
    return incidents.map(item => ({
      id: incidentId(item.id),
      title: item.incident_type ?? 'Community incident',
      area: item.city ?? 'Area not provided',
      summary: item.public_summary,
      incidentType: item.incident_type ?? 'Unclassified',
      reportedAt: item.incident_date || item.post_date || '',
      dateBasis: item.incident_date ? 'incident' : 'source post',
      assistanceStatus: statuses[item.service_status],
    }))
  },

  async submit(draft: ReportDraft): Promise<Incident> {
    if (Object.keys(validate(draft)).length) throw new Error('Check the report fields.')
    const saved = await apiRequest<SavedReport>('/api/reports', {
      method: 'POST',
      body: JSON.stringify({
        narrative: draft.description,
        anonymous: draft.anonymous,
        location: draft.location.rawAddress,
        name: draft.anonymous ? null : draft.name.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim(),
        email_opt_in: Boolean(draft.emailOptIn),
        department: draft.department,
      }),
    })
    const id = reportId(saved.report_id)
    try {
      localStorage.setItem(referencePrefix + id, JSON.stringify({
        key: saved.tracking_key,
      }))
    } catch {
      // The receipt still shows the private tracking key if browser storage is disabled.
    }
    announceCaseChange()
    const now = new Date().toISOString()
    return {
      incidentId: incidentId(saved.incident_id), reportId: id, trackingKey: saved.tracking_key, aiStatus: saved.ai_status,
      anonymous: draft.anonymous, reporterName: draft.anonymous ? '' : draft.name.trim(),
      reporterContact: { email: draft.email.trim(), phone: draft.phone.trim() },
      originalDescription: draft.description, incidentType: null, incidentDate: null, incidentTime: null,
      incidentLocation: draft.location, selectedDepartment: draft.department,
      verificationStatus: 'pending-review', assistanceStatus: 'not-assessed',
      createdAt: now, updatedAt: now,
    }
  },
}
