import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: '.',
	outputDir: './test-results',
	// Shots share one Gravwell and some change its state, so run them in order.
	workers: 1,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	reporter: [['list']],
	use: {
		baseURL: process.env.GRAVWELL_URL ?? 'http://localhost:8080',
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 2,
		colorScheme: 'dark',
		locale: 'en-US',
		timezoneId: 'UTC',
		trace: 'retain-on-failure',
	},
	projects: [
		{ name: 'setup', testMatch: 'setup/*.setup.ts' },
		{
			name: 'shots',
			testMatch: 'shots/**/*.spec.ts',
			dependencies: ['setup'],
			use: { storageState: '.state/admin.json' },
		},
	],
});
