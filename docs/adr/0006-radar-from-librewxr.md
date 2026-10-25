# Radar comes from LibreWXR, cached by the home server

The Weather page's radar comes from LibreWXR's public API (librewxr.net), the one part of the weather that isn't Home Assistant; only the home's location (`zone.home`) comes from HA. Home Assistant has no radar image of its own to give, and LibreWXR covers the US with real radar (NOAA MRMS) through one fixed-size image per frame centred on a point, which suits a frame that can't run a map library. The home server fetches those images and serves them to the frame from its own cache; we rejected letting the frame load LibreWXR directly (CORS would allow it) because every open screen would then make its own requests, and the public instance asks for "reasonable request rates" and encourages caching. Its terms also forbid re-exposing the hosted endpoint as your own API or proxy, so the cache is private to the household: it serves only the home's fixed location, zoom and look, and its routes take no URL or coordinates from the client.

## Consequences

- Radar is opt-in (`settings.homeAssistant.radar`), so nobody's home coordinates go to a third party unless they turned it on.
- Nothing is fetched unless someone is looking: the frame asks only while the Weather page is on screen, and the server checks LibreWXR's frame list at most every 10 minutes and only when asked. Past frames never change, so each is fetched once.
- The OpenStreetMap background never changes for a fixed location and zoom, so its few tiles are fetched once into the data dir, with a User-Agent as OSM's tile policy asks.
- The radar credits LibreWXR, NOAA and OpenStreetMap on screen (CC-BY-4.0 and OSM's terms).
- The public instance has no SLA: when it fails the radar shows its last good frames with their age, and the rest of the Weather page never waits on it.
