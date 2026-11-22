import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Flame, Layers, MapPin, MessageSquarePlus, RotateCcw } from 'lucide-react'
import { useCaseUpdates } from '../hooks/useCaseUpdates'
import { ApiError } from '../services/apiClient'
import { hasPoint, incidentMapService, progressLabels, type MapIncident } from '../services/incidentMapService'
import { incidentId } from '../services/incidentService'
import type { User } from '../types/accounts'
import { Hero } from './Layout'
import { MilwaukeeMap, tone } from './MilwaukeeMap'

const emptyFilters = { category: '', area: '', start: '', end: '', progress: '', verification: '' }
const sourceNames = {
  reviewed_demo: 'Reviewed demo · imported source account',
  imported: 'Imported report · source not independently verified here',
  community: 'Community report',
}
const verifyLabels = {
  confirmed: 'Recipient confirmed',
  not_requested: 'No verification request',
  awaiting_confirmation: 'Awaiting confirmation',
  needs_follow_up: 'Follow-up requested',
}
const statusColor = { needed: 'red', working: 'yellow', confirmed: 'green', neutral: 'neutral' } as const
const mapDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

function useIncidentMap(view: 'active' | 'completed' | 'all') {
  const version = useCaseUpdates()
  const [state, setState] = useState<{ items: MapIncident[]; status: 'loading' | 'ready' | 'error' }>({
    items: [], status: 'loading',
  })
  useEffect(() => {
    const controller = new AbortController()
    let busy = false
    async function load() {
      if (busy) return
      busy = true
      try {
        const items = await incidentMapService.list(view, controller.signal)
        if (!controller.signal.aborted) setState(current => {
          if (current.status === 'ready' && JSON.stringify(current.items) === JSON.stringify(items)) return current
          return { items, status: 'ready' }
        })
      } catch {
        if (!controller.signal.aborted) setState(current => ({ ...current, status: 'error' }))
      } finally {
        busy = false
      }
    }
    void load()
    const interval = window.setInterval(load, 4000)
    window.addEventListener('focus', load)
    return () => {
      controller.abort()
      window.clearInterval(interval)
      window.removeEventListener('focus', load)
    }
  }, [version, view])
  return state
}

function ProviderAction({ item }: { item: MapIncident }) {
  const [action, setAction] = useState<{ case_id: number | null; can_view_report: boolean }>()
  const [error, setError] = useState('')
  useEffect(() => {
    const request = new AbortController()
    incidentMapService.staffAction(item.id, request.signal).then(setAction).catch(cause => {
      if (!request.signal.aborted) setError(cause instanceof ApiError && cause.status === 404
        ? 'This report is outside your organization’s access.' : 'Could not check report access.')
    })
    return () => request.abort()
  }, [item.id])
  if (error) return <p className="helper" role="status">{error}</p>
  if (!action) return <p className="helper" role="status">Checking report access…</p>
  const routeId = action.case_id ? `CASE-${action.case_id}` : incidentId(item.id)
  return <a className="primary" href={`#manage-incidents?id=${routeId}`}>
    {action.can_view_report ? 'View Full Report' : 'Open Service Case'}<ChevronRight size={17} aria-hidden="true" />
  </a>
}

function SelectedIncident({ item, user }: { item: MapIncident; user: User | null }) {
  const day = item.date ? mapDate.format(new Date(item.date + 'T00:00:00Z')) : 'Not reported'
  return <section className="map-summary" id="selected-map-incident" tabIndex={-1} aria-label="Selected incident">
    <div className="map-summary-meta"><strong>{incidentId(item.id)}</strong><span>{sourceNames[item.source]}</span></div>
    <h3>{item.incident_type ?? 'Unclassified incident'}</h3>
    <p className="map-status"><span className={`map-dot ${statusColor[tone(item)]}`} />
      {progressLabels[item.service_status]}</p>
    <dl className="map-summary-data">
      <div><dt>When</dt><dd>{item.date && item.date_basis === 'source_post' ? 'Source posted ' : ''}{day}
        {item.approximate_time && ` · around ${item.approximate_time} local time`}</dd></div>
      <div><dt>General location</dt><dd>{item.area ?? (hasPoint(item) ? 'Milwaukee · approximate area' : 'Awaiting location verification')}</dd></div>
      <div><dt>What happened</dt><dd>{item.public_summary}</dd></div>
    </dl>
    {user?.staffRole ? <ProviderAction key={item.id} item={item} /> : !user &&
      <a className="primary" href={`#submit-tip?id=${incidentId(item.id)}`}>
        <MessageSquarePlus size={18} aria-hidden="true" />Submit a Tip
      </a>}
  </section>
}

