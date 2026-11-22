import { useEffect, useState } from 'react'
import { Layout, pages, type Page } from './components/Layout'
import { Home, TrackReport } from './components/OtherPages'
import { IncidentMap } from './components/IncidentMap'
import { ReportFlow } from './components/ReportFlow'
import { SubmitTip } from './components/SubmitTip'
import { LoginForm } from './components/Accounts'
import { CommunityDashboard, MyReports } from './components/CommunityDashboard'
import { WorkerDashboard } from './components/WorkerDashboard'
import { authService, canManageIncidents } from './services/authService'

function currentRoute() {
  const [destination, query] = window.location.hash.slice(1).split('?')
  const page: Page = pages.find(item => item.id === destination)?.id ?? 'home'
  return { page, id: new URLSearchParams(query).get('id') ?? '' }
}

export function App() {
  const [route, setRoute] = useState(currentRoute)
  const [user, setUser] = useState(authService.current)
  const [sessionReady, setSessionReady] = useState(false)
  const staffOnly = route.page === 'manage-incidents' || route.page === 'service-updates'
  const page = staffOnly && !user ? 'login' : route.page === 'login' && user ? 'dashboard' : route.page

  useEffect(() => {
    const navigate = () => setRoute(currentRoute())
    const unsubscribe = authService.subscribe(() => setUser(authService.current()))
    let active = true
    void authService.restoreStaff().finally(() => { if (active) setSessionReady(true) })
    window.addEventListener('hashchange', navigate)
    return () => {
      active = false
      window.removeEventListener('hashchange', navigate)
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!sessionReady) return
    if (page !== route.page) window.location.replace('#' + page)
    const frame = requestAnimationFrame(() => {
      document.getElementById('page-title')?.focus({ preventScroll: true })
      window.scrollTo(0, 0)
    })
    return () => cancelAnimationFrame(frame)
  }, [page, route, sessionReady])

  if (!sessionReady && (staffOnly || route.page === 'dashboard' || route.page === 'login')) return null

  return <Layout page={page} user={user} fullWidth={page === 'home' || (page === 'dashboard' && !user)}>
    {page === 'home' && <Home />}
    {page === 'incident-map' && <IncidentMap key={route.id} initialId={route.id} user={user} />}
    {page === 'track-report' && <TrackReport key={route.id} initialId={route.id} />}
    {page === 'submit-tip' && <SubmitTip key={route.id} initialId={route.id} />}
    {page === 'login' && <LoginForm />}
    {page === 'my-reports' && <MyReports selectedId={route.id} />}
    {page === 'dashboard' && !user && <CommunityDashboard />}
    {(page === 'dashboard' || page === 'manage-incidents' || page === 'service-updates') && canManageIncidents(user)
      && <WorkerDashboard user={user} view={page} selectedId={route.id} />}
    <ReportFlow key={user?.userId ?? 'guest'} visible={page === 'submit-report'} />
  </Layout>
}
