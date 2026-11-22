export interface TipDraft {
  incidentId: string
  name: string
  phone: string
  email: string
  information: string
}

export interface Tip {
  tipId: string
  incidentId: string
  reporterName: string
  phoneNumber: string
  emailAddress: string
  additionalInformation: string
  reviewStatus: 'Pending Review' | 'Reviewed'
  createdAt: string
}
