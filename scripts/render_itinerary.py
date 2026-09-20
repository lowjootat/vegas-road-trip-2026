"""Validate trip data and render presentation HTML without downloading assets."""

import argparse
import html
import json
import math
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data/itinerary.json"
CATEGORIES = {"meal": ("🍕", "Meal"), "hike": ("🥾", "Hike"), "drive": ("🚗", "Drive")}


def inline_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace(
        "<", "\\u003c"
    )


def validate(data):
    def require(obj, fields, context):
        for field in fields:
            if field not in obj:
                raise ValueError(f"{context}: missing {field}")

    def unique(values, context):
        if len(values) != len(set(values)):
            raise ValueError(f"{context}: duplicate ID")
        if any(not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", v) for v in values):
            raise ValueError(
                f"{context}: IDs must be lowercase words or numbers separated by hyphens"
            )

    require(
        data,
        ["version", "trip", "days", "places", "mapStops", "checklist"],
        "itinerary",
    )
    if data["version"] != 1:
        raise ValueError("Unsupported itinerary version")
    require(
        data["trip"],
        [
            "title",
            "description",
            "heading",
            "eyebrow",
            "introduction",
            "startDate",
            "endDate",
            "hero",
            "bookingNotice",
            "facts",
            "footer",
        ],
        "trip",
    )
    if not data["days"]:
        raise ValueError("At least one day is required")
    day_ids = [d["id"] for d in data["days"]]
    unique(day_ids, "days")
    unique(list(data["places"]), "places")
    activity_ids = []
    for day in data["days"]:
        require(
            day,
            [
                "date",
                "title",
                "navigationLabel",
                "route",
                "clockGuidance",
                "activities",
                "notes",
            ],
            day["id"],
        )
        for activity in day["activities"]:
            require(
                activity,
                [
                    "id",
                    "location",
                    "time",
                    "duration",
                    "description",
                    "categories",
                    "links",
                ],
                day["id"],
            )
            activity_ids.append(activity["id"])
            timestamps = [activity.get("startAt"), activity.get("endAt")]
            if activity["time"] == "Optional":
                if any(value is not None for value in timestamps):
                    raise ValueError(f'{activity["id"]}: optional activity must be unscheduled')
            else:
                parsed = []
                for value in timestamps:
                    if not isinstance(value, str) or not re.fullmatch(
                        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}", value
                    ):
                        raise ValueError(f'{activity["id"]}: startAt and endAt require explicit UTC offsets')
                    parsed.append(datetime.fromisoformat(value))
                if parsed[1] <= parsed[0]:
                    raise ValueError(f'{activity["id"]}: scheduled duration must be positive')
                if any(value[:10] != day["date"] for value in timestamps):
                    raise ValueError(f'{activity["id"]}: scheduled date must match its day')
            if any(c not in CATEGORIES for c in activity["categories"]):
                raise ValueError(f'{activity["id"]}: unknown activity category')
            if any(p not in data["places"] for p in activity.get("placeIds", [])):
                raise ValueError(f'{activity["id"]}: unknown place reference')
    unique(activity_ids, "activities")
    unique(day_ids + activity_ids, "page anchors")
    for pid, place in data["places"].items():
        require(place, ["name", "latitude", "longitude", "mapsUrl"], pid)
        if not -90 <= place["latitude"] <= 90 or not -180 <= place["longitude"] <= 180:
            raise ValueError(f"{pid}: invalid coordinates")
    unique([s["id"] for s in data["mapStops"]], "map stops")
    numbers = []
    for stop in data["mapStops"]:
        require(
            stop,
            [
                "number",
                "placeId",
                "dayIds",
                "dayLabel",
                "time",
                "summary",
                "defaultDayId",
            ],
            stop["id"],
        )
        if type(stop["number"]) is not int or stop["number"] < 1:
            raise ValueError(f'{stop["id"]}: map number must be a positive integer')
        numbers.append(stop["number"])
        if (
            stop["placeId"] not in data["places"]
            or not stop["dayIds"]
            or any(d not in day_ids for d in stop["dayIds"])
            or stop["defaultDayId"] not in stop["dayIds"]
        ):
            raise ValueError(f'{stop["id"]}: invalid map reference')
    if len(numbers) != len(set(numbers)):
        raise ValueError("Map stop numbers must be unique")
    unique([c["id"] for c in data["checklist"]], "checklist")
    for item in data["checklist"]:
        require(item, ["text", "checked"], item["id"])
        if not isinstance(item["checked"], bool):
            raise ValueError(f'{item["id"]}: checked must be a boolean')

    def check_content(value, path="itinerary"):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in ("url", "mapsUrl") and (
                    not isinstance(child, str)
                    or urlparse(child).scheme not in ("http", "https")
                    or not urlparse(child).netloc
                ):
                    raise ValueError(f"{path}.{key}: expected an HTTP(S) URL")
                check_content(child, f"{path}.{key}")
            if "photo" in value:
                require(value["photo"], ["url", "alt", "caption"], path + ".photo")
            if "label" in value:
                require(value, ["kind"], path)
                if value["kind"] not in ("map", "trail", "reference"):
                    raise ValueError(f"{path}: unknown link kind")
                if ("url" in value) == ("placeId" in value):
                    raise ValueError(
                        f"{path}: link needs exactly one of url or placeId"
                    )
                if "placeId" in value and value["placeId"] not in data["places"]:
                    raise ValueError(f"{path}: unknown link place reference")
        elif isinstance(value, list):
            for i, child in enumerate(value):
                check_content(child, f"{path}[{i}]")

    check_content(data)


