# Editing the itinerary

`itinerary.json` is the authoritative trip content. Read it directly when planning or changing the trip. No HTML knowledge is needed. The generated HTML is for viewing and sharing.

## Structure

- `trip` holds dates, titles, introduction, booking notice, clock facts, hero photo, and footer credits. `mapHeading` is the initial map overview title.
- `days` is an ordered list. Each day holds its date, headings, clock guidance, optional photo, ordered `activities`, and `notes`.
- Each activity has a stable `id`, a readable `location`, `time`, `duration`, `description`, `categories`, and `links`. Optional fields are `descriptionLead` for an emphasized opening phrase, `solarNote`, `photo`, and `placeIds` for associated shared places. Categories are `meal`, `hike`, and `drive`; the renderer supplies icons.
- `places` maps stable IDs to names, latitude, longitude, and `mapsUrl`. Activity map links and map stops share these records.
- `mapStops` is the ordered route displayed on the map. Each stop references a `placeId` and `dayIds`, has a unique positive `number`, and specifies a `defaultDayId`. `dayLabel`, `time`, and `summary` are editorial map descriptions, which can describe a whole visit or multiple activities. Review them when changing the schedule; they are not automatically calculated from activities.
- `checklist` holds stable IDs, text, and default `checked` values. Existing saved browser selections override defaults.

Keep IDs unchanged when moving or editing an existing activity. The numeric portion of migrated activity IDs records the original position; do not renumber IDs when reordering. New IDs can use descriptive lowercase words separated by hyphens. Day IDs also serve as page anchors. Checklist IDs form existing browser storage keys.

## Text, timing, links, and photos

All text is plain text, without HTML. Timing is deliberately stored as readable labels, including UTC offsets, approximate times, and `Optional`. Duration is explicit because clocks can change across the route. Changing a time does not automatically recalculate duration, date headings, solar notes, or map summaries.

A link contains `label`, `kind` (`map`, `trail`, or `reference`), and exactly one of:

- `placeId`, to use a shared place's map URL.
- `url`, for a separate HTTP or HTTPS destination.

Notes contain `title`, `text`, and `links`. Photos contain `url`, `alt`, and `caption`; the hero needs `url` and `alt`. Source URLs generate the photo credits, while explicit attribution text remains in the trip footer. The build embeds image bytes; never paste image data into this JSON.

## Validate and rebuild

From the project root:

```sh
python3 scripts/render_itinerary.py
python3 -m unittest discover -s tests -v
python3 scripts/build_offline.py
```

Validation and tests use only the Python standard library. The offline builder additionally requires Pillow, pyshp, and shapely. It reuses `.offline-cache` and downloads missing assets. Share only the generated `vegas-road-trip-2026.html`.

For layout changes, edit `web/template.html` and `web/itinerary.css`. Browser behavior lives in `web/itinerary.js`. The renderer escapes text and provides explicit template slots; the offline builder packages assets. The native app is still separate.

## Machine-readable schedule

Every scheduled activity also has `startAt` and `endAt` values such as `2026-09-25T10:15:00-07:00`. Both must be complete ISO timestamps with explicit numeric UTC offsets and dates matching their day. The end must be later than the start as an absolute instant. The activity whose interval contains the device clock is highlighted; the end instant belongs to the next activity if one starts then.

Keep these timestamps consistent with the readable `time` and `duration` fields when editing. Cross-zone journeys can have different start and end offsets. Preserve the intentional UTC−7 convention at Lone Rock. The optional flexible activity has neither timestamp and is never selected automatically.
