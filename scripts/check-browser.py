"""Run the optional local Ego browser suite with explicit runtime paths."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--space-id", type=int, help="Reuse an existing Ego task space")
    parser.add_argument(
        "--url", default="http://127.0.0.1:1313", help="Running Hugo preview"
    )
    args = parser.parse_args()
    executable = shutil.which("ego-browser")
    if not executable:
        parser.error("ego-browser is required for this optional suite")
    root = Path(__file__).resolve().parents[1]
    output = Path(tempfile.gettempdir()) / "kktae-blog-qa"
    output.mkdir(exist_ok=True)
    options = {
        "projectRoot": str(root),
        "outputDirectory": str(output),
        "baseURL": args.url.rstrip("/"),
    }
    if args.space_id is not None:
        options["spaceId"] = args.space_id
    script = "globalThis.blogCheck = " + json.dumps(options) + ";\n"
    script += (root / "scripts/browser-check.mjs").read_text(encoding="utf-8")
    subprocess.run([executable, "nodejs"], input=script, text=True, check=True)
    print(f"Browser evidence: {output}")


if __name__ == "__main__":
    main()
