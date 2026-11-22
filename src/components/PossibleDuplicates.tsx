import { ChevronDown } from 'lucide-react'

const sampleGroups = [
  {
    reason: 'Both reports describe a blocked roadway near the same intersection within 15 minutes.',
    reports: [
      { id: 'DEMO-101', type: 'Blocked roadway', location: 'Near N 27th St & W Center St', date: 'Nov 21, 2026', time: '9:05 AM' },
      { id: 'DEMO-102', type: 'Road obstruction', location: 'W Center St near N 27th St', date: 'Nov 21, 2026', time: '9:17 AM' },
    ],
  },
  {
    reason: 'Both reports mention a fallen tree blocking a sidewalk on the same block within 10 minutes.',
    reports: [
      { id: 'DEMO-103', type: 'Fallen tree', location: 'Near S Kinnickinnic Ave & E Lincoln Ave', date: 'Nov 21, 2026', time: '2:10 PM' },
      { id: 'DEMO-104', type: 'Blocked sidewalk', location: 'E Lincoln Ave near S Kinnickinnic Ave', date: 'Nov 21, 2026', time: '2:18 PM' },
    ],
  },
]

export function PossibleDuplicates() {
  return (
    <details className="incident-detail mt-4">
      <summary>
        <span className="flex flex-wrap items-center gap-x-3">
          <strong>Possible Duplicates</strong>
          <small>{sampleGroups.length} flagged groups</small>
        </span>
        <ChevronDown size={18} className="shrink-0" aria-hidden="true" />
      </summary>

      <div className="grid gap-4">
        <p className="helper">Fictional sample reports for the demo.</p>
        <p className="helper">
          AI flagged these reports as similar. A coordinator can review them to determine whether they describe the same incident.
        </p>

        {sampleGroups.map(({ reports, reason }, index) => (
          <section className="dashboard-card grid gap-2" key={reports[0].id}>
            <h3>Flagged group {index + 1}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {reports.map(report => (
                <article className="dashboard-card" key={report.id}>
                  <p className="helper">Report {report.id}</p>
                  <p><strong>{report.type}</strong></p>
                  <p>{report.location}</p>
                  <p className="helper">Reported {report.date} at {report.time} CT</p>
                </article>
              ))}
            </div>
            <p className="helper">{reason}</p>
          </section>
        ))}
      </div>
    </details>
  )
}