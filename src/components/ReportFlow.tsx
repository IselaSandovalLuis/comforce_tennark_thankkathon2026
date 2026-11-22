import { useState, type FormEvent } from 'react'
import { Check, ClipboardCheck, Info, LoaderCircle, Pencil, Send } from 'lucide-react'
import { departmentLabel, emptyDraft, validate, type ReportDraft } from '../reports'
import { incidentService } from '../services/incidentService'
import type { Incident } from '../types/incident'
import { CardHeading, ReportForm } from './ReportForm'
import { EmergencyNotice, Hero } from './Layout'

type SummaryDetails = Omit<ReportDraft, 'location'> & { location: Incident['incidentLocation'] }

function ReportSummary({ draft }: { draft: SummaryDetails }) {
  const contact = [draft.email.trim(), draft.phone.trim()].filter(Boolean).join(' · ')
  return <dl className="summary">
    <div><dt>Reporter</dt><dd>{draft.anonymous ? 'Anonymous' : draft.name.trim() || 'Not provided'}</dd></div>
    <div><dt>Contact information</dt><dd>{contact || 'None provided'}</dd></div>
    <div><dt>Incident location</dt><dd className="whitespace-pre-wrap">{draft.location?.rawAddress || 'Not provided'}</dd></div>
    <div><dt>Selected department</dt><dd>{departmentLabel(draft.department)}</dd></div>
    <div><dt>Incident description</dt><dd className="whitespace-pre-wrap">{draft.description.trim()}</dd></div>
  </dl>
}

export function IncidentReportSummary({ incident }: { incident: Incident }) {
  return <ReportSummary draft={{
    anonymous: incident.anonymous,
    name: incident.reporterName,
    email: incident.reporterContact.email,
    phone: incident.reporterContact.phone,
    location: incident.incidentLocation,
    description: incident.originalDescription,
    department: incident.selectedDepartment,
  }} />
}

export function ReportFlow({ visible }: { visible: boolean }) {
  const [draft, setDraft] = useState<ReportDraft>(emptyDraft)
  const [validated, setValidated] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [report, setReport] = useState<Incident>()

  function focusHeading() {
    requestAnimationFrame(() => {
      if (!document.getElementById('report-workflow')) return
      document.getElementById('page-title')?.focus({ preventScroll: true })
      window.scrollTo(0, 0)
    })
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setValidated(true)
    const firstInvalid = Object.keys(validate(draft))[0]
    if (firstInvalid) {
      requestAnimationFrame(() => document.getElementById(firstInvalid)?.focus())
      return
    }
    setReviewing(true)
    focusHeading()
  }

  async function submit() {
    if (saving) return
    setFailed(false)
    setSaving(true)
    try {
      setReport(await incidentService.submit(draft))
      focusHeading()
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setReport(undefined)
    setDraft(emptyDraft)
    setReviewing(false)
    setValidated(false)
    setFailed(false)
    focusHeading()
  }

  if (!visible) return null

  return <div id="report-workflow">
    <Hero title={report ? 'Report saved' : reviewing ? 'Review your report' : 'Submit an incident report'}>
      {report ? 'Keep your report ID to find this submission again.' :
        reviewing ? 'Check the details below before saving your report.' :
        'Share what happened and tell us where you’d like to request support.'}
    </Hero>
    <div className="page-columns">
      <aside className="report-sidebar">
        <EmergencyNotice />
        <div className="side-card">
          <span className="section-icon" aria-hidden="true"><Info size={20} /></span>
          <h2>About this prototype</h2>
          <p>Staff review submissions before they can appear on the map. The server may use AI to suggest support options.</p>
        </div>
      </aside>
      {report ? <section className="card" aria-label="Submission confirmation">
        <CardHeading icon={<Check size={22} />} title="Submission confirmed">Your report was saved and is pending staff review.</CardHeading>
        <div className="report-id"><span>Report ID</span><strong>{report.reportId}</strong></div>
        <p className="helper mt-3">Keep this private tracking key if you want to look up your report on another device.</p>
        <p className="break-all"><code>{report.trackingKey}</code></p>
        <IncidentReportSummary incident={report} />
        <div className="form-actions">
          <button type="button" className="secondary" onClick={reset}>Start another report</button>
          <a className="primary" href={`#track-report?id=${encodeURIComponent(report.reportId ?? report.incidentId)}`}>Track this report</a>
        </div>
      </section> : reviewing ? <section className="card" aria-label="Review submission">
        <CardHeading icon={<ClipboardCheck size={21} />} title="Submission summary">You can edit your information before submitting.</CardHeading>
        <ReportSummary draft={draft} />
        {failed && <p className="field-error" role="alert">The report could not be saved. Check your connection and try again.</p>}
        <div className="form-actions" aria-busy={saving}>
          <button type="button" className="secondary" disabled={saving} onClick={() => {
            setReviewing(false)
            setFailed(false)
            focusHeading()
          }}><Pencil size={16} aria-hidden="true" /> Edit report</button>
          <button type="button" className="primary" disabled={saving} onClick={submit}>
            {saving ? <LoaderCircle className="animate-spin" size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
            {saving ? 'Saving report…' : 'Submit Report'}
          </button>
        </div>
        <p role="status" className="sr-only">{saving ? 'Saving your report.' : ''}</p>
      </section> : <ReportForm draft={draft} errors={validated ? validate(draft) : {}}
        update={(key, value) => {
          setDraft(current => ({ ...current, [key]: value }))
        }} onReview={review} />}
    </div>
  </div>
}
