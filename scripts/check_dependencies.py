#!/usr/bin/env python3
"""Fail when direct project dependencies are behind latest stable upstream versions."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tomllib
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
TIMEOUT_SECONDS = 20
USER_AGENT = "kktae-dependency-audit"


def fetch_json(url: str) -> object:
    headers = {
        "Accept": "application/vnd.github+json, application/json",
        "User-Agent": USER_AGENT,
    }
    if token := os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    with urlopen(Request(url, headers=headers), timeout=TIMEOUT_SECONDS) as response:
        return json.load(response)


def stable_version(value: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", value)
    if not match:
        raise ValueError(f"not a stable semantic version: {value}")
    return tuple(int(part) for part in match.groups())


def latest_github_release(repo: str) -> str:
    payload = fetch_json(f"https://api.github.com/repos/{repo}/releases/latest")
    assert isinstance(payload, dict)
    return str(payload["tag_name"]).removeprefix("v")


def latest_npm(package: str) -> str:
    payload = fetch_json(f"https://registry.npmjs.org/{package}/latest")
    assert isinstance(payload, dict)
    return str(payload["version"])


def latest_python() -> str:
    payload = fetch_json(
        "https://www.python.org/api/v2/downloads/release/?is_published=true"
    )
    assert isinstance(payload, list)
    releases: list[tuple[tuple[int, int, int], str]] = []
    for release in payload:
        if not isinstance(release, dict) or release.get("pre_release"):
            continue
        name = str(release.get("name", ""))
        if not name.startswith("Python "):
            continue
        version = name.removeprefix("Python ")
        try:
            releases.append((stable_version(version), version))
        except ValueError:
            continue
    if not releases:
        raise RuntimeError("python.org returned no stable Python releases")
    return max(releases)[1]


def latest_node() -> str:
    payload = fetch_json("https://nodejs.org/dist/index.json")
    assert isinstance(payload, list)
    releases: list[tuple[tuple[int, int, int], str]] = []
    for release in payload:
        if not isinstance(release, dict):
            continue
        version = str(release.get("version", ""))
        try:
            releases.append((stable_version(version), version.removeprefix("v")))
        except ValueError:
            continue
    if not releases:
        raise RuntimeError("nodejs.org returned no stable Node.js releases")
    return max(releases)[1]


def latest_pypi(package: str) -> str:
    payload = fetch_json(f"https://pypi.org/pypi/{package}/json")
    assert isinstance(payload, dict)
    info = payload.get("info")
    assert isinstance(info, dict)
    return str(info["version"])


def latest_github_branch_commit(repo: str, branch: str) -> str:
    payload = fetch_json(f"https://api.github.com/repos/{repo}/commits/{branch}")
    assert isinstance(payload, dict)
    return str(payload["sha"])


def local_ruff_version() -> str:
    workflow = (ROOT / ".github/workflows/pages.yml").read_text(encoding="utf-8")
    match = re.search(
        r"astral-sh/ruff-action@[^\n]+(?:\n[^\n]+){0,6}\n\s+version:\s+[\"']?([^\"'\n]+)",
        workflow,
    )
    if not match:
        raise RuntimeError("could not find the pinned Ruff version in pages.yml")
    return match.group(1).strip()


def paper_mod_commit() -> str:
    return subprocess.run(
        ["git", "-C", str(ROOT / "themes/PaperMod"), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def main() -> int:
    dependencies = tomllib.loads(
        (ROOT / "data/dependencies.toml").read_text(encoding="utf-8")
    )

    current: dict[str, str] = {
        "Hugo": (ROOT / ".hugo-version").read_text(encoding="utf-8").strip(),
        "Python": (ROOT / ".python-version").read_text(encoding="utf-8").strip(),
        "Node.js": (ROOT / ".node-version").read_text(encoding="utf-8").strip(),
        "Ruff": local_ruff_version(),
        "Mermaid": str(dependencies["mermaid"]["version"]),
        "Fuse.js": str(dependencies["fuse"]["version"]),
        "PaperMod": paper_mod_commit(),
    }
    latest: dict[str, str] = {
        "Hugo": latest_github_release("gohugoio/hugo"),
        "Python": latest_python(),
        "Node.js": latest_node(),
        "Ruff": latest_pypi("ruff"),
        "Mermaid": latest_npm("mermaid"),
        "Fuse.js": latest_npm("fuse.js"),
        "PaperMod": latest_github_branch_commit(
            "adityatelange/hugo-PaperMod", "master"
        ),
    }

    stale: list[str] = []
    for name in current:
        ok = current[name].removeprefix("v") == latest[name].removeprefix("v")
        marker = "OK" if ok else "OUTDATED"
        print(f"{marker:8} {name:12} pinned={current[name]} latest={latest[name]}")
        if not ok:
            stale.append(name)

    if stale:
        print(
            "Outdated direct dependencies: " + ", ".join(stale),
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Dependency audit failed: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
