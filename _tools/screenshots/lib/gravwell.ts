// Small helpers for the Gravwell REST API. Setup uses these to get a fresh
// instance into a known state before any screenshots are taken.
import { expect, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import { WINDOW, type ToyEntry } from './toydata';

export const ADMIN = { user: 'admin', pass: 'changeme' };

export async function waitForGravwell(request: APIRequestContext): Promise<string> {
	let version = '';
	await expect
		.poll(
			async () => {
				const res = await request.get('/api/version').catch(() => null);
				if (!res?.ok()) return false;
				const { Build } = await res.json();
				version = `${Build.Major}.${Build.Minor}.${Build.Point}`;
				return true;
			},
			{ timeout: 60_000, message: 'Gravwell never came up' },
		)
		.toBe(true);
	return version;
}

/**
 * Install a license if Gravwell is waiting for one. With no GRAVWELL_LICENSE
 * we use the Free tier, which needs no license file at all.
 */
export async function ensureLicense(request: APIRequestContext): Promise<void> {
	const status = await (await request.get('/api/license/status')).json();
	if (status.status !== 'waiting for license') return;

	const file = process.env.GRAVWELL_LICENSE;
	const buffer = file ? fs.readFileSync(file) : Buffer.from('UNLICENSED');
	const res = await request.post('/api/license/update', {
		multipart: { file: { name: 'license', mimeType: 'text/plain', buffer } },
	});
	expect(res.ok(), `license upload failed: ${await res.text()}`).toBe(true);

	// Gravwell restarts parts of itself after licensing, so expect refused connections for a bit.
	await expect
		.poll(async () => (await request.get('/api/license/status').then(r => r.json()).catch(() => null))?.status, {
			timeout: 60_000,
		})
		.toBe('done');
}

export async function login(request: APIRequestContext): Promise<string> {
	let jwt = '';
	await expect
		.poll(
			async () => {
				const res = await request
					.post('/api/login', { data: { User: ADMIN.user, Pass: ADMIN.pass } })
					.catch(() => null);
				jwt = res?.ok() ? (await res.json()).JWT : '';
				return !!jwt;
			},
			{ timeout: 60_000, message: 'could not log in as admin' },
		)
		.toBe(true);
	return jwt;
}

/** Ingest toy entries once. Skips if the tags already exist (e.g. a reused container). */
export async function seed(request: APIRequestContext, jwt: string, entries: ToyEntry[]): Promise<void> {
	const headers = { Authorization: `Bearer ${jwt}` };
	const tags = [...new Set(entries.map(e => e.Tag))];
	const known: string[] = await (await request.get('/api/tags', { headers })).json();

	if (!tags.every(t => known.includes(t))) {
		for (let i = 0; i < entries.length; i += 500) {
			const res = await request.put('/api/ingest/json', { headers, data: entries.slice(i, i + 500) });
			expect(res.ok(), `ingest failed: ${await res.text()}`).toBe(true);
		}
	}

	// Wait until every entry is searchable inside the window.
	await expect
		.poll(
			async () => {
				const res = await request.post('/api/search/direct', {
					headers,
					data: {
						SearchString: `tag=${tags.join(',')}`,
						SearchStart: WINDOW.start.toISOString(),
						SearchEnd: WINDOW.end.toISOString(),
						Format: 'text',
					},
				});
				return res.ok() ? (await res.text()).trim().split('\n').length : 0;
			},
			{ timeout: 60_000, message: 'toy data never became searchable' },
		)
		.toBe(entries.length);
}
