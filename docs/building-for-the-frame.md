# Building a web dashboard for the PF1007L frame

Hand this to an agent that builds the site the frame displays. It lists what the frame can
run, what breaks, and how to test. Facts come from the owner's unit (firmware 20260529) and
from [pf1007l-start-here.md](pf1007l-start-here.md). Items marked **(observed)** were seen on a
real frame. Items marked **(expected)** follow from the Chrome 106 feature set and have not been
tested on the frame.

## The target, in one table

| Item | Value |
| --- | --- |
| Browser engine | Android System WebView **106.0.5249.126** (Chrome 106, from 2022), inside the `dashboard/kiosk` app |
| OS | Android 6.0.1, no security updates, root ADB |
| Screen | **1280 × 800** landscape, `devicePixelRatio` **1** (160 dpi), touchscreen. The 15.6" FRAME156 is **1920 × 1080**, DPR 1, same WebView 106 ([pastigio-frame156.md](pastigio-frame156.md)); see [Screen sizes](#screen-sizes) |
| CPU / GPU | Allwinner A33 ARMv7, 1.34 GHz, 2 cores online in our snapshot; OpenGL ES 2.0 |
| RAM | ~1 GB total. The kiosk with the sample dashboard used ~80 MB (observed) |
| Network | Wi-Fi only. Wi-Fi comes up **after** the kiosk starts at boot (observed) |
| Time zone | `America/New_York`, network time on |
| Navigation | No address bar, no back button, no status bar. The kiosk can be the Home screen (see the [kiosk README](../dashboard/kiosk/README.md#start-at-boot)) |

## Screen sizes

Frames come in 16:10 (1280 × 800) and 16:9 (1920 × 1080, the FRAME156). A page built for a
fixed 1280 × 800 and scaled to fit shows 96 px black bars on each side of a 1920 × 1080 screen
(observed on the FRAME156).

The sample dashboard avoids that with a stage whose height is always 800 logical pixels and
whose width follows the window's aspect ratio: 1280 at 16:10, 1422 at 16:9. `dashboard/js/stage.js`
works out the size and `fit()` in `dashboard/js/app.js` scales the stage uniformly to fill the
window, again on every resize. Views lay out in grids and flex rows, so the extra width goes to
wider cards and, on Home controls, a fifth column of tiles; fonts and spacing stay the same. The
width is kept between 1280 (narrower windows letterbox, except a phone, see [Phones](#phones)) and 1600. The viewport meta
is `width=device-width`, so the page sees the screen's real size. Anything converting screen
coordinates to stage coordinates must use the stage's current width (`App.stage.width`), not 1280.

This was checked in headless Chromium 149 on Linux at 1920 × 1080 and 1280 × 800 (every view, and resizing
between the two without a reload), not yet on a FRAME156 itself.

### Phones

The sample dashboard also works on a phone held upright. A window narrower than 700 CSS px and
taller than it is wide gets the **phone layout** (`Stage.layout` in `stage.js`): the stage is not
scaled but laid out at the phone's own CSS pixels, with `data-layout="phone"` on it for CSS. The
rail becomes a bottom tab bar (Photos left out), the clock moves to a slim top bar, each view
stacks into one column that scrolls, and Calendar's Today shows one list instead of a lane per
person (3 Day is left out). Sheets fit the phone's width and scroll. Every phone rule sits at the
end of `css/base.css` or the view's own file in `css/views/`, so the frame layouts don't change.
A phone never goes back to Today on its own, nor into ambient or night mode. A phone turned
sideways, and a portrait tablet 700 px or wider, keep the scaled stage.

Open the dashboard's LAN address in the phone's browser (the home server, or `npm run dev`, which
listens on the LAN). It was checked in headless Chromium 147 on Linux at 390 × 844 (DPR 3) and
360 × 640 against the home server and its test fakes: no sideways scrolling in any view, adding and
undoing an event, adding, ticking and editing a chore, and Home controls taps and "All off".
1280 × 800 and 1920 × 1080 rendered the same as before.

## How the kiosk loads your site

- The kiosk opens one URL full screen. Save your dashboard's URL once with `--es url`:

  ```sh
  adb -d shell am start -n com.wesbos.homehq/.MainActivity --es url http://<server-ip>:<port>/
  ```

  That URL is used at every launch. For a quick test without changing the saved URL, open it with
  a VIEW intent instead (`-a android.intent.action.VIEW -d "<url>"`); it is shown but not saved.
- If the **page itself** fails to load, the kiosk retries it every 5 s. It does **not** retry
  your `fetch()` calls, images or scripts. The page must recover from those itself.
- JavaScript, `localStorage`/`sessionStorage`, IndexedDB and cookies are on. Media can autoplay.
- The kiosk exposes **no Android bridge** to the page (no `addJavascriptInterface`). The page
  cannot read files, sensors or the camera. Keep it that way.
- **Two fingers held still for 1.5 s open the kiosk's controls menu** (open launcher,
  Android settings, reload). Do not design a two-finger hold gesture. Pinch and two-finger
  swipes that move are fine. The fingers must be a few centimetres apart: the touchscreen
  (`gslX680`) reads two fingers close together as one touch (observed).
- **A horizontal swipe over something that scrolls needs `touch-action: pan-y`.** Without it the
  browser takes the gesture over to pan, the page gets `pointercancel` after a few pixels and never
  sees the swipe. With it, vertical scrolling still works. Chrome then drops a tap made within
  about 300 ms of a fast flick (seen in Chrome with touch emulation, not yet on a frame). The
  dashboard's `App.swipe` (Calendar and Chores) sets this for you.

## Safe to use

**HTML/CSS (observed working in the sample dashboard, or Chrome ≤ 106):**
- Flexbox, CSS Grid, `gap`, `aspect-ratio`, custom properties (`var()`), `clamp()/min()/max()`,
  `:is()`/`:where()`, `@media`, `@font-face`, `@supports`, CSS transitions and simple keyframe
  animations of `transform`/`opacity` that run once and stop. On one PF1007L the kiosk was idle
  again after a one-second animation had finished (1 tick in the next 4.4 s). A loop that never
  ends is in **Heavy content**.
- Colours in `#rgb`, `#rrggbb`, `rgb()/rgba()`, `hsl()`.
- Self-hosted fonts (`woff2`) and SVG icons.

**JavaScript (Chrome 106 = ES2022):**
- ES modules, `async/await`, top-level `await`, optional chaining `?.`, `??`, class fields and
  private `#methods`, `Array.prototype.at`, `Object.hasOwn`, `structuredClone`,
  `Array.prototype.findLast`.
- `fetch`, `WebSocket`, `EventSource` (server-sent events), `Intl.DateTimeFormat`,
  `IntersectionObserver`, `ResizeObserver`, `requestAnimationFrame`.

**Frameworks and build:** plain HTML/JS, Preact, Svelte, Lit, Alpine, Vue 3, or React with a
small bundle. Use a bundler and set its JS target to **`chrome106`**. Vite example (the repo's
[`dashboard/vite.config.js`](../dashboard/vite.config.js)):

```js
build: { target: 'chrome106', cssTarget: 'chrome61' }
```

`cssTarget: 'chrome61'` stops the minifier from producing 4- and 8-digit hex colours. The frame
rejected those (observed), even though Chrome 106 should support them.

The same applies to a minifier you do not configure yourself, for example Tailwind v4 through
Next.js: set `"browserslist": ["chrome >= 61"]` in `package.json`. This was seen on **one** DP101
(Android 10, WebView 113), where it removed all 91 hex colours with alpha from a built stylesheet.
That unit also gave `filter: none` for `var(--tw-blur,)`, a variable with an empty fallback that
Tailwind registers with `@property`, so `blur-*` did nothing there; a literal `filter: blur(12px)`
worked. Gradients using `color-mix()` did render there, so the `oklch()`/`color-mix()` row below
doesn't hold on that WebView. Whether `blur-*` works after the `browserslist` change was not tested. Other WebView 113
devices were not tested either. Test results:
[veswwe-dp101.md](veswwe-dp101.md#css-compatibility-issues-in-this-webview).

## Avoid

**CSS that does not work:**

This table is about WebView 106 (the PF1007L). For the one WebView 113 unit tested, see above.

| Feature | Status |
| --- | --- |
| `oklch()`, `oklab()`, `color-mix()` | Not in Chrome 106 (observed: Tailwind v4 colours break) |
| **Tailwind CSS v4** | Uses the above for its palette. Use **Tailwind v3**, or plain CSS |
| CSS nesting (`.a { .b {} }` without a preprocessor) | Not supported (observed). Sass/PostCSS nesting compiled away is fine |
| `:has()` | Did not work on these units (observed), although Chrome 105+ supports it. Test before relying on it |
| 4- and 8-digit hex (`#0008`, `#ffffffbf`) | Rejected (observed), although Chrome 62+ supports them. Use `rgba()` to be safe. Also rejected on one DP101 with WebView 113, see [veswwe-dp101.md](veswwe-dp101.md#css-compatibility-issues-in-this-webview) |
| `dvh`/`svh`/`lvh` units | Chrome 108+. Use `vh` or `100%`, since the frame has no browser bars |
| Subgrid, `@starting-style`, `text-wrap: balance`, View Transitions, scroll-driven animations, anchor positioning, Popover API | Chrome 111+ |
| Container queries (`@container`) | Chrome 105, so (expected) to work, but untested. Test before you depend on them |

**JavaScript that does not work:** `Array.prototype.toSorted/toReversed/with` (110),
`Object.groupBy` (117), `Promise.withResolvers` (119), new `Set` methods (122),
`Array.fromAsync` (121), and anything newer. A bundler targeting `chrome106` rewrites syntax but
does **not** add these functions; avoid them, or add a polyfill.

**Browser features the kiosk does not provide:**
- `alert()`, `confirm()`, `prompt()`: the kiosk has no handler, so they do nothing. Build
  dialogs in HTML.
- Fullscreen API, Notifications, Web Push, geolocation, camera/microphone, file upload,
  downloads, Web Bluetooth/USB/NFC.
- Pop-ups and `target="_blank"`: they open in the same view, with no way back. Avoid
  links to external sites.
- Sign-in flows that need pop-ups or third-party cookies (for example "Sign in with Google").
  Do the sign-in on your server, and send the frame only the finished data.

**Heavy content:**
- Large images: resize to display size, at most 1280 px wide (DPR is 1, so no 2× images).
  Prefer JPEG/WebP. Avoid AVIF.
- Video, WebGL scenes, big canvas animations, `backdrop-filter`/large blurs, long box-shadow
  animations, and dozens of simultaneous animations. The GPU is OpenGL ES 2.0 and the CPU is slow.
- An animation that never ends. Serve a static SVG.
  - On a Frameo 114K, one SMIL icon held the kiosk at about 1.8 of 4 cores, and the same
    page with that icon static sat at about 0.05. The renderer thread and the GPU thread
    split that cost. Seven animated icons cost the same as one
    ([#143](https://github.com/wesbos/photo-frame-dashboard/issues/143)).
  - On one PF1007L (firmware `20260410`, WebView 106, the `com.wesbos.homehq` kiosk, an
    otherwise empty page) the same kind of sample read about 2.1 cores for one SMIL icon
    and about 1.1 cores for one infinite CSS animation of `transform` and `opacity`.
    The static page and a CSS animation that had already finished both sat at about 0.
    SMIL time was spread across the renderer, the GPU thread, and the compositor. The CSS
    loop stayed off the renderer and still kept the compositor busy. All 4 CPUs were online
    during either loop. This unit had been down to CPU 0 while idle. Animated GIFs were
    not measured. A clock text change once a minute, or an image swapped every few seconds,
    is a separate cost.
- Very large frameworks or bundles. Aim for a JS bundle in the low hundreds of KB.
- Re-rendering the whole page every second. Update only what changes (the clock text, for
  example).

## Network and HTTPS

- **Prefer plain `http://` on the local network.** The kiosk allows cleartext traffic.
- Address the server by **IP address** (with a DHCP reservation on the router) or by a name your
  router's DNS serves. Do **not** use `.local` (mDNS) names: Android 6 does not resolve them.
- **HTTPS works only with certificates the frame trusts.** Android 6 has no **ISRG Root X1**,
  so **Let's Encrypt certificates fail** (observed: `net_error -202`, images from
  `fastly.picsum.photos` did not load). Self-signed certificates also fail. Google Trust
  Services certificates that chain to GlobalSign Root CA load (observed: `*.workers.dev`).
  Do not bypass certificate checks. If HTTPS is required, the owner adds the root
  certificate to the frame.
- Do not load scripts, fonts or images from third-party CDNs. Serve everything from your own
  server. This avoids the certificate problem, and the frame needs no internet access beyond
  your server.
- **Keep API keys and tokens on the server.** Anyone on the local network can read the page
  source. The server fetches calendars, weather and so on, then gives the frame plain JSON or
  HTML.

## Make it survive on its own

The frame runs for weeks unattended, with no keyboard and no way to press reload.

- **Boot:** Wi-Fi is not up when the page first loads, and the clock can be wrong for the first
  minute. Retry every data request with backoff. Do not show a permanent error after one
  failure.
- **Server restarts:** keep showing the last good data, and mark it stale ("updated 12 min
  ago"). Reconnect WebSockets/EventSource automatically.
- **Memory:** reload the whole page once a day (for example at 3 a.m.) with
  `location.reload()`, to clear slow leaks. Remove old DOM nodes and timers.
- **Time:** show the time from the frame's clock, but treat server timestamps as the source of
  truth for "updated at" and schedules.
- **Updates:** the frame cannot clear its cache. Use hashed file names for JS/CSS (Vite
  does this) and serve `index.html` with `Cache-Control: no-cache`, so a new deploy appears at
  the next reload.
- **Screen burn-in and night:** consider a dim or dark mode at night, and small position shifts
  for elements that never move.

## How to test

1. **On a computer first:** Chrome DevTools, device size 1280 × 800 (and 1920 × 1080 for a
   16:9 frame), DPR 1. Throttle the CPU
   (6× slowdown) to get closer to the frame.
2. **Feature check:** run your CSS through a Browserslist/`caniuse` check for `Chrome 106`,
   or a linter such as `eslint-plugin-compat` and `stylelint-no-unsupported-browser-features`
   with `browserslist: "Chrome 106"`.
3. **On the frame, over USB** (no network changes needed):

   ```sh
   adb -d reverse tcp:5173 tcp:5173
   adb -d shell 'am start -a android.intent.action.VIEW -d "http://127.0.0.1:5173/" -n com.wesbos.homehq/.MainActivity --ez debug true'
   ```

   Then open `chrome://inspect` in desktop Chrome to see the page's console and DOM.
   `--ez debug true` turns remote debugging on only for that launch. A normal launch turns it
   off again.
4. **Logs:** `adb -d logcat -d | grep -iE "chromium|HomeHQ"` shows console errors and failed
   loads.
5. **Memory:** `adb -d shell dumpsys meminfo com.wesbos.homehq`. Compare it with ~80 MB for the
   sample dashboard.
6. **When done**, launch the kiosk once more **without** `--ez debug true`, then power-cycle the
   frame to confirm that it comes back on its own. Unplug it rather than `adb reboot`, which hangs
   on many PF1007L units.

### Keyboard shortcuts

The sample dashboard has a few keys for testing on a computer (`dashboard/js/system.js`,
`dashboard/js/testcontrols.js`). They do nothing while you type in a text box.

| Key | Does |
| --- | --- |
| `A` | Ambient screen: closes any sheet and goes to Today first, like the idle switch. Holds until the next 10 pm or 6 am. |
| `N` | Night screen, the same way (tap it for the dimmed dashboard). Neither key does anything over a takeover or on a phone. |
| `1`–`9` | The rail's tabs in order: Today, Weather, Calendar, Chores, Shopping, Photos, Home controls. A tab hidden from the rail has no number. |
| `T` | Open or close **Test controls**, a hidden drawer for switching display modes (Day, Ambient, Night, Nightdash), fast idle (Today after 8 s, the idle screen after 15 s), Pretend night (behave as if it were night hours; the clock stays real) and fake weather alerts (five presets from Minor advisory to Two urgent at once, shown on top of the real alerts and never sent to the server; Clear removes them). On the frame, a 2 s hold on the rail clock opens it too. Nothing it changes is saved: a reload undoes it. A "Test" pill by the rail clock shows while fast idle, Pretend night or a fake alert is on. Not on a phone. |
| `Esc` | Close the open sheet, or Test controls |

## Do not change on the frame

The site should need no changes to the frame. An agent that builds the site should not:
- install apps, change `/system`, change WebView, or add certificates without the owner's
  approval;
- re-enable `com.efercro.os.aimor`, `com.yhk.qeota` or `com.DeviceTest` (vendor remote root
  shell, updater and factory test);
- leave remote debugging on, or add an Android bridge to the kiosk.
