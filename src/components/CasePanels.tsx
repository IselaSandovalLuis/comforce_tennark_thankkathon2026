import type { CaseSummary } from '../services/caseData'
import { organizationService } from '../services/organizationService'

export const statusLabels = {
  'not-started': 'Assistance needed', 'in-progress': 'In Progress', completed: 'Completed',
  'not-requested': 'Not Requested', 'awaiting-verification': 'Awaiting confirmation',
  confirmed: 'Assistance confirmed', disputed: 'Needs follow-up',
} as const

const centralDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'America/Chicago' })
const centralTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago' })
export const reportDate = (value: string) => centralDate.format(new Date(value))
export const reportTime = (value: string) => centralTime.format(new Date(value))
export const departmentName = (id: string) => organizationService.find(id)?.organizationName ?? id

export function CaseHistory({ item }: { item: CaseSummary }) {
  return <section className="case-history">
    <h3>Service history</h3>
    {item.updates.length === 0 ? <p>No service updates yet.</p> : <ol>
      {item.updates.map(update => {
        const verification = item.verifications.find(entry => entry.serviceUpdateId === update.updateId)
        return <li key={update.updateId}>
          <strong>{statusLabels[update.progressStatus]} · {departmentName(update.departmentId)}</strong>
          <time dateTime={update.createdAt}>{reportTime(update.createdAt)} CT</time>
          <p>{update.notes}</p>
          {update.workerId && <p className="helper">Updated by {update.workerId}</p>}
          {verification && <p className="verification-note">
            Recipient {verification.verificationStatus} · {reportTime(verification.verifiedAt)} CT
            {verification.feedback && <span>{verification.feedback}</span>}
          </p>}
        </li>
      })}
    </ol>}
  </section>
}

