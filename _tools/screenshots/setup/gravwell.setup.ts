// Runs before every shot: license, toy data, and a logged-in browser session.
import { expect, test as setup } from '@playwright/test';
import fs from 'node:fs';
import { ADMIN, ensureLicense, login, seed, waitForGravwell } from '../lib/gravwell';
import { STATE_DIR } from '../lib/shot';
import { toyEntries } from '../lib/toydata';

setup('prepare gravwell', async ({ page, request }) => {
	setup.setTimeout(180_000);

	const version = await waitForGravwell(request);
	await ensureLicense(request);
	await seed(request, await login(request), toyEntries());

	await page.goto('/login');
	await page.getByRole('textbox', { name: 'Username' }).fill(ADMIN.user);
	await page.getByRole('textbox', { name: 'Password' }).fill(ADMIN.pass);
	await page.getByRole('button', { name: /Login/ }).click();
	await expect(page).not.toHaveURL(/\/login/);

	fs.mkdirSync(STATE_DIR, { recursive: true });
	await page.context().storageState({ path: `${STATE_DIR}/admin.json` });
	fs.writeFileSync(`${STATE_DIR}/gravwell.json`, JSON.stringify({ version }));
});
