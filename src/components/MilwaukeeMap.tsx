import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { HeatLayer } from 'leaflet.heat'
import 'leaflet/dist/leaflet.css'
import { hasPoint, progressLabels, type MapIncident } from '../services/incidentMapService'

const milwaukee: L.LatLngTuple = [43.052, -87.936]
const tiles = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
type Point = MapIncident & { latitude: number; longitude: number }

export function tone(item: MapIncident) {
  if (item.service_status === 'assistance_confirmed') return 'confirmed'
  if (item.service_status === 'no_service_case' || item.service_status === 'completed_unconfirmed') return 'neutral'
  return item.service_status === 'assistance_needed' || item.service_status === 'needs_follow_up' ? 'needed' : 'working'
}

export function MilwaukeeMap({ incidents, mode, selected, onSelect, onTileError }: {
  incidents: MapIncident[]
  mode: 'pins' | 'heat'
  selected: number | null
  onSelect: (id: number) => void
  onTileError: (failed: boolean) => void
}) {
  const element = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const markerLayer = useRef<L.LayerGroup | null>(null)
  const heat = useRef<L.Layer | null>(null)
  const markers = useRef(new Map<number, L.Marker>())
  const fitKeys = useRef('')
  const selectionRef = useRef(onSelect)

  useEffect(() => { selectionRef.current = onSelect }, [onSelect])
  useEffect(() => {
    if (!element.current) return
    const view = L.map(element.current, { scrollWheelZoom: false, maxZoom: 16 })
      .setView(milwaukee, 12)
    const basemap = L.tileLayer(tiles, {
      maxNativeZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    }).addTo(view)
    const tileStatus = () => {
      const layer = basemap.getContainer()
      onTileError(Boolean(layer?.querySelector('.leaflet-tile') && !layer.querySelector('.leaflet-tile-loaded')))
    }
    basemap.on('tileerror load', tileStatus)
    markerLayer.current = L.layerGroup().addTo(view)
    map.current = view
    const observer = new ResizeObserver(() => view.invalidateSize({ pan: false }))
    observer.observe(element.current)
    return () => {
      observer.disconnect()
      map.current = null
      markerLayer.current = null
      heat.current = null
      markers.current.clear()
      fitKeys.current = ''
      view.remove()
    }
  }, [onTileError])

  useEffect(() => {
    const view = map.current
    const layer = markerLayer.current
    if (!view || !layer) return
    const points = incidents.filter(hasPoint)
    layer.clearLayers()
    markers.current.clear()
    heat.current?.remove()
    heat.current = null
    const positions = points.map(({ latitude, longitude }): L.LatLngTuple => [latitude, longitude])
    const signature = points.map(item => `${item.id}:${item.latitude}:${item.longitude}`).join('|')
    if (fitKeys.current !== signature && positions.length) {
      view.fitBounds(L.latLngBounds(positions), { padding: [40, 40], maxZoom: 13, animate: false })
    }
    fitKeys.current = signature

    if (mode === 'heat') {
      if (positions.length) {
        // The heat plugin runs with Leaflet 1.9, but ships declarations for Leaflet 2.
        const overlay = new HeatLayer(positions, {
          radius: 38, blur: 24, maxZoom: 13, max: 2, minOpacity: .4,
          gradient: { .15: '#287565', .38: '#6fa04f', .65: '#f8bf48', 1: '#bb3434' },
        }) as unknown as L.Layer
        heat.current = overlay.addTo(view)
      }
      return
    }

    const groups = new Map<string, Point[]>()
    for (const item of points) {
      const key = `${item.latitude}:${item.longitude}`
      const group = groups.get(key) ?? []
      group.push(item)
      groups.set(key, group)
    }
    for (const group of groups.values()) {
      group.forEach((item, index) => {
        const angle = 2 * Math.PI * index / group.length
        const offset = group.length > 1 ? 20 + Math.min(group.length, 8) * 3 : 0
        const label = `MKE-${item.id} · ${item.incident_type ?? 'Incident'} · ${progressLabels[item.service_status]}`
        const icon = L.divIcon({
          className: 'incident-pin-shell',
          html: `<span class="incident-pin pin-${tone(item)}" aria-hidden="true"></span>`,
          iconSize: [34, 34],
          iconAnchor: [17 - offset * Math.cos(angle), 30 - offset * Math.sin(angle)],
        })
        const marker = L.marker([item.latitude, item.longitude], { icon, title: label, alt: label }).addTo(layer)
        const markerElement = marker.getElement()
        if (markerElement) {
          markerElement.setAttribute('aria-label', label)
          markerElement.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.stopPropagation()
            selectionRef.current(item.id)
          })
        }
        marker.on('click', () => selectionRef.current(item.id))
        markers.current.set(item.id, marker)
      })
    }
  }, [incidents, mode])

  useEffect(() => {
    markers.current.forEach((marker, id) => {
      marker.getElement()?.classList.toggle('is-selected', id === selected)
      marker.setZIndexOffset(id === selected ? 1000 : 0)
    })
  }, [incidents, mode, selected])

  return <div ref={element} className="milwaukee-map" role="region" aria-label="Interactive map of Milwaukee" />
}
