import { useEffect, useState } from 'react'
import { useCaseUpdates } from '../hooks/useCaseUpdates'
import { usePublicIncidents } from '../hooks/usePublicIncidents'
import { reportReferences } from '../services/incidentService'
import { reportTrackingService, type TrackedReport } from '../services/reportTrackingService'
import { reportDate, statusLabels } from './CasePanels'
import { CommunityHeroBanner, ExploreReports } from './CommunityOverview'
import { EmergencyNotice, Hero } from './Layout'

const reference = (item: TrackedReport) => item.incident.reportId ?? item.incident.incidentId

function useMyReports(): TrackedReport[] {
  const version = useCaseUpdates()
  const [shared, setShared] = useState<TrackedReport[]>([])
  useEffect(() => {
    let active = true
    const refresh = () => Promise.allSettled(reportReferences().map(id => reportTrackingService.find(id))).then(results => {
      if (active) setShared(results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []))
    })
    void refresh()
    const timer = window.setInterval(refresh, 7000)
    return () => { active = false; window.clearInterval(timer) }
  }, [version])
  return [...shared].sort((a, b) => b.incident.createdAt.localeCompare(a.incident.createdAt))
}

export const assistanceLabels = {
  'not-assessed': 'Not assessed', needed: 'Assistance needed',
  'in-progress': 'In progress or awaiting confirmation', confirmed: 'Assistance confirmed',
} as const

function reportStatus({ incident, serviceCases, serviceProgress, recipientVerificationStatus }: TrackedReport) {
  if (incident.verificationStatus === 'pending-review') return 'Pending review'
  if (incident.verificationStatus === 'rejected') return 'Publication declined'
  if (!serviceCases?.length) return 'No service cases yet'
  return recipientVerificationStatus === 'not-requested'
    ? statusLabels[serviceProgress]
    : `${statusLabels[serviceProgress]} · ${statusLabels[recipientVerificationStatus]}`
}

export function CommunityDashboard() {
  const allReports = useMyReports()
  const reports = allReports.slice(0, 3)
  const { incidents, status } = usePublicIncidents()
  const recent = incidents.filter(item => item.area.toLowerCase() === 'milwaukee').sort((a, b) => b.reportedAt.localeCompare(a.reportedAt)).slice(0, 4)
  return <>
    <CommunityHeroBanner />
    <div className="page-width community-overview">
      <div className="home-content">
        <ExploreReports signedIn />
        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading">Recent Milwaukee incidents</h2>
          {status === 'loading' && <p role="status">Loading incidents…</p>}
          {status === 'error' && <p role="alert">Could not load community incidents.</p>}
          <ul className="dashboard-list community-incidents">{recent.map(item => <li key={item.id}>
            <a href={`#incident-map?id=${item.id}`} className="tip-text-link"><strong>{item.title}</strong></a>
            <p className="helper">{item.incidentType} · {item.area}{item.reportedAt && ` · ${item.dateBasis === 'source post' ? 'Source posted ' : ''}${reportDate(item.reportedAt + 'T12:00:00Z')}`}</p>
            <p className="community-status"><span className={`map-dot ${{
              needed: 'red', 'in-progress': 'yellow', confirmed: 'green', 'not-assessed': '',
            }[item.assistanceStatus]}`} aria-hidden="true" />{assistanceLabels[item.assistanceStatus]}</p>
          </li>)}</ul>
          <a className="secondary mt-4" href="#incident-map">View all incidents</a>
        </section>
      </div>
      <p className="community-welcome">Your reports on this browser</p>
      <div className="home-content">
        <section aria-labelledby="my-reports-heading">
          <h2 id="my-reports-heading">My Reports</h2>
          <p className="helper">{allReports.length} saved · {allReports.filter(item => item.incident.verificationStatus === 'pending-review').length} pending review</p>
          {!reports.length && <p className="helper mt-2">Your submitted reports will appear here.</p>}
          <ul className="dashboard-list">{reports.map(item => <li key={reference(item)}>
            <a className="tip-text-link" href={`#my-reports?id=${reference(item)}`}>{reference(item)}</a>
            <p className="helper">{reportDate(item.incident.createdAt)} · {reportStatus(item)}</p>
          </li>)}</ul>
          <a className="secondary mt-4" href="#my-reports">View My Reports</a>
        </section>
      </div>
      <div className="home-emergency"><EmergencyNotice /></div>
    </div>
  </>
}

export function MyReports({ selectedId }: { selectedId: string }) {
  const reports = useMyReports()
  const selected = reports.find(item => reference(item) === selectedId)
  return <>
    <Hero title="My reports">Review your submissions, service updates, and requests to verify assistance.</Hero>
    {selectedId && !selected && <p role="status" className="dashboard-card">This report is unavailable for this browser.</p>}
    {selected && <section className="dashboard-card mb-5">
      <h2>{reference(selected)}</h2>
      <p className="helper">Submitted {reportDate(selected.incident.createdAt)} · {reportStatus(selected)}</p>
      <a className="primary mt-3" href={`#track-report?id=${reference(selected)}`}>View review and service progress</a>
    </section>}
    <section className="dashboard-card">
      <h2>Reports associated with your account</h2>
      {reports.length === 0 && <p>No reports are associated with this browser yet.</p>}
      <ul className="dashboard-list">{reports.map(item => <li key={reference(item)}>
        <a className="tip-text-link" href={`#my-reports?id=${reference(item)}`}><strong>{reference(item)}</strong></a>
        <p className="helper">Submitted {reportDate(item.incident.createdAt)} · Report review: {item.incident.verificationStatus.replaceAll('-', ' ')}</p>
        <p>{reportStatus(item)}</p>
      </li>)}</ul>
      <a className="secondary mt-4" href="#track-report">Look up a report by ID</a>
    </section>
  </>
}
