import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

// Date.parse alone accepts dates such as February 30 by rolling into March.
function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || match[0] !== value) return null;
  const [, year, month, day] = match.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function parseEvent(line: string) {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const time = timestamp(event.at);
  if (
    time === null || typeof event.at !== 'string' ||
    typeof event.job !== 'string' || event.job.trim() === '' ||
    (event.status !== 'ok' && event.status !== 'retry' && event.status !== 'fail') ||
    (event.owner != null && typeof event.owner !== 'string') ||
    (event.error != null && typeof event.error !== 'string')
  ) return null;
  return {
    at: event.at,
    time,
    job: event.job,
    status: event.status,
    owner: event.owner ?? null,
    error: event.error ?? null,
  } as const;
}

export const readNight: ReadNight = (runsDir, night) => {
  if (night.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const jobs = new Map<string, {
    row: DigestRow;
    firstTime: number;
    lastTime: number;
    lastErrorTime: number;
  }>();
  const totals: Record<RunStatus, number> = { ok: 0, retry: 0, fail: 0 };
  let invalidLines = 0;

  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const event = parseEvent(line);
    if (!event) {
      invalidLines++;
      continue;
    }
    totals[event.status]++;
    let job = jobs.get(event.job);
    if (!job) {
      job = {
        row: {
          job: event.job,
          owner: event.owner,
          runs: 0,
          retries: 0,
          lastStatus: event.status,
          lastError: null,
          firstAt: event.at,
          lastAt: event.at,
          hasFailed: false,
        },
        firstTime: event.time,
        lastTime: event.time,
        lastErrorTime: -Infinity,
      };
      jobs.set(event.job, job);
    }
    const { row } = job;
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (event.status === 'fail') row.hasFailed = true;
    if (event.time < job.firstTime) {
      job.firstTime = event.time;
      row.firstAt = event.at;
    }
    if (event.time >= job.lastTime) {
      job.lastTime = event.time;
      row.lastAt = event.at;
      row.owner = event.owner;
      row.lastStatus = event.status;
    }
    if (event.error !== null && event.time >= job.lastErrorTime) {
      job.lastErrorTime = event.time;
      row.lastError = event.error;
    }
  }

  const rows = [...jobs.values()].map(({ row }) => row);
  rows.sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { night, rows, invalidLines, totals };
};
