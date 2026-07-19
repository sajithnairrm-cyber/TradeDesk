# Screenshots

This folder is intentionally empty.

The `screenshots` field is **not** referenced in `manifest.json`, because a
manifest that points at missing files logs console errors, and shipping
mock-ups that do not show the real app would misrepresent it in the Android
install dialog.

To add real ones (optional — install works fine without them):

1. Open the deployed desk in Chrome on Android, or in desktop Chrome with
   device emulation set to a phone.
2. Capture two images:
   - **narrow** — 1080×1920 portrait (phone)
   - **wide**   — 1920×1080 landscape (desktop/tablet)
3. Save them here as `narrow.png` and `wide.png`.
4. Add this block to `manifest.json`, after the `"icons"` array:

```json
"screenshots": [
  { "src": "./screenshots/narrow.png", "sizes": "1080x1920", "type": "image/png", "form_factor": "narrow", "label": "P&L Dashboard" },
  { "src": "./screenshots/wide.png",   "sizes": "1920x1080", "type": "image/png", "form_factor": "wide",   "label": "Pre-trade calculator" }
]
```

5. Bump `VERSION` in `service-worker.js` so the manifest is re-fetched.

Chrome then shows a richer install dialog with previews. Everything else
about installation is unchanged.
