import { useEffect, useState, type FormEvent } from 'react'
import { useCaseUpdates } from '../hooks/useCaseUpdates'
import { departments } from '../reports'
import { incidentMapService } from '../services/incidentMapService'
import { incidentId, reportId, utcTime } from '../services/incidentService'
import {
  caseLabels, incidentFields, reportingWorkflow, type IncidentFields, type OpenableIncident,
  type ReviewReport, type StaffIncident, type WorkerCase,
} from '../services/reportingWorkflow'
import type { User } from '../types/accounts'
import { CaseHistory, departmentName, reportTime } from './CasePanels'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Request failed. Try again.'
}

const serviceLabels: Record<string, string> = {
  shelter: 'Shelter', missing_person_support: 'Missing person support', food_assistance: 'Food assistance',
  violence_prevention_interruption: 'Violence prevention / interruption', transportation: 'Transportation',
  incident_de_escalation: 'Incident de-escalation', burial_assistance: 'Burial assistance', employment_support: 'Employment support',
}

function PrivateSubmissions({ incident }: { incident: StaffIncident }) {
  return <div className="grid gap-4 my-4">
    <section>
      <h3>Original reports</h3>
      {incident.reports.map(report => <details key={report.id} className="incident-detail">
        <summary>{reportId(report.id)} · {report.source} · {report.reviewed_at ? 'Reviewed' : 'Pending review'}</summary>
        <div className="p-3 grid gap-2">
          <p className="whitespace-pre-wrap">{report.original_text || 'No original text provided.'}</p>
          <p>{[report.name, report.email, report.phone].filter(Boolean).join(' · ') || 'No contact provided.'}</p>
          {report.anonymous === 1 && <p>Anonymous submission.</p>}
          {report.email_opt_in === 1 && <p>Email updates requested.</p>}
          {report.requested_department && <p>Requested department · {departmentName(report.requested_department)}</p>}
          {report.submitted_location && <p>Submitted location · {report.submitted_location}</p>}
          {report.post_id && <p>Post ID · {report.post_id}</p>}
          {report.post_url && <p className="break-all">Post URL · {report.post_url}</p>}
          {report.post_date && <p>Source post date · {report.post_date}</p>}
          {report.source_metadata?.post_time && <p>Source post time · {report.source_metadata.post_time}</p>}
          {report.related_post_urls && <p className="break-all">Related posts · {report.related_post_urls}</p>}
          {report.source_verification_status && <p>Source verification · {report.source_verification_status}</p>}
          {report.ai_summary && <div className="mt-3">
            <p><strong>AI summary</strong> · {report.ai_summary}</p>
            <p>Suggested assistance · {serviceLabels[report.suggested_service_category ?? ''] ?? 'None suggested'}</p>
            <p>Provisional team · {report.suggested_team ?? 'None suggested'}</p>
            {report.needs_review === 1 && !report.reviewed_at && <p>Coordinator review required.</p>}
          </div>}
          {report.reviewed_service_category && <p>Reviewed assistance · {serviceLabels[report.reviewed_service_category]}</p>}
          {report.manual_review_reason && <p>Review notes · {report.manual_review_reason}</p>}
        </div>
      </details>)}
    </section>
    <section>
      <h3>Tips</h3>
      {!incident.tips.length && <p className="helper">No tips submitted.</p>}
      {incident.tips.map(tip => <details key={tip.id} className="incident-detail">
        <summary>TIP-{tip.id} · {reportTime(utcTime(tip.created_at))}</summary>
        <div className="p-3">
          <p className="whitespace-pre-wrap">{tip.tip_text}</p>
          <p>{[tip.name, tip.email, tip.phone].filter(Boolean).join(' · ') || 'No contact provided.'}</p>
        </div>
      </details>)}
    </section>
  </div>
}

