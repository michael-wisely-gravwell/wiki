// Screenshots for flows/editor.md
import { expect, type Page } from '@playwright/test';
import { annotate, shot } from '../lib/shot';

/** Open the "Query Alert Flow" starter flow in the editor. */
async function openStarterFlow(page: Page) {
	await page.goto('/flows/queryAlertEmail');
	await expect(page.locator('[data-test="flow-node"]')).toHaveCount(5);
}

shot(
	'flows/create-flow.png',
	async page => {
		await page.goto('/flows');
		await page.locator('[data-test="add-flow-btn"]').click();
		const menu = page.locator('.context-menu').filter({ hasText: 'New blank flow' });
		await expect(menu).toBeVisible();
		await annotate(page, [{ target: menu }]);
	},
	// Just tall enough for the starter flows.
	{ viewport: { width: 1440, height: 600 } },
);

shot('flows/editor.png', async page => {
	await openStarterFlow(page);
	await annotate(page, [
		{ target: page.locator('gw-flow-editor-toolbar'), label: 'Toolbar', side: 'right' },
		{ target: page.locator('gw-flows-graph-editor'), label: 'Canvas', side: 'inside' },
		{ target: page.locator('[data-test="node-palette-pane"]'), label: 'Palette', side: 'left' },
		{ target: page.locator('gw-flows-error-console'), label: 'Console', side: 'top' },
	]);
});

shot('flows/settings-button.png', async page => {
	await openStarterFlow(page);
	const settings = page.getByRole('button', { name: 'Settings', exact: true });
	await annotate(page, [{ target: settings }]);
	return page.locator('gw-flow-editor-toolbar');
});
