# Screenshot automation plan

Screenshots make the docs much easier to follow, but they're hard to keep up to date. The goal is to regenerate them with code, and to know which ones are out of date.

## Where we are

From `inventory.py` on `next-major` (October 2026):

- 772 images, about 194 MB
- About 80% were last changed in 2023 or earlier. The biggest batch (241) came from one manual pass in January 2022.
- In the biggest folders (search, gui, flows, configuration), the median image is 70+ releases old
- 13 images aren't used by any doc, and 636 image references have no alt text
- About 30 images have hand-drawn red boxes or arrows

## Build size

The deployed site has every version in `_static/versions.json` (59 right now, back to v5.4.3). After all versions are built, `dedup-links` keeps one copy of each image and points every version at it. That works well today:

- Without dedup, images across all 59 versions would be about 11.1 GB. Dedup leaves 197 MB.
- Recent releases added under 2 MB of new images each, because few images changed.
- The v5.10.2 deploy uploaded 559 MB (compressed), and the build took 50 minutes. GitHub's documented limit for a published Pages site is 1 GB.

Regenerating screenshots puts this at risk. Old doc versions keep their own images, so every new image adds to the site. A pass that rewrites every image would add about a full set (170 to 200 MB) to the site and to git history. New images need to keep the same bytes unless the screen really changed, and they should be small. See phases 3 and 6.

## Approach

- **Recipes are Playwright tests.** They live in `_tools/screenshots/shots/`, one `shot()` per image. We picked this over a YAML manifest or recipes inside the Markdown because it's the simplest place to start.
- **A throwaway Gravwell.** `run.sh` starts `gravwell/gravwell` (pinned) with Docker Compose and removes it afterward. It uses the Free tier, so there's no license to manage. `GRAVWELL_LICENSE` is there for screens the Free tier can't show.
- **Toy data in a fixed window.** Setup ingests generated entries with a fixed seed, all stamped between 2026-01-15 09:00 and 17:00 UTC. Recipes query exactly that window. Two runs on fresh containers gave byte-for-byte identical images.
- **Same browser everywhere.** Playwright runs in Microsoft's Docker image, so fonts and rendering match on every laptop and in CI.
- **Annotations are drawn in the page.** `annotate()` adds red boxes and labels before capture, so they move with the UI.
- **Images say where they came from.** Each PNG gets `gravwell-version` and `screenshot-recipe` text chunks, which `inventory.py` reads back.

## Phases

### 1. Pilot (done)

- `inventory.py`
- Docker Compose, toy data, setup, and the `shot()` / `annotate()` helpers
- 9 recipes: 6 from `gui/gui.md` and 3 from `flows/editor.md`

### 2. More coverage

Work through the docs one section at a time, biggest and oldest first: search, flows, gui, configuration. Use the inventory to track progress. This will need more setup helpers:

- Notifications, including a critical one (`gui/notifications.png`, `gui/notif-warn.png`)
- Saved flows, flow debug runs, alerts, dashboards, macros, and kits
- A second user for screens that show sharing or permissions

Some images will stay manual: third-party screens (most of `integrations/`, Okta, AWS, Chrome settings) and diagrams (`architecture/`). Mark those in the inventory so they don't show up as missing recipes.

### 3. Only write images that changed, and keep them small

This keeps git history small and keeps `dedup-links` sharing identical images across doc versions (see Build size).

- **Skip unchanged images.** Capture, compress, then compare bytes with the committed image. If they differ, compare pixels and skip the write when the difference is below a threshold.
- **Capture only what the doc is about.** Use element screenshots, not the whole window, so a change to the top bar doesn't touch every image.
- **Hide things that change on their own.** Version strings, clocks, relative times, the "edited" badge.
- **Pin Gravwell and Playwright per docs branch.** A Chromium bump can shift antialiasing on every image, so the pixel threshold should ignore antialiasing.
- **Compress with pngquant and oxipng.** On the 9 pilot images:

| | Total |
|---|---|
| Committed originals | 1.44 MB |
| New captures at 2x | 1.28 MB |
| oxipng only (lossless) | 0.96 MB |
| pngquant (quality 80-95), then oxipng | 0.39 MB |

pngquant gave the same bytes on repeat runs, so dedup still works. The flow editor shot shows no visible quality loss. At that size, even a pass that changes every image would add roughly 30 to 50 MB.

### 4. Drift report

Add a check mode that captures everything but writes nothing, then reports how much each image changed. Combine that with the inventory (no recipe, N releases old) to get a to-do list.

### 5. Check the words, not just the pixels

Have recipes assert the labels the docs mention ("Query Studio", "Scheduled Searches"). If the GUI renames something, the recipe fails, which tells us the text is stale too. For example, `gui/gui.md` says you land on the search page after login, but 5.10 lands on the Welcome page.

### 6. GitHub Actions (last)

Once the steps above work locally:

- **Inventory on PRs.** Run `inventory.py` and fail on broken image references.
- **Image size check on PRs.** Compare the PR's image blob hashes with every version in `_static/versions.json` and report the new bytes. Git blob hashes match what `dedup-links` sees, so no build is needed. Warn above about 10 MB.
- **Regenerate on demand.** A manual workflow takes a docs branch and a Gravwell version, runs `run.sh`, and opens a PR with the changed images. Only allow `next-*` branches, never `release/*`, so old docs keep their old images. Later, a minor or major Gravwell release could trigger it.
- **Scheduled drift report.** Run the check mode weekly against the latest Gravwell and post the results.
- **Optional: oxipng in the deploy.** Run it in `build-html.yml` after `dedup-links`, on the ~780 images left. It's lossless and doesn't touch old branches. On today's hosted PNGs it went from 186 MB to 98 MB.

Notes: `ubuntu-latest` has Docker, and the Free tier means no secrets. The inventory needs full history (`fetch-depth: 0`).

## Open questions

- How should each docs branch pin its Gravwell version, and who bumps it?
- Is 2x scale right? It's sharp. With pngquant, 2x captures came out smaller than today's originals (phase 3), so size isn't a big reason to drop it.
- Should we host fewer versions? 49 of the 59 are patch releases (5.8 alone has 15). Keeping every patch of the current minor and the last patch of each older minor would be 9 versions. That would cut most of the deploy size and the 50-minute build. `404.html` could redirect links to dropped versions.
- The Free tier shows a "Non-Commercial Use Only" badge. We hide it with CSS, but should screenshots use a real license instead?
- Should we use the frontend's `gw-playwright` image instead of Microsoft's?
- Can the GUI team add `data-test` attributes where they're missing (top bar menus, account dropdown)?
