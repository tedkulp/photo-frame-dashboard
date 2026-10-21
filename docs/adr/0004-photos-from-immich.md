# Photos come from one Immich album

The frame's photos come from one album on the family's Immich server, read by the home server with an Immich API key and streamed to the frame through `/api/photos`. Google Photos was the obvious source and we rejected it: since 31 March 2025 the Library API only sees photos the app itself uploaded, so it can't read an existing library, and the Picker API that replaced it needs someone to pick every photo by hand in Google's UI, so a frame can't follow an album as people add to it. Immich runs at home already, its API reads any album the key's user can see, and adding a photo to the album is the whole workflow. We also rejected a local folder (a second place to copy photos to) and more than one source or album (one album is the curation, like the `frame` label in ADR 0003).

## Consequences

- Who a photo is from is its Immich uploader, matched by email to `people[].immich`; an uploader with no match gets no credit. Shared albums are how the family adds their own photos.
- Which photos pair up on screen is "taken the same day", since an album has no finer grouping.
- The home server never stores photos: it lists the album (cached 5 minutes) and streams Immich's preview images, only for ids in that listing, so the API key never reaches the frame.
- The frame's Favourite button stays local; writing back to Immich would need a key with write access.
