// shot() turns a recipe into a screenshot in the wiki. A recipe gets the page
// into the right state and returns what to capture:
//
//   shot('gui/menu.png', async page => {
//   	await page.goto('/welcome');
//   	await page.getByRole('button', { name: 'Navigation' }).click();
//   	return page.locator('gw-global-nav');
//   });
//
// Return a locator (or several) to crop to them, or nothing for the viewport.
import { test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const TOOL_DIR = path.resolve(__dirname, '..');
export const WIKI_ROOT = path.resolve(TOOL_DIR, '../..');
export const STATE_DIR = path.join(TOOL_DIR, '.state');

// Applied while capturing only.
const CAPTURE_CSS = `
	/* The Free tier badge. Licensed installs don't show it. */
	a[href*="gravwell-license-types"] { display: none !important; }
`;

export type ShotOptions = {
	/** Use a different viewport, e.g. a tall one for a long menu. */
	viewport?: { width: number; height: number };
	/** Space around the cropped elements, in CSS pixels. */
	pad?: number;
};

type Target = Locator | Locator[] | void;

export function shot(image: string, recipe: (page: Page) => Promise<Target>, options: ShotOptions = {}): void {
	const recipeFile = callerFile();
	test(image, async ({ page }, testInfo) => {
		if (options.viewport) await page.setViewportSize(options.viewport);
		// Hide things up front too, so the layout recipes measure is the one we capture.
		await page.addInitScript(css => {
			document.addEventListener('DOMContentLoaded', () => {
				document.head.appendChild(document.createElement('style')).textContent = css;
			});
		}, CAPTURE_CSS);
		const target = await recipe(page);
		// Don't wait forever on pages that poll.
		await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

		const targets = target ? [target].flat() : [];
		const clip = targets.length
			? await region(page, [...targets, page.locator('#docs-annotations > *')], options.pad ?? 8)
			: undefined;
		const png = await page.screenshot({ clip, animations: 'disabled', caret: 'hide', style: CAPTURE_CSS });

		const stamped = withText(png, {
			'gravwell-version': gravwellVersion(),
			'screenshot-recipe': recipeFile,
		});
		const out = path.join(WIKI_ROOT, image);
		fs.mkdirSync(path.dirname(out), { recursive: true });
		fs.writeFileSync(out, stamped);
		await testInfo.attach(image, { body: stamped, contentType: 'image/png' });
	});
}

/** The smallest box that holds every visible match, plus padding, kept inside the viewport. */
async function region(page: Page, locators: Locator[], pad: number) {
	const boxes = [];
	for (const locator of locators) {
		for (const el of await locator.all()) {
			const box = await el.boundingBox();
			if (box) boxes.push(box);
		}
	}
	if (!boxes.length) throw new Error('nothing to capture: none of the returned elements are visible');

	const view = page.viewportSize()!;
	const x = Math.max(0, Math.min(...boxes.map(b => b.x)) - pad);
	const y = Math.max(0, Math.min(...boxes.map(b => b.y)) - pad);
	const right = Math.min(view.width, Math.max(...boxes.map(b => b.x + b.width)) + pad);
	const bottom = Math.min(view.height, Math.max(...boxes.map(b => b.y + b.height)) + pad);
	return { x, y, width: right - x, height: bottom - y };
}

export type Mark = {
	/** One element, or several to draw a single box around. */
	target: Locator | Locator[];
	label?: string;
	/** Where the label goes. Defaults to below. "inside" puts it in the top left corner. */
	side?: 'top' | 'bottom' | 'left' | 'right' | 'inside';
	/** Push the label this many pixels further out, with a line back to the box. */
	offset?: number;
};

/** Draw red boxes (and optional labels) around elements, like the hand-made screenshots do. */
export async function annotate(page: Page, marks: Mark[]): Promise<void> {
	for (const { target, label, side = 'bottom', offset = 0 } of marks) {
		const box = await region(page, [target].flat(), 0);
		await page.evaluate(
			({ box, label, side, offset }) => {
				const red = '#ff3b3b';
				const pad = 3;
				let layer = document.getElementById('docs-annotations');
				if (!layer) {
					layer = document.body.appendChild(document.createElement('div'));
					layer.id = 'docs-annotations';
					layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
				}
				const frame = layer.appendChild(document.createElement('div'));
				frame.style.cssText = `position:fixed;left:${box.x - pad}px;top:${box.y - pad}px;
					width:${box.width + pad * 2}px;height:${box.height + pad * 2}px;
					box-sizing:border-box;border:2px solid ${red};border-radius:4px`;
				if (!label) return;

				const text = layer.appendChild(document.createElement('div'));
				text.textContent = label;
				text.style.cssText = `position:fixed;color:${red};font:600 14px Roboto,Arial,sans-serif;
					white-space:nowrap;text-shadow:0 0 3px #000,0 0 3px #000`;
				const { width, height } = text.getBoundingClientRect();
				const gap = pad + 4 + offset;
				const centerX = box.x + box.width / 2 - width / 2;
				const centerY = box.y + box.height / 2 - height / 2;
				const spot = {
					top: [centerX, box.y - gap - height],
					bottom: [centerX, box.y + box.height + gap],
					left: [box.x - gap - width, centerY],
					right: [box.x + box.width + gap, centerY],
					inside: [box.x + 10, box.y + 8],
				}[side];
				const clamp = (n: number, max: number) => Math.min(Math.max(4, n), max - 4);
				text.style.left = `${clamp(spot[0], innerWidth - width)}px`;
				text.style.top = `${clamp(spot[1], innerHeight - height)}px`;

				if (offset && side !== 'inside') {
					const across = side === 'top' || side === 'bottom';
					const line = layer.appendChild(document.createElement('div'));
					const [x, y] = {
						top: [box.x + box.width / 2 - 1, box.y - pad - offset],
						bottom: [box.x + box.width / 2 - 1, box.y + box.height + pad],
						left: [box.x - pad - offset, box.y + box.height / 2 - 1],
						right: [box.x + box.width + pad, box.y + box.height / 2 - 1],
					}[side];
					line.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:${red};
						width:${across ? 2 : offset}px;height:${across ? offset : 2}px`;
				}
			},
			{ box, label, side, offset },
		);
	}
}

/** Replace text that changes between runs (IPs, "a few seconds ago") with something fixed. */
export async function setText(locator: Locator, text: string): Promise<void> {
	await locator.evaluate((el, text) => (el.textContent = text), text);
}

/** The spec file that called shot(). Playwright reports this file instead. */
function callerFile(): string {
	for (const line of (new Error().stack ?? '').split('\n')) {
		const match = line.match(/(\/[^\s():]+\.spec\.ts):\d+:\d+/);
		if (match) return path.relative(WIKI_ROOT, match[1]);
	}
	return 'unknown';
}

function gravwellVersion(): string {
	try {
		return JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'gravwell.json'), 'utf8')).version;
	} catch {
		return 'unknown';
	}
}

/** Add tEXt chunks right after IHDR. inventory.py reads them back. */
function withText(png: Buffer, text: Record<string, string>): Buffer {
	const afterHeader = 8 + 8 + 13 + 4; // signature, IHDR length+type, IHDR data, CRC
	const chunks = Object.entries(text).map(([key, value]) => {
		const body = Buffer.concat([Buffer.from('tEXt'), Buffer.from(`${key}\0${value}`, 'latin1')]);
		const length = Buffer.alloc(4);
		length.writeUInt32BE(body.length - 4);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(zlib.crc32(body));
		return Buffer.concat([length, body, crc]);
	});
	return Buffer.concat([png.subarray(0, afterHeader), ...chunks, png.subarray(afterHeader)]);
}
