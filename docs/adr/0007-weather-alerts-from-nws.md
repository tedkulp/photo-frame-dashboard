# Weather alerts come from the NWS directly, not Home Assistant

Weather alerts come from the National Weather Service's public API (`api.weather.gov/alerts/active?point=`), fetched by the home server at `zone.home`'s coordinates; only the location comes from Home Assistant. The weather entity we read (`weather.pirateweather`) carries no alerts, so Home Assistant would need another integration first: NWS Alerts from HACS, or Pirate Weather's alerts sensor. Each of those is one more thing to install and keep working, with its own attribute shape, while the NWS API is free, needs no key and gives every alert's event, severity, urgency, headline, description and times in one documented format. We also rejected calling Pirate Weather's API directly because it needs a second API key in the server config. The cost is that alerts are US-only.

## Consequences

- Alerts are opt-in (`settings.homeAssistant.alerts`), next to the radar, so homes outside the US never ask NWS and nobody's coordinates leave the house unless they turned it on.
- NWS publishes no rate limit ("generous for typical use") and sends alerts with a 5-second cache. The server asks at most once a minute, and only while a frame has asked recently. After a refusal or failure it keeps the last good copy and waits for the next minute rather than retrying straight away.
- NWS requires a User-Agent that identifies the app; an optional `contact` setting is added to it so NWS can reach the owner.
- When NWS can't be reached the frame shows the last good alerts minus expired ones, with their age, so an outage never reads as "no alerts".