export function IncidentMap({ initialId, user }: { initialId: string; user: User | null }) {
  const [view, setView] = useState<'active' | 'completed' | 'all'>('active')
  const { items, status } = useIncidentMap(view)
  const [selection, setSelection] = useState<number | null>(/^MKE-\d+$/.test(initialId) ? Number(initialId.slice(4)) : null)
  const [mode, setMode] = useState<'pins' | 'heat'>('pins')
  const [filters, setFilters] = useState(emptyFilters)
  const [tileError, setTileError] = useState(false)
  const shown = useMemo(() => items.filter(item =>
    (!filters.category || item.incident_type === filters.category)
    && (!filters.area || item.area === filters.area)
    && (!filters.progress || item.service_status === filters.progress)
    && (!filters.verification || item.verification_status === filters.verification)
    && (!filters.start || Boolean(item.date && item.date >= filters.start))
    && (!filters.end || Boolean(item.date && item.date <= filters.end))
  ), [items, filters])
  const selected = shown.find(item => item.id === selection)
  const mapped = shown.filter(hasPoint).length
  const missing = shown.length - mapped
  const options = (field: 'incident_type' | 'area') => [...new Set(items.flatMap(item => item[field] ?? []))].sort()
  const select = (key: keyof typeof emptyFilters, value: string) => setFilters(current => ({ ...current, [key]: value }))
  const filtered = Object.values(filters).filter(Boolean).length
  function selectIncident(id: number) {
    setSelection(id)
    window.requestAnimationFrame(() => {
      const wide = window.matchMedia('(min-width: 781px)').matches
      document.getElementById('selected-map-incident')?.focus({ preventScroll: wide })
    })
  }

  return <>
    <Hero title="Milwaukee Incident Map">Explore reported incidents across Milwaukee, follow community assistance progress, and share information that can help.</Hero>
    <section className="dashboard-card map-dashboard" aria-label="Incident map dashboard">
      <div className="map-toolbar">
        <div className="map-mode" aria-label="Map display">
          <button type="button" aria-pressed={mode === 'pins'} onClick={() => setMode('pins')}><MapPin size={17} />Pins</button>
          <button type="button" aria-pressed={mode === 'heat'} onClick={() => setMode('heat')}><Flame size={17} />Heat map</button>
        </div>
        <p className="helper" role="status">{mapped} mapped · {shown.length} shown{missing ? ` · ${missing} awaiting location verification` : ''}</p>
      </div>
      <label className="field mt-3">Map records
        <select value={view} onChange={event => setView(event.target.value as typeof view)}>
          <option value="active">Active incidents</option>
          <option value="completed">Confirmed history</option>
          <option value="all">All approved incidents</option>
        </select>
      </label>
      <details className="map-filters">
        <summary><Layers size={17} />Filters{filtered ? ` (${filtered})` : ''}</summary>
        <div className="dashboard-filters">
          <label className="field">Category<select value={filters.category} onChange={e => select('category', e.target.value)}><option value="">All categories</option>{options('incident_type').map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="field">Area<select value={filters.area} onChange={e => select('area', e.target.value)}><option value="">All areas</option>{options('area').map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="field">Service progress<select value={filters.progress} onChange={e => select('progress', e.target.value)}><option value="">All progress statuses</option>{Object.entries(progressLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field">Verification<select value={filters.verification} onChange={e => select('verification', e.target.value)}><option value="">Any verification status</option>{Object.entries(verifyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field">From<input type="date" value={filters.start} max={filters.end || undefined} onChange={e => select('start', e.target.value)} /></label>
          <label className="field">Through<input type="date" value={filters.end} min={filters.start || undefined} onChange={e => select('end', e.target.value)} /></label>
        </div>
        <button type="button" className="secondary mt-3" onClick={() => setFilters(emptyFilters)}><RotateCcw size={16} />Reset filters</button>
      </details>
      {status === 'loading' && <p className="helper mt-3" role="status">Loading incidents…</p>}
      {status === 'error' && <p className="field-error" role="alert">Incident data is temporarily unavailable. Reconnecting automatically.</p>}
      {tileError && <p className="field-error" role="status">The street basemap is unavailable. Incident summaries are still available in the list.</p>}
      <div className="map-workspace">
        <div className="map-canvas">
          <MilwaukeeMap incidents={shown} mode={mode} selected={selected?.id ?? null} onSelect={selectIncident} onTileError={setTileError} />
          <div className="map-legend" aria-label="Map legend">
            {mode === 'heat' ? <><span className="heat-scale" /><span>Fewer to more reports</span></> : <>
              <span><i className="map-dot red" />Needed or follow-up</span>
              <span><i className="map-dot yellow" />Referral, work in progress, or awaiting confirmation</span>
              <span><i className="map-dot green" />Recipient confirmed</span>
              <span><i className="map-dot neutral" />Assistance unassessed or completion unconfirmed</span>
            </>}
          </div>
        </div>
        <aside className="map-side" aria-label="Incident summaries">
          {selected
            ? <SelectedIncident key={selected.id} item={selected} user={user} />
            : <div className="map-summary"><h3>Incident results</h3><p className="helper">
              {selection && status === 'ready' && !items.some(item => item.id === selection)
                ? 'This incident is no longer on the active map.'
                : 'Select a pin or incident to see its public summary.'}</p></div>}
          <ul className="map-results" aria-label="Filtered active incidents">
            {shown.map(item => <li key={item.id}><button type="button" aria-pressed={item.id === selected?.id} onClick={() => selectIncident(item.id)}>
              <span className={`map-dot ${statusColor[tone(item)]}`} /><span>
                <strong>{item.incident_type ?? 'Incident'}</strong>
                <small>{incidentId(item.id)} · {hasPoint(item) ? item.area ?? 'Milwaukee' : 'Awaiting location verification'}</small>
              </span><ChevronRight size={17} /></button></li>)}
          </ul>
          {status === 'ready' && shown.length === 0 && <p className="helper map-empty">No incidents match these filters.</p>}
        </aside>
      </div>
      <p className="helper map-privacy">Pins show approximate locations. Imported source accounts are reviewed for publication.</p>
    </section>
  </>
}
