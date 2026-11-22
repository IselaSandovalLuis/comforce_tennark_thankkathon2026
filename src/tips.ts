import type { TipDraft } from './types/tip'

export type TipErrors = Partial<Record<keyof TipDraft, string>>
export const tipInformationLimit = 5000

export function validateTip(draft: TipDraft): TipErrors {
  const errors: TipErrors = {}
  const phone = draft.phone.trim()
  const email = draft.email.trim()

  if (!draft.incidentId.trim()) errors.incidentId = 'Select an existing incident.'
  if (phone && (!/^\+?[\d().\s-]+$/.test(phone) || !/^\d{7,15}$/.test(phone.replace(/\D/g, '')))) {
    errors.phone = 'Enter a valid phone number.'
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.'
  if (!draft.information.trim()) errors.information = 'Enter the additional information you want to share.'
  if (draft.information.length > tipInformationLimit) errors.information = 'Use 5,000 characters or fewer.'
  return errors
}
