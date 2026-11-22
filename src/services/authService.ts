import type { User } from '../types/accounts'
import { apiRequest } from './apiClient'

interface StaffIdentity { username: string; organization: string; role: 'worker' | 'admin' }

let staff: User | null = null
const accountChange = 'comforce-account-change'

function update(identity: StaffIdentity | null) {
  staff = identity ? {
    userId: identity.username, username: identity.username, email: '',
    role: 'service_worker', organizationId: identity.organization, accountStatus: 'active',
    createdAt: '', staffRole: identity.role,
  } : null
  window.dispatchEvent(new Event(accountChange))
}

export const authService = {
  current: () => staff,
  async login(username: string, password: string) {
    update(await apiRequest<StaffIdentity>('/api/staff/login', {
      method: 'POST', body: JSON.stringify({ username, password }),
    }))
  },
  async restoreStaff() {
    try { update(await apiRequest<StaffIdentity>('/api/staff/me')) }
    catch { update(null) }
  },
  async logout() {
    await apiRequest('/api/staff/logout', { method: 'POST' })
    update(null)
  },
  subscribe(listener: () => void) {
    window.addEventListener(accountChange, listener)
    return () => window.removeEventListener(accountChange, listener)
  },
}

export function canManageIncidents(user: User | null): user is User & { organizationId: string } {
  return Boolean(user?.staffRole && user.organizationId)
}
