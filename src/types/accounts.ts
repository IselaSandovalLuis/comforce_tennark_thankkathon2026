export type Role = 'community_member' | 'service_worker'
export type AccountStatus = 'active' | 'pending-verification'

export interface User {
  staffRole?: 'worker' | 'admin'
  userId: string
  username: string
  email: string
  role: Role
  organizationId: string | null
  accountStatus: AccountStatus
  createdAt: string
}

export interface Organization {
  organizationId: string
  organizationName: string
  organizationType: 'coordination' | 'department' | 'community'
  verificationStatus: 'verified' | 'pending'
}

export type ServiceProgressStatus = 'not-started' | 'in-progress' | 'completed'
export type RecipientVerificationStatus = 'not-requested' | 'awaiting-verification' | 'confirmed' | 'disputed'

export interface ServiceUpdate {
  updateId: string
  incidentId: string
  workerId: string
  departmentId: string
  progressStatus: 'in-progress' | 'completed'
  notes: string
  createdAt: string
}

export interface RecipientVerification {
  verificationId: string
  incidentId: string
  serviceUpdateId: string
  recipientId: string
  verificationStatus: 'confirmed' | 'disputed'
  feedback: string
  verifiedAt: string
}

export interface Notification {
  notificationId: string
  recipientId: string
  incidentId: string
  notificationType: 'service-progress' | 'verification-requested' | 'assistance-disputed'
  message: string
  deliveryStatus: 'in-app'
  createdAt: string
}
