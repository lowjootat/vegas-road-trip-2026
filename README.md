# Vegas Road Trip 2026

An offline itinerary for September 25–29, 2026, with photos, a regional map, a checklist, and a clock-based current-activity indicator.

Website: https://lowjootat.github.io/vegas-road-trip-2026/

## Install on iPhone

1. Open the website in Safari while connected to the internet.
2. Tap Share → Add to Home Screen. Enable Open as Web App if offered.
3. Open the new Vegas Trip icon and wait for **Ready offline**.
4. Turn on airplane mode, close the app, and reopen it to verify your saved copy.

The itinerary, photos, overview map, and current-time indicator work offline. Google Maps, AllTrails, and other external links need internet. The map covers the region at zoom levels 6–11; it does not provide driving or trail navigation.

The app highlights the activity scheduled for the current time. **Jump to now** takes you there; between activities, **Jump to next** shows what follows. Times follow the itinerary’s explicit UTC offsets, including Arizona time at Lone Rock. This uses your device clock, not GPS or your actual travel progress.

A completed download displays **Ready offline**. If saving fails, reconnect and tap **Retry**. New versions download in the background; tap **Update & reload** when offered. A failed update keeps the existing saved version. Clearing website storage, or storage eviction by the phone, removes the offline copy. Open online again to restore it. Checklist selections stay in browser storage when available; they do not sync between browsers or devices.

## Standalone HTML

Open `vegas-road-trip-2026.html` directly in a desktop browser. It includes its photos, map, scripts, and styles and requires no server or companion folder. The website also offers this file as a download. Checklist selections may not follow a moved file.

## Edit and build

Edit trip content in `data/itinerary.json`; see `data/README.md`. Preserve IDs and explicit timezone guidance. Presentation lives in `web/`; rendering and packaging live in `scripts/`. The generated HTML must never be edited directly.

Use Python 3.12 and Node.js 22. Set up Python dependencies:

```sh
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
```

Validate, test, and build both outputs:

```sh
python3 scripts/render_itinerary.py
python3 -m unittest discover -s tests -v
node --test tests/*.cjs
python3 scripts/build_offline.py --site-dir dist
```

Without `--site-dir`, the builder only produces the portable HTML. The committed `web/offline-assets.json` contains the verified photos, Leaflet, and regional geography. Existing content builds without downloading assets. When adding a new photo, build locally and commit the updated bundle with the source changes. New source downloads go into `.offline-cache`. `--refresh-assets` regenerates the bundle from those source assets. CI uses `--bundled-only` and fails with a clear error if an asset is missing. Leaflet’s license and photo credits are embedded. Natural Earth geography is public domain.

For local website testing, serve `dist` on localhost rather than opening its `index.html` as a file:

```sh
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000/. Service workers require HTTPS outside localhost. The website uses relative URLs so it can run under the GitHub repository path.

## Publishing

The public repository contains the web source, data, tests, build scripts, and generated standalone HTML. The native app, reports, environment, caches, and build directory remain local.

The `Publish itinerary` GitHub Actions workflow runs validation and tests, builds `dist`, and deploys only that directory to GitHub Pages after changes to `main`. It can also run manually from Actions. Repository Settings → Pages must use **GitHub Actions** as its source.

Rebuild the standalone HTML when editing and include it with the source changes. The workflow rebuilds the published website from source. Changes to page content, app assets, or the worker generate a new offline cache version. Asset hashes prevent incomplete deployments from replacing a working offline copy.

Use the personal GitHub account `lowjootat` for publication. This is a public website and repository.

## Device acceptance

Automated tests cover timing boundaries, timezone changes, optional activities, and cache installation/update failure behavior. Browser checks also exercise the generated website. Actual iPhone Safari Home Screen installation and airplane-mode reopening must be checked on the device before relying on it during the trip.
