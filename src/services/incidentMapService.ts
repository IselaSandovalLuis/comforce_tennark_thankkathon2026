import { apiRequest } from './apiClient'

export const progressLabels = {
  referral_pending: 'Referral pending',
  completed_unconfirmed: 'Completed without recipient confirmation',
  no_service_case: 'Assistance not assessed',
  assistance_confirmed: 'Assistance confirmed',
  assistance_needed: 'Assistance needed',
  needs_follow_up: 'Needs follow-up',
  in_progress: 'In progress',
  awaiting_confirmation: 'Awaiting recipient confirmation',
} as const

export type MapProgress = keyof typeof progressLabels

export interface MapIncident {
  id: number
  incident_type: string | null
  public_summary: string
  area: string | null
  date: string | null
  date_basis: 'incident' | 'source_post'
  approximate_time: string | null
  latitude: number | null
  longitude: number | null
  source: 'imported' | 'community' | 'reviewed_demo'
  service_status: MapProgress
  verification_status: 'not_requested' | 'awaiting_confirmation' | 'needs_follow_up' | 'confirmed'
}

export function hasPoint(item: MapIncident): item is MapIncident & { latitude: number; longitude: number } {
  return item.latitude !== null && item.longitude !== null
    && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
    && item.latitude >= 42.90 && item.latitude <= 43.21 && item.longitude >= -88.10 && item.longitude <= -87.85
}

export const incidentMapService = {
  list: (view: 'active' | 'completed' | 'all', signal: AbortSignal) =>
    apiRequest<MapIncident[]>(`/api/map/incidents?view=${view}`, { signal }),
  areas: () => apiRequest<string[]>('/api/map/areas'),
  staffAction: (id: number, signal: AbortSignal) => apiRequest<{ case_id: number | null; can_view_report: boolean }>(
    `/api/staff/map-action/${id}`, { signal },
  ),
}
