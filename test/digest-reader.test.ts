import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const directories: string[] = [];

function runs(contents: string) {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  directories.push(dir);
  writeFileSync(join(dir, `${night}.jsonl`), contents);
  return dir;
}

function event(overrides: Record<string, unknown> = {}) {
  return { at: '2026-10-29T01:00:00+01:00', job: 'job', status: 'ok', owner: 'rook', ...overrides };
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readNight', () => {
  it('reads the real night without changing its five jobs or bad line', () => {
    const before = readFileSync(`runs/${night}.jsonl`, 'utf8');
    const result = readNight('runs', night)!;
    expect(result.night).toBe(night);
    expect(result.invalidLines).toBe(1);
    expect(result.totals).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(result.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(result.rows[0].owner).toBeNull();
    expect(result.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503', hasFailed: false,
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(result.rows[2]).toMatchObject({ runs: 8, retries: 1, lastError: 'lock held' });
    expect(result.rows[3]).toMatchObject({ hasFailed: true, lastStatus: 'fail', lastError: 'quota exceeded' });
    expect(readFileSync(`runs/${night}.jsonl`, 'utf8')).toBe(before);
  });

  it('orders instants across offsets and retains failures and the latest provided error', () => {
    const dir = runs([
      event({ at: '2026-10-29T04:00:00+02:00', owner: null }),
      event({ at: '2026-10-29T02:30:00+01:00', status: 'retry', error: 'new error' }),
      event({ at: '2026-10-29T03:00:00+03:00', status: 'fail', owner: 'old owner', error: 'old error' }),
      event({ at: '2026-10-29T01:45:00Z', error: null }),
    ].map((value) => JSON.stringify(value)).join('\n'));
    expect(readNight(dir, night)?.rows).toEqual([{
      job: 'job', owner: null, runs: 4, retries: 1, lastStatus: 'ok',
      lastError: 'new error', hasFailed: true,
      firstAt: '2026-10-29T03:00:00+03:00', lastAt: '2026-10-29T04:00:00+02:00',
    }]);
  });

  it('breaks timestamp ties by file order, including an empty provided error', () => {
    const dir = runs([
      event({ status: 'fail', error: 'failure' }),
      event({ status: 'retry', error: '' }),
      { at: '2026-10-29T00:00:00Z', job: 'job', status: 'ok' },
    ].map((value) => JSON.stringify(value)).join('\n'));
    expect(readNight(dir, night)?.rows[0]).toMatchObject({
      owner: null, lastStatus: 'ok', lastError: '', hasFailed: true,
      firstAt: '2026-10-29T01:00:00+01:00', lastAt: '2026-10-29T00:00:00Z',
    });
  });

  it('counts invalid JSON and malformed events once each, ignoring blank lines', () => {
    const invalid = [null, [], 42, {}, event({ job: '' }), event({ job: '  ' }),
      event({ status: 'unknown' }), event({ owner: 3 }), event({ error: {} }),
      event({ at: 'tomorrow' }), event({ at: '2026-02-30T01:00:00Z' }),
      event({ at: '2026-10-29T01:00:00' }), event({ at: 123 })];
    const dir = runs(['\n ', 'broken json', ...invalid.map((value) => JSON.stringify(value)), JSON.stringify(event())].join('\r\n'));
    expect(readNight(dir, night)).toMatchObject({
      invalidLines: invalid.length + 1, totals: { ok: 1, retry: 0, fail: 0 },
      rows: [{ runs: 1, lastError: null }],
    });
  });

  it('distinguishes missing, empty, and wholly invalid nights', () => {
    const empty = runs(' \n\r\n');
    expect(readNight(empty, '2026-10-27')).toBeNull();
    expect(readNight(empty, night)).toEqual({ night, rows: [], invalidLines: 0, totals: { ok: 0, retry: 0, fail: 0 } });
    expect(readNight(runs('null\n{'), night)).toEqual({ night, rows: [], invalidLines: 2, totals: { ok: 0, retry: 0, fail: 0 } });
  });

  it('rejects path traversal and other invalid identifiers before reading', () => {
    const dir = runs(JSON.stringify(event()));
    const child = join(dir, 'child');
    mkdirSync(child);
    for (const identifier of [`../${night}`, `${dir}/${night}`, `${night}.jsonl`, '2026-1-28', `${night}\n`]) {
      expect(readNight(child, identifier)).toBeNull();
    }
  });

  it('propagates filesystem errors other than a missing file', () => {
    const dir = runs('');
    rmSync(join(dir, `${night}.jsonl`));
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow();
  });
});
