# Screenshots

Tools for keeping the screenshots in this repo up to date. See [PLAN.md](PLAN.md) for where this is headed.

- `inventory.py` lists every image, which docs use it, how old it is, and whether a recipe can regenerate it.
- `shots/` holds recipes. Each `shot()` call produces one image in the wiki.
- `run.sh` starts a throwaway Gravwell in Docker, loads toy data, runs the recipes, and tears it all down.

## Inventory

Needs only Python 3 and git (the nix-shell has both). It needs full git history, so don't use a shallow clone.

```
./_tools/screenshots/inventory.py                   # summary
./_tools/screenshots/inventory.py gui flows         # just these folders
./_tools/screenshots/inventory.py --format csv      # one row per image
./_tools/screenshots/inventory.py --no-recipe --older-than 365
```

## Taking screenshots

Needs Docker. Nothing else is installed on your machine.

```
./_tools/screenshots/run.sh                         # every recipe
./_tools/screenshots/run.sh shots/gui.spec.ts       # one file
./_tools/screenshots/run.sh -g menu                 # images matching "menu"
```

Images are written straight into the wiki, so `git diff` shows what changed.

Gravwell runs on the Free tier, so you don't need a license. To use one anyway (some features aren't in the Free tier), set `GRAVWELL_LICENSE=/path/to/license`. Set `GRAVWELL_VERSION` to use another `gravwell/gravwell` tag.

## Writing a recipe

Set `KEEP_GRAVWELL=1` to leave Gravwell running at <http://localhost:18080> (admin / changeme) so you can click around while you write.

```ts
shot('gui/menu.png', async page => {
	await page.goto('/query-studio');
	await page.getByRole('button', { name: 'Navigation' }).click();
	return page.locator('gw-global-nav'); // crop to this
});
```

- Return a locator, or a list of them, to crop to. Return nothing to capture the whole viewport.
- Query the toy data with `WINDOW` from `lib/toydata.ts`, not "last hour". The data is the same on every run, so the screenshots are too.
- Use `annotate()` for red boxes and labels, and `setText()` to pin things that change between runs, like IP addresses.
- Prefer roles and labels (`getByRole`) or the GUI's `data-test` attributes over CSS classes.
- Recipes run in order against one Gravwell, so clean up anything that would leak into the next shot.

Each image gets `gravwell-version` and `screenshot-recipe` PNG text chunks. `inventory.py` reports them.
