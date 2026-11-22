import { ClipboardList, ClipboardPenLine, MapPin, MapPinned, MessageSquarePlus, Search } from 'lucide-react'

export function CommunityHeroBanner() {
  return <>
    <section className="home-banner" aria-labelledby="page-title">
      <div className="page-width">
        <p className="location"><MapPin size={20} aria-hidden="true" /> Milwaukee, Wisconsin</p>
        <h1 id="page-title" tabIndex={-1}><span>Community</span> incident reporting</h1>
        <p className="banner-intro">Describe a non-emergency incident in Milwaukee, request community support, or look up a saved report.</p>
        <a className="primary banner-action" href="#submit-report"><ClipboardPenLine size={22} aria-hidden="true" />Start a report</a>
      </div>
    </section>
    <div className="page-width">
      <p className="partnership-note">Milwaukee Together partners with ComForce MKE to help Milwaukee residents report concerns and connect with local organizations that can help.</p>
    </div>
  </>
}

const reportLinks = [
  { route: 'track-report', title: 'Track a report', description: 'Use your confirmation ID to find a saved report.', icon: Search },
  { route: 'incident-map', title: 'Incident map', description: 'Explore recent Milwaukee incidents and check assistance status.', icon: MapPinned },
  { route: 'submit-tip', title: 'Submit a tip', description: 'Add information to an existing incident.', icon: MessageSquarePlus },
  { route: 'my-reports', title: 'My Reports', description: 'Review your submissions and follow service updates.', icon: ClipboardList },
] as const

export function ExploreReports({ signedIn = false }: { signedIn?: boolean }) {
  const links = signedIn ? reportLinks : reportLinks.slice(0, 3)
  return <section className="home-links" aria-labelledby="explore-heading">
    <h2 id="explore-heading">Explore reports</h2>
    <ul>
      {links.map(({ route, title, description, icon: Icon }) => <li key={route}>
        <a className="home-link" href={`#${route}`}>
          <Icon size={25} aria-hidden="true" />
          <span><strong>{title}</strong><small>{description}</small></span>
        </a>
      </li>)}
    </ul>
  </section>
}
