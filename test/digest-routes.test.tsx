import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { DigestResult } from '../src/digest/types.js';

const night = '2026-10-28';
const temporaryRunsDirs: string[] = [];

function runsFile(contents: string): string {
  const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  temporaryRunsDirs.push(runsDir);
  writeFileSync(join(runsDir, `${night}.jsonl`), contents);
  return runsDir;
}

function appFor(runsDir: string) {
  const config: RigConfig = {
    adapter: 'test',
    installed: 'test',
    beatEverySeconds: 60,
    runsDir,
  };
  return createApp(config);
}

function event(job: string, at: string, overrides: Record<string, unknown> = {}) {
  return { at, job, status: 'ok', owner: 'rook', ...overrides };
}

afterEach(() => {
  for (const runsDir of temporaryRunsDirs.splice(0)) {
    rmSync(runsDir, { recursive: true, force: true });
  }
});

describe('digest routes', () => {
  it('reads real JSONL through both routes, keeps valid rows around malformed lines, and renders the same sorted result', async () => {
    const runsDir = runsFile([
      JSON.stringify(event('zeta', '2026-10-29T01:00:00+01:00', { status: 'retry' })),
      JSON.stringify(event('middle', '2026-10-29T01:10:00+01:00')),
      'not json',
      JSON.stringify(event('alpha', '2026-10-29T01:30:00+01:00', { owner: null })),
      JSON.stringify(event('zeta', '2026-10-29T01:01:00+01:00', { status: 'retry' })),
      JSON.stringify(event('zeta', '2026-10-29T01:02:00+01:00', { status: 'retry' })),
      JSON.stringify(event('alpha', '2026-10-29T01:32:00+01:00', {
        status: 'fail', owner: null, error: 'quota exceeded',
      })),
      JSON.stringify(event('zeta', '2026-10-29T01:03:00+01:00')),
    ].join('\n'));
    const app = appFor(runsDir);

    const apiResponse = await app.request(`/api/digest/${night}`);
    const pageResponse = await app.request(`/digest/${night}`);
    expect(apiResponse.status).toBe(200);
    expect(pageResponse.status).toBe(200);

    const result = await apiResponse.json() as DigestResult;
    expect(result).toEqual({
      night,
      invalidLines: 1,
      totals: { ok: 3, retry: 3, fail: 1 },
      rows: [
        {
          job: 'alpha', owner: null, runs: 2, retries: 0,
          lastStatus: 'fail', lastError: 'quota exceeded', hasFailed: true,
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:32:00+01:00',
        },
        {
          job: 'middle', owner: 'rook', runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null, hasFailed: false,
          firstAt: '2026-10-29T01:10:00+01:00', lastAt: '2026-10-29T01:10:00+01:00',
        },
        {
          job: 'zeta', owner: 'rook', runs: 4, retries: 3,
          lastStatus: 'ok', lastError: null, hasFailed: false,
          firstAt: '2026-10-29T01:00:00+01:00', lastAt: '2026-10-29T01:03:00+01:00',
        },
      ],
    });

    const html = await pageResponse.text();
    expect(html).toContain('1 invalid line skipped');
    expect(html).toContain('quota exceeded');
    expect(html).toContain('—');
    // The failed row and the row with exactly three retries are marked; the
    // ordinary row remains unmarked. JSON order and rendered table order match.
    expect([...html.matchAll(/<tr class="warn">/g)]).toHaveLength(2);
    const tableRows = [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)][0]?.[1] ?? '';
    const renderedJobs = [...tableRows.matchAll(/<tr(?: class="warn")?><td>([^<]*)<\/td>/g)]
      .map((match) => match[1]);
    expect(renderedJobs).toEqual(result.rows.map((row) => row.job));
    expect(html.indexOf('2026-10-29T01:30:00+01:00')).toBeGreaterThan(-1);
    expect(html.indexOf('2026-10-29T01:32:00+01:00')).toBeGreaterThan(-1);
  });

  it('returns 404 from both routes when the night file is missing', async () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-missing-'));
    temporaryRunsDirs.push(runsDir);
    const app = appFor(runsDir);
    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    expect(page.status).toBe(404);
    expect(api.status).toBe(404);
  });

  it('serves an empty file as an empty digest and says nothing ran on the page', async () => {
    const app = appFor(runsFile(''));
    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(await page.text()).toContain('nothing ran');
    expect(await api.json()).toEqual({
      night,
      rows: [],
      invalidLines: 0,
      totals: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('keeps malicious log text in JSON and escapes it in server-rendered HTML', async () => {
    const maliciousJob = '<script>alert(1)</script>';
    const maliciousOwner = '<img src=x onerror=alert(1)>';
    const maliciousError = '<svg/onload=alert(1)>';
    const app = appFor(runsFile(JSON.stringify(event(maliciousJob, '2026-10-29T01:00:00+01:00', {
      owner: maliciousOwner,
      error: maliciousError,
    }))));

    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    const result = await api.json() as DigestResult;
    expect(result.rows[0]).toMatchObject({
      job: maliciousJob,
      owner: maliciousOwner,
      lastError: maliciousError,
    });

    const html = await page.text();
    expect(html).not.toContain(maliciousJob);
    expect(html).not.toContain(maliciousOwner);
    expect(html).not.toContain(maliciousError);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;svg/onload=alert(1)&gt;');
  });
});
