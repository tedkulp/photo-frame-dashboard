# Home server: the dashboard with your Google Calendar

The dashboard takes its family (names, colours) and its calendar from this server's
`GET /api/calendar`, adds events through it, and takes the weather from your Home Assistant
through `GET /api/weather`; everything else (chores, shopping, photos, home controls) is still
mock data. `dashboard/server/` is a small Node server for an
always-on machine at home (in Docker) that serves the built dashboard and a calendar API from one
address on your LAN:

- `GET /` and the built files from `dashboard/dist`. `index.html` is sent with
  `Cache-Control: no-cache`, so the frame picks up a new build on reload.
- `GET /api/calendar` returns `{ people, events, updatedAt }`: every event in your configured Google
  calendars from 7 days ago to 42 days ahead, recurring events expanded. If Google fails it answers
  with a non-2xx status and a JSON `error`; it never pretends the calendar is empty.
- `POST /api/events` with a JSON body `{ title, start, end, people, allDay? }` creates the event
  and answers `201` with it in the same shape `GET /api/calendar` uses. `start`/`end` are times
  with an offset (`2026-10-20T15:30:00-04:00`), or dates (`2026-10-20`, end exclusive) with
  `allDay: true`; `people` lists person ids. It goes to that person's own calendar when exactly
  one person with a calendar in `settings.calendars` is picked, otherwise to the Family calendar
  (so on the dashboard it then belongs to everyone). Bad input gets `400` and a JSON `error`, and
  nothing is written; the body must be sent as `application/json`.
- `DELETE /api/events/:id` deletes an event by the `id` the API gave it (`204`). Only events in
  the configured calendars can be deleted. The dashboard uses it for **Undo** right after adding.
