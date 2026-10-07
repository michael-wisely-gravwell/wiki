# Screenshot automation plan

Screenshots make the docs much easier to follow, but they're hard to keep up to date. The goal is to regenerate them with code, and to know which ones are out of date.

## Where we are

From `inventory.py` on `next-major` (October 2026):

- 772 images, about 194 MB
- About 80% were last changed in 2023 or earlier. The biggest batch (241) came from one manual pass in January 2022.
- In the biggest folders (search, gui, flows, configuration), the median image is 70+ releases old
- 13 images aren't used by any doc, and 636 image references have no alt text
- About 30 images have hand-drawn red boxes or arrows

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

### 3. Only write images that changed

Compare new pixels to the committed image and skip the write when the difference is below a threshold. This keeps git history small and keeps `dedup-links` sharing identical images across doc versions.

### 4. Drift report

Add a check mode that captures everything but writes nothing, then reports how much each image changed. Combine that with the inventory (no recipe, N releases old) to get a to-do list.

### 5. Check the words, not just the pixels

Have recipes assert the labels the docs mention ("Query Studio", "Scheduled Searches"). If the GUI renames something, the recipe fails, which tells us the text is stale too. For example, `gui/gui.md` says you land on the search page after login, but 5.10 lands on the Welcome page.

### 6. GitHub Actions (last)

Once the steps above work locally:

- **Inventory on PRs.** Run `inventory.py` and fail on broken image references.
- **Regenerate on demand.** A manual workflow takes a docs branch and a Gravwell version, runs `run.sh`, and opens a PR with the changed images. Later, a Gravwell release could trigger it.
- **Scheduled drift report.** Run the check mode weekly against the latest Gravwell and post the results.

Notes: `ubuntu-latest` has Docker, and the Free tier means no secrets. The inventory needs full history (`fetch-depth: 0`).

## Open questions

- How should each docs branch pin its Gravwell version, and who bumps it?
- Is 2x scale right? It's sharp, but the files are bigger.
- The Free tier shows a "Non-Commercial Use Only" badge. We hide it with CSS, but should screenshots use a real license instead?
- Should we use the frontend's `gw-playwright` image instead of Microsoft's?
- Can the GUI team add `data-test` attributes where they're missing (top bar menus, account dropdown)?
