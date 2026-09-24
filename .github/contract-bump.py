#!/usr/bin/env python3
"""Gate on oasdiff's version policy, and warn about the breaks themselves.

oasdiff keeps a breaking change at ERR even after a correct 0.x minor bump,
so --fail-on ERR cannot accept that bump. The version checks are the policy:
api-version-not-bumped, api-version-decreased, api-major-version-not-bumped.
Below 1.0.0, oasdiff treats a minor bump as enough. Other changes are printed
as warnings.
"""

import json
import subprocess
import sys
from pathlib import Path

VERSION_IDS = {
    "api-version-not-bumped",
    "api-version-decreased",
    "api-major-version-not-bumped",
}


def info_version(path: Path) -> str:
    in_info = False
    for line in path.read_text().splitlines():
        if line == "info:":
            in_info = True
            continue
        if in_info and line.startswith("  version:"):
            return line.split(":", 1)[1].strip().strip("'\"")
        if in_info and line and not line.startswith(" "):
            break
    raise SystemExit(f"no info.version in {path}")


def pkg_version(path: Path) -> str:
    return json.loads(path.read_text())["version"]


def main() -> None:
    base_yaml, rev_yaml, base_pkg, rev_pkg = map(Path, sys.argv[1:5])
    base_info, rev_info = info_version(base_yaml), info_version(rev_yaml)
    base_pkg_v, rev_pkg_v = pkg_version(base_pkg), pkg_version(rev_pkg)
    if rev_info != rev_pkg_v:
        raise SystemExit(f"revision info.version {rev_info} != package.json {rev_pkg_v}")
    if base_info != base_pkg_v:
        raise SystemExit(f"base info.version {base_info} != package.json {base_pkg_v}")

    plain = Path("/tmp/oasdiff-plain.yaml")
    plain.write_text("fail-on: ERR\n")
    levels = Path(__file__).with_name("oasdiff-levels.txt")
    probe = subprocess.run(
        [
            "oasdiff",
            "breaking",
            str(base_yaml),
            str(rev_yaml),
            "--config",
            str(plain),
            "--severity-levels",
            str(levels),
            "--format",
            "json",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if probe.returncode not in (0, 1):
        sys.stderr.write(probe.stderr)
        raise SystemExit(probe.returncode or 1)
    changes = json.loads(probe.stdout or "[]")
    blocked = []
    for change in changes:
        where = " ".join(
            part for part in (change.get("operation") or "", change.get("path") or "") if part
        )
        text = change.get("text") or change["id"]
        line = f"{where} {text}".strip() if where else text
        if change["id"] in VERSION_IDS:
            blocked.append(line)
        else:
            print(f"::warning::{line}")
    if blocked:
        for line in blocked:
            print(f"::error::{line}", file=sys.stderr)
        raise SystemExit(1)
    if changes:
        print(f"breaking changes warned; version {base_info} -> {rev_info} satisfies oasdiff")
    else:
        print(f"no breaking changes ({base_info})")


if __name__ == "__main__":
    main()
