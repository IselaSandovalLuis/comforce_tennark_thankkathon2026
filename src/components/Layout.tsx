import type { ReactNode } from 'react'
import { ClipboardPenLine, House, LayoutDashboard, LogIn, MapPin, MapPinned, Menu, MessageSquarePlus, Search, Siren, Wrench } from 'lucide-react'
import type { User } from '../types/accounts'
import { authService } from '../services/authService'
import { Logo } from './Logo'

export const pages = [
  { id: 'home', title: 'Home', mobile: 'Home', icon: House },
  { id: 'submit-report', title: 'Submit Report', mobile: 'Report', icon: ClipboardPenLine },
  { id: 'submit-tip', title: 'Submit a Tip', mobile: 'Submit a Tip', icon: MessageSquarePlus },
  { id: 'incident-map', title: 'Incident Map', mobile: 'Map', icon: MapPinned },
  { id: 'track-report', title: 'Track Report', mobile: 'Track', icon: Search },
  { id: 'dashboard', title: 'Dashboard', mobile: 'Dashboard', icon: LayoutDashboard },
  { id: 'my-reports', title: 'My Reports', mobile: 'My Reports', icon: Search },
  { id: 'manage-incidents', title: 'Manage Incidents', mobile: 'Incidents', icon: ClipboardPenLine },
  { id: 'service-updates', title: 'Service Updates', mobile: 'Updates', icon: Wrench },
  { id: 'login', title: 'Log in', mobile: 'Log in', icon: LogIn },
] as const
export type Page = (typeof pages)[number]['id']

function destinations(user: User | null): Page[] {
  if (user) return ['dashboard', 'manage-incidents', 'incident-map', 'service-updates']
  return ['home', 'submit-report', 'submit-tip', 'incident-map', 'track-report', 'my-reports', 'login']
}

function LinkToPage({ id, active, mobile = false }: { id: Page; active: Page; mobile?: boolean }) {
  const entry = pages.find(item => item.id === id)!
  const Icon = entry.icon
  return <a href={`#${id}`} aria-current={active === id ? 'page' : undefined}>
    {mobile && <Icon size={19} aria-hidden="true" />}<span>{mobile ? entry.mobile : entry.title}</span>
  </a>
}

function DashboardHeader({ page, links, signedIn }: { page: Page; links: Page[]; signedIn: boolean }) {
  const logout = <button type="button" onClick={() => {
    void authService.logout().then(() => { location.hash = 'login' }).catch(() => window.alert('Sign-out failed. Try again.'))
  }}>Logout</button>

  return <header className="site-header">
    <div className="site-header-inner">
      <Logo />
      <nav className="top-nav account-nav" aria-label="Main navigation">
        {links.map(id => <LinkToPage key={id} id={id} active={page} />)}
        {signedIn && logout}
      </nav>
      <div className="header-actions">
        <span className="prototype-badge">Prototype</span>
        <details className="mobile-account" key={page}>
          <summary aria-label={signedIn ? 'Account menu' : 'Site menu'}><Menu size={21} aria-hidden="true" /></summary>
          <nav aria-label="Account navigation" onClick={event => {
            if ((event.target as Element).closest('a')) event.currentTarget.closest('details')?.removeAttribute('open')
          }}>
            {links.slice(5).map(id => <LinkToPage key={id} id={id} active={page} />)}
            {signedIn && logout}
          </nav>
        </details>
      </div>
    </div>
  </header>
}

function BottomNavigation({ links, active }: { links: Page[]; active: Page }) {
  return <nav className="bottom-nav account-bottom" aria-label="Main navigation">
    {links.slice(0, 5).map(id => <LinkToPage key={id} id={id} active={active} mobile />)}
  </nav>
}

export function Layout({ page, user, fullWidth, children }: {
  page: Page
  user: User | null
  fullWidth: boolean
  children: ReactNode
}) {
  const links = destinations(user)
  return <>
    <a className="skip-link" href="#main" onClick={event => {
      event.preventDefault()
      document.getElementById('main')?.focus()
    }}>Skip to content</a>
    <DashboardHeader page={page} links={links} signedIn={Boolean(user)} />
    <main className={fullWidth ? undefined : 'page-width'} id="main" tabIndex={-1}>{children}</main>
    <footer className="site-footer page-width"><span>Milwaukee Together x ComForce MKE</span><span>Milwaukee community incident reporting · Prototype</span></footer>
    <BottomNavigation active={page} links={links} />
  </>
}

export function Hero({ title, children }: { title: string; children: ReactNode }) {
  return <section className="hero" aria-labelledby="page-title">
    <div className="hero-content">
      <p className="location"><MapPin size={15} aria-hidden="true" /> Milwaukee, Wisconsin</p>
      <h1 id="page-title" tabIndex={-1}>{title}</h1>
      <p className="hero-description">{children}</p>
    </div>
  </section>
}

export function EmergencyNotice() {
  return <aside className="emergency" aria-label="Emergency services">
    <Siren size={20} aria-hidden="true" />
    <div><h2>Immediate emergency?</h2>
      <p>Call <a href="tel:911">911</a> if you need immediate help. This form is for non-emergency reports.</p>
    </div>
  </aside>
}
