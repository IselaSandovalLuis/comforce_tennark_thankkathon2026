import type { FormEvent, ReactNode } from 'react'
import { ChevronDown, ClipboardPenLine, LockKeyhole, Send, UserRound } from 'lucide-react'
import { departments, descriptionLimit, type FieldErrors, type ReportDraft } from '../reports'

export function CardHeading({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return <div className="card-heading">
    <span className="section-icon" aria-hidden="true">{icon}</span>
    <div><h2>{title}</h2>{children && <p>{children}</p>}</div>
  </div>
}

function FieldError({ field, errors }: { field: keyof FieldErrors; errors: FieldErrors }) {
  return errors[field] ? <p className="field-error" id={`${field}-error`}>{errors[field]}</p> : null
}

interface Props {
  draft: ReportDraft
  errors: FieldErrors
  update: <K extends keyof ReportDraft>(key: K, value: ReportDraft[K]) => void
  onReview: (event: FormEvent<HTMLFormElement>) => void
}

export function ReportForm({ draft, errors, update, onReview }: Props) {
  return <form className="report-form grid gap-5" onSubmit={onReview} noValidate aria-label="Incident report">
    <section className="card">
      <CardHeading icon={<UserRound size={21} />} title="Reporter information">Choose how you’d like to be identified.</CardHeading>
      <label className="anonymous-option">
        <input type="checkbox" checked={draft.anonymous} onChange={event => update('anonymous', event.target.checked)} />
        <span><strong>Submit anonymously</strong><small>Your name is omitted. You can leave contact details blank.</small></span>
      </label>
      {!draft.anonymous && <div className="field">
        <label htmlFor="name">Full name (optional)</label>
        <input id="name" autoComplete="name" placeholder="Enter your full name" maxLength={250} value={draft.name}
          aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'name-error' : undefined}
          onChange={event => update('name', event.target.value)} />
        <FieldError field="name" errors={errors} />
      </div>}
      <fieldset className="contact-fields" aria-describedby="contact-help">
        <legend>Contact information <span className="muted-label">Optional</span></legend>
        <p className="helper" id="contact-help">Provide an email address if you want to receive service updates.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={draft.email}
              aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-error' : undefined}
              onChange={event => update('email', event.target.value)} />
            <FieldError field="email" errors={errors} />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone number</label>
            <input id="phone" type="tel" autoComplete="tel" placeholder="(414) 555-0123" value={draft.phone}
              aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? 'phone-error' : undefined}
              onChange={event => update('phone', event.target.value)} />
            <FieldError field="phone" errors={errors} />
          </div>
        </div>
        <label className="anonymous-option">
          <input type="checkbox" checked={Boolean(draft.emailOptIn)}
            onChange={event => update('emailOptIn', event.target.checked)} />
          <span>Email me about service progress and requests to confirm assistance.</span>
        </label>
      </fieldset>
    </section>
    <section className="card">
      <CardHeading icon={<ClipboardPenLine size={21} />} title="Incident information">Tell us what happened in your own words.</CardHeading>
      <div className="field">
        <label htmlFor="location">Incident location (optional)</label>
        <input id="location" type="text" maxLength={250} value={draft.location.rawAddress}
          placeholder="Enter an address, intersection, or neighborhood in Milwaukee"
          aria-invalid={Boolean(errors.location)} aria-describedby={errors.location ? 'location-error' : undefined}
          onChange={event => update('location', { rawAddress: event.target.value })} />
        <FieldError field="location" errors={errors} />
      </div>
      <div className="field mt-4">
        <label htmlFor="description">Incident description <span className="required">*</span></label>
        <p className="helper" id="description-help">Include what happened, who was involved, when it happened, and whether anyone still needs assistance.</p>
        <textarea id="description" rows={5} maxLength={descriptionLimit} required value={draft.description}
          placeholder="Describe what happened, who was involved, when it happened, and any other important details..."
          aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? 'description-help description-error' : 'description-help'}
          onChange={event => update('description', event.target.value)} />
        <div className="flex flex-wrap justify-between gap-x-4">
          <FieldError field="description" errors={errors} />
          <span className="counter ml-auto">{draft.description.length.toLocaleString()} / 5,000</span>
        </div>
      </div>
      <div className="field mt-4">
        <label htmlFor="department">Department to contact</label>
        <div className="select-wrap">
          <select id="department" value={draft.department} aria-describedby="department-help"
            onChange={event => update('department', event.target.value as ReportDraft['department'])}>
            {departments.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}
          </select>
          <ChevronDown size={18} aria-hidden="true" />
        </div>
        <p className="helper" id="department-help">Leave ComForce selected if you want participating departments to be eligible to help.</p>
      </div>
    </section>
    <div className="form-actions">
      <p><LockKeyhole size={16} aria-hidden="true" /> Contact information is kept private.</p>
      <button className="primary" type="submit"><Send size={17} aria-hidden="true" /> Review report</button>
    </div>
  </form>
}
