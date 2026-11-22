# Integration summary

| Area | Reused | Integrated or added |
| --- | --- | --- |
| Website | Heat map project’s React forms, home banner, assets, layout, community and staff dashboards | Replaced local workflow simulations with API data. Community reads use tracking keys, staff actions use backend sessions, and the mobile preview redirects to the responsive app. |
| Map | Leaflet view, OpenStreetMap basemap, density overlay, area presets and filter panel | Added confirmed history, neutral service status, and labels for reviewed CSV demo records. Approved records without coordinates remain searchable for tips and appear in map results. |
| SQLite | Incident, report, contact, tip, case, update, notification and staff tables | Added fields for anonymity, AI output, reviewed assistance, decline state and additional CSV source metadata. Imported the supplied CSV and added an explicit coordinator command to publish two curated public excerpts. |
| AI | Teammate’s categorizer, routing configuration, structured schema, samples, cost reporting and offline tests | Python package imports, backend key configuration, bounded request timeout, and corrected adapter. The browser report receipt shows the AI status returned by FastAPI. |
| Staff and recipient | Backend login, organization permissions, case timeline, demo email and secure response form | Staff review can accept or edit AI suggestions, approve a public summary, or decline publication. Worker progress and recipient confirmation feed the public map. |
| Setup and verification | Vite lockfile, FastAPI development ports and backend regression suite | Windows launch scripts, PWA manifest and icons, tests for full CSV import, demo review, AI adapter persistence and historical map projection. |

The two input projects were used as references. The ZIP contains the separate unified project.
