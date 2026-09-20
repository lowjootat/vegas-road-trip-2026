import copy
import json
import sys
import unittest
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from render_itinerary import load_data, render, validate, inline_json, map_data


class Articles(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.articles = {}
        self.current = None
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        if tag == "article":
            self.current = dict(attrs)["id"]
            self.articles[self.current] = ""

    def handle_endtag(self, tag):
        if tag == "article":
            self.current = None

    def handle_data(self, text):
        if self.current:
            self.articles[self.current] += text


class ItineraryTests(unittest.TestCase):
    def setUp(self):
        self.data = load_data()

    def render(self):
        return render(
            self.data,
            lambda p: "test-photo",
            dict(
                leaflet_css="",
                leaflet_js="",
                styles="",
                interactions="",
                geography_data="{}",
                photo_data="{}",
                credits="",
            ),
        )

    def test_every_activity_renders_in_day_order(self):
        expected = [a for d in self.data["days"] for a in d["activities"]]
        actual = Articles(self.render()).articles
        self.assertEqual(list(actual), [a["id"] for a in expected])
        for activity in expected:
            for field in ["description", "descriptionLead", "duration", "solarNote"]:
                if field in activity:
                    self.assertIn(activity[field], actual[activity["id"]])

    def test_insert_and_reorder_keeps_metadata_attached(self):
        before = Articles(self.render()).articles
        activities = self.data["days"][0]["activities"]
        added = copy.deepcopy(activities[0])
        added.update(
            id="new-breakfast",
            description="A new breakfast",
            duration="10 min",
            categories=["hike"],
            solarNote="Sunrise note",
        )
        activities.reverse()
        activities.insert(1, added)
        after = Articles(self.render()).articles
        for aid, content in before.items():
            self.assertEqual(after[aid], content)
        self.assertIn("10 min", after["new-breakfast"])
        self.assertIn("🥾", after["new-breakfast"])
        self.assertIn("Sunrise note", after["new-breakfast"])

    def test_duplicate_and_missing_fields_fail(self):
        self.data["days"][0]["activities"].append(
            copy.deepcopy(self.data["days"][0]["activities"][0])
        )
        with self.assertRaisesRegex(ValueError, "duplicate ID"):
            validate(self.data)
        self.data = load_data()
        del self.data["days"][0]["activities"][0]["duration"]
        with self.assertRaisesRegex(ValueError, "missing duration"):
            validate(self.data)

    def test_broken_references_fail(self):
        self.data["mapStops"][0]["placeId"] = "missing"
        with self.assertRaisesRegex(ValueError, "invalid map reference"):
            validate(self.data)
        self.data = load_data()
        self.data["days"][0]["activities"][0]["links"][0]["placeId"] = "missing"
        with self.assertRaisesRegex(ValueError, "unknown link place reference"):
            validate(self.data)

    def test_place_link_change_updates_both_views(self):
        self.data["places"]["las-vegas"]["mapsUrl"] = "https://example.com/updated-map"
        self.assertIn("https://example.com/updated-map", self.render())
        self.assertEqual(
            map_data(self.data)[0]["maps"], "https://example.com/updated-map"
        )

    def test_text_and_embedded_data_are_escaped(self):
        value = '</script><img src=x onerror=alert(1)> & "quoted"'
        self.data["days"][0]["activities"][0]["description"] = value
        output = self.render()
        self.assertNotIn(value, output)
        self.assertIn("&lt;/script&gt;", output)
        encoded = inline_json({"text": value})
        self.assertNotIn("<", encoded)
        self.assertEqual(json.loads(encoded)["text"], value)

    def test_unsafe_links_fail(self):
        self.data["places"]["las-vegas"]["mapsUrl"] = "javascript:alert(1)"
        with self.assertRaisesRegex(ValueError, "HTTP"):
            validate(self.data)

    def test_optional_and_cross_zone_time_labels(self):
        articles = Articles(self.render()).articles
        self.assertIn("OptionalFlexible", articles["fri-5-parus-trail"])
        self.assertIn("10:15 UTC−7→14:45 UTC−6", articles["fri-3-las-vegas-zion"])

    def test_schedule_rejects_missing_offset_pair_and_nonpositive_duration(self):
        activity = self.data["days"][0]["activities"][0]
        original = dict(activity)
        for changes in [
            {"startAt": None},
            {"endAt": "2026-09-25T08:00:00"},
            {"endAt": original["startAt"]},
            {"endAt": "2026-09-25T07:00:00-07:00"},
            {"startAt": "2026-09-24T07:15:00-07:00"},
        ]:
            activity.update(original)
            activity.update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate(self.data)

    def test_schedule_data_keeps_offsets_and_skips_optional_activity(self):
        source = self.render()
        start = source.index('<script type="application/json" id="schedule-data">')
        encoded = source[start:].split('>', 1)[1].split('</script>', 1)[0]
        schedule = json.loads(encoded)
        self.assertEqual(len(schedule), 60)
        self.assertNotIn("fri-5-parus-trail", [item["id"] for item in schedule])
        drive = next(item for item in schedule if item["id"] == "fri-3-las-vegas-zion")
        self.assertTrue(drive["startAt"].endswith("-07:00"))
        self.assertTrue(drive["endAt"].endswith("-06:00"))


if __name__ == "__main__":
    unittest.main()
