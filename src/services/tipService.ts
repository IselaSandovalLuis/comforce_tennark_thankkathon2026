import { validateTip } from '../tips'
import type { Tip, TipDraft } from '../types/tip'
import { apiRequest } from './apiClient'

export const tipService = {
  async submit(draft: TipDraft): Promise<Tip> {
    const incidentId = draft.incidentId.trim().toUpperCase()
    const id = /^MKE-(\d+)$/.exec(incidentId)?.[1]
    if (!id || Object.keys(validateTip(draft)).length) throw new Error('Check the tip fields.')
    const saved = await apiRequest<{ tip_id: number }>(`/api/incidents/${id}/tips`, {
      method: 'POST',
      body: JSON.stringify({ tip_text: draft.information, name: draft.name, email: draft.email, phone: draft.phone }),
    })
    return {
      tipId: `TIP-${saved.tip_id}`, incidentId, reporterName: draft.name,
      phoneNumber: draft.phone, emailAddress: draft.email, additionalInformation: draft.information,
      reviewStatus: 'Pending Review', createdAt: new Date().toISOString(),
    }
  },
}
