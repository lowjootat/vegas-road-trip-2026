import copy
from html.parser import HTMLParser
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import render_markdown as markdown
from render_itinerary import load_data


class MarkdownTests(unittest.TestCase):
    def setUp(self):
        self.data = load_data()
        self.output = markdown.render_markdown(self.data)

    def test_complete_content_and_order(self):
        positions = []
        for day in self.data["days"]:
            self.assertIn(f"- Day ID: {day['id']}", self.output)
            self.assertIn(markdown.escape(day["clockGuidance"]), self.output)
            for activity in day["activities"]:
                positions.append(self.output.index(f"- Activity ID: {activity['id']}\n"))
                for key in ("time", "duration", "description", "descriptionLead", "solarNote", "startAt", "endAt"):
                    if key in activity:
                        self.assertIn(markdown.escape(activity[key]), self.output)
            for note in day["notes"]:
                self.assertIn(markdown.escape(note["text"]), self.output)
            for event in day.get("solarEvents", []):
                self.assertIn(event["at"], self.output)
                self.assertIn(markdown.escape(event["text"]), self.output)
        self.assertEqual(positions, sorted(positions))
        for pid, place in self.data["places"].items():
            self.assertIn(f"- Place ID: {pid}\n", self.output)
            self.assertIn(place["mapsUrl"], self.output)
            self.assertIn(str(place["latitude"]), self.output)
        for stop in self.data["mapStops"]:
            self.assertIn(f"- Stop ID: {stop['id']}\n", self.output)
            self.assertIn(markdown.escape(stop["summary"]), self.output)
        for item in self.data["checklist"]:
            self.assertIn(f"- [{'x' if item['checked'] else ' '}] {markdown.escape(item['text'])} (ID: `{item['id']}`)", self.output)
        self.assertIn(markdown.escape(self.data["trip"]["bookingNotice"]["text"]), self.output)
        self.assertIn(markdown.escape(self.data["trip"]["footer"]), self.output)
        self.assertNotIn("![", self.output)

    def test_optional_activity_has_no_invented_timestamps(self):
        activity = next(a for d in self.data["days"] for a in d["activities"] if a["time"] == "Optional")
        section = self.output.split(f"- Activity ID: {activity['id']}\n", 1)[1].split("\n#### ", 1)[0]
        self.assertIn("- Time: Optional", section)
        self.assertNotIn("Start timestamp", section)
        self.assertNotIn("End timestamp", section)

    def test_source_edits_update_resolved_links_and_photos(self):
        data = copy.deepcopy(self.data)
        data["places"]["las-vegas"]["mapsUrl"] = "https://example.com/changed"
        data["trip"]["hero"] = {"alt": "New photo", "url": "https://example.com/photo.jpg"}
        output = markdown.render_markdown(data)
        self.assertIn("[Google Maps](<https://example.com/changed>)", output)
        self.assertIn("[New photo](<https://example.com/photo.jpg>)", output)

    def test_literal_markdown_and_link_escaping(self):
        self.assertEqual(markdown.escape("[text] *bold* <tag> & `code`"),
                         r"\[text\] \*bold\* &lt;tag&gt; &amp; \`code\`")
        self.assertEqual(markdown.link("[label]", "https://example.com/a b>"),
                         r"[\[label\]](<https://example.com/a%20b%3E>)")

    def test_deterministic_output_and_committed_freshness(self):
        self.assertEqual(self.output, markdown.render_markdown(self.data))
        self.assertEqual(self.output, markdown.OUTPUT.read_text(encoding="utf-8"))

    def test_check_rejects_missing_and_stale_files_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "itinerary.md"
            with patch.object(markdown, "OUTPUT", path), patch.object(sys, "argv", ["render_markdown.py", "--check"]):
                with self.assertRaises(SystemExit) as missing:
                    markdown.main()
                self.assertEqual(missing.exception.code, 1)
                self.assertFalse(path.exists())
                path.write_text("stale", encoding="utf-8")
                with self.assertRaises(SystemExit) as stale:
                    markdown.main()
                self.assertEqual(stale.exception.code, 1)
                self.assertEqual(path.read_text(), "stale")

    def test_template_places_html_link_immediately_after_json(self):
        template = (markdown.ROOT / "web/template.html").read_text()
        lines = template.splitlines()
        index = next(i for i, line in enumerate(lines) if "Itinerary data (raw JSON)" in line)
        self.assertIn("Itinerary for agents (HTML)", lines[index + 1])
        self.assertIn("https://lowjootat.github.io/vegas-road-trip-2026/itinerary-for-agents.html", lines[index + 1])

    def test_html_contains_source_content_in_semantic_elements(self):
        class Document(HTMLParser):
            def __init__(self, source):
                super().__init__()
                self.tags, self.text, self.links = [], [], []
                self.feed(source)

            def handle_starttag(self, tag, attrs):
                self.tags.append(tag)
                if tag == 'a':
                    self.links.append(dict(attrs)['href'])

            def handle_data(self, value):
                self.text.append(value)

        source = markdown.render_agent_html(self.data)
        doc = Document(source)
        text = ''.join(doc.text)
        for tag in ('main', 'h1', 'h2', 'h3', 'h4', 'ul', 'li', 'a'):
            self.assertIn(tag, doc.tags)
        for tag in ('script', 'img', 'iframe'):
            self.assertNotIn(tag, doc.tags)
        positions = []
        for day in self.data['days']:
            self.assertIn(day['clockGuidance'], text)
            for activity in day['activities']:
                positions.append(text.index('Activity ID: ' + activity['id'] + '\n'))
                for key in ('time', 'duration', 'description', 'startAt', 'endAt'):
                    if key in activity:
                        self.assertIn(activity[key], text)
        self.assertEqual(positions, sorted(positions))
        for place in self.data['places'].values():
            self.assertIn(place['mapsUrl'], doc.links)
        self.assertNotIn('{{body}}', source)

    def test_html_escapes_source_text_and_attributes(self):
        self.data['trip']['title'] = '<script>alert("test")</script>'
        self.data['days'][0]['activities'][0]['description'] = '<img src=x onerror=alert(1)> & text'
        self.data['places']['las-vegas']['mapsUrl'] = 'https://example.com/?x="quoted"&y=1'
        source = markdown.render_agent_html(self.data)
        self.assertNotIn('<script>', source)
        self.assertNotIn('<img', source)
        self.assertIn('&lt;img src=x onerror=alert(1)&gt; &amp; text', source)
        self.assertIn('href="https://example.com/?x=&quot;quoted&quot;&amp;y=1"', source)
