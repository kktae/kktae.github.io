# Monochrome blog refactor

Approved scope: retain Hugo and PaperMod, existing published URLs and content; replace the site-owned presentation with a white/black reading-oriented layout. Upgrade direct dependencies to the latest verified stable versions (PaperMod uses its latest default-branch commit), eliminate deprecated APIs from the active build, and validate actual browser behavior. No push or deployment is authorized.

## Implementation sequence

1. Add build regression tests for existing post URLs, Korean locale, compact home, four-item navigation, closed mobile TOC, explicit series order, search data, RSS/SEO, diagrams, slide passthrough, local links, integrity, deprecated browser APIs, and pagination. Observe failures on the old site.
2. Pin Hugo in `.hugo-version`; update the PaperMod submodule and GitHub Actions. Pin CDN dependencies centrally in `data/dependencies.toml` and vendor the current Fuse browser bundle with its license. Exclude local `references/` working documents from Hugo, not just Git.
3. Migrate project templates to Hugo's current layout directories. Share list rows, pagination and series data through small partials. Keep PaperMod typography/reset/Chroma foundations and SEO utilities; replace only active deprecated/template behavior through project overrides.
4. Implement a six-post home, paginated all-posts view, minimal header/footer, readable article typography, one responsive TOC, series-aware navigation, accessible search and modern Clipboard API error handling. Preserve standalone slides.
5. Run the complete tests and strict production build, inspect responsive light/dark pages and keyboard interactions in the browser, verify all Mermaid diagrams and slides, then document exact versions and remaining limitations.

## Acceptance and review focus

- Existing article/series/taxonomy routes stay valid; unpublished local references do not leak into output.
- No deprecated Hugo warnings or browser APIs in generated active code; upstream sources remain an unmodified submodule.
- Search handles Korean IME input, queries typed before its index loads, empty/no-result/error states, and keyboard navigation.
- A single TOC is collapsed on mobile but visible on wide screens without duplicating heading IDs; reduced motion and focus styles remain usable.
- Series ordering follows metadata, including first/last and one-article series; navigation does not cross unrelated series.
- CDN failure keeps readable Mermaid source; theme changes do not destroy it; standard code blocks have truthful clipboard success/error feedback.
- No new runtime framework, CMS, analytics, image generation, or content rewrite.

## Verification commands

```sh
python3 -m unittest discover -s tests -v
hugo --minify --panicOnWarning
hugo server --bind 127.0.0.1 --port 1313 --disableFastRender
```
