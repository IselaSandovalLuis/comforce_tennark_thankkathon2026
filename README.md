# Milwaukee Together x ComForce MKE

Milwaukee Together is one responsive React/Vite app with a FastAPI backend and a persistent SQLite database. It uses the supplied heat map project as its foundation. The community reporting, tracking, and tip pages share the same database as coordinator review, organization cases, and recipient confirmation.

## Run in PyCharm on Windows

1. Extract the ZIP and open the **Milwaukee_Together_Unified** folder in PyCharm. Use Python 3.11 or newer and Node.js 22 or newer.
2. In the PyCharm PowerShell terminal, run the following from the project root. The commands use the virtual environment directly.

   ```powershell
   py -3 -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   npm.cmd ci
   Copy-Item backend\.env.example backend\.env
   ```

3. Open `backend/.env`. Set `OPENAI_API_KEY` if you want live AI suggestions. With the key blank, reports are saved and queued for manual review. The default notification mode writes to the coordinator-only demo inbox in SQLite.
4. Initialize SQLite and create your own local staff credentials. The command prompts for a password of at least 12 characters.

   ```powershell
   .\.venv\Scripts\python.exe -m backend.manage init
   .\.venv\Scripts\python.exe -m backend.manage staff coordinator --role admin
   .\.venv\Scripts\python.exe -m backend.manage staff provider --organization comforce --role worker
   ```

5. For an immediately demonstrable map, review the two curated summaries in `backend/reviewed_demo.py`, then approve the excerpts using your coordinator username. The rest of the imports remain in the review queue.

   ```powershell
   .\.venv\Scripts\python.exe -m backend.manage reviewed-demo coordinator --approve
   ```

6. Start both services with `.\start-local.cmd`, or use `.\start-backend.cmd` and `.\start-frontend.cmd` in two separate terminals. If you prefer direct commands, use:

   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn backend.api:app --host 127.0.0.1 --port 8011 --no-access-log
   npm.cmd run dev
   ```

7. Open [Milwaukee Together on localhost](http://localhost:5180). Use **Log in** for the staff credentials you provisioned. Community reporting and tracking use a private tracking key. **My Reports** lists reports saved in the current browser. To look up a report on a different device, use its ID and key on **Track Report**.

### Phone and PWA

Use the browser’s device toolbar to test the same app at phone sizes. For a phone on the same trusted Wi-Fi, leave the API on loopback and run `npm.cmd run dev -- --host 0.0.0.0`. Open `http://<computer-LAN-IP>:5180` on the phone. If you will open recipient links on that device, set `COMFORCE_PUBLIC_ORIGIN` to the same LAN URL before starting the backend.

For the installable build run `npm.cmd run build`, then `npm.cmd run preview -- --host 127.0.0.1 --port 5180` with the backend running. Use localhost or HTTPS for installation in a supporting browser. The service worker serves an offline message. Reporting, maps and tracking require a connection.

## Architecture and data

- **Frontend.** A single React application keeps the original branding, hero, contact and report forms, dashboards, and Leaflet map. Vite proxies `/api` to port 8011. The frontend polls the map and dashboards and refreshes after local changes. The browser stores private tracking references. Incidents, cases and updates are fetched from the backend.
- **Backend.** FastAPI handles staff sessions, submissions, reviews, tips, organization cases and confirmation. Additive migrations preserve the original table relationships and workflow data. The SQLite file defaults to `milwaukee-together.sqlite3` in the project root. Set `COMFORCE_DB` to reopen an existing database. Relative paths are interpreted from the project root when following the run instructions.
- **Import.** The supplied updated CSV has 100 records, including 74 labeled Milwaukee. The importer runs on startup and is safe to rerun. Source post IDs, narratives, verification labels, post dates and supplemental source fields are retained for authorized staff. Missing URLs, coordinates and incident dates remain unknown. The Milwaukee map filters by the reviewed city. A source post date is labeled as such when used in place of a missing incident date.
- **Publication.** The coordinator writes a public summary and selects an approximate area or enters reviewed coordinates. The map lists approved Milwaukee incidents without usable points as awaiting location verification. The two reviewed demo entries use area presets for the Water Street/Buffalo Street report and the Holton Street/Locust Street report. City planning references support the area assignments. [Historic Third Ward plan](https://city.milwaukee.gov/ImageLibrary/Groups/cityDCD/planning/plans/ThirdWard/plan/TWPlan.pdf) · [Northeast Side plan](https://city.milwaukee.gov/ImageLibrary/Groups/cityDCD/planning/plans/Northeast/plan/NESplan.pdf)
- **AI.** The backend commits original submissions before invoking the supplied GPT-4o mini categorizer on the narrative. SQLite stores the AI summary, optional assistance category and team, and review flag separately from incident type, date and location. Staff can retry AI or continue manually if processing is unavailable. The coordinator can keep or change the assistance category and decide whether to publish or open a case. Staff actions drive referrals.
- **Service progress.** A gray pin indicates that assistance has not been assessed. Red indicates work is needed or follow-up was requested. Yellow indicates a referral is pending, work is in progress, or completion is awaiting confirmation. Gray also covers recorded completion when the recipient did not opt in. Green appears in **Confirmed history** once the recipients have confirmed all service cases linked to an incident. A case without an opted-in recipient can record completion but cannot reach recipient-confirmed status through the demo inbox.
- **Privacy.** Public catalog and map responses contain an allowlist of fields. Staff sessions and organization checks protect private intake, tips, and case notes. Confirmation links are time-limited and single-use. The demo inbox is local. See the [backend notes](backend/README.md) for optional SMTP and public geocoding.

## Demonstrate to judges

1. Open **Incident Map**. Select a gray **Reviewed demo** pin, show the source post date, switch to **Heat map**, and filter by category. Explain that the excerpts came from the imported CSV and the pins represent neighborhoods.
2. Open **Submit Report** in the community browser. Use a clearly labeled test narrative such as “TEST REPORT. A family needs temporary shelter tonight.” Enter a synthetic address like `demo-recipient@example.test`, opt in to email updates, and submit. Save the report ID and tracking key. Open **Track this report** and look it up.
3. Sign in as the coordinator in a separate browser profile. Open **Manage Incidents**, select the new report, and compare its original text with the AI suggestions if configured. Set a conventional incident type such as “Housing concern,” review the suggested assistance category, set the city to Milwaukee, and enter a public summary beginning with “TEST REPORT.” Choose Downtown as the approximate public area, mark assistance as needed, and approve.
4. In the community browser, open the new map entry, **Submit a Tip**, and enter a synthetic tip. The tip receipt names its associated incident and its own reference ID.
5. Sign in as the provider in a third browser context. Open the approved incident from the map or **Manage Incidents**. Open the ComForce case, show the linked tip under the private submissions, and mark the case in progress with a test note. The public pin changes as the map refreshes.
6. Mark the case completed. In the coordinator browser, open **Service Updates** and then **Open recipient response form** in the **Demo email inbox**. Confirm assistance as the synthetic recipient.
7. In the public map, choose **Confirmed history** to show the green pin. Run **Track Report** again to show the recorded outcome. The case, tip, and report remain after a backend restart.

See [INTEGRATION.md](INTEGRATION.md) for the code changes and [TEST_REPORT.md](TEST_REPORT.md) for verification results.
