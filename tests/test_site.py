"""Build-level regression tests. Run: python3 -m unittest discover -s tests -v."""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
import os
import subprocess
import tempfile
import tomllib
import unittest
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[1]
POSTS = (
    (ROOT / "tests/fixtures/published-posts.txt")
    .read_text(encoding="utf-8")
    .splitlines()
)
TAGS = (
    (ROOT / "tests/fixtures/published-tags.txt")
    .read_text(encoding="utf-8")
    .splitlines()
)
CONFIG = tomllib.loads((ROOT / "hugo.toml").read_text(encoding="utf-8"))
ARTICLE = POSTS[6]
VOID = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}


class Element:
    def __init__(self, tag: str = "document", attrs=(), parent: Element | None = None):
        self.tag = tag
        self.attrs: dict[str, str] = {key: value or "" for key, value in attrs}
        self.parent = parent
        self.children: list[Element] = []
        self.parts: list[str | Element] = []

    @property
    def text(self):
        return "".join(
            part.text if isinstance(part, Element) else part for part in self.parts
        )

    def find(self, tag=None, cls=None, **attrs):
        return [
            node
            for node in self.walk()
            if (tag is None or node.tag == tag)
            and (cls is None or cls in node.attrs.get("class", "").split())
            and all(node.attrs.get(key) == value for key, value in attrs.items())
        ]

    def walk(self):
        for child in self.children:
            yield child
            yield from child.walk()


class Document(HTMLParser, Element):
    def __init__(self, text):
        HTMLParser.__init__(self, convert_charrefs=True)
        Element.__init__(self)
        self.current: Element = self
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        node = Element(tag, attrs, self.current)
        self.current.children.append(node)
        self.current.parts.append(node)
        if tag not in VOID:
            self.current = node

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        node = self.current
        while node.parent is not None and node.tag != tag:
            node = node.parent
        if node.parent is not None:
            self.current = node.parent

    def handle_data(self, data):
        self.current.parts.append(data)


