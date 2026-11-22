export const departments = [
  { id: 'comforce', label: 'Comforce — Contact All Departments' },
  { id: 'public-safety', label: 'Police / Public Safety' },
  { id: 'fire', label: 'Fire Department' },
  { id: 'ems', label: 'Emergency Medical Services' },
  { id: 'community-support', label: 'Community Support Services' },
  { id: 'housing', label: 'Housing / Neighborhood Services' },
  { id: 'other', label: 'Other' },
] as const

export type DepartmentId = (typeof departments)[number]['id']

export interface IncidentLocation {
  rawAddress: string
  latitude?: number
  longitude?: number
}

export interface ReportDraft {
  anonymous: boolean
  emailOptIn?: boolean
  name: string
  email: string
  phone: string
  location: IncidentLocation
  description: string
  department: DepartmentId
}

export const emptyDraft: ReportDraft = {
  anonymous: false,
  emailOptIn: false,
  name: '',
  email: '',
  phone: '',
  location: { rawAddress: '' },
  description: '',
  department: 'comforce',
}

export const descriptionLimit = 5000
export type FieldErrors = Partial<Record<'name' | 'email' | 'phone' | 'location' | 'description', string>>

export function validate(draft: ReportDraft): FieldErrors {
  const errors: FieldErrors = {}
  const email = draft.email.trim()
  const phone = draft.phone.trim()
  if (draft.emailOptIn && !email) errors.email = 'Enter an email address to receive updates.'
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.'
  if (phone && (!/^\+?[\d().\s-]+$/.test(phone) || !/^\d{7,15}$/.test(phone.replace(/\D/g, '')))) {
    errors.phone = 'Enter a valid phone number.'
  }
  if (draft.location.rawAddress.length > 250) errors.location = 'Use 250 characters or fewer.'
  if (!draft.description.trim()) errors.description = 'Describe what happened.'
  if (draft.description.length > descriptionLimit) errors.description = 'Use 5,000 characters or fewer.'
  return errors
}

export function departmentLabel(id: DepartmentId) {
  return departments.find(department => department.id === id)?.label ?? departments[0].label
}
