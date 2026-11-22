import { useEffect, useState } from 'react'
import { useCaseUpdates } from './useCaseUpdates'
import { incidentService } from '../services/incidentService'
import type { IncidentSummary } from '../types/incident'

export function usePublicIncidents() {
  const [incidents, setIncidents] = useState<readonly IncidentSummary[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const version = useCaseUpdates()
  useEffect(() => {
    let active = true
    const refresh = () => incidentService.listPublic().then(results => {
      if (!active) return
      setIncidents(results)
      setStatus('ready')
    }).catch(() => {
      if (active) setStatus('error')
    })

    void refresh()
    const timer = window.setInterval(refresh, 7000)
    return () => { active = false; window.clearInterval(timer) }
  }, [version])

  return { incidents, status }
}
