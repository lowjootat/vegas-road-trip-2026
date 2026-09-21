"""Build the portable itinerary. Requires Pillow, pyshp, and shapely."""

import base64
import argparse
import hashlib
import html
import io
import json
import re
import urllib.request
import zipfile

from render_itinerary import load_data, render, inline_json
from render_markdown import render_markdown, render_agent_html, OUTPUT as MARKDOWN_OUTPUT
from pathlib import Path

import shapefile
from PIL import Image, ImageOps, ImageDraw
from shapely.geometry import box, mapping, shape

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".offline-cache"
BOUNDS = (-116.5, 34.5, -110.5, 38.0)


def fetch(url):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / hashlib.sha256(url.encode()).hexdigest()
    if not path.exists():
        request = urllib.request.Request(
            url, headers={"User-Agent": "ItineraryOfflineBuilder/1.0"}
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read()
        path.write_bytes(data)
    return path.read_bytes()


def data_url(data, mime):
    return "data:" + mime + ";base64," + base64.b64encode(data).decode()


def geography(category, name, layer):
    url = f"https://naciscdn.org/naturalearth/10m/{category}/{name}.zip"
    archive = zipfile.ZipFile(io.BytesIO(fetch(url)))
    reader = shapefile.Reader(
        **{
            ext: io.BytesIO(archive.read(f"{name}.{ext}"))
            for ext in ["shp", "shx", "dbf"]
        }
    )
    features = []
    region = box(*BOUNDS)
    for record in reader.iterShapeRecords(bbox=BOUNDS):
        if not record.shape.shapeType:
            continue
        properties = record.record.as_dict()
        if layer == "roads" and properties["type"] not in [
            "Freeway",
            "Primary",
            "Secondary",
        ]:
            continue
        geometry = shape(record.shape.__geo_interface__)
        if not geometry.intersects(region):
            continue
        geometry = geometry.intersection(region).simplify(
            0.0005, preserve_topology=True
        )
        if geometry.is_empty:
            continue
        name = properties.get("NAME") or properties.get("name") or ""
        if layer == "towns" and (
            properties.get("POP_MAX", 0) < 5000
            or name in ["North Las Vegas", "Henderson"]
        ):
            continue
        props = {"name": name}
        if layer == "roads":
            props = {
                "name": " ".join(
                    str(properties.get(k, "")) for k in ["prefix", "number"]
                ).strip(),
                "major": properties["type"] in ["Freeway", "Primary"],
            }
        features.append(
            {"type": "Feature", "properties": props, "geometry": mapping(geometry)}
        )
    print(layer, len(features), flush=True)
    if not features:
        raise ValueError(f"No {layer} data was found in the trip region")
    return {"type": "FeatureCollection", "features": features}


def build_site(result, destination, data):
    destination.mkdir(parents=True, exist_ok=True)
    hosted = result.replace(
        "img-src data:; font-src data:; connect-src 'none';",
        "img-src 'self' data:; font-src data:; connect-src 'self'; worker-src 'self'; manifest-src 'self';",
    )
    hosted = hosted.replace('</head>', '''<link rel="manifest" href="./manifest.webmanifest">
<link rel="apple-touch-icon" href="./icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Vegas Trip">
</head>''')
    hosted = hosted.replace('<main class="shell">', '''<main class="shell">
<section class="offline-panel" aria-label="Offline installation">
<div class="offline-state"><span id="offline-status" role="status">Saving for offline use…</span><button id="offline-action" type="button" hidden>Retry</button></div>
<details><summary>Install on iPhone</summary><p>In Safari, tap Share, then Add to Home Screen. Enable Open as Web App if shown. Open the new icon while online and wait for Ready offline, then test reopening in airplane mode.</p><p>Photos and the overview map work offline. External links need internet. Clearing website storage removes the saved copy.</p><a href="./vegas-road-trip-2026.html" download>Download the standalone HTML</a></details>
</section>''')
    hosted = hosted.replace('</body>', '<script>' + (ROOT / 'web/offline-app.js').read_text() + '</script></body>')
    (destination / 'index.html').write_text(hosted)
    (destination / 'vegas-road-trip-2026.html').write_text(result)
    (destination / 'itinerary-for-agents.html').write_text(render_agent_html(data), encoding='utf-8')
    manifest = {
        'id': './', 'name': 'Vegas Road Trip 2026', 'short_name': 'Vegas Trip',
        'start_url': './', 'scope': './', 'display': 'standalone',
        'background_color': '#f6f3ec', 'theme_color': '#171713',
        'icons': [{'src': f'./icon-{size}.png', 'sizes': f'{size}x{size}', 'type': 'image/png'} for size in (192, 512)],
    }
    (destination / 'manifest.webmanifest').write_text(json.dumps(manifest, indent=2) + '\n')
    for size in (180, 192, 512):
        icon = Image.new('RGB', (size, size), '#171713')
        drawing = ImageDraw.Draw(icon)
        scale = size / 64
        drawing.polygon([(int(x*scale), int(y*scale)) for x, y in [(10,49),(25,20),(33,35),(40,24),(54,49)]], fill='#f4b860')
        drawing.ellipse(tuple(int(n*scale) for n in (41,10,53,22)), fill='#f7e5ba')
        icon.save(destination / f'icon-{size}.png')
    names = ['index.html', 'vegas-road-trip-2026.html', 'itinerary-for-agents.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png']
    assets = {name: hashlib.sha256((destination / name).read_bytes()).hexdigest() for name in names}
    source = (ROOT / 'web/service-worker.js').read_text()
    version = hashlib.sha256((json.dumps(assets, sort_keys=True) + source).encode()).hexdigest()[:16]
    worker = source.replace('__ASSETS__', json.dumps(assets)).replace('__VERSION__', version)
    (destination / 'sw.js').write_text(worker)
    (destination / '.nojekyll').write_text('')
    print(f'Built website in {destination}; offline version {version}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site-dir', type=Path, help='Also build an installable website in this directory')
    parser.add_argument('--bundled-only', action='store_true', help='Build only from committed assets; never download')
    parser.add_argument('--refresh-assets', action='store_true', help='Rebuild the committed bundle from source assets in the download cache')
    args = parser.parse_args()
    bundle_path = ROOT / 'web/offline-assets.json'
    bundle = json.loads(bundle_path.read_text()) if bundle_path.exists() and not args.refresh_assets else None
    if args.bundled_only and not bundle:
        parser.error('--bundled-only requires web/offline-assets.json and cannot use --refresh-assets')
    data = load_data()
    if bundle:
        license_text, css, js = (bundle[key] for key in ('leaflet_license', 'leaflet_css', 'leaflet_js'))
    else:
        leaflet_base = "https://unpkg.com/leaflet@1.9.4/"
        license_text = fetch(leaflet_base + "LICENSE").decode()
        css = fetch(leaflet_base + "dist/leaflet.css").decode()
        css = re.sub(
            r'url\((?:[\'"]?)(images/[^)\'\"]+)[\'\"]?\)',
            lambda m: 'url("'
            + data_url(fetch(leaflet_base + "dist/" + m[1]), "image/png")
            + '")',
            css,
        )
        js = fetch(leaflet_base + "dist/leaflet.js").decode()
        js = re.sub(r"//# sourceMappingURL=.*", "", js)
    photos, photo_ids, credits = {}, {}, []

    def photo_id(photo):
        url = photo["url"]
        canonical = re.sub(r"\?width=\d+$", "", url)
        if canonical in photo_ids:
            return photo_ids[canonical]
        key = "photo" + str(len(photos))
        if bundle and canonical in bundle['photos']:
            photos[key] = bundle['photos'][canonical]
        elif args.bundled_only:
            raise ValueError(f'Photo missing from committed assets: {url}. Build locally and commit the updated asset bundle.')
        else:
            original = Image.open(io.BytesIO(fetch(url)))
            image = ImageOps.exif_transpose(original).convert("RGB")
            image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            encoded = io.BytesIO()
            image.save(encoded, format="JPEG", quality=82, optimize=True, progressive=True)
            Image.open(io.BytesIO(encoded.getvalue())).verify()
            photos[key] = data_url(encoded.getvalue(), "image/jpeg")
        photo_ids[canonical] = key
        credits.append({"id": key, "description": photo["alt"], "source": url})
        return key

    for day in data["days"]:
        if day.get("photo"):
            photo_id(day["photo"])
        for activity in day["activities"]:
            if activity.get("photo"):
                photo_id(activity["photo"])
    photo_id(data["trip"]["hero"])
    layers = bundle['geography'] if bundle else {
        layer: geography(category, name, layer)
        for layer, category, name in [
            ("roads", "cultural", "ne_10m_roads_north_america"),
            ("states", "cultural", "ne_10m_admin_1_states_provinces_lines"),
            ("towns", "cultural", "ne_10m_populated_places"),
            ("lakes", "physical", "ne_10m_lakes"),
            ("rivers", "physical", "ne_10m_rivers_lake_centerlines"),
        ]
    }
    geo_json = re.sub(r"(-?\d+\.\d{5})\d+", r"\1", inline_json(layers))
    credit_html = '<details class="offline-credits"><summary>Offline content and credits</summary><p>All photos and the overview map are included in this file. External websites require internet. Map geography: Natural Earth, public domain. Photo sources retain their original copyrights.</p><ul>'
    credit_html += "".join(
        '<li><a target="_blank" rel="noopener" href="'
        + html.escape(c["source"], quote=True)
        + '">'
        + html.escape(c["description"])
        + "</a></li>"
        for c in credits
    )
    credit_html += (
        "</ul><p>Leaflet 1.9.4 license</p><pre>"
        + html.escape(license_text)
        + "</pre></details>"
    )
    output = ROOT / "vegas-road-trip-2026.html"
    result = render(
        data,
        photo_id,
        {
            "leaflet_css": css,
            "leaflet_js": "/*\n" + license_text + "\n*/\n" + js,
            "styles": (ROOT / "web/itinerary.css").read_text(),
            "interactions": (ROOT / "web/itinerary.js").read_text(),
            "clock_script": (ROOT / "web/current-time.js").read_text(),
            "geography_data": geo_json,
            "photo_data": inline_json(photos),
            "credits": credit_html,
        },
    )
    output.write_text(result)
    MARKDOWN_OUTPUT.write_text(render_markdown(data), encoding="utf-8")
    if not args.bundled_only:
        bundle_path.write_text(json.dumps({
            'leaflet_license': license_text, 'leaflet_css': css, 'leaflet_js': js,
            'photos': {url: photos[key] for url, key in photo_ids.items()},
            'geography': layers,
        }, ensure_ascii=False, separators=(',', ':')) + '\n')
    CACHE.mkdir(exist_ok=True)
    if args.site_dir:
        build_site(result, args.site_dir, data)
    (CACHE / "asset-manifest.json").write_text(
        json.dumps(
            {
                "photos": credits,
                "bounds": BOUNDS,
                "geography": {k: len(v["features"]) for k, v in layers.items()},
                "bytes": output.stat().st_size,
            },
            indent=2,
        )
    )
    print(
        f"Built {output.name}: {output.stat().st_size / 1_000_000:.2f} MB; {len(photos)} unique photos",
        flush=True,
    )


if __name__ == "__main__":
    main()
