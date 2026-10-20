# Home controls show only Home Assistant entities with the `frame` label

Home Assistant has about 1,900 entities here and only a few dozen belong on a wall panel, so what Home controls shows is chosen in Home Assistant itself: an entity appears if it carries the `frame` label, its room is its HA area, and its name is its HA friendly name. The home server reads labels, areas and state over one websocket subscription and refuses any service call for an entity without the label, so the frame (which never sees the token) can only touch what was deliberately put on it. We rejected an explicit entity list in `settings.json` (curation away from where devices are renamed and moved, and a server edit for every new lamp) and showing every entity in the supported domains (integration noise and duplicates swamp the page, and the frame could control the server's own power switch).

## Consequences

- Putting something on the frame, renaming it or moving it between rooms is done in Home Assistant's UI; the frame follows on the next state push.
- Room order is the one thing kept in `settings.json` (`rooms`), since HA areas have no order; unlisted rooms go last, alphabetically.
- Tagging both a light group and its members shows both; the convention is to tag the group only when it acts as one fixture.
