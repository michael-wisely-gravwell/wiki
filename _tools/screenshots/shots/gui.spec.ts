// Screenshots for gui/gui.md
import { expect, type Locator, type Page } from '@playwright/test';
import { annotate, setText, shot } from '../lib/shot';
import { WINDOW } from '../lib/toydata';

const topIcons = (page: Page) => ['Help', 'Timeframe Locking', 'Notifications', 'Account'].map(name => page.getByRole('button', { name }));

const nav = (page: Page) => page.locator('gw-global-nav');

/** The tabs plus what's in the panel, so we don't capture the empty space beside the form. */
const tabContents = (page: Page, panel: Locator) => [
	page.getByRole('tab'),
	panel.getByRole('group'),
	panel.getByRole('heading'),
	panel.getByRole('listitem'),
	panel.getByRole('button'),
];

shot('gui/searchpage.png', async page => {
	const query = 'tag=weblogs json status | count by status | table';
	await page.goto(`/search?q=${encodeURIComponent(query)}&start=${WINDOW.start.toISOString()}&end=${WINDOW.end.toISOString()}`);
	await page.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(page.getByRole('gridcell', { name: '404', exact: true })).toBeVisible();

	await annotate(page, [
		{ target: page.getByRole('button', { name: 'Navigation' }), label: 'Main menu', offset: 40 },
		{ target: page.getByRole('button', { name: /^\d+\/\d+\/\d+ .* - / }), label: 'Timeframe' },
		{ target: page.getByRole('button', { name: 'Search', exact: true }), label: 'Search' },
		{ target: topIcons(page), label: 'Help, timeframe locking, notifications, account', side: 'left' },
	]);
});

shot('gui/menu.png', async page => {
	await page.goto('/query-studio');
	await page.getByRole('button', { name: 'Navigation' }).click();
	return nav(page);
});

shot(
	'gui/menu-expanded.png',
	async page => {
		await page.goto('/query-studio');
		await page.getByRole('button', { name: 'Navigation' }).click();
		for (const section of ['Automation', 'Tools & Resources', 'Systems & Health', 'Administrator']) {
			await nav(page).getByRole('heading', { name: section }).click();
		}
		return nav(page);
	},
	{ viewport: { width: 1440, height: 1800 } },
);

shot('gui/user-dropdown.png', async page => {
	await page.goto('/query-studio');
	await page.getByRole('button', { name: 'Account' }).click();
	const dropdown = page.locator('div.menu').filter({ hasText: 'Logged in as' });
	await expect(dropdown).toBeVisible();
	return [...topIcons(page), dropdown];
});

shot(
	'gui/account-prefs.png',
	async page => {
		await page.goto('/account');
		const panel = page.getByRole('tabpanel', { name: 'Account' });
		// The session list shows when and where you logged in from, and setup
		// logs in more than once. Show one fixed session.
		const sessions = panel.getByRole('listitem');
		await expect(sessions.first()).toContainText('Active');
		await sessions.evaluateAll(items => items.slice(1).forEach(item => item.remove()));
		await setText(sessions.first(), 'Active a few seconds ago from 10.0.0.5');
		return tabContents(page, panel);
	},
	{ viewport: { width: 1440, height: 1400 }, pad: 24 },
);

shot(
	'gui/general-prefs.png',
	async page => {
		await page.goto('/account?tab=preferences');
		const panel = page.getByRole('tabpanel', { name: 'Preferences' });
		await expect(panel.getByRole('combobox', { name: 'Interface theme' })).toBeVisible();
		return tabContents(page, panel);
	},
	{ viewport: { width: 1440, height: 1800 }, pad: 24 },
);
