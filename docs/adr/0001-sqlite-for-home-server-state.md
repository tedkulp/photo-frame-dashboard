# SQLite (node:sqlite) for home-server state

The home server stays zero-dependency, but it now keeps state it writes itself (chores and the record of what was done each day), so we store it in one SQLite file in a writable `data/` directory using Node's built-in `node:sqlite`, not a JSON file. The record of done chores grows forever and gets queried by day and by person, a frame and a phone can write at the same moment, and other screens (shopping next) will want the same store; a JSON file would mean rewriting the whole file on every check-off, losing one of two simultaneous writes, and hand-rolling queries.

## Consequences

- Node 22.13 or newer is required (`engines` goes up from `>=20.19`); Node 24 may print an experimental warning at startup.
- `config/` stays read-only; `data/` is a separate writable volume and is private (gitignored, never committed).