def build(destination, **extra_env):
    env = {**os.environ, "HUGO_ENVIRONMENT": "production", **extra_env}
    result = subprocess.run(
        [
            "hugo",
            "--destination",
            str(destination),
            "--cacheDir",
            str(destination.parent / "cache"),
            "--noBuildLock",
        ],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result.stdout + result.stderr


class SiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="kktae-tests-")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.output = Path(cls.temp.name) / "public"
        cls.log = build(cls.output)
        cls.docs = {
            p.relative_to(cls.output).as_posix(): Document(
                p.read_text(encoding="utf-8")
            )
            for p in cls.output.rglob("*.html")
            if "/slides/" not in p.as_posix()
        }
        # Existing URL fixtures are a compatibility floor, not a cap on new posts.
        cls.article_routes = {
            urlsplit(doc.find("link", rel="canonical")[0].attrs["href"]).path
            for doc in cls.docs.values()
            if doc.find("article", cls="post-single")
        }

    def page(self, route):
        return self.docs[
            route.strip("/") + "/index.html" if route != "/" else "index.html"
        ]

    def test_production_build_has_no_warnings(self):
        self.assertNotRegex(self.log, r"(?m)^(?:WARN|ERROR)")

    def test_ci_pins_runtime_versions_and_runs_lint(self):
        workflow = (ROOT / ".github/workflows/pages.yml").read_text(encoding="utf-8")
        self.assertEqual((ROOT / ".python-version").read_text().strip(), "3.14.7")
        self.assertEqual((ROOT / ".node-version").read_text().strip(), "26.10.0")
        self.assertIn(
            "actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97", workflow
        )
        self.assertIn(
            "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020", workflow
        )
        self.assertIn(
            "astral-sh/ruff-action@278981a28ce3188b1e39527901f38254bf3aac89", workflow
        )
        self.assertIn("python-version-file: .python-version", workflow)
        self.assertIn("node-version-file: .node-version", workflow)
        self.assertIn('version: "0.16.8"', workflow)
        self.assertIn("hugo --minify --panicOnWarning --cleanDestinationDir", workflow)


    def test_ci_cancels_stale_prs_bounds_jobs_and_skips_non_main_pages_artifacts(self):
        workflow = (ROOT / ".github/workflows/pages.yml").read_text(encoding="utf-8")
        self.assertIn("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", workflow)
        self.assertIn("timeout-minutes: 10", workflow)
        main_only = "if: github.ref == 'refs/heads/main'"
        self.assertEqual(workflow.count(main_only), 3)

        audit = (ROOT / ".github/workflows/dependency-audit.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("timeout-minutes: 5", audit)
    def test_dependency_audit_is_scheduled(self):
        workflow = (ROOT / ".github/workflows/dependency-audit.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("schedule:", workflow)
        self.assertIn("python3 scripts/check_dependencies.py", workflow)
        self.assertTrue((ROOT / "scripts/check_dependencies.py").is_file())

    def test_original_public_post_urls_remain(self):
        for route in POSTS:
            with self.subTest(route=route):
                self.assertTrue(self.page(route).find("h1"))

    def test_original_public_tag_urls_remain(self):
        for route in TAGS:
            with self.subTest(route=route):
                self.assertTrue(self.page(route).find("h1"))

    def test_primary_navigation_has_four_clear_choices(self):
        nav = self.page("/").find("nav", **{"aria-label": "주 메뉴"})
        self.assertEqual(len(nav), 1)
        self.assertEqual(
            [a.text.strip() for a in nav[0].find("a")], ["글", "시리즈", "소개", "검색"]
        )

    def test_home_is_bounded_flat_list(self):
        home = self.page("/")
        self.assertEqual(
            len(home.find("article", cls="post-row")),
            min(CONFIG["params"]["homePostLimit"], len(self.article_routes)),
        )
        self.assertFalse(home.find(cls="timeline-toc"))
        self.assertFalse(home.find(cls="post-entry"))

    def test_korean_language_and_light_default(self):
        html = self.page("/").find("html")[0]
        self.assertEqual(html.attrs.get("lang"), "ko")
        self.assertEqual(html.attrs.get("data-theme"), "light")
        self.assertEqual(html.attrs.get("dir"), "ltr")

    def test_one_closed_toc_and_no_duplicate_ids(self):
        doc = self.page(ARTICLE)
        toc = doc.find("details", cls="toc")
        self.assertEqual(len(toc), 1)
        self.assertNotIn("open", toc[0].attrs)
        ids = [node.attrs["id"] for node in doc.walk() if "id" in node.attrs]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(doc.find("a", href="#main-content"))

    def test_series_links_follow_explicit_order(self):
        doc = self.page(ARTICLE)
        series = doc.find("ol", cls="series-list")
        self.assertEqual(len(series), 1)
        ordered = [urlsplit(a.attrs["href"]).path for a in series[0].find("a")]
        self.assertEqual([route for route in ordered if route in POSTS[:9]], POSTS[:9])
        self.assertEqual(
            [
                urlsplit(a.attrs["href"]).path
                for a in series[0].find("a", **{"aria-current": "page"})
            ],
            [ARTICLE],
        )
        position = ordered.index(ARTICLE)
        self.assertEqual(
            urlsplit(doc.find("a", rel="prev")[0].attrs["href"]).path,
            ordered[position - 1],
        )
        self.assertEqual(
            urlsplit(doc.find("a", rel="next")[0].attrs["href"]).path,
            ordered[position + 1],
        )

    def test_series_boundaries_do_not_cross_into_unrelated_series(self):
        for route in self.article_routes:
            doc = self.page(route)
            series = doc.find("ol", cls="series-list")
            if not series:
                continue
            ordered = [urlsplit(a.attrs["href"]).path for a in series[0].find("a")]
            position = ordered.index(route)
            with self.subTest(route=route):
                actual_prev = [
                    urlsplit(a.attrs["href"]).path for a in doc.find("a", rel="prev")
                ]
                actual_next = [
                    urlsplit(a.attrs["href"]).path for a in doc.find("a", rel="next")
                ]
                self.assertEqual(
                    actual_prev, ordered[position - 1 : position] if position else []
                )
                self.assertEqual(actual_next, ordered[position + 1 : position + 2])

    def test_search_index_contains_only_public_articles(self):
        entries = json.loads((self.output / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(
            {urlsplit(e["permalink"]).path for e in entries}, self.article_routes
        )
        self.assertTrue(all(e["title"] and e["content"] for e in entries))
        doc = self.page("/search/")
        self.assertTrue(doc.find("label", **{"for": "searchInput"}))
        self.assertTrue(doc.find(id="searchStatus", role="status"))

    def test_search_index_stays_within_growth_budget(self):
        payload = (self.output / "index.json").read_bytes()
        self.assertLess(len(payload), 128 * 1024)
        self.assertLess(len(gzip.compress(payload, compresslevel=9)), 64 * 1024)

    def test_tag_taxonomy_is_curated_and_singletons_are_noindex(self):
        expected = {
            "AI Agent",
            "GCP",
            "Gemini",
            "IP Management",
            "Load Balancing",
            "Monitoring",
            "PSA",
            "PSC",
            "VPC",
            "Vertex AI",
        }
        tag_root = self.page("/tags/")
        actual = {
            anchor.find("span")[0].text.strip()
            for anchor in tag_root.find("a")
            if anchor.find("span")
        }
        self.assertEqual(actual, expected)
        singleton_pages = []
        for relative, doc in self.docs.items():
            if not relative.startswith("tags/") or relative == "tags/index.html":
                continue
            if "/page/" in relative or len(doc.find("article", cls="post-row")) != 1:
                continue
            singleton_pages.append(relative)
            robots = doc.find("meta", name="robots")[0].attrs["content"]
            self.assertEqual(robots, "noindex, follow", relative)
        self.assertTrue(singleton_pages)

    def test_rendered_blog_and_slide_deck_do_not_depend_on_external_fonts(self):
        home = self.page("/")
        external_styles = [
            link.attrs.get("href", "")
            for link in home.find("link", rel="stylesheet")
            if link.attrs.get("href", "").startswith(("http://", "https://"))
        ]
        self.assertEqual(external_styles, [])
        slides = (ROOT / "static/posts/gemini-enterprise/slides/index.html").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("fonts.googleapis.com", slides)
        self.assertNotIn("cdn.jsdelivr.net", slides)

    def test_working_reference_documents_never_publish(self):
        self.assertFalse(any("/references/" in path for path in self.docs))

    def test_rss_language_and_items(self):
        root = ET.fromstring((self.output / "index.xml").read_text(encoding="utf-8"))
        self.assertEqual(root.findtext("channel/language"), "ko")
        self.assertEqual(
            {urlsplit(e.text or "").path for e in root.findall("channel/item/link")},
            self.article_routes,
        )

    def test_metadata_and_jsonld_remain_valid(self):
        for route in ["/", ARTICLE]:
            doc = self.page(route)
            self.assertTrue(doc.find("link", rel="canonical"))
            self.assertTrue(doc.find("meta", property="og:title"))
            self.assertEqual(
                doc.find("meta", property="og:locale")[0].attrs["content"], "ko"
            )
            scripts = doc.find("script", type="application/ld+json")
            self.assertTrue(scripts)
            for script in scripts:
                self.assertIsInstance(json.loads(script.text), (dict, list))

    def test_author_metadata_has_scalar_person_name(self):
        doc = self.page(ARTICLE)
        self.assertEqual(doc.find("meta", name="author")[0].attrs["content"], "kktae")
        jsonld = [
            json.loads(script.text)
            for script in doc.find("script", type="application/ld+json")
        ]
        posting = next(item for item in jsonld if item.get("@type") == "BlogPosting")
        self.assertEqual(posting["author"], {"@type": "Person", "name": "kktae"})

    def test_markdown_disallows_raw_html_and_slide_embed_uses_shortcode(self):
        self.assertFalse(CONFIG["markup"]["goldmark"]["renderer"]["unsafe"])
        source = (ROOT / "content/posts/gemini-enterprise/01-overview.md").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("<iframe", source)
        self.assertIn("{{< slides", source)
        iframe = self.page(POSTS[-1]).find("iframe")[0]
        self.assertEqual(iframe.attrs["src"], "../slides/")
        self.assertEqual(iframe.attrs.get("loading"), "lazy")
        self.assertEqual(iframe.attrs.get("referrerpolicy"), "no-referrer")

    def test_slide_deck_uses_optimized_accessible_media(self):
        slide_root = ROOT / "static/posts/gemini-enterprise/slides"
        source = (slide_root / "index.html").read_text(encoding="utf-8")
        doc = Document(source)
        self.assertNotIn(".gif", source)
        self.assertFalse(
            (slide_root / "assets/brand/gemini-welcome-animation.gif").exists()
        )
        videos = doc.find("video")
        self.assertEqual(len(videos), 1)
        self.assertEqual(videos[0].attrs.get("preload"), "metadata")
        self.assertIn("playsinline", videos[0].attrs)
        media_sources = {
            node.attrs.get("type"): node.attrs.get("src")
            for node in videos[0].find("source")
        }
        self.assertEqual(set(media_sources), {"video/mp4"})
        self.assertFalse(
            (slide_root / "assets/brand/gemini-welcome-animation.webm").exists()
        )
        images = doc.find("img")
        self.assertTrue(images)
        for image in images:
            with self.subTest(src=image.attrs.get("src")):
                self.assertIn(image.attrs.get("loading"), {"lazy", "eager"})
                self.assertEqual(image.attrs.get("decoding"), "async")
                self.assertGreater(int(image.attrs.get("width", "0")), 0)
                self.assertGreater(int(image.attrs.get("height", "0")), 0)
        total_assets = sum(
            path.stat().st_size
            for path in (slide_root / "assets").rglob("*")
            if path.is_file()
        )
        self.assertLess(total_assets, 5 * 1024 * 1024)

    def test_slide_navigation_has_accessible_state_and_reduced_motion(self):
        source = (ROOT / "static/posts/gemini-enterprise/slides/index.html").read_text(
            encoding="utf-8"
        )
        doc = Document(source)
        nav = doc.find("nav", id="navDots", **{"aria-label": "슬라이드 이동"})
        self.assertEqual(len(nav), 1)
        self.assertIn("setAttribute('aria-label'", source)
        self.assertIn("setAttribute('aria-current', 'page')", source)
        self.assertIn("removeAttribute('aria-current')", source)
        self.assertIn("prefers-reduced-motion: reduce", source)
        self.assertIn("reduceMotion.matches ? 'auto' : 'smooth'", source)

    def test_mermaid_sources_and_slide_iframe_are_preserved(self):
        diagrams = [
            node
            for route in POSTS
            for node in self.page(route).find("pre", cls="mermaid")
        ]
        self.assertEqual(len(diagrams), 12)
        self.assertTrue(all(node.text.strip() for node in diagrams))
        iframe = self.page(POSTS[-1]).find("iframe")[0]
        self.assertEqual(iframe.attrs["src"], "../slides/")
        self.assertEqual(
            (ROOT / "static/posts/gemini-enterprise/slides/index.html").read_bytes(),
            (self.output / "posts/gemini-enterprise/slides/index.html").read_bytes(),
        )

    def test_local_asset_integrity_matches_content(self):
        checked = set()
        for doc in self.docs.values():
            for node in doc.walk():
                integrity = node.attrs.get("integrity")
                url = node.attrs.get("src", node.attrs.get("href", ""))
                if not integrity or url in checked:
                    continue
                checked.add(url)
                path = self.output / unquote(urlsplit(url).path).lstrip("/")
                self.assertTrue(path.is_file(), url)
                algorithm, expected = integrity.split("-", 1)
                actual = base64.b64encode(
                    hashlib.new(algorithm, path.read_bytes()).digest()
                ).decode()
                self.assertEqual(actual, expected, url)
        self.assertTrue(checked)

    def test_internal_navigation_and_asset_targets_exist(self):
        broken = set()
        for relative, doc in self.docs.items():
            for node in doc.walk():
                for attr in ("href", "src"):
                    value = node.attrs.get(attr, "")
                    if not value or value.startswith(
                        ("#", "mailto:", "data:", "javascript:")
                    ):
                        continue
                    resolved = urlsplit(
                        urljoin("https://kktae.github.io/" + relative, value)
                    )
                    if resolved.netloc != "kktae.github.io":
                        continue
                    path = self.output / unquote(resolved.path).lstrip("/")
                    if path.is_dir():
                        path = path / "index.html"
                    if not path.is_file():
                        broken.add((relative, value))
        self.assertEqual(sorted(broken), [])

    def test_built_scripts_do_not_use_deprecated_browser_apis(self):
        text = "\n".join(
            p.read_text(encoding="utf-8") for p in self.output.rglob("*.js")
        )
        text += "\n".join(script.text for script in self.page(ARTICLE).find("script"))
        self.assertNotRegex(text, r"execCommand\s*\(|\.keyCode\b|\.substr\s*\(")

    def test_posts_pagination_keeps_every_article_once(self):
        output = Path(self.temp.name) / "paginated"
        log = build(output, HUGO_PAGINATION_PAGERSIZE="3")
        self.assertNotRegex(log, r"(?m)^(?:WARN|ERROR)")
        found = []
        for index in range(1, (len(self.article_routes) + 2) // 3 + 1):
            path = output / (
                "posts/index.html" if index == 1 else f"posts/page/{index}/index.html"
            )
            self.assertTrue(path.is_file(), path)
            doc = Document(path.read_text(encoding="utf-8"))
            for row in doc.find("article", cls="post-row"):
                found.append(
                    urlsplit(row.find("h2")[0].find("a")[0].attrs["href"]).path
                )
        self.assertEqual(len(found), len(set(found)))
        self.assertEqual(set(found), self.article_routes)


if __name__ == "__main__":
    unittest.main()
