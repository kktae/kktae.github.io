"""Essential build-level regression tests."""

from __future__ import annotations

import base64
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
POSTS = (ROOT / "tests/fixtures/published-posts.txt").read_text(encoding="utf-8").splitlines()
TAGS = (ROOT / "tests/fixtures/published-tags.txt").read_text(encoding="utf-8").splitlines()
CONFIG = tomllib.loads((ROOT / "hugo.toml").read_text(encoding="utf-8"))
ARTICLE = POSTS[6]
SLIDE_ARTICLE = "/posts/gemini-enterprise/01-overview/"
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


class Element:
    def __init__(self, tag="document", attrs=(), parent=None):
        self.tag = tag
        self.attrs = {key: value or "" for key, value in attrs}
        self.parent = parent
        self.children = []
        self.parts = []

    @property
    def text(self):
        return "".join(part.text if isinstance(part, Element) else part for part in self.parts)

    def walk(self):
        for child in self.children:
            yield child
            yield from child.walk()

    def find(self, tag=None, cls=None, **attrs):
        return [
            node
            for node in self.walk()
            if (tag is None or node.tag == tag)
            and (cls is None or cls in node.attrs.get("class", "").split())
            and all(node.attrs.get(key) == value for key, value in attrs.items())
        ]


class Document(HTMLParser, Element):
    def __init__(self, text):
        HTMLParser.__init__(self, convert_charrefs=True)
        Element.__init__(self)
        self.current = self
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
    result = subprocess.run(
        [
            "hugo",
            "--destination",
            str(destination),
            "--cacheDir",
            str(destination.parent / "cache"),
            "--noBuildLock",
            "--panicOnWarning",
            "--printPathWarnings",
            "--cleanDestinationDir",
        ],
        cwd=ROOT,
        env={**os.environ, "HUGO_ENVIRONMENT": "production", **extra_env},
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)


class SiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="kktae-tests-")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.output = Path(cls.temp.name) / "public"
        build(cls.output)
        cls.docs = {
            path.relative_to(cls.output).as_posix(): Document(path.read_text(encoding="utf-8"))
            for path in cls.output.rglob("*.html")
            if "/slides/" not in path.as_posix()
        }
        cls.article_routes = {
            urlsplit(doc.find("link", rel="canonical")[0].attrs["href"]).path
            for doc in cls.docs.values()
            if doc.find("article", cls="post-single")
        }

    def page(self, route):
        key = "index.html" if route == "/" else route.strip("/") + "/index.html"
        return self.docs[key]

    def test_public_urls_remain_available(self):
        for route in [*POSTS, *TAGS]:
            with self.subTest(route=route):
                self.assertTrue(self.page(route).find("h1"))

        alias = Document((self.output / "about/index.html").read_text(encoding="utf-8"))
        refresh = alias.find("meta", **{"http-equiv": "refresh"})
        self.assertTrue(refresh)
        self.assertIn("url=https://kktae.github.io/", refresh[0].attrs["content"].lower())

        for relative in ["categories/index.html", "categories/gcp-deep-dive/index.html"]:
            category_alias = Document((self.output / relative).read_text(encoding="utf-8"))
            refresh = category_alias.find("meta", **{"http-equiv": "refresh"})
            self.assertTrue(refresh, relative)
            self.assertIn("url=https://kktae.github.io/posts/", refresh[0].attrs["content"].lower())

    def test_search_and_seo_descriptions_remain_available(self):
        home = self.page("/")
        self.assertFalse(home.find(cls="post-summary"))
        self.assertTrue(self.page("/posts/").find(cls="post-summary"))

        entries = json.loads((self.output / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(
            {urlsplit(entry["permalink"]).path for entry in entries},
            self.article_routes,
        )
        self.assertTrue(all(entry["title"] and entry["content"] and entry["summary"] for entry in entries))

        article_entry = next(
            entry for entry in entries if urlsplit(entry["permalink"]).path == ARTICLE
        )
        article = self.page(ARTICLE)
        description = article.find("meta", name="description")[0].attrs["content"]
        self.assertEqual(description, article_entry["summary"])
        self.assertEqual(
            article.find("meta", property="og:description")[0].attrs["content"],
            description,
        )
        self.assertEqual(
            article.find("meta", name="twitter:description")[0].attrs["content"],
            description,
        )

        search = self.page("/search/")
        self.assertEqual(search.find("meta", name="robots")[0].attrs["content"], "noindex, follow")

    def test_metadata_and_rss_are_valid(self):
        home = self.page("/")
        head = home.find("head")[0]
        self.assertEqual(head.children[0].tag, "meta")
        self.assertEqual(head.children[0].attrs.get("charset"), "utf-8")
        self.assertFalse(home.find("meta", name="generator"))
        self.assertEqual(home.find("title")[0].text.strip(), CONFIG["params"]["seoTitle"])
        self.assertEqual(
            home.find("meta", name="description")[0].attrs["content"],
            CONFIG["params"]["description"],
        )
        social_image = urljoin(CONFIG["baseURL"], CONFIG["params"]["socialImage"])
        self.assertEqual(
            home.find("meta", property="og:image")[0].attrs["content"],
            social_image,
        )
        self.assertEqual(
            home.find("meta", name="twitter:image")[0].attrs["content"],
            social_image,
        )
        self.assertEqual(
            home.find("meta", name="twitter:card")[0].attrs["content"],
            "summary_large_image",
        )
        self.assertEqual(
            home.find("meta", name="twitter:title")[0].attrs["content"],
            CONFIG["params"]["seoTitle"],
        )
        self.assertTrue(home.find("link", rel="manifest"))
        self.assertTrue(home.find("link", rel="icon", type="image/svg+xml"))
        social_path = self.output / urlsplit(social_image).path.lstrip("/")
        self.assertTrue(social_path.is_file())
        manifest = json.loads((self.output / "site.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["name"], "kktae.io")
        self.assertEqual({icon["sizes"] for icon in manifest["icons"]}, {"192x192", "512x512"})

        for route in ["/", ARTICLE]:
            doc = self.page(route)
            self.assertTrue(doc.find("link", rel="canonical"))
            self.assertTrue(doc.find("meta", property="og:title"))
            self.assertEqual(doc.find("meta", property="og:locale")[0].attrs["content"], "ko")
            for script in doc.find("script", type="application/ld+json"):
                self.assertIsInstance(json.loads(script.text), (dict, list))

        article = self.page(ARTICLE)
        self.assertEqual(article.find("meta", name="author")[0].attrs["content"], "kktae")

        rss = ET.fromstring((self.output / "index.xml").read_text(encoding="utf-8"))
        self.assertEqual(rss.findtext("channel/language"), "ko")
        items = rss.findall("channel/item")
        self.assertEqual(
            {urlsplit(item.findtext("link") or "").path for item in items},
            self.article_routes,
        )
        self.assertTrue(all((item.findtext("description") or "").strip() for item in items))

    def test_series_navigation_stays_within_each_series(self):
        for route in self.article_routes:
            doc = self.page(route)
            series = doc.find("ol", cls="series-list")
            if not series:
                continue
            ordered = [urlsplit(a.attrs["href"]).path for a in series[0].find("a")]
            position = ordered.index(route)
            previous = [urlsplit(a.attrs["href"]).path for a in doc.find("a", rel="prev")]
            following = [urlsplit(a.attrs["href"]).path for a in doc.find("a", rel="next")]
            self.assertEqual(previous, ordered[position - 1 : position] if position else [])
            self.assertEqual(following, ordered[position + 1 : position + 2])

    def test_taxonomy_and_private_material_are_safe(self):
        expected = set(CONFIG["params"]["curatedTags"])
        tag_root = self.page("/tags/")
        actual = {
            anchor.find("span")[0].text.strip()
            for anchor in tag_root.find("a")
            if anchor.find("span")
        }
        self.assertEqual(actual, expected)
        self.assertFalse(any("/references/" in path for path in self.docs))
        self.assertNotIn("/categories/", (self.output / "sitemap.xml").read_text(encoding="utf-8"))

        for relative, doc in self.docs.items():
            if (
                relative.startswith("tags/")
                and relative != "tags/index.html"
                and "/page/" not in relative
                and len(doc.find("article", cls="post-row")) == 1
            ):
                self.assertEqual(
                    doc.find("meta", name="robots")[0].attrs["content"],
                    "noindex, follow",
                    relative,
                )

    def test_internal_links_assets_and_integrity_are_valid(self):
        broken = set()
        checked_integrity = 0
        for relative, doc in self.docs.items():
            for node in doc.walk():
                for attr in ("href", "src"):
                    value = node.attrs.get(attr, "")
                    if not value or value.startswith(("#", "mailto:", "data:", "javascript:")):
                        continue
                    resolved = urlsplit(urljoin("https://kktae.github.io/" + relative, value))
                    if resolved.netloc != "kktae.github.io":
                        continue
                    path = self.output / unquote(resolved.path).lstrip("/")
                    if path.is_dir():
                        path /= "index.html"
                    if not path.is_file():
                        broken.add((relative, value))

                integrity = node.attrs.get("integrity")
                asset = node.attrs.get("src", node.attrs.get("href", ""))
                if not integrity or not asset:
                    continue
                path = self.output / unquote(urlsplit(asset).path).lstrip("/")
                algorithm, expected = integrity.split("-", 1)
                actual = base64.b64encode(
                    hashlib.new(algorithm, path.read_bytes()).digest()
                ).decode()
                self.assertEqual(actual, expected, asset)
                checked_integrity += 1

        self.assertEqual(sorted(broken), [])
        self.assertGreater(checked_integrity, 0)

    def test_markdown_diagrams_and_slide_embed_are_preserved(self):
        diagrams = [
            node
            for route in POSTS
            for node in self.page(route).find("pre", cls="diagram-source")
        ]
        self.assertTrue(diagrams)
        self.assertTrue(all(node.text.strip() for node in diagrams))
        diagram_bundles = list((self.output / "assets/js").glob("diagrams*.js"))
        self.assertEqual(len(diagram_bundles), 1)
        diagram_bundle = diagram_bundles[0].read_text(encoding="utf-8")
        self.assertIn("antigravity-direct", diagram_bundle)
        self.assertNotIn("mermaid.esm", diagram_bundle)
        self.assertNotIn("registerLayoutLoaders", diagram_bundle)
        self.assertNotIn("cdn.jsdelivr.net/npm/mermaid", diagram_bundle)
        self.assertFalse(CONFIG["markup"]["goldmark"]["renderer"]["unsafe"])
        alerts = [
            node
            for route in POSTS
            for node in self.page(route).find("blockquote", cls="alert")
        ]
        self.assertTrue(alerts)
        self.assertTrue(any("alert-note" in node.attrs.get("class", "").split() for node in alerts))
        self.assertTrue(self.page("/posts/google-cloud/compute-availability-visibility/").find("input", type="checkbox"))
        self.assertTrue(self.page("/posts/google-cloud/gke-agent-substrate/").find(cls="footnotes"))
        code_blocks = self.page("/posts/google-cloud/vertex-gemini-429-resilience/").find("figure", cls="code-block")
        self.assertTrue(code_blocks)
        self.assertEqual(code_blocks[0].find("figcaption", cls="code-block-header")[0].text.strip(), "json")

        iframe = self.page(SLIDE_ARTICLE).find("iframe")
        self.assertEqual(len(iframe), 1)
        self.assertTrue((self.output / "posts/gemini-enterprise/slides/index.html").is_file())

    def test_pagination_keeps_every_article_once(self):
        output = Path(self.temp.name) / "paginated"
        build(output, HUGO_PAGINATION_PAGERSIZE="3")
        found = []
        for path in [output / "posts/index.html", *sorted((output / "posts/page").glob("*/index.html"))]:
            doc = Document(path.read_text(encoding="utf-8"))
            found.extend(
                urlsplit(row.find("h2")[0].find("a")[0].attrs["href"]).path
                for row in doc.find("article", cls="post-row")
            )
        self.assertEqual(len(found), len(set(found)))
        self.assertEqual(set(found), self.article_routes)


if __name__ == "__main__":
    unittest.main()
