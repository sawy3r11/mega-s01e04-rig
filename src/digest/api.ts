import { Hono } from 'hono';
import type { ReadNight } from './types.js';

export function createDigestApi(runsDir: string, readNight: ReadNight) {
  const api = new Hono();

  api.get('/:night', (c) => {
    const digest = readNight(runsDir, c.req.param('night'));
    if (digest === null) return c.notFound();
    return c.json(digest);
  });

  return api;
}
