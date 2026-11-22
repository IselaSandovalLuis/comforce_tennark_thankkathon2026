import { useEffect, useState } from 'react'
import { useCaseUpdates } from '../hooks/useCaseUpdates'
import { assignedDepartment, type CaseSummary } from '../services/caseData'
import type { User } from '../types/accounts'
import { departmentName, reportDate, reportTime, statusLabels } from './CasePanels'
import { Hero } from './Layout'
import { reportingWorkflow, type OpenableIncident, type WorkerCase } from '../services/reportingWorkflow'
import { DemoInbox, OpenCaseForm, SharedCaseDetails, SharedIncidentDetails, StaffReview } from './StaffWorkflow'
import { PossibleDuplicates } from './PossibleDuplicates'

const caseKey = (item: CaseSummary) => 'caseId' in item ? `CASE-${item.caseId}` : item.incident.incidentId

const progressTypes = ['not-started', 'in-progress', 'completed'] as const
const verificationTypes = ['awaiting-verification', 'confirmed', 'disputed'] as const

function Activity({ cases, organizationId }: { cases: CaseSummary[]; organizationId: string }) {
  const updates = cases.flatMap(item => item.updates.map(update => ({ ...update, routeId: caseKey(item) })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return <section className="dashboard-card">
    <h2>Recent department activity</h2>
    <p className="helper">{updates.filter(update => update.departmentId === organizationId && update.progressStatus === 'completed').length} completed updates recorded for {departmentName(organizationId)}.</p>
    <ul className="dashboard-list">{updates.slice(0, 8).map(update => <li key={update.updateId}>
      <a className="tip-text-link" href={`#manage-incidents?id=${update.routeId}`}>{update.incidentId}</a>
      <p>{statusLabels[update.progressStatus]} · {departmentName(update.departmentId)}</p>
      <time className="helper" dateTime={update.createdAt}>{reportTime(update.createdAt)} CT</time>
    </li>)}</ul>
    {updates.length === 0 && <p>No service updates yet.</p>}
  </section>
}

function attention(item: CaseSummary) {
  if (item.recipientVerificationStatus === 'disputed') return { rank: 0, label: 'Disputed assistance' }
  if (item.serviceProgress === 'not-started') return { rank: 1, label: 'Work has not started' }
  if (item.recipientVerificationStatus === 'awaiting-verification') return { rank: 2, label: 'Awaiting recipient verification' }
  if (!item.incident.incidentType || !item.incident.incidentLocation) return { rank: 3, label: 'Missing incident details' }
  return undefined
}

function Attention({ cases }: { cases: CaseSummary[] }) {
  const items = cases.flatMap(item => {
    const issue = attention(item)
    return issue ? [{ id: caseKey(item), ...issue }] : []
  }).sort((a, b) => a.rank - b.rank)
  return <section className="dashboard-card">
    <h2>Cases requiring attention</h2>
    <ul className="dashboard-list">{items.slice(0, 8).map(item => <li key={item.id}>
      <a className="tip-text-link" href={`#manage-incidents?id=${item.id}`}>{item.id}</a>
      <p>{item.label}</p>
    </li>)}</ul>
    {items.length === 0 && <p>No cases require attention.</p>}
  </section>
}

export function IncidentManagementTable({
                                          cases,
                                          showPossibleDuplicates = false
}: { cases: CaseSummary[]
     showPossibleDuplicates?: boolean
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [from, setFrom] = useState('')
  const [through, setThrough] = useState('')
  const types = [...new Set(cases.map(item => item.incident.incidentType ?? 'Unclassified'))].sort()
  const shown = cases.filter(item => {
    const { incident, serviceProgress, recipientVerificationStatus } = item
    const search = query.trim().toLowerCase()
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Chicago' }).format(new Date(incident.createdAt))
    return (!search || `${incident.incidentId} ${incident.incidentLocation?.rawAddress ?? ''}`.toLowerCase().includes(search))
      && (!status || status === serviceProgress || status === recipientVerificationStatus)
      && (!type || type === (incident.incidentType ?? 'Unclassified'))
      && (!from || date >= from) && (!through || date <= through)
  })
  return <section className="dashboard-card">
    <h2>Manage incidents</h2>
    <div className="dashboard-filters">
      <div className="field"><label htmlFor="worker-search">Search ID or location</label><input id="worker-search" type="search" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <div className="field"><label htmlFor="worker-status">Status</label><select id="worker-status" value={status} onChange={e => setStatus(e.target.value)}>
        <option value="">All statuses</option>
        {[...progressTypes, ...verificationTypes].map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}
      </select></div>
      <div className="field"><label htmlFor="worker-type">Incident type</label><select id="worker-type" value={type} onChange={e => setType(e.target.value)}>
        <option value="">All types</option>{types.map(value => <option key={value}>{value}</option>)}
      </select></div>
      <div className="field"><label htmlFor="worker-from">From date</label><input id="worker-from" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
      <div className="field"><label htmlFor="worker-through">Through date</label><input id="worker-through" type="date" value={through} onChange={e => setThrough(e.target.value)} /></div>
    </div>
    {showPossibleDuplicates && <PossibleDuplicates />}
    <p className="helper my-3" role="status">{shown.length} of {cases.length} incidents</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Organization incidents table">
      <table>
        <thead><tr>{['Incident ID','Incident Type','Incident Location','Date Reported','Responsible Department','Service Progress','Recipient Verification','Last Updated','Actions'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{shown.map(item => {
          const { incident } = item
          return <tr key={caseKey(item)}>
            <th scope="row">{incident.incidentId}</th><td>{incident.incidentType ?? 'Unclassified'}</td>
            <td>{incident.incidentLocation?.rawAddress ?? 'Not provided'}</td><td>{reportDate(incident.createdAt)}</td>
            <td>{departmentName(assignedDepartment(incident))}</td><td>{statusLabels[item.serviceProgress]}</td>
            <td>{statusLabels[item.recipientVerificationStatus]}</td><td>{reportTime(item.lastUpdated)} CT</td>
            <td><a className="tip-text-link" href={`#manage-incidents?id=${caseKey(item)}`} aria-label={`Open ${incident.incidentId}`}>Open</a></td>
          </tr>
        })}</tbody>
      </table>
    </div>
  </section>
}

export function WorkerDashboard({ user, view, selectedId }: {
  user: User; view: 'dashboard' | 'manage-incidents' | 'service-updates'; selectedId: string
}) {
  const version = useCaseUpdates()
  const [sharedCases, setCases] = useState<WorkerCase[]>([])
  const [candidates, setCandidates] = useState<OpenableIncident[]>([])
  const [failure, setFailure] = useState('')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!user.staffRole) return
    let active = true
    async function refresh() {
      try {
        const [cases, incidents] = await Promise.all([
            reportingWorkflow.cases(),
            reportingWorkflow.candidates(),
        ] as const)

        if (!active) return
        setCases(cases)
        setCandidates(incidents)
        setLoaded(true)
        setFailure('')
      } catch (cause) {
        if (active) setFailure(cause instanceof Error ? cause.message : 'Could not load shared cases.')
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 7000)
    return () => { active = false; window.clearInterval(timer) }
  }, [user, version])
  const cases = sharedCases
  const organizationId = user.organizationId!
  const selected = cases.find(item => caseKey(item) === selectedId)
  const openIncident = user.staffRole ? /^MKE-(\d+)$/.exec(selectedId)?.[1] : undefined
  const headings = { dashboard: `Welcome, ${user.username}`, 'manage-incidents': 'Incident management', 'service-updates': 'Service updates' }
  const progressCounts = progressTypes.map(status => cases.filter(item => item.serviceProgress === status).length)
  const stats = [
    ['Service cases', cases.length],
    ...progressTypes.map((status, index) => [statusLabels[status], progressCounts[index]] as const),
    ...verificationTypes.map(status => [
      status === 'confirmed' ? 'Confirmed Assistance' : status === 'disputed' ? 'Disputed Updates' : statusLabels[status],
      cases.filter(item => item.recipientVerificationStatus === status).length,
    ] as const),
  ] as const
  return <>
    <Hero title={headings[view]}>Organization: {departmentName(organizationId)}</Hero>
    {failure && <p role="alert" className="field-error">{failure}</p>}
    {view === 'service-updates' && <Activity cases={cases} organizationId={organizationId} />}
    {view === 'service-updates' && user.staffRole === 'admin' && <DemoInbox />}
    {view === 'manage-incidents' && openIncident && user.staffRole === 'admin' && <SharedIncidentDetails key={openIncident} id={Number(openIncident)} />}
    {view === 'manage-incidents' && selectedId && !selected && !openIncident && !failure &&
      <p role="status" className="dashboard-card">{user.staffRole && !loaded ? 'Loading the requested case…' : 'This incident is unavailable to your organization.'}</p>}
    {view === 'manage-incidents' && user.staffRole && selected && <SharedCaseDetails key={selectedId} item={selected as WorkerCase} />}
    {view === 'manage-incidents' && user.staffRole && <OpenCaseForm key={openIncident ?? 'choose'} candidates={candidates} user={user} initialIncident={openIncident} />}
    {view === 'manage-incidents' && user.staffRole === 'admin' && <StaffReview candidates={candidates} />}
    {view === 'dashboard' && <>
      <dl className="stat-grid">{stats.map(([label, value]) => <div className="dashboard-card stat-card" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="dashboard-grid my-5">
        <section className="dashboard-card"><h2>Incident status breakdown</h2>
          <ul className="status-chart">{progressTypes.map((status, index) => <li key={status}>
            <div><span>{statusLabels[status]}</span><strong>{progressCounts[index]}</strong></div>
            <progress aria-label={statusLabels[status]} value={progressCounts[index]} max={cases.length || 1} />
          </li>)}</ul>
        </section>
        <Attention cases={cases} />
      </div>
      <div className="mb-5"><Activity cases={cases} organizationId={organizationId} /></div>
    </>}
        {view !== 'service-updates' && (
      <IncidentManagementTable
        cases={cases}
        showPossibleDuplicates={view === 'manage-incidents' && user.staffRole === 'admin'}
      />
    )}
  </>
}
