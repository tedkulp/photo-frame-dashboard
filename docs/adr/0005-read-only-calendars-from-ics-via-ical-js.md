# Read-only calendars come from ICS links, parsed with ical.js

Calendars that aren't on Google (a Fastmail calendar, a work Outlook calendar) are read from their secret iCal (ICS) subscription links and are read-only on the frame: the dashboard shows their events but never adds to or deletes from them. We rejected CalDAV (Fastmail has it, Outlook doesn't, so it covers half the need) and Microsoft Graph (an Azure app registration and usually admin consent from the work tenant, which may be blocked). Fastmail publishes ICS links; Outlook does when the work tenant allows publishing, which we're assuming until checked (if it doesn't, that calendar can be shared into a Google account instead). An ICS link can't be used to write, which matches what the frame should do with these calendars anyway.

The links are parsed with `ical.js`, the home server's first runtime dependency. Until now the server used Node built-ins only, and a hand-written parser was the alternative; we chose the library because expanding recurring events (`RRULE`, `EXDATE`, edited occurrences) and resolving each file's `VTIMEZONE` definitions (Outlook names zones the Windows way, like "Eastern Standard Time") are large, easy-to-get-subtly-wrong specs, while everything else on the server is a thin layer over built-ins that a library wouldn't shrink.

## Consequences

- `ical.js` is pinned to an exact version in `dependencies`, and the Docker runtime stage installs production dependencies (`npm ci --omit=dev`) instead of copying only `server/`.
- An ICS link is a credential (anyone with it can read the calendar), so it lives with the other secrets, not in `settings.json`.
- The Family calendar must be a Google calendar, because added events go there. An event added for a person whose own calendars are all read-only goes to the Family calendar.
- Each feed is cached about 10 minutes, and the last good copy is served while a feed fails, so one broken link doesn't empty the calendar.
