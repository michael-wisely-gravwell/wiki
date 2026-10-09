#!/usr/bin/env python3
"""List every screenshot in the wiki and how stale it is.

For each image this reports its size, which docs use it, when its pixels last
changed in git (following pure renames), how many releases have shipped since,
and whether a Playwright recipe in shots/ can regenerate it.

Examples:

    ./_tools/screenshots/inventory.py                  # summary
    ./_tools/screenshots/inventory.py gui flows        # only these folders
    ./_tools/screenshots/inventory.py --format csv > inventory.csv
    ./_tools/screenshots/inventory.py --format json --no-recipe

Only the standard library is used, so this runs in the nix-shell as-is.
"""

import argparse
import csv
import json
import os
import re
import statistics
import struct
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

IMAGE_EXTS = {".png", ".gif", ".jpg", ".jpeg"}
SKIP_DIRS = {"_build", "node_modules", "result", "test-results", "playwright-report"}
RELEASE_TAG = re.compile(r"^v\d+\.\d+\.\d+$")

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS_DIR = os.path.join(HERE, "shots")

# ![alt](src "title")
MD_IMAGE = re.compile(r"!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
# ```{image} src   or   :::{figure} src
DIRECTIVE = re.compile(r"^\s*(`{3,}|:{3,})\{(?:image|figure)\}\s+(\S+)")
DIRECTIVE_ALT = re.compile(r"^\s*:alt:\s*(.*)$")
HTML_IMG = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
HTML_ATTR = re.compile(r"""\b(src|alt)\s*=\s*["']([^"']*)["']""", re.IGNORECASE)
# shot("gui/menu.png", ...) in a recipe file
RECIPE = re.compile(r"""\bshot\(\s*["'`]([^"'`]+)["'`]""")


@dataclass
class Image:
    path: str
    bytes: int
    width: int | None = None
    height: int | None = None
    last_changed: str | None = None
    commit: str | None = None
    age_days: int | None = None
    releases_since: int | None = None
    refs: list[str] = field(default_factory=list)
    missing_alt: int = 0
    recipe: str | None = None
    gravwell_version: str | None = None


def git(repo, *args):
    return subprocess.run(
        ["git", "-C", repo, *args], check=True, capture_output=True, text=True
    ).stdout


def walk(root, exts):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(
            d for d in dirnames if not d.startswith(".") and d not in SKIP_DIRS
        )
        for name in sorted(filenames):
            if os.path.splitext(name)[1].lower() in exts:
                yield os.path.relpath(os.path.join(dirpath, name), root)


def image_info(abspath):
    """Return (width, height, text chunks) without decoding the image."""
    with open(abspath, "rb") as f:
        head = f.read(32)
        if head.startswith(b"\x89PNG\r\n\x1a\n"):
            width, height = struct.unpack(">II", head[16:24])
            return width, height, png_text(f)
        if head[:6] in (b"GIF87a", b"GIF89a"):
            width, height = struct.unpack("<HH", head[6:10])
            return width, height, {}
        if head.startswith(b"\xff\xd8"):
            f.seek(2)
            return (*jpeg_size(f), {})
    return None, None, {}


def png_text(f):
    """Read tEXt chunks that come before the image data."""
    text = {}
    f.seek(8)
    while True:
        header = f.read(8)
        if len(header) < 8:
            break
        length, kind = struct.unpack(">I4s", header)
        if kind in (b"IDAT", b"IEND"):
            break
        data = f.read(length)
        f.seek(4, os.SEEK_CUR)  # CRC
        if kind == b"tEXt" and b"\0" in data:
            key, value = data.split(b"\0", 1)
            text[key.decode("latin-1")] = value.decode("latin-1")
    return text


def jpeg_size(f):
    while True:
        marker = f.read(2)
        if len(marker) < 2 or marker[0] != 0xFF:
            return None, None
        (length,) = struct.unpack(">H", f.read(2))
        if marker[1] in range(0xC0, 0xD0) and marker[1] not in (0xC4, 0xC8, 0xCC):
            height, width = struct.unpack(">xHH", f.read(5))
            return width, height
        f.seek(length - 2, os.SEEK_CUR)


def find_refs(root):
    """Map image path -> list of (doc:line, has_alt) for every doc reference."""
    refs = defaultdict(list)
    for doc in walk(root, {".md"}):
        docdir = os.path.dirname(doc)
        with open(os.path.join(root, doc), encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()

        def add(src, alt, lineno):
            src = src.split("#", 1)[0].split("?", 1)[0]
            if not src or "://" in src or src.startswith("data:"):
                return
            if src.startswith("/"):
                target = os.path.normpath(src.lstrip("/"))
            else:
                target = os.path.normpath(os.path.join(docdir, src))
            if os.path.splitext(target)[1].lower() in IMAGE_EXTS:
                refs[target].append((f"{doc}:{lineno}", bool(alt.strip())))

        for i, line in enumerate(lines, 1):
            for alt, src in MD_IMAGE.findall(line):
                add(src, alt, i)
            for tag in HTML_IMG.findall(line):
                attrs = {k.lower(): v for k, v in HTML_ATTR.findall(tag)}
                if "src" in attrs:
                    add(attrs["src"], attrs.get("alt", ""), i)
            m = DIRECTIVE.match(line)
            if m:
                fence, alt = m.group(1), ""
                for opt in lines[i:]:
                    if opt.strip().startswith(fence[:3]):
                        break
                    a = DIRECTIVE_ALT.match(opt)
                    if a:
                        alt = a.group(1)
                add(m.group(2), alt, i)
    return refs


def find_recipes(root):
    recipes = {}
    if not os.path.isdir(SHOTS_DIR):
        return recipes
    for spec in walk(SHOTS_DIR, {".ts", ".js"}):
        with open(os.path.join(SHOTS_DIR, spec), encoding="utf-8") as f:
            for target in RECIPE.findall(f.read()):
                recipes[os.path.normpath(target)] = os.path.relpath(
                    os.path.join(SHOTS_DIR, spec), root
                )
    return recipes


def last_changes(root, paths):
    """Map each path to (iso date, short sha) of the last commit that changed it.

    Walks history newest first. A 100% rename just moves the file, so we keep
    following it under its old name. Anything else counts as a change.
    """
    pending = defaultdict(list)  # name in history -> current paths
    for p in paths:
        pending[p].append(p)
    found = {}
    log = git(root, "log", "-M", "--name-status", "--format=%x00%h %aI")
    for block in log.split("\0")[1:]:
        header, *entries = block.strip("\n").split("\n")
        sha, date = header.split(" ", 1)
        for entry in filter(None, entries):
            status, *names = entry.split("\t")
            kind = status[:1]
            if kind in "AM" and names[0] in pending:
                for p in pending.pop(names[0]):
                    found[p] = (date, sha)
            elif kind in "RC" and names[1] in pending:
                current = pending.pop(names[1])
                if status[1:] == "100":
                    pending[names[0]].extend(current)
                else:
                    for p in current:
                        found[p] = (date, sha)
        if not pending:
            break
    return found


def release_dates(root):
    out = git(
        root, "for-each-ref", "refs/tags", "--format=%(refname:short)\t%(creatordate:iso-strict)"
    )
    dates = []
    for line in out.splitlines():
        tag, date = line.split("\t")
        if RELEASE_TAG.match(tag):
            dates.append(datetime.fromisoformat(date))
    return sorted(dates)


def build(root, prefixes):
    paths = [
        p
        for p in walk(root, IMAGE_EXTS)
        if not prefixes or any(p.startswith(pre) for pre in prefixes)
    ]
    refs = find_refs(root)
    recipes = find_recipes(root)
    changes = last_changes(root, paths)
    releases = release_dates(root)
    now = datetime.now(timezone.utc)

    images = []
    for p in paths:
        width, height, text = image_info(os.path.join(root, p))
        img = Image(p, os.path.getsize(os.path.join(root, p)), width, height)
        img.refs = [where for where, _ in refs.get(p, [])]
        img.missing_alt = sum(1 for _, has_alt in refs.get(p, []) if not has_alt)
        img.recipe = recipes.get(p)
        img.gravwell_version = text.get("gravwell-version")
        if p in changes:
            date, img.commit = changes[p]
            changed = datetime.fromisoformat(date)
            img.last_changed = changed.date().isoformat()
            img.age_days = (now - changed).days
            img.releases_since = sum(1 for r in releases if r > changed)
        images.append(img)

    known = set(walk(root, IMAGE_EXTS))
    broken = sorted(
        (where, target)
        for target, places in refs.items()
        if target not in known and (not prefixes or any(target.startswith(pre) for pre in prefixes))
        for where, _ in places
    )
    return images, broken, recipes


def summary(root, images, broken, recipes, out):
    head = git(root, "rev-parse", "--abbrev-ref", "HEAD").strip()
    sha = git(root, "rev-parse", "--short", "HEAD").strip()
    total = sum(i.bytes for i in images)
    unreferenced = [i for i in images if not i.refs]
    stale_recipes = sorted(set(recipes) - {i.path for i in images})

    w = out.write
    w(f"Screenshot inventory for {head} @ {sha}\n\n")
    w(f"  images            {len(images):>6}  ({total / 1e6:.1f} MB)\n")
    w(f"  with a recipe     {sum(1 for i in images if i.recipe):>6}\n")
    w(f"  not referenced    {len(unreferenced):>6}\n")
    w(f"  refs missing alt  {sum(i.missing_alt for i in images):>6}\n")
    w(f"  broken refs       {len(broken):>6}\n")
    if git(root, "rev-parse", "--is-shallow-repository").strip() == "true":
        w("\n  warning: shallow clone, so ages are wrong. Fetch full history.\n")

    w("\nLast changed\n")
    years = Counter((i.last_changed or "untracked")[:4] for i in images)
    for year in sorted(years):
        w(f"  {year:<9} {years[year]:>5}  {'#' * max(1, years[year] // 10)}\n")

    w("\nBy folder\n")
    w(f"  {'folder':<16} {'images':>6} {'recipes':>7} {'median age':>11} {'releases':>9}  oldest\n")
    folders = defaultdict(list)
    for i in images:
        folders[i.path.split(os.sep, 1)[0]].append(i)
    for name, group in sorted(folders.items(), key=lambda kv: -len(kv[1])):
        ages = [i.age_days for i in group if i.age_days is not None]
        rels = [i.releases_since for i in group if i.releases_since is not None]
        dates = [i.last_changed for i in group if i.last_changed]
        w(
            f"  {name:<16} {len(group):>6} {sum(1 for i in group if i.recipe):>7}"
            f" {(f'{statistics.median(ages):.0f} d' if ages else '-'):>11}"
            f" {(f'{statistics.median(rels):.0f}' if rels else '-'):>9}"
            f"  {min(dates) if dates else '-'}\n"
        )

    if broken:
        w("\nBroken refs (doc points at a missing image)\n")
        for where, target in broken:
            w(f"  {where} -> {target}\n")
    if stale_recipes:
        w("\nRecipes for images that don't exist\n")
        for target in stale_recipes:
            w(f"  {target} ({recipes[target]})\n")
    w("\nUse --format csv or --format json for per-image rows.\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("prefixes", nargs="*", help="only include images under these paths")
    parser.add_argument("--format", choices=["summary", "csv", "json"], default="summary")
    parser.add_argument("--no-recipe", action="store_true", help="only images without a recipe")
    parser.add_argument("--unreferenced", action="store_true", help="only images no doc uses")
    parser.add_argument("--older-than", type=int, metavar="DAYS", help="only images older than DAYS")
    args = parser.parse_args()

    root = git(HERE, "rev-parse", "--show-toplevel").strip()
    prefixes = [os.path.normpath(p) for p in args.prefixes]
    images, broken, recipes = build(root, prefixes)

    if args.no_recipe:
        images = [i for i in images if not i.recipe]
    if args.unreferenced:
        images = [i for i in images if not i.refs]
    if args.older_than is not None:
        images = [i for i in images if i.age_days is not None and i.age_days > args.older_than]
    images.sort(key=lambda i: (-(i.age_days or 0), i.path))

    if args.format == "summary":
        summary(root, images, broken, recipes, sys.stdout)
    elif args.format == "json":
        json.dump([asdict(i) for i in images], sys.stdout, indent=2)
        sys.stdout.write("\n")
    else:
        rows = [asdict(i) for i in images]
        writer = csv.DictWriter(sys.stdout, fieldnames=list(Image.__dataclass_fields__))
        writer.writeheader()
        for row in rows:
            row["refs"] = ";".join(row["refs"])
            writer.writerow(row)


if __name__ == "__main__":
    main()
