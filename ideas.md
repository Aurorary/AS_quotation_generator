# Ideas to revisit

## Frontend rewrite — CDN-only React + Tailwind

A buildless stack for a future rewrite of the web app frontend (currently
a single hand-rolled HTML/CSS/JS file in `08 WebApp.html`). Avoids npm,
Vite, webpack, etc. — all dependencies load from CDNs at runtime.

- **React 18** — via UMD CDN (`unpkg.com/react@18`)
- **ReactDOM 18** — same source
- **Babel Standalone** — in-browser JSX transpilation (no build step)
- **Tailwind CSS** — Play CDN (`cdn.tailwindcss.com`) with runtime config for `darkMode: 'class'`
- **No bundler** — no npm, no Vite, no webpack. All deps loaded from CDN at runtime.
- **Native HTML5 drag-and-drop API** — for card reordering between columns
- **`google.script.run`** — Apps Script's built-in RPC bridge wrapped in a promise helper (`gas()`)

### Why park it
Worth doing once the feature surface stabilises (post Phase D). Current
HTML version works; rewriting now would block feature work without
shipping anything new to the user.

### When to pull it back out
- Web app gains enough state that the imperative DOM updates start
  causing real bugs (e.g. drag/drop kanban for quote pipeline)
- Multiple views need to share the same components (e.g. quote-row
  rendering used on landing page AND in revise picker AND in approval inbox)
- Mobile responsiveness becomes a real requirement
