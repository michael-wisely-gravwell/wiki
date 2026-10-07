// Fake data for screenshots. Everything is generated from a fixed seed and
// stamped inside WINDOW, so the same query over WINDOW gives the same results
// on every run. Shots should query this window instead of "last hour".

export const WINDOW = {
	start: new Date('2026-01-15T09:00:00Z'),
	end: new Date('2026-01-15T17:00:00Z'),
};

export type ToyEntry = { TS: string; Tag: string; SRC: string; Data: string };

// mulberry32: small, fast and good enough for fake logs.
function rng(seed: number): () => number {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const HOSTS = ['web-01', 'web-02', 'api-01', 'db-01'];
const USERS = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];
const PATHS = ['/', '/login', '/search', '/dashboards', '/api/stats', '/api/users', '/static/app.js'];
const METHODS = ['GET', 'GET', 'GET', 'POST', 'PUT', 'DELETE'];
const STATUSES = [200, 200, 200, 200, 201, 304, 400, 401, 404, 500];
const AGENTS = ['Mozilla/5.0 (X11; Linux x86_64)', 'Mozilla/5.0 (Macintosh)', 'curl/8.5.0', 'python-requests/2.31'];

/** JSON web access logs (tag "weblogs") and syslog-style auth logs (tag "auth"). */
export function toyEntries(count = 2000, seed = 42): ToyEntry[] {
	const rand = rng(seed);
	const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
	const span = WINDOW.end.getTime() - WINDOW.start.getTime();
	const entries: ToyEntry[] = [];

	for (let i = 0; i < count; i++) {
		// Busier in the middle of the day, so charts have a shape.
		const t = (rand() + rand() + rand()) / 3;
		const ts = new Date(WINDOW.start.getTime() + Math.floor(t * span));
		const host = pick(HOSTS);
		const client = `10.0.${Math.floor(rand() * 4)}.${10 + Math.floor(rand() * 40)}`;
		const user = pick(USERS);

		if (rand() < 0.75) {
			const data = {
				time: ts.toISOString(),
				host,
				client,
				user,
				method: pick(METHODS),
				path: pick(PATHS),
				status: pick(STATUSES),
				bytes: 200 + Math.floor(rand() * 40000),
				duration_ms: Math.round(rand() * rand() * 900),
				agent: pick(AGENTS),
			};
			entries.push(entry(ts, 'weblogs', client, JSON.stringify(data)));
		} else {
			const ok = rand() < 0.8;
			const msg = ok
				? `Accepted publickey for ${user} from ${client} port ${40000 + Math.floor(rand() * 20000)} ssh2`
				: `Failed password for ${user} from ${client} port ${40000 + Math.floor(rand() * 20000)} ssh2`;
			const line = `<38>1 ${ts.toISOString()} ${host} sshd ${1000 + Math.floor(rand() * 9000)} - - ${msg}`;
			entries.push(entry(ts, 'auth', client, line));
		}
	}
	return entries.sort((a, b) => a.TS.localeCompare(b.TS));
}

function entry(ts: Date, tag: string, src: string, data: string): ToyEntry {
	return { TS: ts.toISOString(), Tag: tag, SRC: src, Data: Buffer.from(data).toString('base64') };
}
