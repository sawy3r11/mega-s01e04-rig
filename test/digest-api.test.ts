import { describe, expect, it, vi } from 'vitest';
import { createDigestApi } from '../src/digest/api.js';
import type { DigestResult, ReadNight } from '../src/digest/types.js';

const digest: DigestResult = {
  night: '2026-10-28',
  rows: [
    {
      job: 'alpha',
      owner: null,
      runs: 2,
      retries: 1,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-28T01:00:00+01:00',
      lastAt: '2026-10-28T01:05:00+01:00',
      hasFailed: false,
    },
    {
      job: 'zeta',
      owner: 'rook',
      runs: 1,
      retries: 0,
      lastStatus: 'fail',
      lastError: 'unavailable',
      firstAt: '2026-10-28T01:10:00+01:00',
      lastAt: '2026-10-28T01:10:00+01:00',
      hasFailed: true,
    },
  ],
  invalidLines: 1,
  totals: { ok: 2, retry: 1, fail: 1 },
};

describe('digest JSON API', () => {
  it('returns the injected digest unchanged as JSON', async () => {
    const readNight = vi.fn<ReadNight>(() => digest);
    const response = await createDigestApi('/runs', readNight).request('/2026-10-28');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual(digest);
    expect(readNight).toHaveBeenCalledWith('/runs', '2026-10-28');
  });

  it('returns 404 when the reader has no digest for the night', async () => {
    const readNight = vi.fn<ReadNight>(() => null);
    const response = await createDigestApi('/runs', readNight).request('/missing');

    expect(response.status).toBe(404);
    expect(readNight).toHaveBeenCalledWith('/runs', 'missing');
  });
});