- `GET /api/weather` returns `{ configured: true, now, hourly, daily, updatedAt }` from a Home
  Assistant weather entity, in whole °F (see [Weather](#weather-from-home-assistant-optional)), or
  `{ configured: false }` when Home Assistant isn't set up. If Home Assistant fails it answers
  `502` with a JSON `error`.

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

"Make changes to events" is what lets the dashboard add events. With **See all event details**
the calendar still shows, but adding to it fails with an error.

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
| Home Assistant token (only with `homeAssistant`) | `HOME_ASSISTANT_TOKEN` | `HOME_ASSISTANT_TOKEN_FILE` | `config/home-assistant-token` |
| Port | `PORT` | | `8080` |
| Time zone | `TZ` | | the Family calendar's time zone |
| Data dir (chores) | | `DASHBOARD_DATA_DIR` | `data/` |

If anything is missing or wrong (no key, bad JSON, a calendar naming a person who isn't in
`people`, no Family calendar), the server stops at startup and says which item.
`dashboard/config/` is git-ignored.

### Weather from Home Assistant (optional)

The weather comes from a Home Assistant weather entity; we use the
[PirateWeather](https://github.com/Pirate-Weather/pirate-weather-ha) integration, but any entity
that answers `weather.get_forecasts` with hourly and daily forecasts works. Add to the settings:

```json
"homeAssistant": { "url": "http://homeassistant.local:8123", "weatherEntity": "weather.pirateweather" }
```

and give the server a long-lived access token (Home Assistant → your profile → Security →
Long-lived access tokens) as `HOME_ASSISTANT_TOKEN`, a file named by `HOME_ASSISTANT_TOKEN_FILE`,
or `config/home-assistant-token`. With `homeAssistant` set, a missing or empty token, a bad URL or
an entity id that isn't `weather.*` stops the server at startup. Without it the server runs as
before and the dashboard says "Weather not set up".

Temperatures are converted to whole °F on the server whatever Home Assistant's unit system is.
Home Assistant's conditions are folded into seven: sunny, clear night, partly cloudy, cloudy (also
fog, wind), rain (also pouring, hail), snow (also sleet) and storm (lightning).

```sh
curl http://localhost:8080/api/weather   # should show "configured": true and a forecast
```

## 4. Run it with Docker

From `dashboard/`, copy [`compose.example.yaml`](../dashboard/compose.example.yaml) to
`compose.yaml` and keep the style you want:

- **`dashboard`**: put `settings.json` and `service-account.json` in `dashboard/config/`; the
  folder is mounted read-only.
- **`dashboard-env`**: settings inline in the compose file, the key passed as a compose secret
  and read through `GOOGLE_SERVICE_ACCOUNT_FILE`.

```sh
cd dashboard
mkdir -p data && sudo chown 1000:1000 data  # chores are saved here; see "Data and backups"
docker compose up -d --build dashboard      # or dashboard-env
curl http://localhost:8080/api/calendar     # should list your events
```

To skip building on the home server, use the image GitHub Actions builds from every push to
`main` (`.github/workflows/docker.yml`, amd64 and arm64): in `compose.yaml` replace `build: .`
with `image: ghcr.io/tedkulp/photo-frame-dashboard:latest`, then
`docker compose pull && docker compose up -d dashboard`. Each build is also tagged `sha-<commit>`
if you want to pin one. On a fork, use your own `ghcr.io/<owner>/<repo>`; a new GHCR package is
private until you make it public in the package settings (or `docker login ghcr.io` first).

The container runs as the `node` user (uid 1000), so the key file must be readable by that uid.
Without Docker: `npm install && npm run build && npm run server` in `dashboard/` (Node 22.13 or
newer; Node 24 may print an experimental warning for SQLite at startup).

## Data and backups

The server saves what it is told to remember (chores, and which chores were done on which day) in
one SQLite file, `home.db`, in its data dir: `data/` next to where it runs (`/app/data` in Docker,
mounted from `dashboard/data`), or `DASHBOARD_DATA_DIR`. It starts with no chores. The folder is
created if missing and is git-ignored; it is private, like `config/`.

- Mount the folder, not the file: SQLite keeps `home.db-wal` and `home.db-shm` beside `home.db`.
- In Docker the folder must be writable by uid 1000 (`chown 1000:1000 ./data`). If it isn't, the
  server stops at startup with `data dir /app/data is not writable by uid 1000 ...` and the
  `chown` to run.
- Back up by copying the whole folder while the container is stopped, or while it is running:

  ```sh
  sqlite3 data/home.db ".backup /path/to/backup.db"
  ```

  To restore, stop the server and put the backup in place as `data/home.db`, with no `-wal`/`-shm`
  files left beside it.
- Changing a chore's owner or days, or deleting it, applies from today; earlier days keep what was
  scheduled then. Deleted chores are hidden, never removed. Chores belonging to someone you take
  out of `settings.people` are hidden too, and come back if you add them again.

```sh
curl http://localhost:8080/api/chores       # { "date": ..., "chores": [], "done": [], "week": {} }
```

## What the dashboard does with it

Weather works the same way as the calendar, with its own timings: it is fetched every 10 minutes
and cached, and the Today view says "Weather from N hr ago" once no fetch has worked for an hour.
An old forecast is still used for the hours it covers; once it no longer covers the current hour
the view says "Weather unavailable". The summary and advice lines ("Rain from 4 PM. Grab a rain
jacket.") come from the rule tables in `dashboard/js/advice.js`; edit them there.

Calendar:

- On boot it fetches `/api/calendar` (same origin as the page), then again every 5 minutes. A
  failed fetch is retried after 5 s, doubling up to 5 minutes, forever; Wi-Fi coming up after the
  page is fine.
- The last good response is kept in the page's `localStorage` and shown straight away on the next
  boot, so a reload while the server is down still shows the calendar. Once no fetch has worked for
  15 minutes, the Today and Calendar views say "Updated N min ago".
- With no saved response and no server, the calendar says it can't reach the home server instead
  of showing events.
- All-day events go on their date in the frame's time zone; timed events show in the frame's local
  time, so set the frame's time zone to match the family's.
- The mock chores, stars and photo credits are handed to your people by position (first mock
  person → first person in `settings.people`, and so on). Nobody shows a home/away status: there
  is no source for it.
- **Add event** on the Calendar view writes to Google: the event shows once the server confirms
  it, and **Undo** on the toast deletes it again. If the write fails you get an error toast and the
  sheet stays open with what you typed. Adding is switched off (greyed button, with the reason)
  while the last request failed or no calendar fetch has worked for 15 minutes.

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
npm run dev:all  # both at once; the server restarts when server/ changes, Ctrl+C stops both
npm test         # server tests (local fake Google + Home Assistant, no network or real key) + dashboard tests
```
