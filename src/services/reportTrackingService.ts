import type { DepartmentId } from '../reports'
import type { Incident } from '../types/incident'
import { ApiError, apiRequest } from './apiClient'
import { emptyCase, type CaseSummary } from './caseData'
import { incidentId, reportId, reportReference, utcTime } from './incidentService'
import { summarizeCase } from './reportingWorkflow'

export type TrackedReport = CaseSummary & { serviceCases?: CaseSummary[] }

interface StatusResponse {
  id: number
  incident_id: number
  created_at: string
  reviewed_at: string | null
  publication_declined: number
  requested_department: string
  cases: (Parameters<typeof summarizeCase>[0] & { updates: Parameters<typeof summarizeCase>[1] })[]
}

export const reportTrackingService = {
  async find(id: string, key?: string): Promise<TrackedReport | undefined> {
    const reference = id.trim().toUpperCase()
    const match = /^RPT-(\d+)$/.exec(reference)
    if (match) {
      const saved = reportReference(reference)
      const trackingKey = key?.trim() || (!saved?.owner ? saved?.key : undefined)
      if (!trackingKey) return undefined
      try {
        const report = await apiRequest<StatusResponse>(`/api/reports/${match[1]}/status`, {
          headers: { 'X-Report-Key': trackingKey },
        })
        const timestamp = utcTime(report.created_at)
        const incident: Incident = {
          incidentId: incidentId(report.incident_id), reportId: reportId(report.id),
          originalDescription: '', anonymous: true, reporterName: '', reporterContact: { email: '', phone: '' },
          incidentType: null, incidentDate: null, incidentLocation: null, incidentTime: null,
          selectedDepartment: report.requested_department.toLowerCase() as DepartmentId,
          verificationStatus: report.publication_declined ? 'rejected' : report.reviewed_at ? 'approved' : 'pending-review',
          assistanceStatus: 'not-assessed', createdAt: timestamp, updatedAt: timestamp,
        }
        const serviceCases = report.cases.map(service => summarizeCase(service, service.updates, {
          ...incident, assignedDepartment: service.organization as DepartmentId,
        }))
        return { ...(serviceCases[0] ?? emptyCase(incident)), serviceCases }
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return undefined
        throw error
      }
    }
    return undefined
  },
}