function ReviewForm({ item, incident, candidates, onSaved, onParsed }: {
  item: ReviewReport; incident: StaffIncident; candidates: OpenableIncident[]
  onSaved: () => void; onParsed: () => void
}) {
  const report = incident.reports.find(report => report.id === item.id)
  const [fields, setFields] = useState<IncidentFields>(() => ({
    ...incidentFields.reduce<IncidentFields>((values, key) => ({ ...values, [key]: incident[key] }), {}),
    ...report?.imported_fields,
    ...(report?.submitted_location ? { location: report.submitted_location } : {}),
    ...Object.fromEntries(Object.entries(report?.parser_output ?? {}).filter(([, value]) => value != null)),
    ...Object.fromEntries(Object.entries(report?.reporter_suggestions ?? {}).filter(([, value]) => value?.trim())),
  }))
  const [category, setCategory] = useState(report?.suggested_service_category ?? '')
  const [target, setTarget] = useState('')
  const [assistanceRequested, setAssistanceRequested] = useState(false)
  const [summary, setSummary] = useState('')
  const [areas, setAreas] = useState<string[]>([])
  const [area, setArea] = useState('')
  const [publicTime, setPublicTime] = useState('')
  const csvLatitude = report?.source_metadata?.latitude?.trim() ?? ''
  const csvLongitude = report?.source_metadata?.longitude?.trim() ?? ''

  const hasCsvCoordinates = csvLatitude !== '' && csvLongitude !== ''
    && Math.abs(Number(csvLatitude)) <= 90
    && Math.abs(Number(csvLongitude)) <= 180

  const [latitude, setLatitude] = useState(hasCsvCoordinates ? csvLatitude : '')
  const [longitude, setLongitude] = useState(hasCsvCoordinates ? csvLongitude : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    incidentMapService.areas().then(result => { if (active) setAreas(result) }).catch(() => {
      if (active) setError('Public area presets could not load. You can still enter reviewed coordinates.')
    })
    return () => { active = false }
  }, [])

  async function act(action: () => Promise<unknown>, finished: () => void) {
    setBusy(true)
    setError('')
    try {
      await action()
      finished()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  function approve(event: FormEvent) {
    event.preventDefault()
    void act(() => reportingWorkflow.review(item.id, target ? { incident_id: Number(target), service_category: category || null } : {
      service_category: category || null,
      fields, assistance_requested: assistanceRequested, public_summary: summary, public_area: area || undefined, public_time: publicTime || undefined,
      latitude: latitude.trim() ? Number(latitude) : undefined,
      longitude: longitude.trim() ? Number(longitude) : undefined,
    }), onSaved)
  }

  const labels = {
    incident_type: 'Incident type', city: 'City or general area', location: 'Private location',
    incident_date: 'Incident date', incident_time: 'Incident time', description: 'Private description',
  }

  return <>
    <PrivateSubmissions incident={incident} />
    {item.source === 'manual' &&
  (item.ai_status === 'ready' || item.ai_status === 'failed') && (
    <div className="my-3">
      <p className="helper">
        {item.ai_status === 'ready'
          ? 'AI suggestions are available in the original submission above.'
          : 'AI processing failed. Retry or review manually.'}
      </p>
      {item.ai_status === 'failed' && item.parse_status !== 'parsed' && (
        <button
          className="secondary mt-2"
          type="button"
          disabled={busy}
          onClick={() => void act(() => reportingWorkflow.parse(item.id), onParsed)}
        >
          Retry AI processing
        </button>
      )}
    </div>
  )}
    <form className="verification-panel grid gap-3" onSubmit={approve}>
      <div className="field"><label htmlFor="review-link">Same event as an approved incident?</label>
        <select id="review-link" value={target} onChange={event => setTarget(event.target.value)}>
          <option value="">Review and approve this incident</option>
          {candidates.filter(candidate => candidate.id !== item.incident_id).map(candidate =>
            <option key={candidate.id} value={candidate.id}>
              {incidentId(candidate.id)} · {candidate.incident_type ?? candidate.public_summary}
            </option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="review-service">Reviewed assistance category</label>
        <select id="review-service" value={category} onChange={event => setCategory(event.target.value)}>
          <option value="">No assistance category</option>
          {Object.entries(serviceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      {!target && <>
        <div className="grid gap-3 sm:grid-cols-2">
          {incidentFields.map(field => <div className="field" key={field}>
            <label htmlFor={`review-${field}`}>{labels[field]}</label>
            {field === 'description'
              ? <textarea id={`review-${field}`} value={fields[field] ?? ''} maxLength={5000}
                onChange={event => setFields(current => ({ ...current, [field]: event.target.value }))} />
              : <input id={`review-${field}`} type={field === 'incident_date' ? 'date' : field === 'incident_time' ? 'time' : 'text'}
                step={field === 'incident_time' ? 1 : undefined} value={fields[field] ?? ''} maxLength={250}
                onChange={event => setFields(current => ({ ...current, [field]: event.target.value }))} />}
          </div>)}
        </div>
        <div className="field">
          <label htmlFor="public-summary">Public summary</label>
          <textarea id="public-summary" maxLength={5000} required value={summary}
            onChange={event => setSummary(event.target.value)} />
        </div>
        <label className="anonymous-option">
          <input type="checkbox" checked={assistanceRequested} onChange={event => setAssistanceRequested(event.target.checked)} />
          <span>Show that assistance is needed on the public map</span>
        </label>
        <p className="helper">Publish a brief summary without names, contact information, or private addresses. Choose a public area to use its approximate map point, or enter reviewed general coordinates. Approving without either leaves the incident awaiting location verification.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="field"><label htmlFor="public-area">Public map area</label>
            <select id="public-area" value={area} onChange={event => setArea(event.target.value)}>
              <option value="">No named area</option>{areas.map(name => <option key={name}>{name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="public-time">Public incident time (optional)</label>
            <input id="public-time" type="time" value={publicTime} onChange={event => setPublicTime(event.target.value)} /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="field"><label htmlFor="public-latitude">Public latitude</label>
            <input id="public-latitude" type="number" step="any" min="-90" max="90" value={latitude}
              onChange={event => setLatitude(event.target.value)} /></div>
          <div className="field"><label htmlFor="public-longitude">Public longitude</label>
            <input id="public-longitude" type="number" step="any" min="-180" max="180" value={longitude}
              onChange={event => setLongitude(event.target.value)} /></div>
        </div>
      </>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="primary justify-self-start" type="submit" disabled={busy}>
        {target ? 'Link and approve report' : 'Approve incident'}
      </button>
      <button className="secondary justify-self-start" type="button" disabled={busy}
        onClick={() => {
          if (window.confirm('Decline publication for this report? The original submission will remain in SQLite.')) {
            void act(() => reportingWorkflow.decline(item.id), onSaved)
          }
        }}>Decline publication</button>
    </form>
  </>
}

export function StaffReview({ candidates }: { candidates: OpenableIncident[] }) {
  const [queue, setQueue] = useState<ReviewReport[]>([])
  const [selected, setSelected] = useState('')
  const [incident, setIncident] = useState<StaffIncident>()
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const item = queue.find(report => String(report.id) === selected)
  const target = item?.incident_id

  useEffect(() => {
    let active = true
    const load = () => reportingWorkflow.reviewQueue().then(result => { if (active) setQueue(result) })
      .catch(cause => { if (active) setError(errorMessage(cause)) })
    void load()
    const timer = window.setInterval(load, 7000)
    return () => { active = false; window.clearInterval(timer) }
  }, [version])

  useEffect(() => {
    if (!target) return
    let active = true
    reportingWorkflow.incident(target).then(result => { if (active) setIncident(result) })
      .catch(cause => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [selected, target, version])

  return <section className="dashboard-card my-5">
    <h2>Report review</h2>
    <p className="helper">{queue.length} pending</p>
    <div className="field">
      <label htmlFor="review-report">Reports pending review</label>
      <select id="review-report" value={selected} onChange={event => {
        setIncident(undefined)
        setError('')
        setSaved(false)
        setSelected(event.target.value)
      }}>
        <option value="">{queue.length ? 'Select a report' : 'No pending reports'}</option>
        {queue.map(report => <option value={report.id} key={report.id}>
          {reportId(report.id)} · {report.incident_type ?? report.source}{report.post_id && ` · ${report.post_id}`}
        </option>)}
      </select>
    </div>
    {error && <p role="alert" className="field-error">{error}</p>}
    {saved && <p role="status" className="success-note">Review saved.</p>}
    {item && incident && incident.id === target && <ReviewForm key={`${item.id}-${version}`} item={item} incident={incident}
      candidates={candidates} onSaved={() => {
        setSelected('')
        setIncident(undefined)
        setSaved(true)
        setVersion(current => current + 1)
      }} onParsed={() => setVersion(current => current + 1)} />}
  </section>
}

export function OpenCaseForm({ candidates, user, initialIncident = '' }: {
  candidates: OpenableIncident[]; user: User; initialIncident?: string
}) {
  const [incident, setIncident] = useState(initialIncident)
  const [organization, setOrganization] = useState(user.organizationId ?? 'comforce')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function open(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await reportingWorkflow.openCase(Number(incident), organization)
      window.location.hash = `manage-incidents?id=CASE-${result.case_id}`
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return <form className="dashboard-card grid gap-3 mb-5" onSubmit={open}>
    <h2>Open an organization case</h2>
    <div className="field">
      <label htmlFor="open-incident">Approved incident</label>
      <select id="open-incident" value={incident} onChange={event => setIncident(event.target.value)} required>
        <option value="">{candidates.length ? 'Select an incident' : 'No eligible incidents'}</option>
        {candidates.map(item => <option key={item.id} value={item.id}>
          {incidentId(item.id)} · {item.incident_type ?? item.public_summary}
        </option>)}
      </select>
    </div>
    {user.staffRole === 'admin' && <div className="field">
      <label htmlFor="case-organization">Organization</label>
      <select id="case-organization" value={organization} onChange={event => setOrganization(event.target.value)}>
        {departments.filter(department => department.id !== 'other').map(department =>
          <option value={department.id} key={department.id}>{department.label}</option>)}
      </select>
    </div>}
    {error && <p role="alert" className="field-error">{error}</p>}
    <button className="primary justify-self-start" type="submit" disabled={busy || !incident}>Open case</button>
  </form>
}

function IncidentFacts({ incident }: { incident: StaffIncident }) {
  return <div className="my-4">
    <h3>{incidentId(incident.id)} · {incident.incident_type ?? 'Unclassified incident'}</h3>
    <p className="helper">{[incident.incident_date, incident.incident_time, incident.location ?? incident.city].filter(Boolean).join(' · ') || 'Date and location were not reported.'}</p>
    <p className="mt-2 whitespace-pre-wrap">{incident.description ?? 'No reviewed description.'}</p>
    <PrivateSubmissions incident={incident} />
  </div>
}

export function SharedIncidentDetails({ id }: { id: number }) {
  const [incident, setIncident] = useState<StaffIncident>()
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    reportingWorkflow.incident(id).then(result => { if (active) setIncident(result) })
      .catch(cause => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [id])
  return <section className="dashboard-card mb-5" aria-label="Full incident">
    <h2>Full incident report</h2>
    {incident ? <IncidentFacts incident={incident} /> : <p role="status">{error || 'Loading incident…'}</p>}
  </section>
}

export function SharedCaseDetails({ item }: { item: WorkerCase }) {
  const [incident, setIncident] = useState<StaffIncident>()
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    const load = () => reportingWorkflow.incident(item.databaseIncidentId)
      .then(result => { if (active) setIncident(result) })
      .catch(cause => { if (active) setError(errorMessage(cause)) })
    void load()
    const timer = window.setInterval(load, 7000)
    return () => { active = false; window.clearInterval(timer) }
  }, [item.databaseIncidentId])

  async function save(status: 'in-progress' | 'completed') {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await reportingWorkflow.updateCase(item.caseId, status, notes)
      setNotes('')
      setSaved(true)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return <section className="dashboard-card mb-5">
    <h2>CASE-{item.caseId} · {item.incident.incidentId} · {departmentName(item.organization)}</h2>
    <p><strong>{item.state === 'awaiting_confirmation' && !item.confirmationAvailable
      ? 'Completed without an opted-in recipient' : caseLabels[item.state]}</strong></p>
    {incident && <IncidentFacts incident={incident} />}
    <CaseHistory item={item} />
    {item.state !== 'awaiting_confirmation' && item.state !== 'assistance_confirmed' && <section className="verification-panel grid gap-3">
      <h3>Record a service update</h3>
      <div className="field"><label htmlFor="shared-update-note">Notes (optional)</label>
        <textarea id="shared-update-note" value={notes} maxLength={2000} onChange={event => setNotes(event.target.value)} />
      </div>
      <div className="flex flex-wrap gap-3">
        {item.state !== 'in_progress' && <button className="primary" type="button" disabled={busy}
          onClick={() => void save('in-progress')}>Mark in progress</button>}
        {item.state !== 'assistance_needed' && <button className="primary" type="button" disabled={busy}
          onClick={() => void save('completed')}>Mark completed</button>}
      </div>
    </section>}
    {saved && <p role="status" className="success-note">Service update saved.</p>}
    {error && <p role="alert" className="field-error">{error}</p>}
  </section>
}

export function DemoInbox() {
  const version = useCaseUpdates()
  const [refresh, setRefresh] = useState(0)
  const [messages, setMessages] = useState<Awaited<ReturnType<typeof reportingWorkflow.inbox>>>([])
  const [outbox, setOutbox] = useState<Awaited<ReturnType<typeof reportingWorkflow.outbox>>>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([reportingWorkflow.inbox(), reportingWorkflow.outbox()]).then(([inbox, delivery]) => {
      if (!active) return
      setMessages(inbox)
      setOutbox(delivery)
    }).catch(cause => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [version, refresh])

  async function retry() {
    setBusy(true)
    setError('')
    try {
      await reportingWorkflow.retry()
      setRefresh(current => current + 1)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return <section className="dashboard-card mt-5">
    <h2>Demo email inbox</h2>
    <p className="helper">Open a response link to demonstrate the recipient’s email experience.</p>
    <button className="secondary my-3" type="button" disabled={busy} onClick={() => void retry()}>Retry queued or failed emails</button>
    {error && <p role="alert" className="field-error">{error}</p>}
    {!messages.length && <p>No demo emails delivered.</p>}
    <ul className="dashboard-list">
      {messages.map(message => <li key={message.notification_id}>
        <strong>{message.email}</strong><p>{message.message}</p>
        {message.response_url && <a className="tip-text-link" href={message.response_url}
          target="_blank" rel="noreferrer">Open recipient response form</a>}
      </li>)}
    </ul>
    {outbox.some(message => message.status !== 'sent') && <ul className="dashboard-list" aria-label="Pending delivery">
      {outbox.filter(message => message.status !== 'sent').map(message => <li key={message.id}>
        Email {message.id} · {message.status} · {message.attempts} attempts
        {message.last_error && ` · ${message.last_error}`}
      </li>)}
    </ul>}
  </section>
}