def load_data(path=DATA):
    data = json.loads(Path(path).read_text())
    validate(data)
    return data


def escape(value):
    return html.escape(str(value), quote=True)


def links(items, places=None, inline=False):
    classes = {"map": " map", "trail": " at", "reference": ""}
    result = []
    for item in items:
        url = places[item["placeId"]]["mapsUrl"] if "placeId" in item else item["url"]
        style = "" if inline else f' class="link{classes[item["kind"]]}"'
        result.append(
            f'<a{style} target="_blank" rel="noopener" href="{escape(url)}">{escape(item["label"])}</a>'
        )
    return "".join(result)


def note(value, places):
    return f'<b>{escape(value["title"])}</b>{escape(value["text"])}' + (
        " " + links(value["links"], places, inline=True) if value.get("links") else ""
    )


def time_text(value):
    return re.sub(
        r"UTC−\d",
        lambda m: '<span class="time-zone">' + m[0] + "</span>",
        escape(value),
    )


def duration_bars(value):
    match = re.fullmatch(r"\s*(?:(\d+(?:\.\d+)?)\s*hr)?\s*(?:(\d+)\s*min)?\s*", value)
    if not match:
        return ""
    hours = float(match[1] or 0) + int(match[2] or 0) / 60
    if hours <= 0:
        return ""
    bars = "".join(
        f'<span class="duration-bar"><span class="duration-fill" style="width:{min(1, hours - i) * 100:.4g}%"></span></span>'
        for i in range(math.ceil(hours))
    )
    return f'<span class="duration-bars" aria-hidden="true" title="1 bar = 1 hour">{bars}</span>'


def timing(activity):
    value = activity["time"]
    if "–" in value:
        start, end = value.split("–", 1)
        main = (
            time_text(start)
            + '<span class="time-arrow" aria-label="to">→</span>'
            + time_text(end)
        )
    else:
        main = time_text(value)
    result = f'<div class="time-main">{main}</div><div class="duration">{escape(activity["duration"])}{duration_bars(activity["duration"])}</div>'
    if activity.get("solarNote"):
        result += '<div class="solar">' + time_text(activity["solarNote"]) + "</div>"
    return result


