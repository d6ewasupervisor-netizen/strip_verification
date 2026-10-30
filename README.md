# Strip Verification Gallery

Public photo review board for **District 8 · P08W2** strip verification sets.

- Tabular store / set / Strip / Overall A–D view
- Thumbnail → full-size lightbox with keyboard / arrow / swipe navigation
- Per-store zip + bulk zip downloads
- PIN gate + usage analytics (via eod-api)

## Live site

GitHub Pages: `https://d6ewasupervisor-netizen.github.io/strip_verification/`

FM019 Auburn (P10W2, store 19 only): `https://d6ewasupervisor-netizen.github.io/strip_verification/fm019/`

Rebuild that page with `node scripts/build-fm019.js`. Its PIN is hashed in `fm019/app.js` and is separate from the district gallery.

## Rebuild assets

```bat
node scripts/build-gallery.js
```

Requires the three store zip exports under `Downloads/` and `sharp` / `archiver` from `eod-api/node_modules`.

## PIN

Access PIN is configured in `app.js` (hashed). Do not commit the plaintext PIN in docs that are broader than this team.

## Analytics

Client events POST to `https://eod-api.the-dump-bin.com/api/strip-gallery/event`.
A Pacific-evening digest emails the day’s activity.
