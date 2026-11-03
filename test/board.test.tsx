import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { DigestResult } from '../src/digest/types.js';
import { readStatus } from '../src/status.js';
import { StatusBoard } from '../src/views/status.js';

describe('status board digests', () => {
  it('links each night and shows its event totals from the digest reader', async () => {
    const result: DigestResult = {
      night: '2026-10-28',
      rows: [],
      invalidLines: 0,
      totals: { ok: 12, retry: 3, fail: 1 },
    };
    const status = readStatus(
      { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' },
      (_runsDir, night) => night === result.night ? result : null,
    );
    const app = new Hono();
    app.get('/', (c) => c.html(<StatusBoard status={status} />));

    const html = await (await app.request('/')).text();
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html).toContain('ok 12 · retry 3 · fail 1');
    expect(html).toContain('href="/digest/2026-10-27"');
    expect(html).toContain('ok — · retry — · fail —');
  });
});
