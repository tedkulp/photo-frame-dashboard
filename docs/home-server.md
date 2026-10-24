# Home server: the dashboard with your Google Calendar

The dashboard takes its family (names, colours) and its calendar from this server's
`GET /api/calendar`, adds events through it, and takes the weather from your Home Assistant
through `GET /api/weather`. Home controls and the Today page's Home card show and change the
Home Assistant entities you label for the frame, through `GET /api/home`, and the photos from one
Immich album through `GET /api/photos`; shopping is still mock data. `dashboard/server/` is a small Node server for an
always-on machine at home (in Docker) that serves the built dashboard and a calendar API from one
address on your LAN:

- `GET /` and the built files from `dashboard/dist`. `index.html` is sent with
  `Cache-Control: no-cache`, so the frame picks up a new build on reload.
- `GET /api/calendar` returns `{ people, events, updatedAt }`: every event in your configured Google
  calendars and [read-only calendars](#read-only-calendars-from-ics-links-optional) from 7 days ago
  to 42 days ahead, recurring events expanded. Each event has `deletable`: `false` when it is only
  on read-only or [holiday](#holiday-calendars-optional) calendars. A holiday calendar's events
  (all-day only) come with `people: []`. If Google fails it answers with a non-2xx status and a JSON `error`; it
  never pretends the calendar is empty. A read-only feed that fails doesn't fail the answer.
- `POST /api/events` with a JSON body `{ title, start, end, people, allDay? }` creates the event
  and answers `201` with it in the same shape `GET /api/calendar` uses. `start`/`end` are times
  with an offset (`2026-10-20T15:30:00-04:00`), or dates (`2026-10-20`, end exclusive) with
  `allDay: true`; `people` lists person ids. It goes to that person's own calendar when exactly
  one person with a Google calendar in `settings.calendars` is picked, otherwise to the Family calendar
  (so on the dashboard it then belongs to everyone). Bad input gets `400` and a JSON `error`, and
  nothing is written; the body must be sent as `application/json`.
- `DELETE /api/events/:id` deletes an event by the `id` the API gave it (`204`). Only events in
  the configured Google calendars can be deleted: an event only on read-only or holiday calendars gets `403`
  and nothing is written. The dashboard uses it for **Undo** right after adding.
- `GET /api/weather` returns `{ configured: true, now, hourly, daily, updatedAt }` from a Home
  Assistant weather entity, in whole °F (see [Weather](#weather-from-home-assistant-optional)), or
  `{ configured: false }` when Home Assistant isn't set up. If Home Assistant fails it answers
  `502` with a JSON `error`.
- `GET /api/home` and its actions: Home controls from Home Assistant, see
  [Home controls](#home-controls-from-home-assistant-optional).
- `GET /api/photos` and `GET /api/photos/:id.jpg`: the photos from one Immich album, see
  [Photos](#photos-from-immich-optional).
- An optional feature that isn't set up (weather, Home controls, photos) answers the same way:
  `GET` on its top-level path (`/api/weather`, `/api/home`, `/api/photos`) is `200`
  `{ configured: false }`, and any other request under it (another method, an action, an image) is
  `404` with a JSON `error` naming it, e.g. `Home Assistant is not set up`.
- `GET /api/version` returns `{ build }`: the id `npm run build` stamped into the `dist` being
  served (`dist/version.json`), or `{ build: null }` without one. Sent `Cache-Control: no-store`.
  The dashboard uses it to [reload itself after an update](#updates-reload-the-dashboard).

Its one npm runtime dependency is [`ical.js`](https://github.com/kewisch/ical.js), for the
read-only calendars ([ADR 0005](adr/0005-read-only-calendars-from-ics-via-ical-js.md)). It has no
login of its own: it is meant for your LAN only, so do not expose its port to the internet.

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
- A calendar can also be read-only, from an ICS link: `{ "ics": "alex-work", "person": "alex" }`.
  See [Read-only calendars](#read-only-calendars-from-ics-links-optional). The Family calendar
  must be a Google calendar.
- `"person": "none"` makes a calendar a holiday calendar: its all-day events show for no one. See
  [Holiday calendars](#holiday-calendars-optional). `family` and `none` can't be person ids.
- `people[].homeAssistant` (optional, needs `homeAssistant` below) links a person to their Home
  Assistant `person.*` entity, e.g. `"homeAssistant": "person.alex"`, so their avatar shows
  whether they are home (see [presence](#home-controls-from-home-assistant-optional)). Anything
  that isn't a `person.*` id stops startup with a message naming the person.
- `people[].immich` (optional, needs `immich` below) is the email of that person's Immich user,
  e.g. `"immich": "alex@example.com"`, so the photos they uploaded to the album are credited to
  them (see [Photos](#photos-from-immich-optional)).

The server looks for each item in this order: the inline variable, then the path variable, then
the default file (relative to the folder it runs in; `/app` in Docker).

| Setting | Env (inline) | Env (path) | Default file |
| --- | --- | --- | --- |
| People + calendars | `DASHBOARD_SETTINGS_JSON` | `DASHBOARD_SETTINGS_FILE` | `config/settings.json` |
| Service-account key | `GOOGLE_SERVICE_ACCOUNT_JSON` | `GOOGLE_SERVICE_ACCOUNT_FILE` | `config/service-account.json` |
| Home Assistant token (only with `homeAssistant`) | `HOME_ASSISTANT_TOKEN` | `HOME_ASSISTANT_TOKEN_FILE` | `config/home-assistant-token` |
| Immich API key (only with `immich`) | `IMMICH_API_KEY` | `IMMICH_API_KEY_FILE` | `config/immich-api-key` |
| ICS link (one per `ics` calendar) | | | `config/<ics name>` |
| Port | `PORT` | | `8080` |
| Time zone | `TZ` | | the Family calendar's time zone |
| Data dir (chores) | | `DASHBOARD_DATA_DIR` | `data/` |

If anything is missing or wrong (no key, bad JSON, a calendar naming a person who isn't in
`people`, no Family calendar), the server stops at startup and says which item.
`dashboard/config/` is git-ignored.

### Read-only calendars from ICS links (optional)

Calendars that aren't on Google, like a Fastmail calendar or a work Outlook calendar, can be shown
from their secret iCal (ICS) link. The dashboard shows their events but never adds to or deletes
from them ([ADR 0005](adr/0005-read-only-calendars-from-ics-via-ical-js.md)). In
`settings.calendars`, give each one a name instead of a `calendarId`:

```json
{ "calendarId": "alex@example.com", "person": "alex" },
{ "ics": "alex-fastmail", "person": "alex" },
{ "ics": "jordan-work", "person": "jordan" }
```

and put each link in a file in `config/` named after it, holding just the URL (like
`config/immich-api-key`):

```sh
echo 'https://<your Fastmail ICS link>' > config/alex-fastmail
echo 'https://outlook.office365.com/owa/calendar/<…>/calendar.ics' > config/jordan-work
```

A name is lowercase letters, digits, `-` and `_` (it can't be `home-assistant-token` or
`immich-api-key`). There's no env variable for these links, so with the env-only Docker style,
mount the link files into `/app/config/`.

**The link is a secret.** Anyone who has it can read that calendar, so it lives with the other
secrets, never in `settings.json` or a commit. If one leaks, make a new link (and drop the old one)
in Fastmail or Outlook.

- Startup stops with a message if a name has no link file, a link isn't `http://` or `https://` (for a
  `webcal://` link, change `webcal` to `https`), or the Family calendar is an `ics` one.
- A person can have a Google calendar and read-only calendars together. An event added on the
  frame for one person goes to their own Google calendar, or to the Family calendar if all their
  calendars are read-only.
- The same event on a Google calendar and a feed (same UID and start) shows once, with both
  people. It can be deleted through its Google copy; the feed's copy keeps showing.
- Each link is read at most every 10 minutes. If one fails (the server logs why), its last good
  copy keeps showing and the other calendars are unaffected; before it has ever worked it shows
  nothing. A failing link is tried again every 2 minutes.
- Times use the time zones the file defines (Outlook names them the Windows way, like "Eastern
  Standard Time"). A time zone the file uses but doesn't define is read in the frame's time zone,
  and the server logs a warning once.

**Fastmail:** Settings → **Calendars**, open the calendar's sharing options and turn on sharing
with anyone by a read-only link, then copy its **iCal (ICS)** link (the labels move between
Fastmail versions; you want the subscription link, not the CalDAV account address).

**Outlook (work or personal):** Outlook on the web → Settings → Calendar → **Shared calendars** →
**Publish a calendar**: pick the calendar and **Can view all details** (or **Can view titles and
locations**), **Publish**, and copy the **ICS** link (not the HTML one).

If **Publish a calendar** isn't there, or the link doesn't work, your work tenant blocks
publishing. The fallback is to share the Outlook calendar into Google: in Outlook, **Share** the
calendar with your Google address; once it shows up in Google Calendar, share it with the service
account (step 2) and add it as a normal `calendarId` calendar. Check that company policy allows
it first.

### Holiday calendars (optional)

A holiday calendar's all-day events show on the frame without belonging to anyone: a grey chip
with no avatar or person dots on Today and in the Calendar views. Give the calendar
`"person": "none"`. It can be a Google calendar or an ICS link, and you can have as many as you like:

```json
{ "calendarId": "abc123family@group.calendar.google.com", "person": "family" },
{ "calendarId": "en.usa#holiday@group.v.calendar.google.com", "person": "none" },
{ "ics": "school-holidays", "person": "none" }
```

**A Google public holiday calendar:** in Google Calendar on the web, **Other calendars → + →
Browse calendars of interest → Holidays**, tick your country, then open that calendar's
**⋮ → Settings** and copy its **Calendar ID** (it ends in `@group.v.calendar.google.com`; the one
above is the US holidays one). A public calendar can be read without sharing it with the service
account (step 2 is for your own calendars).

**An ICS link** (a school's or a country's holiday feed) works like any
[read-only calendar](#read-only-calendars-from-ics-links-optional): its link goes in
`config/<ics name>`:

```sh
echo 'https://<the holiday feed's ICS link>' > config/school-holidays
```

What changes for a holiday calendar:

- Only its all-day events are shown. Its timed events are left out.
- Its events can't be deleted from the frame, even when it is a Google calendar, and an event added
  on the frame never goes to it.
- They don't show on a person's lane or when a view shows one person, and the idle and night
  screens never pick one as "First up".
- If the same event (same UID and start) is also on a person's or the Family calendar, it shows
  once, as that calendar's event, with its people and colour, and can be deleted there.
- A holiday calendar that fails to load (a mistyped Calendar ID, no access, a Google error) doesn't
  take the calendar down: it is skipped, with an error naming it in the server log, and shows its
  last good copy if it loaded earlier. A failing person's or Family calendar still fails the load.

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

The response, for the Today card and the Weather page:

```json
{
  "configured": true,
  "now": { "temp": 49, "cond": "sun", "feels": 40, "humidity": 56, "wind": 11, "gust": 23,
           "bearing": 6, "uv": 0, "sunrise": "2026-10-22T11:30:00+00:00", "sunset": "2026-10-21T22:30:00+00:00" },
  "hourly": [{ "at": "2026-10-21T11:00:00+00:00", "temp": 48, "cond": "moon", "pop": 0, "wind": 9, "bearing": 20, "humidity": 76 }],
  "daily": [{ "at": "2026-10-21T04:00:00+00:00", "hi": 64, "lo": 46, "cond": "sun", "pop": 0, "wind": 8, "gust": 14, "bearing": 18, "humidity": 60 }],
  "updatedAt": "2026-10-21T11:50:02.000Z"
}
```

- `cond` is one of `sun`, `moon`, `partly`, `cloud`, `rain`, `snow`, `storm`; `pop` is the chance
  of precipitation in %; `hourly` has up to 48 hours, `daily` up to 7 days.
- `wind` and `gust` are whole **mph**, converted from the entity's `wind_speed_unit` (mph, km/h,
  m/s, kn or ft/s; another unit leaves wind speeds out). `bearing` is whole degrees (0 = from the
  north). `humidity` is %.
- `now.feels` (whole °F) and `now.uv` come from the forecast hour covering now, else the entity's
  own `apparent_temperature` / `uv_index`.
- `now.sunrise` / `now.sunset` are the **next** sunrise and sunset from Home Assistant's `sun.sun`
  (so after sunset, tomorrow's).
- Every field past `temp`, `cond` and `pop` is left out when Home Assistant doesn't give it
  (another weather integration, no `sun.sun`); that never fails the request.

```sh
curl http://localhost:8080/api/weather   # should show "configured": true and a forecast
```

### Home controls from Home Assistant (optional)

With `homeAssistant` set, the server also holds one websocket connection to Home Assistant
(same URL and token) and keeps the state of the entities you have put on the frame. Nothing is
picked in `settings.json`: in Home Assistant, create a label `frame` (Settings → Areas, labels &
zones → Labels) and add it to each entity that belongs on the panel (see
[ADR 0003](adr/0003-home-controls-curated-by-ha-label.md)). Room = the entity's area, else its
device's area; name = its friendly name. Supported: `light`, `switch`, `input_boolean`, `fan`,
`lock`, `climate`, `scene`, `script`, `camera`, `media_player`; labelled entities in other
domains, and disabled ones, are ignored. Home controls shows the first four labelled cameras by
name (a 2×2 grid). Tag a light group only when it acts as one fixture, not
both a group and its members.

Two optional keys in `homeAssistant`:

```json
"homeAssistant": {
  "url": "http://homeassistant.local:8123",
  "weatherEntity": "weather.pirateweather",
  "label": "frame",
  "rooms": ["Living Room", "Office", "Robin's Room"]
}
```

- `label` (default `"frame"`): the label's id or name (any case).
- `rooms`: area names in the order the page shows them. Case and curly vs straight apostrophes
  don't matter. Rooms not listed come next, alphabetically, then "Other" for labelled entities
  with no area. On each connect the server logs a warning for a listed room that isn't an area,
  and for a label Home Assistant doesn't have.

**Presence.** For each person with `people[].homeAssistant`, the server also follows that
`person.*` entity (it needs no label and is never a tile or an action target). On the frame, the
Today "who" row, the Today lane headers and the ambient "who" row draw that person **Home**
(solid) or **Away** (hollow ring with a coloured letter). A person HA doesn't know about, who isn't
linked, or whose state can't be trusted right now (Home Assistant or the server unreachable)
shows solid. On connect the server warns about a linked entity Home Assistant doesn't have.

Renaming, moving or tagging things in Home Assistant shows up straight away (the server re-reads
the registries when they change). If the connection drops it reconnects with a growing delay (1 s
up to 1 min) and in the meantime still answers with the last-known state.

API (all JSON, `cache-control: no-store`; without `homeAssistant`, `GET /api/home` is
`{ configured: false }` and the rest `404` `Home Assistant is not set up`):

- `GET /api/home` →
  `{ configured: true, connected, updated, rooms, climate, scenes, cameras, media, presence }`.
  `connected` is false while the websocket is down; `updated` is when the last registry,
  labelled-entity or linked-person update arrived (ISO time, null before the first connection).
  - `rooms`: `[{ name, tiles }]`; tiles sorted by name, each `{ id, kind, name, available }`
    plus: `light` → `on`, `dimmable`, `level` (1–100; null when off, not dimmable, or on at
    brightness 0 as some Govee/Matter lights report); `switch`, `fan`, `toggle`
    (input_boolean) → `on`; `lock` → `locked`, `state` (HA's: `locked`, `unlocked`, `jammed`, …).
    `available` is false when Home Assistant says `unavailable`.
  - `climate`: the labelled climate entity (the first by id if there are several), or null:
    `{ id, name, available, mode, modes, action, current, humidity, target, low, high }`.
    Temperatures are whole °F; `target` is the single setpoint (heat/cool), `low`/`high` the
    range (`heat_cool`, Auto). `modes` is what the entity supports out of `heat`, `cool`,
    `heat_cool`, `off`.
  - `scenes`: labelled `scene.*` and `script.*`, `[{ id, name, icon }]` (`icon` is HA's
    `mdi:…` or null).
  - `cameras`: `[{ id, name, available }]`.
  - `media`: `[{ id, name, available, state, title, artist, hasArt }]`.
  - `presence`: `{ [personId]: "home" | "away" }` for linked people: HA state `home` is
    `"home"`, any other known state (`not_home`, a zone such as `School`) is `"away"`. People
    whose entity is `unknown`, `unavailable` or missing, and unlinked people, are left out.
- `POST /api/home/:entityId` with `{ action, value? }`, answered `204` once Home Assistant has
  acknowledged the service call:

  | Domain | Actions |
  | --- | --- |
  | `light` | `on`, `off`, `level` (value 0–100, brightness %) |
  | `switch`, `input_boolean`, `fan` | `on`, `off` |
  | `lock` | `lock`, `unlock` |
  | `climate` | `mode` (value one of `modes`), `target` (°F), `range` (`{ low, high }` in °F) |
  | `scene`, `script` | `run` |
  | `media_player` | `play`, `pause` |

  An entity without the label (or unknown) is `404`; any other action or a bad value is `400`;
  Home Assistant disconnected is `503`; Home Assistant refusing the call is `502` with its message.
- `POST /api/home/rooms/:name/off` turns off that room's available lights, switches and fans
  (`204`; a room with none is `404`). `:name` matches like `rooms`; `Other` is the no-area room.
- `GET /api/home/cameras/:entityId.jpg`: a snapshot of a labelled camera.
- `GET /api/home/media/:entityId/art`: a labelled player's current artwork.

The images are fetched from Home Assistant with the token on the server; the token never reaches
the frame.

```sh
curl http://localhost:8080/api/home   # "connected": true and your labelled entities by room
```

### Photos from Immich (optional)

The Photos page, the idle photo frame and the Today page's photo tile show one album from your
[Immich](https://immich.app) server. (Not Google Photos: since 31 March 2025 its API can't read an
existing library; see [ADR 0004](adr/0004-photos-from-immich.md).) Add to the settings:

```json
"immich": { "url": "http://immich.local:2283", "albumId": "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d" }
```

- `albumId` is the last part of the album's address in Immich's web app
  (`…/albums/<albumId>`). Put the photos you want on the frame in that album; to let the family
  add theirs, share the album with their Immich users.
- Make an API key (Immich → Account settings → API keys → New API key) with the permissions
  **`album.read`** (the album and who shares it), **`asset.read`** (its photos, with their EXIF)
  and **`asset.view`** (the preview images), plus **`user.read`** if someone who isn't one of the
  album's users (an Immich admin, say) adds photos to it and should be credited. Give it to the server as `IMMICH_API_KEY`, a
  file named by `IMMICH_API_KEY_FILE`, or `config/immich-api-key`. The key's user must own the
  album or have it shared with them.
- With `immich` set, a missing or empty key, a bad URL or an `albumId` that isn't an Immich id
  stops the server at startup. Without it the server runs as before and the dashboard keeps its
  sample photos.

Each image in the album becomes one photo; videos are left out. For each:

- **Portrait or landscape** from its width and height once EXIF orientation is applied.
- **Date** is the local date it was taken (the camera's clock), used for "3 years ago" and "On this
  day". Photos taken the same day are grouped, so two portraits from one day can show side by side.
- **Place** is the city from Immich's reverse geocoding, else the state or country, else nothing.
- **From** is the person whose `people[].immich` email matches the Immich user who uploaded it
  (ignoring case), shown as "From Alex" in the slideshow's caption. Uploaders are matched among the
  album's users, then (with `user.read`) all Immich users; anyone else's photos show with no name.
- **Favourite** is Immich's favourite heart; favourites come round twice as often. Tapping
  **Favourite** on the frame changes it on that frame only, until the album next changes; it never
  writes to Immich.

API (JSON is `cache-control: no-store`):

- `GET /api/photos` → `{ configured: true, photos: [{ id, o, date, place, from?, tag, fav }], updatedAt }`:
  `o` is `"p"` or `"l"`, `date` and `tag` are `YYYY-MM-DD`, `place` may be `""`, `from` is a
  person id and left out when nobody matches. Without `immich`, `{ configured: false }` (and every
  other `/api/photos` request is `404` `Photos are not set up`). The album
  is read from Immich at most once every 5 minutes; if Immich fails it answers `502` with a JSON
  `error`, and the frame keeps the photos it had.
- `GET /api/photos/:id.jpg`: the photo's preview-size image (Immich's own, about 1440 px), streamed
  from Immich with the key on the server. Only photos in the album are served (any other id is
  `404`; while Immich can't list the album, the last listing it gave decides); the browser may keep
  an image for an hour. Nothing is stored on the server, and the key
  never reaches the frame.

```sh
curl http://localhost:8080/api/photos   # "configured": true and your album's photos
```

## 4. Run it with Docker

From `dashboard/`, copy [`compose.example.yaml`](../dashboard/compose.example.yaml) to
`compose.yaml` and keep the style you want:

- **`dashboard`**: put `settings.json` and `service-account.json` (and one link file per
  read-only calendar) in `dashboard/config/`; the folder is mounted read-only.
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
curl http://localhost:8080/api/chores       # { "date": ..., "chores": [], "done": [], "week": { <each person>: [7 × null] } }
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
- A timed event that starts and ends exactly at midnight in the frame's time zone, on different
  dates, shows as an all-day event on those dates (Outlook calendars shared into Google write
  all-day events that way). This applies to every calendar, Google or read-only.
- Without an Immich album, the sample photos and their credits are handed to your people by
  position (first mock person → first person in `settings.people`, and so on). With one, the
  album's photos replace them everywhere, and are fetched every 5 minutes and cached like the
  calendar: new photos join the slideshow without a reload, and a boot with Immich or the server
  down shows the last photos (or the sample ones, the very first time). Home/away comes only from Home
  Assistant, for people linked with `people[].homeAssistant`.
- **Add event** on the Calendar view writes to Google: the event shows once the server confirms
  it, and **Undo** on the toast deletes it again. If the write fails you get an error toast and the
  sheet stays open with what you typed. Adding is switched off (greyed button, with the reason)
  while the last request failed or no calendar fetch has worked for 15 minutes.

### Updates reload the dashboard

Every `npm run build` gives the dashboard a new build id, carried by the page and reported by
`GET /api/version`. Each open dashboard asks for it every minute; when the server reports a
different build (the container was updated), the page reloads itself, so nobody has to do
**Reload dashboard** on the frame.

- It waits until nothing would be lost: no sheet open, no edit mode on, and no chore tick or Home
  controls tap still waiting for the server. Then it reloads straight away.
- It reloads at most once per server build: the build it reloaded for is kept in the page's
  `sessionStorage`, and if the server still reports a different build afterwards it stays put. If
  `sessionStorage` doesn't work it never reloads.
- Restarting the container on the same build, an unreachable server, or a server with no build id
  changes nothing, and shows no error. The Vite dev server, the Cloudflare deploy and the kiosk's
  bundled site have no `/api/version`, so they never reload themselves (they keep asking, backing
  off to once every 5 minutes).

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
