import { useState, type FormEvent } from 'react'
import { Search } from 'lucide-react'
import { CaseHistory, departmentName, reportDate, statusLabels } from './CasePanels'
import { reportTrackingService, type TrackedReport } from '../services/reportTrackingService'
import { EmergencyNotice, Hero } from './Layout'
import { CommunityHeroBanner, ExploreReports } from './CommunityOverview'
import { CardHeading } from './ReportForm'

const serviceStatuses = [
  { label: 'Assistance needed', color: 'red', detail: 'The report identifies a need for support. A referral has yet to be made.' },
  { label: 'In progress', color: 'yellow', detail: 'A referral is pending or a provider is working on the request.' },
  { label: 'Assistance confirmed', color: 'green', detail: 'The affected person or family has confirmed that they received support.' },
] as const

function ServiceStatusPreview() {
  const [selected, setSelected] = useState(0)
  return <section className="status-preview" aria-labelledby="status-heading">
    <h2 id="status-heading">What the map colors mean</h2>
    <p>Choose a status to see how assistance would be tracked.</p>
    <ul className="status-options">
      {serviceStatuses.map(({ label, color }, index) => <li key={color}>
        <button type="button" aria-pressed={selected === index} aria-controls="status-description"
          onClick={() => setSelected(index)}>
          <span className={`map-dot ${color}`} aria-hidden="true" />{label}
        </button>
      </li>)}
    </ul>
    <p className="status-description" id="status-description" role="status">{serviceStatuses[selected].detail}</p>
  </section>
}

export function Home() {
  return <>
    <CommunityHeroBanner />
    <div className="page-width">
      <div className="home-content">
        <ExploreReports />
        <ServiceStatusPreview />
      </div>
      <div className="home-emergency"><EmergencyNotice /></div>
    </div>
  </>
}

export function TrackReport({ initialId }: { initialId: string }) {
  const [id, setId] = useState(initialId)
  const [key, setKey] = useState('')
  const [report, setReport] = useState<TrackedReport>()
  const [message, setMessage] = useState('')

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setReport(undefined)
    if (!id.trim()) {
      setMessage('Enter your report ID.')
      document.getElementById('lookup-id')?.focus()
      return
    }
    try {
      const found = await reportTrackingService.find(id, key)
      setReport(found)
      setMessage(found ? 'Report found.' : 'Could not find that report. Check the ID and private tracking key.')
    } catch {
      setMessage('Could not retrieve the report. Try again.')
    }
  }

  return <>
    <Hero title="Track a report">Look up review and service progress for your report.</Hero>
    <section className="card secondary-page">
      <CardHeading icon={<Search size={21} />} title="Look up a report">Enter your report ID. Use the private tracking key if you submitted it on another device.</CardHeading>
      <form onSubmit={lookup} noValidate>
        <div className="field">
          <label htmlFor="lookup-id">Report ID</label>
          <input id="lookup-id" value={id} onChange={event => {
            setId(event.target.value)
            setMessage('')
            setReport(undefined)
          }} required aria-invalid={Boolean(message && !report)} aria-describedby="lookup-status"
            placeholder="Enter your report ID" autoComplete="off" spellCheck={false} />
        </div>
        {/^RPT-/i.test(id) && <div className="field mt-3">
          <label htmlFor="lookup-key">Private tracking key</label>
          <input id="lookup-key" type="password" autoComplete="off" value={key}
            onChange={event => setKey(event.target.value)} />
        </div>}
        <button className="primary mt-4" type="submit">Find report</button>
      </form>
      <p id="lookup-status" className={report ? 'lookup-success' : 'field-error'} role="status">{message}</p>
      {report?.serviceCases ? <section className="mt-4">
        <h2>{report.incident.reportId} · {report.incident.incidentId}</h2>
        <p>Review status: {report.incident.verificationStatus.replaceAll('-', ' ')}</p>
        {!report.serviceCases.length && <p>No service cases yet.</p>}
        {report.serviceCases.map(item => <section key={item.incident.assignedDepartment} className="mt-4">
          <h3>{departmentName(item.incident.assignedDepartment ?? '')}</h3>
          <p>{statusLabels[item.serviceProgress]}{item.recipientVerificationStatus !== 'not-requested' && ` · ${statusLabels[item.recipientVerificationStatus]}`}</p>
          <CaseHistory item={item} />
        </section>)}
      </section> : null}
    </section>
  </>
}
