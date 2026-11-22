# Verification report

| Check | Result |
| --- | --- |
| Original regression suite and added integration tests | 14 passed. Covers migration, repeat imports, authenticated role boundaries, stored narratives, AI adapter output, linked tips, progress, confirmation and dispute handling, and public map projection. |
| Teammate’s offline categorizer suite | 10 passed. |
| TypeScript and production Vite build | Passed. Used the existing npm lockfile with a clean dependency install. |
| Supplied CSV | Imported 100 of 100 records. A second pass imported zero and skipped 100. The coordinator saw the import queue. The two curated entries published once and preserved source post dates and approximate locations. |
| Desktop Chromium at 1280 × 900 | Browser submissions, tracking, coordinator approval, a linked tip, provider progress, demo inbox response, and green confirmed history passed. Leaflet marker selection, heat overlay, and category filtering passed with SQLite-backed records. |
| Chromium mobile emulation at 390 × 844 | Home, map, report form, community dashboard, tracking references, and staff incident management rendered without horizontal overflow. |
| PWA production preview | Manifest, two icons, service worker activation, and offline fallback passed on localhost. |
| Restart and database integrity | FastAPI reopened the database used during browser testing. The imported rows, test report, linked tip, and confirmed map entry remained. SQLite reported no foreign key violations. |
| Live OpenAI request | Skipped. No live API key was available. The real adapter path was tested with a mocked categorizer response. Missing-key and parser failure behavior were also verified. |
| External delivery and device testing | The SQLite demo inbox was exercised. Live SMTP, physical phone installation, online geocoding, Windows execution, and PyCharm launch were not exercised in this Linux environment. |

## Rerun the automated tests

From the project root, using the same virtual environment as the backend:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests
.\.venv\Scripts\python.exe -m unittest ai.test_categorizer
npm.cmd run build
```
