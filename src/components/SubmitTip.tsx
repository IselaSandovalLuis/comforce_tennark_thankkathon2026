import { useRef, useState, type FormEvent } from 'react'
import { Check, FileSearch, LockKeyhole, MessageSquarePlus, UserRound } from 'lucide-react'
import { usePublicIncidents } from '../hooks/usePublicIncidents'
import { tipService } from '../services/tipService'
import { tipInformationLimit, validateTip } from '../tips'
import type { Tip, TipDraft } from '../types/tip'
import { EmergencyNotice, Hero } from './Layout'
import { CardHeading } from './ReportForm'

const emptyTip: TipDraft = { incidentId: '', name: '', phone: '', email: '', information: '' }

const fieldIds: Record<keyof TipDraft, string> = {
  incidentId: 'incident-search',
  name: 'tip-name',
  phone: 'tip-phone',
  email: 'tip-email',
  information: 'tip-information',
}

export function SubmitTip({ initialId }: { initialId: string }) {
  const { incidents, status } = usePublicIncidents()
  const [draft, setDraft] = useState({ ...emptyTip, incidentId: initialId.trim().toUpperCase() })
  const [query, setQuery] = useState(initialId)
  const [anonymous, setAnonymous] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState(false)
  const [tip, setTip] = useState<Tip>()
  const submissionInProgress = useRef(false)
  const selected = incidents.find(incident => incident.id === draft.incidentId)
  const lockedIncident = Boolean(initialId.trim())
  const submission = { ...draft, ...(anonymous ? { name: '', phone: '', email: '' } : {}), incidentId: selected?.id ?? '' }
  const search = query.trim().toLowerCase()
  const matches = incidents.filter(({ id, title, area }) =>
    [id, title, area].some(value => value.toLowerCase().includes(search)))
  const errors = attempted ? validateTip(submission) : {}

  function update(field: keyof TipDraft, value: string) {
    setDraft(current => ({ ...current, [field]: value }))
  }

  function selectIncident(id: string) {
    update('incidentId', id)
    requestAnimationFrame(() => document.getElementById('selected-incident')?.focus())
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionInProgress.current) return
    setAttempted(true)
    setFailure(false)
    const firstError = (Object.keys(validateTip(submission)) as (keyof TipDraft)[])[0]
    if (firstError) {
      requestAnimationFrame(() => document.getElementById(fieldIds[firstError])?.focus())
      return
    }

    submissionInProgress.current = true
    setSaving(true)
    try {
      setTip(await tipService.submit(submission))
      requestAnimationFrame(() => document.getElementById('page-title')?.focus())
    } catch {
      setFailure(true)
    } finally {
      submissionInProgress.current = false
      setSaving(false)
    }
  }

  if (tip) return <>
    <Hero title="Tip saved">Your tip was linked to incident {tip.incidentId}.</Hero>
    <section className="secondary-page" aria-label="Tip confirmation">
      <CardHeading icon={<Check size={21} />} title="Tip confirmation">Your tip is available for staff review.</CardHeading>
      <div className="report-id"><span>Tip reference number</span><strong>{tip.tipId}</strong></div>
      {selected && <p className="mb-5">{selected.title} · {selected.id}</p>}
      <a className="primary" href="#incident-map">Back to incident map</a>
    </section>
  </>

  return <>
    <Hero title="Submit a Tip">Add information to an existing incident. To tell us about a different incident, <a className="tip-text-link" href="#submit-report">submit a new report</a>.</Hero>
    <div className="page-columns">
      <div className="report-sidebar"><EmergencyNotice /></div>
      <form className="report-form tip-form grid" onSubmit={submit} noValidate aria-label="Incident tip">
        <fieldset disabled={saving} className="tip-fields grid">
          <section>
            <CardHeading icon={<FileSearch size={21} />} title="Existing incident" />
            {lockedIncident && !selected ? <p className="helper" role="status">{status === 'loading' ? 'Loading the selected incident…' : 'The selected incident is unavailable. Return to the map to choose an incident.'}</p> : !selected ? <>
              <div className="field">
                <label htmlFor="incident-search">Find an incident</label>
                <input id="incident-search" type="search" value={query} onChange={event => setQuery(event.target.value)}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                    event.preventDefault()
                    const match = incidents.find(incident => incident.id.toLowerCase() === search) ?? (matches.length === 1 ? matches[0] : undefined)
                    if (match) selectIncident(match.id)
                  }}
                  placeholder="Enter an incident ID, title, or area" autoComplete="off"
                  aria-invalid={Boolean(errors.incidentId)} aria-describedby={errors.incidentId ? 'tip-incident-error' : undefined} />
                {errors.incidentId && <p id="tip-incident-error" className="field-error">{errors.incidentId}</p>}
              </div>
              {status === 'loading' && <p className="helper mt-3" role="status">Loading incidents…</p>}
              {status === 'error' && <p className="field-error" role="alert">Could not load incidents.</p>}
              {status === 'ready' && (matches.length ? <ul className="incident-results" aria-label="Matching incidents">
                {matches.map(incident => <li key={incident.id}>
                  <button type="button" onClick={() => selectIncident(incident.id)}>
                    <strong>{incident.title}</strong><span>{incident.id} · {incident.area}</span>
                  </button>
                </li>)}
              </ul> : <p className="helper mt-3" role="status">No matching incidents. Try a different ID, title, or area.</p>)}
            </> : <div id="selected-incident" tabIndex={-1} className="selected-incident">
              <p className="helper">{selected.id} · {selected.area}</p>
              <h3>{selected.title}</h3>
              <p>{selected.summary}</p>
              {!lockedIncident && <button className="secondary mt-3" type="button" onClick={() => {
                update('incidentId', '')
                setQuery('')
                requestAnimationFrame(() => document.getElementById('incident-search')?.focus())
              }}>Change incident</button>}
            </div>}
          </section>
          <section>
            <CardHeading icon={<UserRound size={21} />} title="Contact information">
              Contact details are optional and visible to authorized staff.
            </CardHeading>
            <label className="anonymous-option">
              <input type="checkbox" checked={anonymous} onChange={event => setAnonymous(event.target.checked)} />
              <span>Submit anonymously</span>
            </label>
            {!anonymous && <div className="grid gap-4">
              <div className="field">
                <label htmlFor="tip-name">Full name (optional)</label>
                <input id="tip-name" autoComplete="name" maxLength={250} placeholder="Enter your full name" value={draft.name}
                  onChange={event => update('name', event.target.value)} aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? 'tip-name-error' : undefined} />
                {errors.name && <p id="tip-name-error" className="field-error">{errors.name}</p>}
              </div>
              <fieldset aria-describedby="tip-contact-help">
                <legend id="tip-contact-help" className="helper mb-2">Phone and email are optional.</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="field">
                    <label htmlFor="tip-phone">Phone number</label>
                    <input id="tip-phone" type="tel" autoComplete="tel" placeholder="Enter your phone number" value={draft.phone}
                      onChange={event => update('phone', event.target.value)} aria-invalid={Boolean(errors.phone)}
                      aria-describedby={errors.phone ? 'tip-phone-error' : undefined} />
                    {errors.phone && <p id="tip-phone-error" className="field-error">{errors.phone}</p>}
                  </div>
                  <div className="field">
                    <label htmlFor="tip-email">Email address</label>
                    <input id="tip-email" type="email" autoComplete="email" placeholder="Enter your email address" value={draft.email}
                      onChange={event => update('email', event.target.value)} aria-invalid={Boolean(errors.email)}
                      aria-describedby={errors.email ? 'tip-email-error' : undefined} />
                    {errors.email && <p id="tip-email-error" className="field-error">{errors.email}</p>}
                  </div>
                </div>
              </fieldset>
            </div>}
          </section>
          <section>
            <CardHeading icon={<MessageSquarePlus size={21} />} title="Additional incident information" />
            <div className="field">
              <label htmlFor="tip-information">Additional information <span className="required">*</span></label>
              <textarea id="tip-information" rows={5} required maxLength={tipInformationLimit} value={draft.information}
                placeholder="Share any additional information you have about this incident..."
                onChange={event => update('information', event.target.value)} aria-invalid={Boolean(errors.information)}
                aria-describedby={errors.information ? 'tip-information-error' : undefined} />
              {errors.information && <p id="tip-information-error" className="field-error">{errors.information}</p>}
            </div>
          </section>
        </fieldset>
        {failure && <p className="field-error" role="alert">Your tip could not be saved. Check your connection and try again.</p>}
        <div className="form-actions">
          <p><LockKeyhole size={16} aria-hidden="true" /> Tips and contact details are private.</p>
          <button className="primary" type="submit" disabled={saving || (lockedIncident && !selected)}>{saving ? 'Saving tip…' : 'Submit Tip'}</button>
        </div>
        <span role="status" className="sr-only">{saving ? 'Saving your tip.' : ''}</span>
      </form>
    </div>
  </>
}
