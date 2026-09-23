# kktae.io

- Site: <https://kktae.github.io/>
- Posts: `content/posts/`
- Static assets: `static/`
- Runtime versions: `.hugo-version`, `.python-version`, `.node-version`

## Local

- Initialize: `git submodule update --init --recursive`
- Run: `hugo server`

## Verify

- `ruff check scripts/check-browser.py scripts/check_dependencies.py tests/test_site.py`
- `python3 -m unittest discover -s tests -v`
- `node --test tests/*.test.mjs`
- `HUGO_ENVIRONMENT=production hugo --minify --panicOnWarning --cleanDestinationDir`

## Deploy

- `main` → GitHub Actions → GitHub Pages
