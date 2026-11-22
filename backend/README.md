# FastAPI and SQLite

Run commands from the project root. [Setup and demonstration steps](../README.md) are in the main README.

- `backend.manage init` migrates SQLite and imports the bundled dataset. FastAPI also imports at startup. Import identity is the source plus post ID.
- The staff commands use the same database path as the API. Coordinator credentials have the `admin` role. Worker access follows the provisioned organization and case membership. An existing case is returned if the same organization opens the same incident again.
- `GET /api/map/incidents?view=active|completed|all` returns the public Milwaukee projection. The public incident catalog also supports incidents without coordinates. Staff map actions resolve through a separate authorized endpoint.
- The default AI parser invokes the supplied categorizer. `COMFORCE_PARSER=module:function` can optionally select a Python callable accepting a narrative. For legacy integrations the backend still accepts conventional incident field proposals. These remain distinct from assistance recommendations.
- To look up a public landmark, set `MILWAUKEE_GEOCODER_CONTACT` in `backend/.env` and run `python -m backend.manage geocode "public landmark" --public`. Review the results before entering an approximate coordinate in the approval form. The lookup is optional. Named public areas work locally.

## Notifications

Demo delivery is the default. The coordinator can inspect the inbox through **Service Updates**. The API queues updates and notifications in the same transaction. A recipient’s confirmation link expires after 72 hours. Opening it displays a form, and submitting the form records a single confirmation or dispute against the corresponding service update.

For live SMTP, explicitly set `COMFORCE_EMAIL_MODE=smtp` and configure `COMFORCE_SMTP_HOST`, `COMFORCE_SMTP_PORT` (default 465), `COMFORCE_SMTP_USERNAME`, `COMFORCE_SMTP_PASSWORD`, `COMFORCE_SMTP_FROM`, and an HTTPS `COMFORCE_PUBLIC_ORIGIN`. Use one delivery process to run `python -m backend.manage deliver`. Add `--retry-failed` to retry failed messages. SMTP can redeliver if accepted by the provider immediately before the local delivery transaction is interrupted. The local launch scripts disable Uvicorn access logging because response URLs contain bearer tokens.
