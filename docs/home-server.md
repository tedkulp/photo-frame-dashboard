# Home server: the dashboard with your Google Calendar

The dashboard ships with mock data. `dashboard/server/` is a small Node server for an always-on
machine at home (in Docker) that serves the built dashboard and a read-only calendar API from one
address on your LAN:

- `GET /` and the built files from `dashboard/dist`. `index.html` is sent with
  `Cache-Control: no-cache`, so the frame picks up a new build on reload.
- `GET /api/calendar` returns `{ people, events, updatedAt }`: every event in your configured Google
  calendars from 7 days ago to 42 days ahead, recurring events expanded. If Google fails it answers
  with a non-2xx status and a JSON `error`; it never pretends the calendar is empty.

It has no npm runtime dependencies and no login of its own: it is meant for your LAN only, so do
not expose its port to the internet.

## 1. Google Cloud: a service account

1. Open <https://console.cloud.google.com/>, create a project (any name).
2. **APIs & Services → Library**, search **Google Calendar API**, click **Enable**.
3. **IAM & Admin → Service Accounts → Create service account**. Any name; skip the optional
   role and user steps.
4. Open the new account, **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
   This is the key: keep it private and never commit it.
5. Note the account's email, for example `frame@my-project.iam.gserviceaccount.com`.

## 2. Share each calendar with the service account

For the shared Family calendar, and for each person's calendar you want on the dashboard:

1. In Google Calendar on the web, hover the calendar → **⋮ → Settings and sharing**.
2. **Share with specific people or groups → Add people and groups**, paste the service-account
   email, permission **Make changes to events**, **Send**.
3. Further down, **Integrate calendar → Calendar ID**. Copy it (it looks like
   `abc123…@group.calendar.google.com`, or a Gmail address for someone's main calendar).

"Make changes to events" lets a later version add events from the dashboard; this server only
reads.

## 3. Settings

Copy [`dashboard/settings.example.json`](../dashboard/settings.example.json) and fill it in:

```json
{
  "people": [
    { "id": "alex", "name": "Alex", "colour": "#2D5BFF" },
    { "id": "jordan", "name": "Jordan", "colour": "#E4007C" }
  ],
  "calendars": [
    { "calendarId": "abc123family@group.calendar.google.com", "person": "family" },
    { "calendarId": "alex@example.com", "person": "alex" }
  ]
}
```

- `people[].id` is what events are tagged with; `colour` is a 6-digit hex colour.
- Exactly one calendar has `"person": "family"`. Its events belong to everyone.
- Per-person calendars are optional. An event that appears in several of your calendars (say,
  an invite on two people's calendars) is shown once, with both people.

The server looks for each item in this order: the inline variable, then the path variable, then
the default file (relative to the folder it runs in; `/app` in Docker).

| Setting | Env (inline) | Env (path) | Default file |
| --- | --- | --- | --- |
| People + calendars | `DASHBOARD_SETTINGS_JSON` | `DASHBOARD_SETTINGS_FILE` | `config/settings.json` |
| Service-account key | `GOOGLE_SERVICE_ACCOUNT_JSON` | `GOOGLE_SERVICE_ACCOUNT_FILE` | `config/service-account.json` |
| Port | `PORT` | | `8080` |
| Time zone | `TZ` | | the Family calendar's time zone |

If anything is missing or wrong (no key, bad JSON, a calendar naming a person who isn't in
`people`, no Family calendar), the server stops at startup and says which item.
`dashboard/config/` is git-ignored.

## 4. Run it with Docker

From `dashboard/`, copy [`compose.example.yaml`](../dashboard/compose.example.yaml) to
`compose.yaml` and keep the style you want:

- **`dashboard`**: put `settings.json` and `service-account.json` in `dashboard/config/`; the
  folder is mounted read-only.
- **`dashboard-env`**: settings inline in the compose file, the key passed as a compose secret
  and read through `GOOGLE_SERVICE_ACCOUNT_FILE`.

```sh
cd dashboard
docker compose up -d --build dashboard      # or dashboard-env
curl http://localhost:8080/api/calendar     # should list your events
```

The container runs as the `node` user (uid 1000), so the key file must be readable by that uid.
Without Docker: `npm install && npm run build && npm run server` in `dashboard/` (Node 20.19 or
newer).

## 5. Point the frame at it

Give the home machine a fixed LAN address (a DHCP reservation in your router), then with the frame
connected over ADB:

```sh
scripts/set-kiosk-url.sh http://<server-ip>:8080/
```

## Developing

```sh
cd dashboard
npm run server   # API + dist on :8080 (needs config/)
npm run dev      # Vite on :5173, proxies /api to :8080
npm test         # server tests against a local fake Google; no network or real key needed
```