def map_data(data):
    return [
        dict(
            n=s["number"],
            days=s["dayIds"],
            day=s["dayLabel"],
            time=s["time"],
            name=data["places"][s["placeId"]]["name"],
            summary=s["summary"],
            lat=data["places"][s["placeId"]]["latitude"],
            lng=data["places"][s["placeId"]]["longitude"],
            section=s["defaultDayId"],
            maps=data["places"][s["placeId"]]["mapsUrl"],
        )
        for s in data["mapStops"]
    ]


def render(data, photo_id, assets):
    validate(data)

    def photo(value, kind):
        return f'<div class="{kind}"><img loading="lazy" data-photo="{escape(photo_id(value))}" alt="{escape(value["alt"])}"><span class="cap">{escape(value["caption"])}</span></div>'

    days = []
    for day in data["days"]:
        content = f'<section class="section" id="{day["id"]}"><div class="dayhead"><div><h2>{escape(day["title"])}</h2><p>{escape(day["route"])}</p></div><div class="clock">{escape(day["clockGuidance"])}</div></div>'
        if day.get("photo"):
            content += photo(day["photo"], "photo")
        content += '<div class="timeline">'
        for a in day["activities"]:
            description = escape(a["description"])
            if a.get("descriptionLead"):
                description = (
                    "<strong>"
                    + escape(a["descriptionLead"])
                    + "</strong>"
                    + description
                )
            icons = "".join(
                f'<span class="activity-icon" title="{CATEGORIES[c][1]}" role="img" aria-label="{CATEGORIES[c][1]}">{CATEGORIES[c][0]}</span>'
                for c in a["categories"]
            )
            content += f'<article class="item" id="{a["id"]}"><div class="time">{timing(a)}</div><div class="card"><div class="area">{icons}{escape(a["location"])}</div><div class="desc">{description}</div>'
            if a.get("photo"):
                content += photo(a["photo"], "thumb")
            if a["links"]:
                content += (
                    '<div class="links">' + links(a["links"], data["places"]) + "</div>"
                )
            content += "</div></article>"
        content += (
            "</div>"
            + "".join(
                '<div class="note">' + note(n, data["places"]) + "</div>"
                for n in day["notes"]
            )
            + "</section>"
        )
        days.append(content)
    trip = data["trip"]
    values = {
        key: escape(trip[key])
        for key in [
            "title",
            "description",
            "heading",
            "eyebrow",
            "introduction",
            "footer",
        ]
    }
    values.update(assets)
    values.update(
        security_policy=assets.get("security_policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"),
        schedule_data=inline_json([
            {key: activity[key] for key in ("id", "location", "startAt", "endAt")}
            for day in data["days"] for activity in day["activities"]
            if "startAt" in activity
        ]),
        clock_script=assets.get("clock_script", ""),
        hero_id=photo_id(trip["hero"]),
        facts="".join(
            f'<div class="fact"><b>{escape(f["title"])}</b><span>{escape(f["text"])}</span></div>'
            for f in trip["facts"]
        ),
        days="\n".join(days),
        map_data=inline_json(map_data(data)),
    )
    values["filters"] = (
        '<button class="map-filter active" data-map-day="all">All days</button>'
        + "".join(
            f'<button class="map-filter" data-map-day="{d["id"]}">{escape(d["title"].split()[0][:3])}</button>'
            for d in data["days"]
        )
    )
    values["navigation"] = "".join(
        f'<button class="daybtn{" active" if i == 0 else ""}" data-target="{d["id"]}">{escape(d["navigationLabel"])}</button>'
        for i, d in enumerate(data["days"])
    )
    values["checklist"] = "".join(
        f'<label><input type="checkbox" data-check="{c["id"]}"{" checked" if c["checked"] else ""}>{escape(c["text"])}</label>'
        for c in data["checklist"]
    )
    template = (ROOT / "web/template.html").read_text()
    return re.sub(r"\{\{([a-z_]+)\}\}", lambda m: values[m[1]], template)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DATA)
    args = parser.parse_args()
    data = load_data(args.data)
    print(
        f'Valid itinerary: {len(data["days"])} days, {sum(len(d["activities"]) for d in data["days"])} activities, {len(data["mapStops"])} map stops'
    )
