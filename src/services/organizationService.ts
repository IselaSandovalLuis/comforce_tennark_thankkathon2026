import { departments } from '../reports'
import type { Organization } from '../types/accounts'

const organizations: Organization[] = departments.map(({ id, label }) => ({
  organizationId: id,
  organizationName: id === 'comforce' ? 'Comforce' : id === 'other' ? 'Other Organization' : label,
  organizationType: id === 'comforce' ? 'coordination' : ['other', 'community-support'].includes(id) ? 'community' : 'department',
  verificationStatus: id === 'other' ? 'pending' : 'verified',
}))

export const organizationService = {
  list: () => organizations as readonly Organization[],
  find: (id: string | null) => organizations.find(item => item.organizationId === id),
}
