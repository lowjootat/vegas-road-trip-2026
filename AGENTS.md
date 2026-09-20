# Itinerary editing

- Read `data/itinerary.json` for trip content and `data/README.md` for the format.
- Make itinerary changes in the JSON. Preserve existing IDs and explicit timezone guidance.
- `vegas-road-trip-2026.html` is generated; rebuild it with `python3 scripts/build_offline.py` after edits. Do not edit it directly.
- Validate with `python3 scripts/render_itinerary.py` and run `python3 -m unittest discover -s tests -v`.
- Presentation belongs in `web/`; Python rendering and offline packaging belong in `scripts/`. The native app is separate.
